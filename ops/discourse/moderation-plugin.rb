# frozen_string_literal: true

# name: graviquest-pulsar-moderation
# about: Review eligible public queued posts with GraviQuest Pulsar.
# version: 1.0.0

require "json"
require "net/http"

after_initialize do
  module ::GraviQuestPulsarModeration
    CONFIG = "/shared/graviquest-integration/pulsar-moderation.json"
    ENDPOINT = URI("https://graviquest.com/api/forum/moderation/classify/")
    PREFIX = "[GraviQuest Pulsar v1]"
    REASONS = {
      "ordinary_discussion" => "Clear ordinary community discussion",
      "targeted_threat" => "Clear targeted threat",
      "credential_solicitation" => "Clear solicitation of credentials",
      "unsolicited_bulk_advertising" => "Clear unsolicited bulk advertising",
      "policy_uncertainty" => "Needs human judgment",
      "provider_unavailable" => "Classifier unavailable after retries",
      "daily_budget_reached" => "Daily model budget reached",
    }.freeze
    REJECTIONS = %w[targeted_threat credential_solicitation unsolicited_bulk_advertising].freeze
    QUEUE_REASONS = %w[group new_topics_unless_allowed_groups].freeze
    CURSOR = "graviquest:pulsar-moderation:cursor"
    CATEGORIES = %w[open-question ai-in-research discovery computable-universe corrections propose-a-topic lab-results introductions].freeze

    def self.config
      return unless File.file?(CONFIG) && (File.stat(CONFIG).mode & 0o007).zero?
      config = JSON.parse(File.read(CONFIG, 8192))
      return unless %w[observe apply].include?(config["mode"]) && config["token"].is_a?(String) && config["token"].length >= 48
      return unless valid_pilot_ids?(config["pilot_author_ids"])
      # Real member rollout is an explicit, server-only switch, never the
      # default. Observe/apply pilots remain restricted to exact QA identities.
      return unless [true, false, nil].include?(config["production_members"])
      cutoff = Time.iso8601(config.fetch("starts_at"))
      slugs = config.fetch("categories") & CATEGORIES
      actor = User.find_by(username_lower: config.fetch("actor").downcase)
      return unless SiteSetting.auto_silence_first_post_regex.blank? && actor&.active? && actor.moderator? && !actor.admin? && !actor.suspended? && !slugs.empty?
      [config, cutoff, slugs, actor]
    rescue ArgumentError, KeyError, TypeError, NoMethodError, SystemCallError
      nil
    end

    def self.valid_pilot_ids?(ids)
      ids.is_a?(Array) && ids.size.between?(1, 10) && ids.all? { |id| id.is_a?(Integer) && id.positive? }
    end

    def self.eligible?(item, slugs, guardian)
      return false unless item.is_a?(ReviewableQueuedPost) && item.pending? && !item.potential_spam
      author, topic, room = item.target_created_by, item.topic, item.category
      room ||= topic&.category
      return false unless author&.active? && !author.staff? && !author.staged? && !author.silenced? && !author.suspended?
      reasons = item.reviewable_scores.pluck(:user_id, :reviewable_score_type, :reason)
      return false unless reasons.one? && reasons.first[0] == Discourse.system_user.id &&
        reasons.first[1] == ReviewableScore.types[:needs_approval] && QUEUE_REASONS.include?(reasons.first[2])
      return false if item.reviewable_notes.where.not(user_id: guardian.user.id).exists?
      return false unless room && !room.read_restricted? && slugs.include?(room.slug)
      return false if item.topic_id && (!topic || topic.private_message? || topic.closed? || topic.archived? ||
        topic.deleted_at || topic.category_id != room.id || !topic.visible)
      return false if topic && ReviewableClaimedTopic.exists?(topic_id: topic.id)
      # Native Guardian#can_see? accepts categories/topics, not ReviewableQueuedPost.
      # can_see?(item) returns nil even for a real moderator, silently skipping
      # all legitimate system-generated approval queue entries. Validate the
      # permitted public category instead, alongside the strict reviewable score,
      # moderator identity, author state and author posting ACL checks above.
      return false if SiteSetting.reviewable_claiming == "required" || !guardian.user.moderator? ||
        guardian.user.admin? || !guardian.can_see?(room)
      author_guardian = Guardian.new(author)
      allowed = topic ? author_guardian.can_create?(Post, topic) : author_guardian.can_create?(Topic, room)
      return false unless allowed
      data = item.payload
      body = data&.[]("raw")
      title = (topic&.title || data&.[]("title")).to_s
      return false unless data.present? && !data["via_email"] && !data["is_warning"] && !data["featured_link"] &&
        body.is_a?(String) && body.present? && body.length <= 3000 &&
        !body.match?(%r{https?://|upload://|/uploads/|\[poll|<[^>]*>}i) && title.length <= 300
      watch = WordWatcher.new("#{title} #{body}")
      !watch.requires_approval? && !watch.should_silence?
    end

    def self.classify(config, item)
      request = Net::HTTP::Post.new(ENDPOINT)
      request["Authorization"] = "Bearer #{config.fetch('token')}"
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(submission: "#{item.id}:#{item.version}",
        title: (item.topic&.title || item.payload["title"]).to_s, body: item.payload.fetch("raw"))
      response = Net::HTTP.start(ENDPOINT.host, ENDPOINT.port, nil, use_ssl: true,
        open_timeout: 4, read_timeout: 18) { |http| http.request(request) }
      return unless response.code == "200" && response.body.bytesize <= 1024
      value = JSON.parse(response.body)
      return unless value.is_a?(Hash) && REASONS.key?(value["reason"])
      decision, reason = value.values_at("decision", "reason")
      if decision == "review" || (decision == "approve" && reason == "ordinary_discussion") ||
          (decision == "reject" && REJECTIONS.include?(reason))
        [decision, reason]
      end
    rescue JSON::ParserError, Timeout::Error, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError
      nil
    end

    def self.process(item, config, slugs, actor)
      guardian = Guardian.new(actor)
      return unless (config["production_members"] == true ||
        config.fetch("pilot_author_ids").include?(item.target_created_by_id)) && eligible?(item, slugs, guardian)
      version = item.version
      marker = "#{PREFIX} version=#{version} mode=#{config.fetch('mode')} "
      return if item.reviewable_notes.where(user_id: actor.id).where("content LIKE ?", "#{marker}%").exists?
      decision = classify(config, item)
      return unless decision

      # Native approval can release a silenced user. Lock the current author row
      # and recheck status alongside the item revision before invoking it.
      author = item.target_created_by
      author.with_lock do
        item.with_lock do
          next unless item.target_created_by_id == author.id
          item.target_created_by = author
          next unless item.version == version && eligible?(item, slugs, guardian)
          next if item.reviewable_notes.where(user_id: actor.id).where("content LIKE ?", "#{marker}%").exists?
          outcome, reason = decision
          applied = false
          if config["mode"] == "apply" && outcome != "review"
            action = outcome == "approve" ? :approve_post : :revise_and_reject_post
            result = item.perform(actor, action, version: version, guardian: guardian,
              revise_custom_reason: REASONS.fetch(reason),
              revise_feedback: "A staff reviewer can reconsider this decision.")
            applied = result.success?
          end
          item.reviewable_notes.create!(user: actor,
            content: "#{marker}decision=#{outcome} applied=#{applied}. #{REASONS.fetch(reason)}.")
        end
      end
    end

    def self.run
      config, cutoff, slugs, actor = self.config
      return unless config
      mode = config.fetch("mode")
      scope = ReviewableQueuedPost.pending.where(created_at: cutoff..2.minutes.ago)
      unless config["production_members"] == true
        scope = scope.where(target_created_by_id: config.fetch("pilot_author_ids"))
      end
      scope = scope.where.not(id: ReviewableNote.where(user_id: actor.id)
        .joins(:reviewable).where("reviewable_notes.content LIKE concat(?, reviewables.version, ?)",
          "#{PREFIX} version=", " mode=#{mode} %").select(:reviewable_id))
      scope = scope.left_joins(:topic).where("topics.id IS NULL OR topics.deleted_at IS NULL")
      category_ids = Category.where(slug: slugs, read_restricted: false).select(:id)
      scope = scope.where(Reviewable.arel_table[:category_id].in(category_ids.arel)
        .or(Topic.arel_table[:category_id].in(category_ids.arel)))
      cursor_key = "#{CURSOR}:#{mode}"
      cursor = Discourse.redis.get(cursor_key).to_i
      batch = scope.where("reviewables.id > ?", cursor).order(:id).limit(30).to_a
      if batch.empty?
        Discourse.redis.del(cursor_key)
        return
      end
      guardian = Guardian.new(actor)
      candidates = 0
      batch.each do |item|
        if eligible?(item, slugs, guardian)
          begin
            process(item, config, slugs, actor)
          rescue StandardError => error
            Rails.logger.warn("GraviQuest Pulsar review failed for item #{item.id}: #{error.class}")
          end
          candidates += 1
        end
        Discourse.redis.set(cursor_key, item.id)
        break if candidates == 4
      end
    end
  end

  class ::Jobs::GraviQuestPulsarReview < ::Jobs::Scheduled
    every 1.minute

    def execute(_args)
      ::GraviQuestPulsarModeration.run
    end
  end
end
