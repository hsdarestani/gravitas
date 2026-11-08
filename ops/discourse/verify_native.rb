# Exercise the real production-mode Rails app, PostgreSQL, native SSO sessions,
# moderation, polls, uploads and permissions. Acceptance identities are created
# with reserved example.com addresses and recorded before any test mutations.
# The second invocation follows a container restart, verifies committed records,
# then removes only identities and topics created by this acceptance run.
require "json"
require "base64"
require "openssl"
require "uri"
require "tempfile"
require "rack/test"
require "action_dispatch/testing/integration"

def assert!(condition, message)
  raise "Forum acceptance failed: #{message}" unless condition
end

state_path = "/shared/graviquest-integration/acceptance-state.json"
root = "/shared/graviquest-integration"
links = JSON.parse(File.read("#{root}/links.json")).fetch("links")
assert!(SiteSetting.enable_discourse_connect, "SSO is required")
assert!(!SiteSetting.enable_local_logins, "duplicate password login is disabled")
assert!(SiteSetting.approve_unless_allowed_groups == "1|2", "member approval is enforced")
assert!(SiteSetting.force_https, "HTTPS remains required")
assert!(Theme.find(SiteSetting.default_theme_id).name == "GraviQuest Community", "custom theme is the default")

def browser_session
  session = ActionDispatch::Integration::Session.new(Rails.application)
  session.host! "forum.graviquest.com"
  session.https!
  session
end

def sso_login(role, token)
  s = browser_session
  s.get "/session/sso"
  assert!(s.response.redirect?, "native SSO starts")
  input = URI.decode_www_form(URI.parse(s.response.location).query).to_h
  payload = URI.decode_www_form(Base64.strict_decode64(input.fetch("sso"))).to_h
  fields = {nonce: payload.fetch("nonce"), external_id: "graviquest-acceptance:#{token}:#{role}",
            email: "graviquest-qa-#{role}-#{token}@example.com", username: "gq_qa_#{role}_#{token}",
            name: "Automated acceptance #{role}", require_activation: "false",
            admin: (role == "admin").to_s, moderator: "false",
            add_groups: (role == "research" ? "researchers" : "")}
  outbound = Base64.strict_encode64(URI.encode_www_form(fields))
  sig = OpenSSL::HMAC.hexdigest("SHA256", SiteSetting.discourse_connect_secret, outbound)
  s.get "/session/sso_login", params: {sso: outbound, sig: sig}
  assert!(s.response.redirect?, "native SSO completes for #{role}")
  user = SingleSignOnRecord.find_by!(external_id: fields[:external_id]).user
  [s, user]
end

def csrf_headers(s)
  s.get "/session/csrf.json"
  assert!(s.response.status == 200, "CSRF token is available")
  {"X-CSRF-Token" => JSON.parse(s.response.body).fetch("csrf"), "X-Requested-With" => "XMLHttpRequest"}
end

def approve_latest(user, admin)
  queued = ReviewableQueuedPost.pending.where(created_by_id: user.id).order(id: :desc).first
  assert!(queued, "member submission entered moderation")
  result = queued.perform(admin, :approve_post)
  assert!(result.success?, "moderator approved the submission")
end

if ENV["GQ_VERIFY_AFTER_RESTART"] == "1"
  state = JSON.parse(File.read(state_path))
  assert!(Topic.exists?(state.fetch("topic_id")), "discussion survived container restart")
  assert!(Post.exists?(state.fetch("reply_id")), "reply survived container restart")
  assert!(Upload.exists?(state.fetch("upload_id")), "attachment survived container restart")
  assert!(PollVote.exists?(user_id: state.fetch("member_id")), "vote survived container restart")
  s, member = sso_login("member", state.fetch("token"))
  assert!(member.id == state.fetch("member_id"), "repeat SSO maps the same account")
  s.get "/t/#{state.fetch('topic_id')}.json"
  assert!(s.response.status == 200, "discussion reloads after restart")
  # Remove only this recorded acceptance run. No production identity is selected
  # by name, email, trust level, role, or broad age-based query.
  state.fetch("topic_ids").each do |id|
    topic = Topic.with_deleted.find_by(id: id)
    next unless topic && topic.title.include?(state.fetch("token"))
    TopicDestroyer.new(Discourse.system_user, topic).destroy
  end
  state.fetch("user_ids").each do |id|
    record = SingleSignOnRecord.find_by(user_id: id, external_id: "graviquest-acceptance:#{state.fetch('token')}:#{state.fetch('roles').fetch(id.to_s)}")
    assert!(record, "cleanup is limited to recorded acceptance identities")
    user = record.user
    user.update!(admin: false, moderator: false)
    UserDestroyer.new(Discourse.system_user).destroy(user, delete_posts: true)
  end
  File.delete(state_path)
  puts "Native Discourse restart persistence and scoped acceptance cleanup passed."
  exit
end

assert!(!File.exist?(state_path), "previous acceptance state needs restart verification before another test run")
token = SecureRandom.hex(3)
admin_session, admin = sso_login("admin", token)
member_session, member = sso_login("member", token)
research_session, researcher = sso_login("research", token)
state = {token: token, member_id: member.id, user_ids: [admin.id, member.id, researcher.id],
         roles: {admin.id => "admin", member.id => "member", researcher.id => "research"}, topic_ids: []}
