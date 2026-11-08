/* The homepage teaser and the Topic reader use the same published snapshot. */
(function () {
  'use strict';
  const reader = document.querySelector('[data-topic-essay-reader]');
  const excerpt = document.querySelector('[data-topic-essay-excerpt]');
  const overviewTitles = document.querySelectorAll('[data-topic-essay-title]');
  const deepTitles = document.querySelectorAll('[data-topic-essay-deep-title]');
  const updateTitle = (nodes, title) => nodes.forEach(node => { node.textContent = title; });
  fetch('/api/topics/answer-that-looked-right/essays/', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('Essay unavailable');
      return response.json();
    })
    .then(({ essays }) => {
      for (const depth of ['overview', 'deep']) {
        const essay = essays[depth];
        if (!essay) continue;
        // The API renders Markdown with raw HTML disabled and unsafe links filtered.
        const content = document.createElement('template');
        content.innerHTML = essay.html;
        const title = essay.title || (depth === 'overview' ? 'Overview' : 'In depth');
        if (depth === 'overview' && excerpt) {
          const text = content.content.querySelector('p')?.textContent?.trim() || '';
          excerpt.textContent = text.length > 360 ? text.slice(0, 357).trimEnd() + '…' : text;
          excerpt.closest('blockquote').hidden = !text;
        }
        updateTitle(depth === 'overview' ? overviewTitles : deepTitles, title);
        const target = reader?.querySelector(`[data-level="${depth}"]`);
        if (target) {
          const heading = document.createElement('h3');
          heading.textContent = title;
          target.replaceChildren(heading, content.content);
        }
      }
    })
    .catch(() => {
      if (excerpt) excerpt.closest('blockquote').hidden = true;
      updateTitle(overviewTitles, 'Topic 01 essay');
      updateTitle(deepTitles, 'Topic 01 essay');
      if (!reader) return;
      reader.querySelectorAll('[data-level]').forEach(node => node.replaceChildren());
      const error = reader.querySelector('[data-topic-essay-error]');
      error.textContent = 'The essay is temporarily unavailable. Reload to try again.';
      error.hidden = false;
    });
})();
