// The Forum's front page head and each room's head.
//
// 2026-11-18, second pass. The first pass made the front page a list of three
// rooms. Seen live, the owner preferred graviquest.com/forum.html's page,
// which this Forum has now replaced (that URL redirects here): one list of
// every thread, filtered by room with a row of chips, sorted Latest or Top,
// and searchable. So the front page is that page's head, its chips, its
// search and Discourse's own thread list (common.scss draws the list as
// forum.html's table). A room's page keeps its own head, with Open the Topic
// and New thread side by side as in the approved prototype, and the same
// chips with that room lit, so moving between rooms reads as filtering one
// list.
//
// Which rooms, and in what order, is backend/core/forum_rooms.json; the slugs
// below must match it (core/test_forum_rooms.py fails otherwise), and
// ops/discourse/rooms.rb creates them on Discourse before every theme release.
// Names are read from Discourse, never written here.
import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";

const ROOMS = ["about-the-forum", "about-graviquest", "ai-in-research"];

// A Topic's room links back to its published page (forum_rooms.json topic_url),
// as the approved prototype's "Open the Topic" button does.
const TOPIC_PAGES = {
  "ai-in-research": "https://graviquest.com/topic-answer-that-looked-right.html",
};

export default class GraviQuestForumHome extends Component {
  @service site;
  @service currentUser;
  @service composer;
  @service router;

  get category() {
    return this.args.outletArgs?.category;
  }

  get topicPage() {
    return TOPIC_PAGES[this.category?.slug];
  }

  get chips() {
    const bySlug = new Map(this.site.categories.map((c) => [c.slug, c]));
    const current = this.category?.slug;
    return ROOMS.map((slug) => bySlug.get(slug))
      .filter(Boolean)
      .map((c) => ({ slug: c.slug, name: c.name, url: c.url, active: c.slug === current }));
  }

  get sort() {
    const name = this.router.currentRouteName || "";
    return name.includes("top") ? "top" : "latest";
  }

  get isLatest() {
    return this.sort === "latest";
  }

  get isTop() {
    return this.sort === "top";
  }

  // A member's thread starts in this room; a visitor is asked to sign in,
  // as Discourse's own button does.
  @action
  newThread(event) {
    event.preventDefault();
    if (!this.currentUser) {
      window.location.href = "/login";
      return;
    }
    this.composer.openNewTopic({ category: this.category });
  }

  <template>
    {{#if this.category}}
      <header class="gq-page-top gq-room-head">
        <div>
          <nav class="gq-crumb" aria-label="Breadcrumb"><a href="/">Forum</a></nav>
          <h1>{{this.category.name}}</h1>
          {{#if this.category.description_text}}
            <p class="gq-lead">{{this.category.description_text}}</p>
          {{/if}}
        </div>
        <div class="gq-page-top__action gq-room-actions">
          {{#if this.topicPage}}
            <a class="btn btn-default" href={{this.topicPage}}>Open the Topic</a>
          {{/if}}
          <a class="btn btn-primary gq-new-thread" href="/new-topic" {{on "click" this.newThread}}>New thread</a>
        </div>
      </header>
    {{else}}
      <header class="gq-page-top gq-forum-home">
        <div>
          <span class="gq-eyebrow">Community · Forum</span>
          <h1>Forum</h1>
          <p class="gq-lead">A few rooms, set up by the team. Read any thread without an account; sign in when you want to reply.</p>
        </div>
        <a class="btn btn-primary gq-page-top__action" href="/new-topic">Start a Thread</a>
      </header>
    {{/if}}
    <div class="gq-filters">
      <nav class="gq-chips" aria-label="Rooms">
        <a class="gq-chip {{unless this.category 'is-active'}}" href="/latest" aria-current={{unless this.category "page"}}>All</a>
        {{#each this.chips key="slug" as |chip|}}
          <a class="gq-chip {{if chip.active 'is-active'}}" href={{chip.url}} data-room={{chip.slug}} aria-current={{if chip.active "page"}}>{{chip.name}}</a>
        {{/each}}
      </nav>
      <form class="gq-search" action="/search" method="get" role="search">
        <input type="search" name="q" placeholder="Search threads" aria-label="Search threads" />
        <button class="btn btn-default" type="submit">Search</button>
      </form>
    </div>
    {{#unless this.category}}
      <nav class="gq-chips gq-chips--sort" aria-label="Sort">
        <a class="gq-chip {{if this.isLatest 'is-active'}}" href="/latest">Latest</a>
        <a class="gq-chip {{if this.isTop 'is-active'}}" href="/top">Top</a>
      </nav>
    {{/unless}}
  </template>
}
