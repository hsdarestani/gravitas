(function () {
  'use strict';

  var configs = {
    '/topics.html': { kind: 'dossier', target: '[data-filterable]', label: 'topic' },
    '/magazine.html': { kind: 'article', target: '[data-filterable]', label: 'article' },
    '/learn.html': { kind: 'learning', target: '.g-grid.g-grid--2', label: 'learning path' },
    '/lab.html': { kind: 'lab', target: '.games', label: 'lab item' }
  };
  var config = configs[location.pathname];
  if (!config) return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function bodyText(value) {
    var text = String(value || '').trim();
    if (!text) return '<p class="g-subtle">No full text yet.</p>';
    return text.split(/\n\s*\n/).map(function (paragraph) {
      return '<p>' + esc(paragraph).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function dateLabel(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function loadBody(item, details) {
    if (details.dataset.loaded || details.dataset.loading) return;
    details.dataset.loading = '1';
    var box = details.querySelector('.g-cms-body');
    box.innerHTML = '<p class="g-subtle">Loading…</p>';

    fetch('/api/content/' + encodeURIComponent(item.slug) + '/', {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('detail_unavailable');
        return response.json();
      })
      .then(function (data) {
        box.innerHTML = bodyText(data.item && data.item.body);
        details.dataset.loaded = '1';
      })
      .catch(function () {
        box.innerHTML = '<p class="g-subtle">Could not load this content right now.</p>';
      })
      .finally(function () {
        details.dataset.loading = '';
      });
  }

  function clearPrototypeUi() {
    var target = document.querySelector(config.target);
    if (!target) return null;
    target.innerHTML = '';
    target.classList.add('g-cms-grid');

    var parent = target.parentElement;
    if (parent) {
      var filters = parent.querySelector('.filters');
      if (filters) filters.remove();
      var legacyEmpty = parent.querySelector('.empty');
      if (legacyEmpty) legacyEmpty.remove();
    }
    return target;
  }

  function render(items) {
    var target = clearPrototypeUi();
    if (!target) return;

    if (!items.length) {
      target.innerHTML = '<div class="g-cms-empty"><p class="g-eyebrow">Published</p><h2>No published ' + esc(config.label) + 's yet.</h2><p class="g-muted">New material will appear here as soon as it is published from the Gravitas+ CMS.</p></div>';
      return;
    }

    items.forEach(function (item) {
      var article = document.createElement('article');
      article.className = 'g-cms-card';
      article.id = 'cms-' + item.slug;
      article.innerHTML =
        '<p class="g-eyebrow g-eyebrow--bare">' + esc(item.kind) + (item.published_at ? ' · ' + esc(dateLabel(item.published_at)) : '') + '</p>' +
        '<h3>' + esc(item.title) + '</h3>' +
        (item.summary ? '<p class="g-muted">' + esc(item.summary) + '</p>' : '') +
        '<details class="g-cms-details"><summary>Read</summary><div class="g-cms-body"></div></details>';

      var details = article.querySelector('details');
      details.addEventListener('toggle', function () {
        if (details.open) loadBody(item, details);
      });
      target.appendChild(article);
    });
  }

  fetch('/api/content/?kind=' + encodeURIComponent(config.kind) + '&limit=50', {
    credentials: 'same-origin',
    cache: 'no-store'
  })
    .then(function (response) {
      if (!response.ok) throw new Error('list_unavailable');
      return response.json();
    })
    .then(function (data) {
      render(Array.isArray(data.items) ? data.items : []);
    })
    .catch(function () {
      var target = clearPrototypeUi();
      if (target) {
        target.innerHTML = '<div class="g-cms-empty"><p class="g-muted">Published content is temporarily unavailable.</p></div>';
      }
    });
})();
