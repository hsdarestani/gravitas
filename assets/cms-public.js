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

  function renderBody(body) {
    var value = String(body || '').trim();
    if (!value) return '<p class="g-subtle">Full text will be added here.</p>';
    return value.split(/\n\s*\n/).map(function (paragraph) {
      return '<p>' + esc(paragraph).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderListing(items, kind) {
    var main = document.querySelector('main');
    if (!main || !items.length || main.querySelector('.g-cms-feed[data-cms-kind="' + kind + '"]')) return;

    var section = document.createElement('section');
    section.className = 'g-section g-cms-feed';
    section.setAttribute('data-cms-kind', kind);
    section.innerHTML = '<div class="g-container">' +
      '<div class="g-section-head"><p class="g-eyebrow">Published</p><h2>From the Gravitas+ CMS</h2></div>' +
      '<div class="g-cms-grid"></div></div>';

    var grid = section.querySelector('.g-cms-grid');
    items.forEach(function (item) {
      var article = document.createElement('article');
      article.className = 'g-cms-card';
      article.id = 'cms-' + item.slug;
      article.innerHTML =
        '<p class="g-eyebrow g-eyebrow--bare">' + esc(item.kind) + (item.published_at ? ' · ' + esc(dateLabel(item.published_at)) : '') + '</p>' +
        '<h3>' + esc(item.title) + '</h3>' +
        (item.summary ? '<p class="g-muted">' + esc(item.summary) + '</p>' : '') +
        '<details class="g-cms-details"><summary>Read</summary><div class="g-cms-body">' + renderBody(item.body) + '</div></details>';
      grid.appendChild(article);
    });

    main.appendChild(section);
  }

  function run() {
    var kind = PAGE_KIND[location.pathname];
    if (!kind) return;

    fetch(DATA_URL, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('cms_unavailable');
        return response.json();
      })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        renderListing(items.filter(function (item) { return item.kind === kind; }), kind);
      })
      .catch(function () {
        // Static pages remain usable if the CMS feed is temporarily unavailable.
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
