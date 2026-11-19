// House Rules, under every thread list (the Forum's front page and each
// room), as forum.html had them under its table. Brought back 2026-11-19 at
// the owner's request. Four short lines, numbered, in one quiet band: the
// rules are read once and kept, so they sit after the threads rather than
// above them. Same wording as forum.html; the welcome thread in About the
// Forum (backend/core/forum_rooms.json) says the same in its own words.
const RULES = [
  "Land on a position, then tell us why.",
  "Cite your source, or say you can\u2019t.",
  "Be generous with each other.",
  "A moderator reads every post before it appears.",
];

<template>
  <section class="gq-rules" aria-labelledby="gq-rules-title">
    <h2 class="gq-rules__title" id="gq-rules-title">House Rules</h2>
    <ol class="gq-rules__list">
      {{#each RULES as |rule|}}
        <li>{{rule}}</li>
      {{/each}}
    </ol>
  </section>
</template>
