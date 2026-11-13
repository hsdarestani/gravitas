import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { service } from "@ember/service";
import { htmlSafe } from "@ember/template";
import { popupAjaxError } from "discourse/lib/ajax-error";
import DiscourseURL from "discourse/lib/url";
import DRelativeDate from "discourse/ui-kit/d-relative-date";
import dBoundAvatarTemplate from "discourse/ui-kit/helpers/d-bound-avatar-template";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import dNumber from "discourse/ui-kit/helpers/d-number";

export const ThreadBreadcrumb = <template>
  {{#if @outletArgs.model.category}}
    <nav class="gq-thread-crumb container" aria-label="Discussion breadcrumb">
      <a href="https://graviquest.com/forum.html">Forum</a>
      <span aria-hidden="true">/</span>
      <a href={{@outletArgs.model.category.url}}>{{@outletArgs.model.category.name}}</a>
    </nav>
  {{/if}}
</template>;

export const ThreadByline = <template>
  {{#if @outletArgs.model.category}}
    {{#if @outletArgs.model.details.created_by}}
      <p class="gq-thread-byline">
        Started by
        {{@outletArgs.model.details.created_by.username}}
        <DRelativeDate @date={{@outletArgs.model.created_at}} />
      </p>
    {{/if}}
  {{/if}}
</template>;

export class ThreadRail extends Component {
  @service appEvents;
  @tracked position = 1;
  @tracked jumping = false;

  constructor() {
    super(...arguments);
    this.appEvents.on("topic:current-post-scrolled", this, this.updatePosition);
    registerDestructor(this, () => {
      this.appEvents.off("topic:current-post-scrolled", this, this.updatePosition);
    });
  }

  get topic() {
    return this.args.outletArgs.topic;
  }

  get total() {
    return this.topic.postStream.filteredPostsCount || this.topic.posts_count || 1;
  }

  get current() {
    return Math.min(this.position, this.total);
  }

  get positionLabel() {
    return [this.current, this.total].map((n) => String(n).padStart(2, "0")).join(" / ");
  }

  // How far down the thread the reader is, drawn as the filled part of the
  // timeline track, as Discourse's own timeline does with its scroller.
  get progressStyle() {
    const share = this.total > 1 ? (this.current - 1) / (this.total - 1) : 1;
    return htmlSafe(`--gq-progress: ${Math.round(share * 100)}%`);
  }

  get previousDisabled() {
    return this.jumping || this.current <= 1;
  }

  get nextDisabled() {
    return this.jumping || this.current >= this.total;
  }

  get participants() {
    return this.topic.details.participants?.slice(0, 5);
  }

  updatePosition({ postIndex }) {
    if (Number.isInteger(postIndex) && postIndex > 0) {
      this.position = postIndex;
    }
  }

  @action previous() {
    return this.goTo(this.current - 1);
  }

  @action next() {
    return this.goTo(this.current + 1);
  }

  async goTo(index) {
    if (this.jumping || index < 1 || index > this.total) {
      return;
    }

    this.jumping = true;
    const topic = this.topic;
    const stream = topic.postStream;
    try {
      let post;
      if (stream.isMegaTopic) {
        post = await stream.loadPostByPostNumber(index);
      } else {
        const id = stream.stream[index - 1];
        if (!id) {
          return;
        }
        post = stream.findLoadedPost(id);
        if (!post) {
          [post] = await stream.findPostsByIds([id]);
        }
      }

      if (post && !this.isDestroying && this.topic === topic) {
        this.appEvents.trigger("topic:jump-to-post", post.id);
        DiscourseURL.routeTo(topic.urlForPostNumber(post.post_number), { keepFilter: true });
      }
    } catch (error) {
      popupAjaxError(error);
    } finally {
      if (!this.isDestroying) {
        this.jumping = false;
      }
    }
  }

  <template>
    {{#if this.topic.category}}
      <aside class="gq-thread-rail" aria-label="This thread">
        <div class="gq-thread-steps" role="group" aria-label="Move between posts">
          <span class="gq-thread-track" style={{this.progressStyle}} aria-hidden="true"></span>
          <span class="gq-thread-when"><DRelativeDate @date={{this.topic.created_at}} /></span>
          <span aria-live="polite" class="gq-thread-position">{{this.positionLabel}}</span>
          <span class="gq-thread-when"><DRelativeDate @date={{this.topic.last_posted_at}} /></span>
          <span class="gq-thread-arrows">
            <button class="gq-thread-arrow" type="button" aria-label="Previous post"
              disabled={{this.previousDisabled}} {{on "click" this.previous}}>
              {{dIcon "chevron-up"}}
            </button>
            <button class="gq-thread-arrow" type="button" aria-label="Next post"
              disabled={{this.nextDisabled}} {{on "click" this.next}}>
              {{dIcon "chevron-down"}}
            </button>
          </span>
        </div>
        <dl class="gq-thread-facts">
          <div><dt>Replies</dt><dd>{{dNumber this.topic.replyCount}}</dd></div>
          <div><dt>Views</dt><dd>{{dNumber this.topic.views}}</dd></div>
          <div><dt>Likes</dt><dd>{{dNumber this.topic.like_count}}</dd></div>
          <div>
            <dt>Last reply</dt>
            <dd><DRelativeDate @date={{this.topic.last_posted_at}} /></dd>
          </div>
        </dl>
        {{#if this.participants.length}}
          <div class="gq-thread-talking">
            <p>Talking</p>
            <ul>
              {{#each this.participants as |participant|}}
                <li title={{if participant.name participant.name participant.username}}>
                  {{dBoundAvatarTemplate participant.avatar_template "small"}}
                  <span class="gq-thread-name">{{if participant.name participant.name participant.username}}</span>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </aside>
    {{/if}}
  </template>
}
