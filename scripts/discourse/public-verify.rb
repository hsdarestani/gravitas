# Real public browser acceptance uses Django-owned identities. This script only
# exports non-secret native IDs, verifies their actual mappings, and removes
# the exact recorded test users/posts/votes. Existing users are never selected.
require "json"
root="/shared/graviquest-integration"
path="#{root}/public-users.json"
exit unless File.exist?(path)
state=JSON.parse(File.read(path))
raise "Unrecognized public acceptance state" unless state["managed_by"]=="graviquest-public-acceptance-v1" && state["token"].match?(/\A[0-9a-f]{16}\z/)
mode=ARGV.first || ENV.fetch("GQ_PUBLIC_MODE","metadata")
links=JSON.parse(File.read("#{root}/links.json")).fetch("links")
if mode=="metadata"
  poll_post=Topic.find(links.find{|x|x["key"]=="next-topic-poll"}.fetch("topic_id")).first_post
  poll=Poll.find_by!(post_id:poll_post.id)
  content=links.find{|x|x["source"]=="static"} || links.find{|x|x["content_id"]}
  state["native"]={"public_category_id"=>Category.find_by!(slug:"introductions").id,
    "private_category_id"=>Category.find_by!(slug:"research-discussions").id,
    "poll_post_id"=>poll_post.id,"poll_name"=>poll.name,"poll_option"=>poll.poll_options.first.digest,
    "content_key"=>content&.fetch("key"),"content_topic_id"=>content&.fetch("topic_id")}
  File.write(path,JSON.pretty_generate(state))
  puts "Native public acceptance metadata prepared."
elsif mode=="verify"
  results=JSON.parse(File.read("#{root}/public-results.json"))
  raise "Wrong acceptance token" unless results["token"]==state["token"] && results["browser_sso_verified"]
  state.fetch("users").each do |role,data|
    records=SingleSignOnRecord.where(external_id:"graviquest:#{data.fetch('id')}")
    raise "Identity duplicated" unless records.count==1
    user=records.first.user
    raise "Wrong mapped identity" unless user.email==data.fetch("email") && !user.admin?
    raise "Wrong moderator authority" unless user.moderator? == (role=="moderator")
    raise "Wrong private group authority" unless user.groups.exists?(name:"researchers") == (%w[moderator researcher].include?(role))
  end
  member=SingleSignOnRecord.find_by!(external_id:"graviquest:#{state['users']['member']['id']}").user
  topic=Topic.find(results.fetch("topic_id"))
  raise "Public discussion did not persist" unless topic.user_id==member.id && topic.title.include?(state['token'])
  raise "Real poll vote missing" unless PollVote.exists?(user_id:member.id,poll_id:Poll.find_by!(post_id:state['native']['poll_post_id']).id)
  state["public_verified"]=true;File.write(path,JSON.pretty_generate(state))
  puts "Public Django identity mappings, roles, moderated discussion, reply, file and vote persistence verified."
elsif mode=="cleanup"
  state.fetch("users").each do |role,data|
    expected="gq-launch-#{state['token']}-#{role}@example.com"
    raise "Cleanup email mismatch" unless data['email']==expected
    record=SingleSignOnRecord.find_by(external_id:"graviquest:#{data.fetch('id')}")
    next unless record
    user=record.user
    raise "Cleanup identity mismatch" unless user.email==expected && !user.admin?
    user.update!(moderator:false)
    UserDestroyer.new(Discourse.system_user).destroy(user,delete_posts:true)
    raise "Acceptance identity remains" if User.exists?(user.id)
  end
  if state['public_verified']
    acceptance=JSON.parse(File.read("#{root}/acceptance-results.json"))
    acceptance['browser_sso_verified']=true
    acceptance['public_acceptance_cleanup_complete']=true
    File.write("#{root}/acceptance-results.json",JSON.pretty_generate(acceptance))
  end
  puts "Removed only recorded public forum acceptance identities, posts and votes."
else
  raise "Unknown public acceptance mode"
end
