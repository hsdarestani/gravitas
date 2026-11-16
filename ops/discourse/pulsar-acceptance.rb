# frozen_string_literal: true
# Exact-ID, disposable native Discourse acceptance for GraviQuest Pulsar.
# No real user's posts or identities are selected or modified.
require "json"
require "base64"
require "openssl"
require "uri"
require "action_dispatch/testing/integration"

ROOT = "/shared/graviquest-integration"
STATE = "#{ROOT}/pulsar-acceptance-state.json"
BOT_EXTERNAL = "graviquest-automation:pulsar-moderation-v1"
PILOT_EXTERNAL = "graviquest-automation:pulsar-acceptance-v1"

def check!(value, message)
  raise "Pulsar acceptance: #{message}" unless value
end

def login_native(external, username, email, moderator)
  s = ActionDispatch::Integration::Session.new(Rails.application)
  s.host! "forum.graviquest.com"
  s.https!
  s.get "/session/sso"
  check!(s.response.redirect?, "native SSO handshake")
  incoming = URI.decode_www_form(URI.parse(s.response.location).query).to_h
  nonce = URI.decode_www_form(Base64.strict_decode64(incoming.fetch("sso"))).to_h.fetch("nonce")
  fields = {nonce: nonce, external_id: external, username: username, email: email,
            name: (moderator ? "GraviQuest Pulsar moderation service" : "Pulsar temporary acceptance"),
            require_activation: "false", moderator: moderator.to_s, admin: "false"}
  payload = Base64.strict_encode64(URI.encode_www_form(fields))
  signature = OpenSSL::HMAC.hexdigest("SHA256", SiteSetting.discourse_connect_secret, payload)
  s.get "/session/sso_login", params: {sso: payload, sig: signature}
  check!(s.response.redirect?, "native SSO callback")
  record = SingleSignOnRecord.find_by!(external_id: external)
  check!(record.user.username == username && record.user.email == email &&
         record.user.moderator? == moderator && !record.user.admin?, "strict service identity")
  [s, record.user]
end

def session_csrf(s)
  s.get "/session/csrf.json"
  check!(s.response.status == 200, "CSRF request")
  {"X-CSRF-Token" => JSON.parse(s.response.body).fetch("csrf"),
   "X-Requested-With" => "XMLHttpRequest"}
end

def member_login
  login_native(PILOT_EXTERNAL, "gq_pulsar_pilot", "gq-pulsar-pilot@example.com", false)
end

def save_state(state)
  File.write(STATE, JSON.pretty_generate(state))
  File.chmod(0600, STATE)
end

def create_candidate(key)
  state = JSON.parse(File.read(STATE))
  s, author = member_login
  check!(author.id == state.fetch("pilot_id"), "pilot ID mismatch")
  category = Category.find_by!(slug: state.fetch("category"))
  title = "Pulsar acceptance #{key} #{state.fetch('nonce')}"
  body = "How can we distinguish reproducible observations from hypotheses in a research discussion? I propose documenting methods, measurements, uncertainty and limitations before drawing conclusions."
  s.post "/posts.json", params: {title: title, raw: body, category: category.id},
    headers: session_csrf(s), as: :json
  check!(s.response.status == 200, "member submission status #{s.response.status}")
  response = JSON.parse(s.response.body)
  check!(response["action"] == "enqueued", "submission must remain in native review queue")
  id = response.fetch("pending_post").fetch("id")
  item = ReviewableQueuedPost.find(id)
  check!(item.pending? && item.target_created_by_id == author.id, "queued pilot identity")
  # Only the disposable pilot submission is aged; this avoids a live 2-minute delay.
  item.update_columns(created_at: 3.minutes.ago)
  state["#{key}_id"] = item.id
  state["#{key}_title"] = title
  save_state(state)
  puts "Created scoped #{key} native queue fixture."
end

case ARGV.fetch(0)
when "bootstrap"
  check!(SiteSetting.enable_discourse_connect, "SSO disabled")
  check!(SiteSetting.auto_silence_first_post_regex.blank?, "unsafe moderation setting")
  actor_session, actor = login_native(BOT_EXTERNAL, "gq_pulsar_moderator",
    "gq-pulsar-moderator@example.com", true)
  pilot_session, pilot = member_login
  check!(actor.active? && actor.moderator? && !actor.admin?, "moderation actor is not a scoped moderator")
  check!(!pilot.staff? && pilot.active?, "pilot must be ordinary active member")
  state = if File.exist?(STATE)
    JSON.parse(File.read(STATE))
  else
    {"managed_by" => "gq-pulsar-acceptance-v1", "nonce" => SecureRandom.hex(6)}
  end
  check!(state["managed_by"] == "gq-pulsar-acceptance-v1", "unexpected acceptance state")
  state["actor"] = actor.username
  state["pilot_id"] = pilot.id
  state["category"] = "introductions"
  save_state(state)
  puts "Scoped moderator and disposable pilot verified; native IDs saved privately."
when "create_observe", "create_apply"
  create_candidate(ARGV[0].delete_prefix("create_"))
when "verify_observe", "verify_apply"
  state = JSON.parse(File.read(STATE))
  key = ARGV[0].delete_prefix("verify_")
  check!(defined?(GraviQuestPulsarModeration), "native plugin was not loaded")
  config = GraviQuestPulsarModeration.config
  check!(config && config[0]["mode"] == key, "worker configuration or mode mismatch")
  id = state.fetch("#{key}_id")
  item = ReviewableQueuedPost.find(id)
  GraviQuestPulsarModeration.run
  note = item.reviewable_notes.where(user_id: User.find_by!(username: state.fetch("actor")).id)
    .where("content LIKE ?", "[GraviQuest Pulsar v1] version=% mode=#{key} %").last
  check!(note, "native Pulsar decision and audit note missing")
  check!(note.content.include?("decision=approve"), "safe candidate not confidently approved")
  if key == "observe"
    check!(item.reload.pending? && note.content.include?("applied=false"), "observe must not publish")
  else
    check!(item.reload.approved? && note.content.include?("applied=true"), "apply did not approve disposable pilot")
    check!(Post.where(user_id: state.fetch("pilot_id"), raw: "How can we distinguish reproducible observations from hypotheses in a research discussion? I propose documenting methods, measurements, uncertainty and limitations before drawing conclusions.").exists?, "approved pilot post not persisted")
  end
  puts "Native Pulsar #{key} verified: confident safe decision, native audit, expected state."
when "cleanup"
  if File.exist?(STATE)
    state = JSON.parse(File.read(STATE))
    check!(state["managed_by"] == "gq-pulsar-acceptance-v1", "unexpected cleanup state")
    record = SingleSignOnRecord.find_by(external_id: PILOT_EXTERNAL)
    if record
      pilot = record.user
      check!(pilot.id == state.fetch("pilot_id") && pilot.email == "gq-pulsar-pilot@example.com" && !pilot.staff?, "pilot cleanup identity")
      UserDestroyer.new(Discourse.system_user).destroy(pilot, delete_posts: true)
      check!(!User.exists?(pilot.id), "pilot account still present")
    end
    File.delete(STATE)
  end
  puts "Removed only recorded disposable Pulsar pilot identity and its submissions."
else
  raise "Unsupported Pulsar acceptance action"
end
