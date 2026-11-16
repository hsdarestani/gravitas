import Component from "@glimmer/component";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import Poll from "discourse/plugins/poll/discourse/components/poll";
import { ajax } from "discourse/lib/ajax";

export default class GraviQuestCommunitySidebar extends Component {
  @service store;
  @service currentUser;
  @tracked post;
  @tracked poll;
  @tracked topic;
  @tracked error = false;

  constructor() {
    super(...arguments);
    this.loadPoll();
  }

  @action
  async loadPoll() {
    const id = Number(settings.next_topic_poll_id);
    if (!id) return;
    this.error = false;
    try {
      const data = await ajax(`/t/${id}.json`);
      if (this.isDestroying || this.isDestroyed) return;
      const raw = data.post_stream.posts.find((post) => post.post_number === 1);
      if (!raw?.polls?.length) throw new Error("Poll not available");
      this.topic = data;
      this.post = this.store.createRecord("post", {
        ...raw,
        topic: this.store.createRecord("topic", data),
      });
      this.poll = raw.polls[0];
    } catch {
      if (!this.isDestroying && !this.isDestroyed) this.error = true;
    }
  }

  get canUseEmbeddedPoll() {
    return !this.currentUser || this.topic.details?.can_create_post === true;
  }

  get pollUrl() {
    return `/t/${this.topic.id}`;
  }

  <template>
    <aside class="gq-community-sidebar" aria-label="Community information">
      {{#if this.poll}}
        <section class="gq-roomcard gq-community-poll">
          <h2>Vote on the next Topic</h2>
          {{#if this.canUseEmbeddedPoll}}
            <Poll @post={{this.post}} @poll={{this.poll}} />
          {{else}}
            <p>Voting requires permission to reply in the poll thread. If your account is on hold, check your Forum messages for next steps.</p>
            <a href={{this.pollUrl}}>Open the poll thread</a>
          {{/if}}
        </section>
      {{else if this.error}}
        <section class="gq-roomcard">
          <h2>The next Topic</h2><p>The poll could not be loaded.</p>
          <button type="button" class="btn" {{on "click" this.loadPoll}}>Try again</button>
        </section>
      {{/if}}
      <section class="gq-roomcard">
        <h2>One community</h2>
        <p>Good questions pull people together. Your GraviQuest account belongs here too.</p>
        <a href="https://graviquest.com/community">How the community works</a>
      </section>
      <section class="gq-roomcard">
        <h2>House rules</h2>
        <ol><li>Commit to a position, then say why.</li><li>Cite it, or say you cannot.</li><li>A moderator reads member posts before publication.</li></ol>
        <a href="/guidelines">Read the guidelines</a>
      </section>
    </aside>
  </template>
}
