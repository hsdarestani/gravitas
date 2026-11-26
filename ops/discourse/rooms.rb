# frozen_string_literal: true
# Explicit initial seed only. The normal theme deployment must not overwrite
# live category metadata, permissions, threads, or activity.
unless ENV["GQ_SEED_ROOMS"] == "1"
  puts "Skipping room seed: live rooms are managed in Discourse admin."
  exit 0
end

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
                                color: "003049", text_color: "f1efec",
                                permissions: { "everyone" => CategoryGroup.permission_types[:create_post],
                                               "admins" => CategoryGroup.permission_types[:full] })
  end
  describe(category, room.fetch("description"), system_user)
  room.fetch("threads").each { |thread| keep_thread(category, thread, system_user) }
  category
end

SiteSetting.default_navigation_menu_categories = rooms.map(&:id).join("|")

# Replies an admin deleted stay in Discourse as soft-deleted posts, and staff
# keep seeing each one as a "deleted" stub in its thread. The test replies of
# November 2026 were deleted by hand from the admin panel and their stubs
# stayed (2026-11-22, the owner: only each thread's opening post should
# remain). In the team's threads, a reply that is already deleted is removed
# for good. Nothing that is not deleted is touched, and an opening post never
# is. Safe to repeat: once purged there is nothing left to find.
purged = 0
rooms.each do |category|
  Topic.where(category_id: category.id).pluck(:id).each do |topic_id|
    Post.with_deleted.where(topic_id: topic_id).where.not(deleted_at: nil).where("post_number > 1").find_each do |post|
      begin
        PostDestroyer.new(Discourse.system_user, post, force_destroy: true, context: "GraviQuest purge of deleted replies").destroy
      rescue StandardError => e
        puts "PostDestroyer could not remove post #{post.id} (#{e.class}); removing the row"
      end
      # Whatever Discourse's own path left behind (nothing, when it worked).
      Post.with_deleted.where(id: post.id).delete_all
      purged += 1
    end
    Topic.reset_highest(topic_id) if Topic.respond_to?(:reset_highest)
  end
end
puts "Deleted replies removed for good: #{purged}"

# The likes and views of the testing weeks go too (2026-11-22, the owner: as
# the test replies were removed, their likes and views should be). In the
# listed rooms every like is deleted, each post's like and read counts and
# each thread's like and view counts go to zero, the per-visitor view records
# that Discourse counts views from are emptied, and the like counters on the
# profiles of everyone who gave or received one are counted again.
#
# Once only, unlike the purge above: from launch on, likes and views are real
# and a theme release must never wipe them. The date it ran is kept in the
# plugin store; delete that row to run it again.
reset_key = "likes_views_reset_20261122"
if PluginStore.get("graviquest", reset_key).blank?
  like = PostActionType.types[:like]
  topic_ids = Topic.with_deleted.where(category_id: rooms.map(&:id)).pluck(:id)
  post_ids = Post.with_deleted.where(topic_id: topic_ids).pluck(:id)
  likes = PostAction.with_deleted.where(post_id: post_ids, post_action_type_id: like)
  touched = (likes.distinct.pluck(:user_id) + Post.with_deleted.where(id: likes.select(:post_id)).distinct.pluck(:user_id)).uniq
  ActiveRecord::Base.transaction do
    removed = likes.delete_all
    UserAction.where(target_post_id: post_ids, action_type: [UserAction::LIKE, UserAction::WAS_LIKED]).delete_all
    Post.with_deleted.where(id: post_ids).update_all(like_count: 0, reads: 0)
    Topic.with_deleted.where(id: topic_ids).update_all(like_count: 0, views: 0)
    TopicViewItem.where(topic_id: topic_ids).delete_all
    TopicViewStat.where(topic_id: topic_ids).delete_all if defined?(TopicViewStat)
    UserStat.where(user_id: touched).find_each do |stat|
      stat.update_columns(
        likes_given: PostAction.where(user_id: stat.user_id, post_action_type_id: like).count,
        likes_received: UserAction.where(user_id: stat.user_id, action_type: UserAction::WAS_LIKED).count,
      )
    end
    puts "Likes removed: #{removed}; views reset on #{topic_ids.size} threads"
  end
  PluginStore.set("graviquest", reset_key, Time.now.utc.iso8601)
else
  puts "Likes and views were reset on #{PluginStore.get('graviquest', reset_key)}; not again"
end

# Each thread in a room shows one line of its opening post, as the approved
# prototype does (2026-11-18). Discourse sends excerpts only for pinned threads
# unless this hidden setting is on; a Discourse without it keeps its default.
if SiteSetting.respond_to?(:always_include_topic_excerpts=) && !SiteSetting.always_include_topic_excerpts
  SiteSetting.always_include_topic_excerpts = true
end
puts "GraviQuest rooms in step with forum_rooms.json: #{rooms.map(&:slug).join(', ')}"
