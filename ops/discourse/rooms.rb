# frozen_string_literal: true

# The Forum's rooms and the team's threads in them, made to match
# backend/core/forum_rooms.json.
#
# Run with the container's Rails runner, from the theme release directory that
# .github/workflows/forum-theme.yml uploads (GQ_THEME_RELEASE). It runs before
# the theme is applied, so the theme never lists a room that does not exist.
# Safe to repeat: each step compares first and changes only what differs.
#
# Why (2026-11-18). The Forum had grown ten rooms, a weekly question card, a
# poll, a chip row and a table, and a visitor could not tell where to go. The
# owner asked for the minimum: three rooms with the team's threads in them.
# Topic 01 is one room holding three threads (its videos, its essays, its
# discussion). Members read, reply, like and may start threads, held for
# review, exactly as before.
#
# Permissions. Rooms it creates get the same access as every other public
# room (bootstrap.rb), and listed rooms keep theirs. Since 2026-11-19 rooms
# that are not in the list are made admin-only (see the end of this file).
#
# What it does:
# - creates each missing room, and keeps each room's name in step;
# - writes each room's description into its "About the … category" post,
#   which is where Discourse keeps a category's description;
# - posts each of the team's threads once, as the system account, and keeps
#   its title and text in step (never a member's post);
# - for a thread marked existing, keeps it in its room and its title in step,
#   and leaves its text alone;
# - makes the rooms the default menu for visitors;
# - names the system account GraviQuest;
# - makes every room that is not in the list admin-only.
require "json"

release = Pathname.new(ENV.fetch("GQ_THEME_RELEASE"))
spec = JSON.parse(release.join("forum_rooms.json").read)
system_user = Discourse.system_user

# The team's threads are posted by the system account, and every post, card
# and profile showed it as "system" (2026-11-19). Its display name is the
# community's; the username stays "system", which Discourse relies on.
system_user.update!(name: "GraviQuest") if system_user.name != "GraviQuest"

def describe(category, text, user)
  post = category.topic&.first_post
  return if post.nil? || post.raw.strip == text
  PostRevisor.new(post).revise!(user, { raw: text }, skip_validations: true, bypass_bump: true)
end

def find_thread(keys)
  field = TopicCustomField.where(name: "graviquest_content_key", value: keys).order(:id).first
  field && Topic.find_by(id: field.topic_id)
end

def keep_thread(category, thread, user)
  topic = find_thread([thread.fetch("key"), *thread.fetch("also_keys", [])])
  if topic.nil?
    raise "Existing thread #{thread.fetch('key')} not found" if thread["existing"]
    return ActiveRecord::Base.transaction do
      post = PostCreator.create!(user, title: thread.fetch("title"), raw: thread.fetch("body"),
                                       category: category.id, skip_validations: true)
      TopicCustomField.create!(topic_id: post.topic_id, name: "graviquest_content_key", value: thread.fetch("key"))
      post.topic
    end
  end
  post = topic.first_post
  changes = {}
  changes[:title] = thread.fetch("title") if topic.title != thread.fetch("title")
  changes[:category_id] = category.id if topic.category_id != category.id
  changes[:raw] = thread.fetch("body") if !thread["existing"] && post.raw.strip != thread.fetch("body").strip
  PostRevisor.new(post, topic).revise!(user, changes, skip_validations: true, bypass_bump: true) if changes.any?
  topic
end

rooms = spec.fetch("rooms").map do |room|
  category = Category.find_by(slug: room.fetch("slug"))
  if category
    category.update!(name: room.fetch("name")) if category.name != room.fetch("name")
  else
    category = Category.create!(name: room.fetch("name"), slug: room.fetch("slug"), user: system_user,
                                color: "003049", text_color: "f1efec", permissions: { "everyone" => 1 })
  end
  describe(category, room.fetch("description"), system_user)
  room.fetch("threads").each { |thread| keep_thread(category, thread, system_user) }
  category
end

SiteSetting.default_navigation_menu_categories = rooms.map(&:id).join("|")

# Rooms that are not in the list are admin-only (2026-11-19, the owner: "make
# the old rooms private, so nobody sees them; moderators see only the three
# rooms"). Until then they were only unlisted, and their threads still showed
# on profiles, in search filters and at their URLs. Admins keep full access,
# so nothing is lost and a room can be listed again by adding it to
# forum_rooms.json. Moderators are not admins, so they see the three rooms
# only. A room's own sub-rooms stay as they are, and Uncategorized, which
# Discourse does not let anyone restrict, is skipped. Safe to repeat: a room
# that is already admin-only is not touched.
listed = rooms.map(&:id)
admins = Group::AUTO_GROUPS[:admins]
admin_only = [[admins, CategoryGroup.permission_types[:full]]]
closed = Category.transaction do
  Category
    .where.not(id: listed)
    .where.not(id: SiteSetting.uncategorized_category_id)
    .where("parent_category_id IS NULL OR parent_category_id NOT IN (?)", listed)
    .to_a
    .filter_map { |category|
      next if category.read_restricted && category.category_groups.pluck(:group_id, :permission_type) == admin_only
      category.set_permissions(admins: :full)
      # Discourse checks each room against its parent as it is saved, so a
      # sub-room closed before its parent (or a parent before its sub-room)
      # fails half way. Every room in this set ends admin-only, which is
      # consistent, so they are saved without that check, in one transaction.
      category.save!(validate: false)
      category.slug
    }
end
puts "Rooms made admin-only: #{closed.any? ? closed.join(', ') : 'none'}"

# Each thread in a room shows one line of its opening post, as the approved
# prototype does (2026-11-18). Discourse sends excerpts only for pinned threads
# unless this hidden setting is on; a Discourse without it keeps its default.
if SiteSetting.respond_to?(:always_include_topic_excerpts=) && !SiteSetting.always_include_topic_excerpts
  SiteSetting.always_include_topic_excerpts = true
end
puts "GraviQuest rooms in step with forum_rooms.json: #{rooms.map(&:slug).join(', ')}"
