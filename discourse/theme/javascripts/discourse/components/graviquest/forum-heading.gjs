import Component from "@glimmer/component";
import { service } from "@ember/service";
export default class GraviQuestForumHeading extends Component {
  @service site;
  @service currentUser;
  get hasQuestion() { return Number(settings.open_question_topic_id) > 0; }
  get questionURL() { return `/t/${Number(settings.open_question_topic_id)}`; }
  get allCurrent() { return this.args.outletArgs?.category ? undefined : "page"; }
  // The curated order first; any other top-level room the reader can see
  // follows by its position. A fixed list alone hid rooms created later
  // (Topic 04 · Computable universe had threads in the list and no chip).
  // Discourse's own defaults stay out of the row.
  get rooms() {
    const order = ["open-question", "ai-in-research", "discovery", "computable-universe", "corrections", "propose-a-topic", "lab-results", "introductions", "research-discussions", "peer-review"];
    const skip = ["uncategorized", "general", "site-feedback", "staff"];
    const rank = (c) => (order.includes(c.slug) ? order.indexOf(c.slug) : order.length + (c.position ?? 0));
    return this.site.categories
      .filter((c) => !c.parent_category_id && !skip.includes(c.slug))
      .sort((a, b) => rank(a) - rank(b))
      .map((c) => ({
      id:c.id, name:c.name, url:c.url,
      current:c.id === this.args.outletArgs?.category?.id ? "page" : undefined,
    }));
  }
  <template>
    <section class="gq-forum-heading">
      <span class="gq-chapter">Community · Forum</span><h1>The Forum</h1>
      {{! A member was told to sign in while signed in. }}
      {{#if this.currentUser}}
        <p>Every Topic has a room. Reply to any thread, or start one of your own.</p>
      {{else}}
        <p>Every Topic has a room. Read any thread without an account; sign in to reply, like or start one.</p>
      {{/if}}
      {{#if this.hasQuestion}}
        <div class="gq-pinned-question"><div><h2>This Week’s Question</h2>
          <p>A model predicts a material’s behaviour correctly, repeatedly, and nobody, including its authors, can say why. Has science been done?</p></div>
          <a class="btn btn-default" href={{this.questionURL}}>Join the Thread</a>
        </div>
      {{/if}}
      <nav class="gq-room-links" aria-label="Rooms">
        <a href="/latest" aria-current={{this.allCurrent}}>All</a>
        {{#each this.rooms key="id" as |room|}}
          <a href={{room.url}} aria-current={{room.current}}>{{room.name}}</a>
        {{/each}}
      </nav>
    </section>
  </template>
}
