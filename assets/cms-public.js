(function () {
  'use strict';

  var DATA_URL = '/cms-data/content.json';
  var PAGE_KIND = {
    '/dossiers.html': 'dossier',
    '/magazine.html': 'article',
    '/learn.html': 'learning',
    '/lab.html': 'lab'
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function dateLabel(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function contentLink(item) {
    return 'content.html?slug=' + encodeURIComponent(item.slug);
  }

  function renderListing(items, kind) {
    var main = document.querySelector('main');
    if (!main || !items.length) return;

    var section = document.createElement('section');
    section.className = 'g-section g-cms-feed';
    section.setAttribute('data-cms-kind', kind);
    section.innerHTML = '<div class="g-container">' +
      '<div class="g-section-head"><p class="g-eyebrow">Published</p><h2>From Gravitas+</h2></div>' +
      '<div class="g-cms-grid"></div></div>';

    var grid = section.querySelector('.g-cms-grid');
    items.forEach(function (item) {
      var article = document.createElement('article');
      article.className = 'g-cms-card';
      article.innerHTML =
        '<p class="g-eyebrow g-eyebrow--bare">' + esc(item.kind) + (item.published_at ? ' · ' + esc(dateLabel(item.published_at)) : '') + '</p>' +
        '<h3><a href="' + contentLink(item) + '">' + esc(item.title) + '</a></h3>' +
        (item.summary ? '<p class="g-muted">' + esc(item.summary) + '</p>' : '') +
        '<a class="g-btn g-btn--ghost g-btn--sm" href="' + contentLink(item) + '">Read</a>';
      grid.appendChild(article);
    });

    main.appendChild(section);
  }

  function renderDetail(items) {
    if (location.pathname !== '/content.html') return false;
    var params = new URLSearchParams(location.search);
    var slug = params.get('slug') || '';
    var item = items.find(function (candidate) { return candidate.slug === slug; });
    var mount = document.getElementById('cms-content');
    if (!mount) return true;

    if (!item) {
      mount.innerHTML = '<p class="g-eyebrow">Content</p><h1>Not found</h1><p class="g-muted">This item is not published or no longer exists.</p>';
      document.title = 'Not found — Gravitas+';
      return true;
    }

    document.title = item.title + ' — Gravitas+';
    var body = String(item.body || '').trim();
    var paragraphs = body ? body.split(/\n\s*\n/).map(function (paragraph) {
      return '<p>' + esc(paragraph).replace(/\n/g, '<br>') + '</p>';
    }).join('') : '';

    mount.innerHTML =
      '<p class="g-eyebrow">' + esc(item.kind) + '</p>' +
      '<h1 class="g-display" style="font-size:clamp(2.25rem,7vw,5.5rem)">' + esc(item.title) + '</h1>' +
      (item.summary ? '<p class="g-lead">' + esc(item.summary) + '</p>' : '') +
      (item.published_at ? '<p class="g-subtle">Published ' + esc(dateLabel(item.published_at)) + '</p>' : '') +
      '<div class="g-cms-body">' + paragraphs + '</div>';
    return true;
  }

  function run() {
    fetch(DATA_URL, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('cms_unavailable');
        return response.json();
      })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        if (renderDetail(items)) return;
        var kind = PAGE_KIND[location.pathname];
        if (!kind) return;
        renderListing(items.filter(function (item) { return item.kind === kind; }), kind);
      })
      .catch(function () {
        // Static site remains fully usable if the CMS feed is temporarily unavailable.
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
