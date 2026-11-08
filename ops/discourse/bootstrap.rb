# Run with the official container's Rails runner. No core modifications.
# Retrying creates no additional official threads and never edits member posts.
require "json"
root = "/shared/graviquest-integration"
settings_file = JSON.parse(File.read("#{root}/environment.json"))
manifest = JSON.parse(File.read("#{root}/content.json"))
system_user = Discourse.system_user

SiteSetting.title = "GraviQuest Forum"
SiteSetting.site_description = "Good questions pull people together."
SiteSetting.navigation_menu = "sidebar"
SiteSetting.discourse_connect_url = "https://graviquest.com/api/forum/sso/"
SiteSetting.discourse_connect_secret = settings_file.fetch("GRAVITAS_DISCOURSE_CONNECT_SECRET")
SiteSetting.enable_discourse_connect = true
SiteSetting.discourse_connect_csrf_protection = true
SiteSetting.discourse_connect_overrides_avatar = true
SiteSetting.auth_overrides_name = true
SiteSetting.logout_redirect = "https://graviquest.com/api/forum/signed-out/"
SiteSetting.enable_local_logins = false
SiteSetting.enable_local_logins_via_email = false
SiteSetting.enable_local_logins_via_code = false
SiteSetting.enable_signup_cta = false
SiteSetting.approve_unless_allowed_groups = "1|2"
SiteSetting.approve_new_topics_unless_allowed_groups = "1|2"
SiteSetting.backup_frequency = 1
SiteSetting.maximum_backups = 14
SiteSetting.backup_with_uploads = true
SiteSetting.force_https = true
SiteSetting.tagging_enabled = true
SiteSetting.tag_topic_allowed_groups = "1|2|10"
SiteSetting.poll_enabled = true
SiteSetting.poll_create_allowed_groups = "1|2|10"
SiteSetting.post_voting_enabled = true
SiteSetting.topic_voting_enabled = true
SiteSetting.notification_email = settings_file.fetch("DISCOURSE_NOTIFICATION_EMAIL")

# Native secure uploads require private S3-compatible storage. Local uploads
# remain suitable for this loopback staging installation, but launch.sh refuses
# public activation until the private attachment path can enforce its ACLs.
s3_fields = {
  "s3_access_key_id" => "DISCOURSE_S3_ACCESS_KEY_ID",
  "s3_secret_access_key" => "DISCOURSE_S3_SECRET_ACCESS_KEY",
  "s3_region" => "DISCOURSE_S3_REGION",
  "s3_upload_bucket" => "DISCOURSE_S3_UPLOAD_BUCKET",
}
if s3_fields.values.all? { |key| settings_file[key].present? }
  s3_fields.each { |setting, key| SiteSetting.public_send("#{setting}=", settings_file.fetch(key)) }
  SiteSetting.s3_endpoint = settings_file["DISCOURSE_S3_ENDPOINT"] if settings_file["DISCOURSE_S3_ENDPOINT"].present?
  SiteSetting.enable_s3_uploads = true
  SiteSetting.secure_uploads = true
end

%w[researchers reviewers].each do |name|
  Group.find_or_create_by!(name: name) do |g|
    g.visibility_level = Group.visibility_levels[:members]
    g.members_visibility_level = Group.visibility_levels[:members]
  end
end

def category(name, slug, permissions, parent: nil)
  existing = Category.find_by(slug: slug)
  if existing
    # Fail rather than silently changing an existing category's security.
    # Discourse deliberately stores public/full access as an empty ACL rather
    # than an everyone row. Compare the core's normalized representation.
    restricted, expected = Category.resolve_permissions(permissions)
    actual = existing.category_groups.pluck(:group_id, :permission_type)
    raise "Category ACL differs: #{slug}" unless existing.read_restricted == restricted && actual.sort == expected.sort
    return existing
  end
  Category.create!(name: name, slug: slug, user: Discourse.system_user,
                   color: "003049", text_color: "f1efec", parent_category: parent,
                   permissions: permissions)
end

rooms = {}
[
  ["The Open Question", "open-question"],
  ["Topic 01 · AI in Research", "ai-in-research"],
  ["Topic 04 · Computable universe", "computable-universe"],
  ["Corrections", "corrections"], ["Propose a Topic", "propose-a-topic"],
  ["Lab results", "lab-results"], ["Introductions", "introductions"],
].each { |name, slug| rooms[slug] = category(name, slug, {"everyone" => 1}) }
proposal_room = rooms.fetch("propose-a-topic")
proposal_room.custom_fields[DiscourseTopicVoting::ENABLE_TOPIC_VOTING_SETTING] = true
proposal_room.save_custom_fields
%w[official for-the-reading against not-sure].each { |name| Tag.find_or_create_by!(name: name) }
private_room = category("Research discussions", "research-discussions", {"researchers" => 1, "reviewers" => 1})
category("Peer review", "peer-review", {"reviewers" => 1}, parent: private_room)
SiteSetting.default_navigation_menu_categories = rooms.values.map(&:id).join("|")

