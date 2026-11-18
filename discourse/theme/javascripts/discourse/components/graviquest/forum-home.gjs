// The Forum's front page and each room's head.
//
// 2026-11-18. The owner asked for the Forum to be as plain as a feed: open it,
// see three rooms (what the Forum is, what GraviQuest is, Topic 01), open one,
// read, reply, like, or start a thread (held for review, as always). The page
// head is the one graviquest.com/forum.html already uses (eyebrow, h1, lead);
// under it the rooms are that page's rows. common.scss hides Discourse's own
// list on the front page, so this is the whole page.
//
// Which rooms, and in what order, is backend/core/forum_rooms.json; the slugs
// below must match it (core/test_forum_rooms.py fails otherwise), and
// ops/discourse/rooms.rb creates them on Discourse before every theme release.
// Names and descriptions are read from Discourse, never written here. Thread
// and reply counts and the last activity come from each room's own latest
// list; a room whose list cannot be read shows its name and line, no figures.
import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { service } from "@ember/service";
import { ajax } from "discourse/lib/ajax";
import DRelativeDate from "discourse/ui-kit/d-relative-date";

const ROOMS = ["about-the-forum", "about-graviquest", "ai-in-research"];

// A Topic's room links back to its published page (forum_rooms.json topic_url),
// as the approved prototype's "Open the Topic" button does.
const TOPIC_PAGES = {
  "ai-in-research": "https://graviquest.com/topic-answer-that-looked-right.html",
};

export default class GraviQuestForumHome extends Component {
  @service site;
  @service currentUser;
  @tracked figures = {};

  constructor() {
    super(...arguments);
    if (!this.category) this.loadFigures();
  }

  get category() {
    return this.args.outletArgs?.category;
  }

  get topicPage() {
    return TOPIC_PAGES[this.category?.slug];
  }

  get categories() {
    const bySlug = new Map(this.site.categories.map((c) => [c.slug, c]));
    return ROOMS.map((slug) => bySlug.get(slug)).filter(Boolean);
  }

  get rooms() {
    return this.categories.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      description: c.description_text,
      ...(this.figures[c.id] || {}),
    }));
  }

  async loadFigures() {
    const figures = {};
    await Promise.all(this.categories.map(async (c) => {
      try {
        const data = await ajax(`/c/${c.slug}/${c.id}/l/latest.json`);
        const about = c.topic_url?.split("/").pop();
        const topics = (data.topic_list?.topics || []).filter((t) => String(t.id) !== about);
        figures[c.id] = {
          known: true,
          threads: topics.length,
          replies: topics.reduce((n, t) => n + Math.max(0, (t.posts_count || 1) - 1), 0),
          last: topics.map((t) => t.last_posted_at).filter(Boolean).sort().pop(),
        };
      } catch {
        // No figures rather than wrong ones.
      }
    }));
    if (!this.isDestroying && !this.isDestroyed) this.figures = figures;
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
        {{#if this.topicPage}}
          <a class="btn btn-default gq-page-top__action" href={{this.topicPage}}>Open the Topic</a>
        {{/if}}
      </header>
    {{else}}
      <section class="gq-forum-heading gq-forum-home">
        <header class="gq-page-top">
          <div>
            <span class="gq-eyebrow">Community · Forum</span>
            <h1>Forum</h1>
            <p class="gq-lead">A few rooms, set up by the team. Read any thread without an account; sign in when you want to reply.</p>
          </div>
          {{! forum.html's one action. A visitor is asked to sign in first. }}
          <a class="btn btn-primary gq-page-top__action" href="/new-topic">Start a Thread</a>
        </header>
        <div class="gq-roomlist">
          <div class="gq-roomrow gq-roomrow--head" aria-hidden="true">
            <span>Room</span><span class="gq-n gq-n--threads">Threads</span><span class="gq-n">Replies</span><span class="gq-n">Activity</span>
          </div>
          <ol class="gq-rooms">
            {{#each this.rooms key="id" as |room|}}
              <li>
                <a class="gq-roomrow" href={{room.url}}>
                  <span class="gq-roomrow__main">
                    <span class="gq-roomrow__name">{{room.name}}</span>
                    {{#if room.description}}<span class="gq-roomrow__desc">{{room.description}}</span>{{/if}}
                  </span>
                  {{#if room.known}}
                    <span class="gq-n gq-n--threads">{{room.threads}}</span>
                    <span class="gq-n">{{room.replies}}</span>
                    <span class="gq-n gq-n--age">{{#if room.last}}<DRelativeDate @date={{room.last}} />{{/if}}</span>
                  {{else}}
                    <span class="gq-n gq-n--threads"></span><span class="gq-n"></span><span class="gq-n gq-n--age"></span>
                  {{/if}}
                </a>
              </li>
            {{/each}}
          </ol>
        </div>
      </section>
    {{/if}}
  </template>
}