File.write(state_path, JSON.pretty_generate(state))

guest = browser_session
guest.get "/latest.json"
assert!(guest.response.status == 200, "public discussions load anonymously")
guest.post "/posts.json", params: {title:"Unauthorized #{token}",raw:"No CSRF token or signed-in session should be able to post here."}, as: :json
assert!([403, 422].include?(guest.response.status), "anonymous CSRF-less write is denied")

room = Category.find_by!(slug: "introductions")
raw = "Automated acceptance #{token}. This verifies real moderated discussion persistence and is removed before launch."
member_session.post "/posts.json", params: {title:"Automated forum acceptance #{token}",raw:raw,category:room.id}, headers:csrf_headers(member_session), as: :json
assert!(member_session.response.status == 200, "member can submit a discussion")
assert!(!Post.exists?(user_id:member.id,raw:raw), "member topic is not public before approval")
approve_latest(member, admin)
post = Post.find_by!(user_id:member.id,raw:raw)
state[:topic_id] = post.topic_id; state[:topic_ids] << post.topic_id
File.write(state_path, JSON.pretty_generate(state))

member_session.get "/review.json"
assert!([403,404].include?(member_session.response.status), "ordinary members cannot moderate")
private_room = Category.find_by!(slug:"research-discussions")
private_post = PostCreator.create!(admin,title:"Private acceptance #{token}",raw:"Automated private category access verification #{token}. Removed before launch.",category:private_room.id)
state[:topic_ids] << private_post.topic_id
File.write(state_path, JSON.pretty_generate(state))
[guest, member_session].each do |session|
  session.get "/t/#{private_post.topic_id}.json"
  assert!([403,404].include?(session.response.status), "private research stays private")
end
research_session.get "/t/#{private_post.topic_id}.json"
assert!(research_session.response.status == 200, "research group can access its private category")

image = Tempfile.new(["graviquest-acceptance", ".png"])
image.binmode
image.write(Base64.strict_decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3cAAAAASUVORK5CYII=")); image.flush
upload_file = Rack::Test::UploadedFile.new(image.path, "image/png")
member_session.post "/uploads.json", params: {type:"composer",file:upload_file}, headers:csrf_headers(member_session)
assert!(member_session.response.status == 200, "member can attach an actual image")
uploaded = JSON.parse(member_session.response.body)
state[:upload_id] = uploaded.fetch("id")
File.write(state_path, JSON.pretty_generate(state))
reply_raw = "Acceptance reply #{token}, with a reference to @#{admin.username} and an actual upload.\n\n![acceptance image](#{uploaded.fetch('url')})"
member_session.post "/posts.json", params: {topic_id:post.topic_id,raw:reply_raw,reply_to_post_number:1}, headers:csrf_headers(member_session), as: :json
assert!(member_session.response.status == 200, "member can submit a reply")
approve_latest(member, admin)
reply = Post.find_by!(user_id:member.id,raw:reply_raw)
assert!(reply.reply_to_post_number == 1, "native reply relationship persists")
state[:reply_id] = reply.id
File.write(state_path, JSON.pretty_generate(state))
member_session.put "/posts/#{reply.id}.json", params:{post:{raw:reply_raw + "\n\nAn edited clarification."}}, headers:csrf_headers(member_session), as: :json
assert!(member_session.response.status == 200, "member can edit their reply")

poll_link = links.find { |x| x["key"] == "next-topic-poll" }
poll_post = Topic.find(poll_link.fetch("topic_id")).first_post
poll = Poll.find_by!(post_id:poll_post.id)
option = poll.poll_options.first
member_session.put "/polls/vote", params:{post_id:poll_post.id,poll_name:poll.name,options:[option.digest]}, headers:csrf_headers(member_session), as: :json
assert!(member_session.response.status == 200, "native poll vote succeeds")
assert!(PollVote.exists?(poll_id:poll.id,user_id:member.id), "native poll vote is committed")
member_session.post "/post_actions", params:{id:poll_post.id,post_action_type_id:2}, headers:csrf_headers(member_session), as: :json
assert!([200,201].include?(member_session.response.status), "native like succeeds")

member_session.get "/search.json", params:{q:token}
assert!(member_session.response.status == 200, "native search works")
guest.get "/tag/official.json"
assert!(guest.response.status == 200, "native tag filter works")
member_session.get "/t/#{post.topic_id}.json"
assert!(member_session.response.status == 200, "real discussion reloads")
20.times do
  break if Notification.exists?(user_id:admin.id,topic_id:post.topic_id)
  sleep 1
end
assert!(Notification.exists?(user_id:admin.id,topic_id:post.topic_id), "native mention notification is persisted")
File.write(state_path, JSON.pretty_generate(state))
puts "Native SSO, moderation, replies, editing, attachments, polls, likes, search, tags, private ACLs and in-app notifications passed. Email delivery and real GraviQuest browser SSO still require public DNS/HTTPS."
