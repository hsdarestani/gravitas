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
// 2026-11-19, third pass. With This Week's Question and House Rules brought
// back from forum.html, the controls around the list were all capsules: the
// room chips, sort chips, a rounded search box and its button. The rooms stay
// chips (they are the Forum's rooms, and read well that way); the rest stops
// being capsules. Search is a plain field with its icon and no button (Enter
// searches), and sort is one segmented control beside it (Latest | Top,
// shaped like the search field, not like a chip, and set apart from the
// table's column names), and the week's question opens its
// thread with a text link.
// House Rules sit under the list (house-rules.gjs, outlet after-topic-list).
//
// 2026-11-19, fourth pass: one page, not two. The front page and a room had
// different heads (the week's question on one, the room's own head on the
// other), so every switch between them moved the row of rooms and the page
// jumped however the scroll was patched. Now every list page (All, Top, each
// room) has the same head and the same week's card, and what belongs to a
// room (its name, its line, Open the Topic and New thread side by side) is a
// band under the row of rooms. Nothing above the row changes, so switching
// is filtering in place: the row stays put without any scroll correction.
// Sort works in a room too (Discourse's /c/<room>/<id>/l/top).
//
// Public rooms and their order are managed in Discourse Category management.
// Native category permissions remain authoritative; no theme release is needed.
import Component from "@glimmer/component";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";

function publicRoom(category, byId) {
  const seen = new Set();
  while (category) {
    if (category.read_restricted || category.slug === "uncategorized" || seen.has(category.id)) {
      return false;
    }
    seen.add(category.id);
    if (!category.parent_category_id) return true;
    category = byId.get(category.parent_category_id);
  }
  return false;
}

// A Topic's room links back to its published page (forum_rooms.json topic_url),
// as the approved prototype's "Open the Topic" button does.
const TOPIC_PAGES = {
  "ai-in-research": "https://graviquest.com/topic-answer-that-looked-right.html",
};

// This week's question is the current Topic's question (2026-11-19, the
// owner: "the week's question is Topic 01's question"), not a separate room:
// Topic 01's title (backend/core/topic_seed/topic-01.json) and its Discussion
// thread, key "answer-that-looked-right" in the ai-in-research room of
// backend/core/forum_rooms.json. The link goes through the backend's
// /api/forum/open/<key>/, which resolves that key to the thread on Discourse,
// so it follows the backend rather than a thread number written here. When the
// next Topic opens, change these three lines.
const WEEK = {
  topic: "AI in Research",
  question: "Is AI reliable in research?",
  url: "https://graviquest.com/api/forum/open/answer-that-looked-right/",
};

