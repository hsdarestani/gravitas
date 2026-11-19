// A post's bookmark as a plain toggle (2026-11-19, at the owner's request).
//
// Discourse's bookmark button opens a menu on the first click (Bookmarked!,
// then remind me in two hours, tomorrow, in three days, custom) and an
// "Edit bookmark" dialog after that, with a name field, an "after you are
// notified" choice and a list of reminder times. The owner wants none of it:
// one click keeps the post, the next click lets it go. So this replaces the
// stock button in the post menu (graviquest.js) and talks to the same two
// endpoints the stock manager uses, POST /bookmarks and DELETE
// /bookmarks/:id, then updates the post through its own createBookmark and
// deleteBookmark so the icon, the topic's bookmarked flag and the profile's
// Bookmarks list stay as Discourse keeps them. A bookmark made here has no
// name and no reminder.
//
// It does not go through PostBookmarkManager: that reads the flat thread's
// topic controller, which the nested replies view does not fill.
import Component from "@glimmer/component";
import { action } from "@ember/object";
import DButton from "discourse/components/d-button";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";

export default class BookmarkToggle extends Component {
  static shouldRender(args) {
    return !!args.post?.canBookmark;
  }

  // Never folded behind the "…" button: it sits beside the like.
  static hidden() {
    return false;
  }

  busy = false;

  get bookmarked() {
    return !!this.args.post?.bookmarked;
  }

  get title() {
    return this.bookmarked ? "Remove bookmark" : "Bookmark this post";
  }

  @action
  async toggle() {
    const post = this.args.post;
    if (!post || this.busy) {
      return;
    }
    this.busy = true;
    try {
      if (this.bookmarked && post.bookmark_id) {
        const result = await ajax(`/bookmarks/${post.bookmark_id}.json`, {
          type: "DELETE",
        });
        post.deleteBookmark(!!result?.topic_bookmarked);
      } else {
        const result = await ajax("/bookmarks.json", {
          type: "POST",
          data: { bookmarkable_id: post.id, bookmarkable_type: "Post" },
        });
        post.createBookmark({
          id: result.id,
          reminder_at: null,
          name: null,
        });
      }
    } catch (error) {
      popupAjaxError(error);
    } finally {
      this.busy = false;
    }
  }

  <template>
    <DButton
      class="post-action-menu__bookmark bookmark btn-flat no-text btn-icon
        {{if this.bookmarked 'bookmarked'}}"
      @icon={{if this.bookmarked "bookmark" "far-bookmark"}}
      @translatedTitle={{this.title}}
      @translatedAriaLabel={{this.title}}
      @action={{this.toggle}}
      aria-pressed={{if this.bookmarked "true" "false"}}
      ...attributes
    />
  </template>
}
