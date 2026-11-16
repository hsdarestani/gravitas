# frozen_string_literal: true

require "json"
require "digest"
require "tempfile"

module GraviQuestModerationSettings
  KEYS = %w[
    approve_unless_allowed_groups approve_new_topics_unless_allowed_groups
    approve_post_count approve_suspect_users fast_typing_threshold
    auto_silence_fast_typers_on_first_post auto_silence_fast_typers_max_trust_level
    auto_silence_first_post_regex num_users_to_silence_new_user
    silence_new_user_sensitivity notify_mods_when_user_silenced newuser_spam_host_threshold
    high_trust_flaggers_auto_hide_posts hide_post_sensitivity max_new_accounts_per_registration_ip
    reviewable_claiming
  ].freeze

  def self.live
    KEYS.to_h { |key| [key, SiteSetting.public_send(key).to_s] }
  end

  def self.compare(path)
    data = JSON.parse(File.read(path))
    raise "Invalid moderation snapshot" unless data["format"] == 1 && data.fetch("settings").keys.sort == KEYS.sort
    current = live
    changed = current.keys.reject { |key| current[key] == data["settings"][key] }
    raise "Moderation settings differ from the saved snapshot: #{changed.join(', ')}" if changed.any?
  end

  def self.capture(path)
    raise "Snapshot already exists" if File.exist?(path)
    snapshot = JSON.pretty_generate(format: 1, captured_at: Time.current.iso8601, settings: live) + "\n"
    Tempfile.create([".moderation-", ".json"], File.dirname(path)) do |file|
      file.chmod(0o600)
      file.write(snapshot)
      file.flush
      file.fsync
      File.link(file.path, path)
    end
    compare(path)
    puts "Verified scoped Discourse policy snapshot: SHA-256 #{Digest::SHA256.hexdigest(snapshot)}"
  end
end

if ENV["GQ_MODERATION_SETTINGS_MODE"]
  path = ENV.fetch("GQ_MODERATION_SETTINGS_FILE")
  case ENV.fetch("GQ_MODERATION_SETTINGS_MODE")
  when "capture" then GraviQuestModerationSettings.capture(path)
  when "compare" then GraviQuestModerationSettings.compare(path)
  else raise "Unknown moderation snapshot operation"
  end
end