// On a phone the rooms are one line that scrolls sideways; the chosen room is
// brought into that line's view (the line scrolls, never the page). Runs on
// insert and again whenever the chosen room changes.
const revealChosen = modifier((element, [chosen]) => {
  const chip = element.querySelector(".gq-chip.is-active");
  if (!chip || element.scrollWidth <= element.clientWidth) {
    return;
  }
  const pad = parseFloat(getComputedStyle(element).paddingLeft) || 0;
  const left = chip.offsetLeft - element.offsetLeft - pad;
  const right = left + chip.offsetWidth + 2 * pad;
  if (left < element.scrollLeft || right > element.scrollLeft + element.clientWidth) {
    element.scrollLeft = chosen ? left : 0;
  }
});

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
    const categories = this.site.categories || [];
    const byId = new Map(categories.map((c) => [c.id, c]));
    const current = this.category?.id;
    return categories.filter((c) => publicRoom(c, byId))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({ slug: c.slug, name: c.name, url: c.url, active: c.id === current }));
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

  // Latest and Top for the list in view: the whole Forum, or this room.
  get latestUrl() {
    return this.category ? this.category.url : "/latest";
  }

  get topUrl() {
    return this.category ? `${this.category.url}/l/top?period=all` : "/top?period=all";
  }

  get week() {
    return WEEK;
  }

  // Only admins open rooms and threads (2026-11-22, the owner). Each thread
  // is one opening post by the team; members reply to it, and to each other
  // under it, and like. So Start a Thread and New thread are drawn for an
  // admin only: offered to a member or a visitor, they promised something
  // neither can do.
  get canStartThread() {
    return !!this.currentUser?.admin;
  }

  // An admin's new thread starts in this room.
  @action
  newThread(event) {
    event.preventDefault();
    this.composer.openNewTopic({ category: this.category });
  }

  // Switching room or sort is filtering one list, so the page stays where
  // the reader is. A plain link could reload the whole page, and on every
  // route change Discourse's route-scroll-manager sends a new page to the top
  // with one document.scrollingElement.scrollTo(). So the switch goes through
  // the router and swallows that one scrollTo: an own property that deletes
  // itself when called, or after three seconds if it never is, and only if a
  // later switch has not put its own in place. The head above the row is the
  // same on every list page, so nothing else needs correcting. A modified
  // click (new tab, new window) is left to the browser.
  @action
  switchList(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const scroller = document.scrollingElement;
    const release = () => {
      if (scroller.scrollTo === release) {
        delete scroller.scrollTo;
      }
    };
    scroller.scrollTo = release;
    setTimeout(release, 3000);
    // A redirect inside the transition rejects it with TransitionAborted; the
    // redirected transition still lands.
    this.router.transitionTo(event.currentTarget.getAttribute("href")).catch(() => {});
  }

  <template>
    <header class="gq-page-top gq-forum-home">
      <div>
        <span class="gq-eyebrow">Community · Forum</span>
        <h1>Forum</h1>
        <p class="gq-lead">Discuss each Topic’s question, share what you found, and ask about GraviQuest itself. Every thread is open to read.</p>
      </div>
      {{! Admins only. In a room, New thread in the room's band is this
          action; the head keeps the button's place so nothing above the
          rooms moves. }}
      {{#if this.canStartThread}}
        <a class="btn btn-primary gq-page-top__action {{if this.category 'gq-is-held'}}" href="/new-topic" aria-hidden={{if this.category "true"}} tabindex={{if this.category "-1"}}>Start a Thread</a>
      {{/if}}
    </header>
    <section class="gq-week" aria-labelledby="gq-week-title">
      <div class="gq-week__text">
        <h2 class="gq-week__label" id="gq-week-title">This Week’s Question · {{this.week.topic}}</h2>
        <p class="gq-week__question">{{this.week.question}}</p>
        <a class="gq-week__link" href={{this.week.url}}>Join the Thread <span aria-hidden="true">→</span></a>
      </div>
      {{! The brand's well: a line that dips where a mass sits, as the site's
          loading mark draws it. Decoration only. }}
      <svg class="gq-week__well" viewBox="0 0 240 96" aria-hidden="true" focusable="false">
        <path d="M0 40 H62 C92 40 98 78 120 78 C142 78 148 40 178 40 H240" />
        <circle cx="120" cy="69" r="7" />
      </svg>
    </section>
    <div class="gq-filters">
      <nav class="gq-chips" aria-label="Rooms" {{revealChosen this.category.slug}}>
        <a class="gq-chip {{unless this.category 'is-active'}}" href="/latest" aria-current={{unless this.category "page"}} {{on "click" this.switchList}}>All</a>
        {{#each this.chips key="slug" as |chip|}}
          <a class="gq-chip {{if chip.active 'is-active'}}" href={{chip.url}} data-room={{chip.slug}} aria-current={{if chip.active "page"}} {{on "click" this.switchList}}>{{chip.name}}</a>
        {{/each}}
      </nav>
      <div class="gq-tools">
        <nav class="gq-sort" aria-label="Sort threads">
          <a class="gq-sort__option {{if this.isLatest 'is-active'}}" href={{this.latestUrl}} aria-current={{if this.isLatest "page"}} {{on "click" this.switchList}}>Latest</a>
          <a class="gq-sort__option {{if this.isTop 'is-active'}}" href={{this.topUrl}} aria-current={{if this.isTop "page"}} {{on "click" this.switchList}}>Top</a>
        </nav>
        <form class="gq-search" action="/search" method="get" role="search">
          <input type="search" name="q" placeholder="Search threads" aria-label="Search threads" />
        </form>
      </div>
    </div>
    {{#if this.category}}
      <section class="gq-room" aria-labelledby="gq-room-title">
        <div class="gq-room__text">
          <h2 class="gq-room__title" id="gq-room-title">{{this.category.name}}</h2>
          {{#if this.category.description_text}}
            <p class="gq-room__lead">{{this.category.description_text}}</p>
          {{/if}}
        </div>
        <div class="gq-room__actions">
          {{#if this.topicPage}}
            <a class="btn btn-default" href={{this.topicPage}}>Open the Topic</a>
          {{/if}}
          {{#if this.canStartThread}}
            <a class="btn btn-primary gq-new-thread" href="/new-topic" {{on "click" this.newThread}}>New thread</a>
          {{/if}}
        </div>
      </section>
    {{/if}}
  </template>
}
