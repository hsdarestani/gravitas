// The site's theme toggle, in the forum header's icon row.
//
// The forum had one dark palette and no way to change it, while every other
// GraviQuest page carries this button. It behaves as the site's does
// (assets/site.js): two states, dark by default, the choice kept under the same
// localStorage key, and both glyphs in the DOM with CSS showing the right one
// so nothing repaints. The attribute itself is set before first paint by the
// script in common/head_tag.html; this only flips it and remembers the choice.
//
// The forum is its own origin, so the choice is remembered per site: choosing
// light here does not reach graviquest.com, and the other way round.
import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";

const KEY = "gravitas:theme";

export default class ThemeToggle extends Component {
  @tracked light = document.documentElement.getAttribute("data-theme") === "light";

  get label() {
    return this.light ? "Switch to dark" : "Switch to light";
  }

  @action
  toggle() {
    this.light = !this.light;
    const theme = this.light ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private windows can refuse storage; the switch still holds for this visit.
    }
  }

  <template>
    <li class="header-dropdown-toggle gq-theme-toggle">
      <button
        type="button"
        class="btn no-text btn-flat icon gq-theme-btn"
        aria-pressed={{if this.light "true" "false"}}
        aria-label={{this.label}}
        title={{this.label}}
        {{on "click" this.toggle}}
      >
        <svg class="gq-ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(1.476 -1.425)"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z" /></g></svg>
        <svg class="gq-ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.1" /><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" /></svg>
      </button>
    </li>
  </template>
}
