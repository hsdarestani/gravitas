# frozen_string_literal: true

# Read-only snapshot on the pinned Discourse version. Keep the report private
# because even numeric IDs can refer to restricted or private topics.
require "json"

ActiveRecord::Base.transaction(isolation: :repeatable_read) do
  ActiveRecord::Base.connection.execute("SET TRANSACTION READ ONLY")
  topics = Topic.where(archetype: Archetype.default, deleted_at: nil)
  report = { format: 1, captured_at: Time.current.iso8601, threads: 0, polls: 0,
             posts: [], likes: [], post_like_integrity: [], views: [], poll_integrity: [], legacy_anonymous_polls: 0 }
  topics.find_in_batches(batch_size: 200) do |batch|
    ids = batch.map(&:id)
    live_posts = Post.where(topic_id: ids, deleted_at: nil)
    post_totals = live_posts.where(Topic.public_post_types_sql).group(:topic_id).count
    # Match Topic#update_action_counts: native Post default scope excludes
    # deleted posts. Whispers don't contribute to a thread's Like count.
    like_totals = live_posts.where.not(post_type: Post.types[:whisper]).group(:topic_id).sum(:like_count)
    raw_likes = PostAction.where(post_id: live_posts.select(:id), deleted_at: nil,
      post_action_type_id: PostActionType.types[:like]).group(:post_id).count
    live_posts.pluck(:id, :like_count).each do |post_id, stored|
      source = raw_likes.fetch(post_id, 0)
      report[:post_like_integrity] << { post_id: post_id, stored: stored, source: source } if stored != source
    end
    view_totals = TopicViewStat.where(topic_id: ids).group(:topic_id)
      .sum(Arel.sql("anonymous_views + logged_in_views"))
    batch.each do |topic|
      report[:threads] += 1
      { posts: [topic.posts_count, post_totals.fetch(topic.id, 0)],
        likes: [topic.like_count, like_totals.fetch(topic.id, 0)],
        views: [topic.views, view_totals.fetch(topic.id, 0)] }.each do |kind, (stored, source)|
        report[kind] << { topic_id: topic.id, stored: stored, source: source } if stored != source
      end
    end
  end
  Poll.where(post_id: Post.where(topic_id: topics.select(:id), deleted_at: nil).select(:id)).find_in_batches do |polls|
    Poll.preload!(polls)
    polls.each do |poll|
      report[:polls] += 1
      report[:legacy_anonymous_polls] += 1 if poll.anonymous_voters.to_i.positive?
      rows = poll.poll_votes
      distinct = rows.distinct.count(:user_id)
      options = poll.poll_options
      orphaned = rows.where.not(poll_option_id: options.map(&:id)).count
      if poll.voters_count != distinct || orphaned.positive? ||
          options.any? { |option| option.voters_count != rows.where(poll_option_id: option.id).count }
        report[:poll_integrity] << { poll_id: poll.id, orphaned: orphaned }
      end
    end
  end
  destination = ENV.fetch("GQ_FORUM_AUDIT_FILE")
  File.open(destination, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
    file.write(JSON.pretty_generate(report) + "\n")
  end
  puts JSON.generate(report.transform_values { |value| value.is_a?(Array) ? value.size : value })
end