def official_topic(key, title, raw, room, version: nil)
  record = TopicCustomField.find_by(name: "graviquest_content_key", value: key)
  return Topic.find(record.topic_id) if record
  ActiveRecord::Base.transaction do
    post = PostCreator.create!(Discourse.system_user, title: title, raw: raw, category: room.id,
                              tags: ["official"], skip_jobs: false)
    TopicCustomField.create!(topic_id: post.topic_id, name: "graviquest_content_key", value: key)
    TopicCustomField.create!(topic_id: post.topic_id, name: "graviquest_content_version", value: version) if version
    post.topic
  end
end

links = []
question = official_topic("weekly-thought-experiment", "Has science been done when prediction works but explanation is missing?",
  "**Official GraviQuest Open Question**\n\nThis is a thought experiment, not a report of a research finding.\n\nA model predicts a material’s behaviour correctly, repeatedly, and nobody, including its authors, can say why. Has science been done?\n\nChoose a position, then say why. Cite evidence where you make an empirical claim. Member posts are reviewed before publication.\n\n[Community](https://graviquest.com/community#this-week)", rooms.fetch("open-question"))
links << {key: "weekly-thought-experiment", topic_id: question.id, category_id: question.category_id}
poll = official_topic("next-topic-poll", "Which question should GraviQuest explore next?",
  "**Official GraviQuest editorial poll**\n\nThese are proposed Topics, not published findings. No votes or engagement have been seeded.\n\n[poll type=regular results=always]\n* What does peer review actually catch?\n* Who pays for science, and what does that buy?\n* Can we model a living cell?\n* Why do most findings shrink when someone repeats them?\n[/poll]\n\nHave another question? Start a discussion in Propose a Topic and explain why it matters.", rooms.fetch("propose-a-topic"))
links << {key: "next-topic-poll", topic_id: poll.id, category_id: poll.category_id}
manifest.fetch("published_content").each do |item|
  room = case item.fetch("key")
         when "answer-that-looked-right", "ai-in-research" then rooms.fetch("ai-in-research")
         when "computable-universe" then rooms.fetch("computable-universe")
         else rooms.fetch("open-question")
         end
  topic = official_topic(item.fetch("key"), "Discuss: #{item.fetch('title')}",
    "**Official discussion of a published GraviQuest Topic**\n\n[Read the published material](#{item.fetch('url')}).\n\nWhich claim needs a stronger source? What is the strongest objection to the reading? Bring a reference or say what remains uncertain.\n\nContent version at discussion creation: `#{item.fetch('version')}`. Later edits do not silently change this version marker.", room, version: item.fetch("version"))
  links << {key: item.fetch("key"), content_id: item.fetch("id"), topic_id: topic.id,
            source: item.fetch("source", "cms"),
            category_id: topic.category_id, version: TopicCustomField.find_by(topic_id: topic.id, name: "graviquest_content_version")&.value || item.fetch("version")}
end
File.write("#{root}/links.json", JSON.pretty_generate(links: links))

scheme = ColorScheme.find_by(name: "GraviQuest") || ColorScheme.create_from_base(
  name: "GraviQuest", base_scheme_id: -2, colors: {
    primary: "f1efec", secondary: "00131d", tertiary: "d4c9be", quaternary: "9ec4da",
    header_background: "001a28", header_primary: "f1efec", highlight: "003049",
    selected: "003049", hover: "013a58", danger: "c9705f", success: "6f9c8f", love: "d4c9be",
  })
theme = RemoteTheme.import_theme_from_directory("#{root}/theme", theme_id: Theme.find_by(name: "GraviQuest Community")&.id)
raise "Theme validation failed" unless theme.persisted? && theme.errors.empty?
theme.update!(color_scheme_id: scheme.id, user_selectable: true)
theme.update_setting(:next_topic_poll_id, poll.id)
theme.update_javascript_cache!
theme.theme_fields.each(&:ensure_baked!)
raise "Theme compilation failed" if theme.theme_fields.where.not(error: [nil, ""]).exists?
%i[common_theme desktop_theme mobile_theme].each { |target| Stylesheet::Manager.new(theme_id: theme.id).stylesheet_data(target) }
SiteSetting.default_theme_id = theme.id
logo_file = File.open("#{root}/logos/Logotype_White.svg")
logo = UploadCreator.new(logo_file, "GraviQuest.svg", type: "branding").create_for(system_user.id)
raise "Brand logo validation failed" unless logo.persisted?
SiteSetting.logo = logo.id
SiteSetting.mobile_logo = logo.id

# This key can look up the mapped account and revoke its sessions, and nothing
# else. It never enters the theme, a public endpoint, or the browser.
key_file = "#{root}/logout-api-key"
unless File.exist?(key_file)
  key = ApiKey.new(user: system_user, created_by: system_user, description: "GraviQuest session revocation", scope_mode: :granular)
  key.api_key_scopes.build(resource: "users", action: "show")
  key.api_key_scopes.build(resource: "users", action: "log_out")
  key.save!
  File.write(key_file, key.key, mode: "w", perm: 0600)
end
puts "GraviQuest forum configured: #{rooms.size} public rooms, private research and peer review, #{links.size} official links. No engagement seeded."
