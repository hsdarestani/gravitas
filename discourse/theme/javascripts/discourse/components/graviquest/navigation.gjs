// The site's header row, inside the Forum's header: the four sections, and the
// site's one account control.
//
// Since 2026-11-17 that control on graviquest.com is "Join Us" for a visitor
// and "Forum" for a member (assets/production-bridge-core.js); the Workspace
// left the public site while it is rebuilt, and nothing links to it. Here a
// visitor gets the same "Join Us", with the site's icon, to the same page. A
// member is already in the Forum, and their avatar menu sits beside it, so
// the control has nothing to offer them and is left out.
import Component from "@glimmer/component";
import { service } from "@ember/service";

export default class GraviQuestNavigation extends Component {
  @service currentUser;

  <template>
    <div class="gq-header-links">
      <nav class="gq-site-nav" aria-label="GraviQuest">
        <a href="https://graviquest.com/topics.html">Topics</a>
        <a href="https://graviquest.com/lab.html">Lab</a>
        <a href="https://graviquest.com/learn.html">Learn</a>
        <a href="https://graviquest.com/community" aria-current="page">Community</a>
      </nav>
      {{#unless this.currentUser}}
        <a class="gq-workspace gq-join" href="https://graviquest.com/signup" aria-label="Create your free account">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(0.645 0.673) scale(0.945894)" stroke-width="1.797"><path d="M2.6 20.4v-1.7a4.6 4.6 0 0 1 4.6-4.6h3.4a4.6 4.6 0 0 1 4.6 4.6v1.7" /><path d="M18.8 5.6v4.8" /><path d="M16.4 8h4.8" /><circle cx="8.9" cy="7.4" r="3.5" fill="currentColor" stroke="none" /></g></svg>
          <span>Join Us</span>
        </a>
      {{/unless}}
    </div>
  </template>
}
