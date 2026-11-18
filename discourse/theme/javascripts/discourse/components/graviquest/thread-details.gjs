// Where a thread sits: Forum / its Topic / its room.
//
// Until 2026-11-18 this file also drew a rail beside the posts (a position
// stepper, reply/view/like counts, the faces of the people talking). The
// Forum is now one column, read top to bottom like a feed; Discourse's own
// progress control still appears in a thread long enough to need it.
export const ThreadBreadcrumb = <template>
  {{#if @outletArgs.model.category}}
    <nav class="gq-thread-crumb container" aria-label="Discussion breadcrumb">
      <a href="/">Forum</a>
      {{#if @outletArgs.model.category.parentCategory}}
        <span aria-hidden="true">/</span>
        <span>{{@outletArgs.model.category.parentCategory.name}}</span>
      {{/if}}
      <span aria-hidden="true">/</span>
      <a href={{@outletArgs.model.category.url}}>{{@outletArgs.model.category.name}}</a>
    </nav>
  {{/if}}
</template>;
