(function () {
  'use strict';

  if (location.pathname !== '/' && location.pathname !== '/index.html') return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function contentUrl(item) {
    return '/content/' + encodeURIComponent(item.slug) + '/';
  }

  function findSection(title) {
    var found = null;
    document.querySelectorAll('main section').forEach(function (section) {
      var heading = section.querySelector('h2');
      if (heading && (heading.textContent || '').trim().toLowerCase() === title.toLowerCase()) {
        found = section;
      }
    });
    return found;
  }

  function bodyHtml(value) {
    var text = String(value || '').trim();
    if (!text) return '<p class="g-subtle">No full text yet.</p>';
    return text.split(/\n\s*\n/).map(function (paragraph) {
      return '<p>' + esc(paragraph).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function lazyBody(item, details) {
    if (details.dataset.loaded || details.dataset.loading) return;
    details.dataset.loading = '1';
    var box = details.querySelector('.g-cms-body');
    box.innerHTML = '<p class="g-subtle">Loading…</p>';

    fetch('/api/content/' + encodeURIComponent(item.slug) + '/', {
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('cms_detail_unavailable');
        return response.json();
      })
      .then(function (data) {
        box.innerHTML = bodyHtml(data.item && data.item.body);
        details.dataset.loaded = '1';
      })
      .catch(function () {
        box.innerHTML = '<p class="g-subtle">Could not load this content.</p>';
      })
      .finally(function () {
        details.dataset.loading = '';
      });
  }

  function renderHero(dossier) {
    var button = document.querySelector('.lp-hero a[href="dossier-computable-universe.html"], .lp-hero a[href^="/content/"]');
    if (!button) return;

    if (dossier) {
      button.href = contentUrl(dossier);
      button.lastChild.textContent = ' Open the current dossier';
    } else {
      button.href = 'dossiers.html';
      button.lastChild.textContent = ' Explore dossiers';
    }
  }

  function renderCurrent(items) {
    var section = findSection('The current dossier');
    var item = items.find(function (candidate) { return candidate.kind === 'dossier'; });
    renderHero(item || null);

    if (!section) return;
    if (!item) {
      section.remove();
      return;
    }

    section.id = 'current-dossier';
    var split = section.querySelector('.split');
    if (!split) return;

    split.innerHTML =
      '<article class="g-cms-card" data-cms-slug="' + esc(item.slug) + '" style="grid-column:1/-1">' +
      '<p class="g-eyebrow g-eyebrow--bare">Dossier</p>' +
      '<h3 style="font-size:var(--g-fs-h2);margin:.25rem 0 .75rem">' + esc(item.title) + '</h3>' +
      (item.summary ? '<p class="g-muted">' + esc(item.summary) + '</p>' : '') +
      '<p><a class="g-btn g-btn--primary" href="' + contentUrl(item) + '">Open the dossier</a></p>' +
      '<details class="g-cms-details"><summary>Quick read</summary><div class="g-cms-body"></div></details>' +
      '</article>';

    var details = split.querySelector('details');
    details.addEventListener('toggle', function () {
      if (details.open) lazyBody(item, details);
    });
  }

  function renderLatest(items) {
    var section = findSection('Across everything');
    if (!section) return;
    if (!items.length) {
      section.remove();
      return;
    }

    var list = section.querySelector('.rv');
    if (!list) {
      section.remove();
      return;
    }

    list.innerHTML = '';
    items.slice(0, 8).forEach(function (item) {
      var article = document.createElement('article');
      article.className = 'entry';
      article.setAttribute('data-cms-slug', item.slug);
      article.innerHTML =
        '<span class="entry__type">' + esc(item.kind) + '</span>' +
        '<div><h3>' + esc(item.title) + '</h3>' +
        (item.summary ? '<p>' + esc(item.summary) + '</p>' : '') +
        '<p><a class="g-btn g-btn--ghost g-btn--sm" href="' + contentUrl(item) + '">Open</a></p>' +
        '<details class="g-cms-details"><summary>Quick read</summary><div class="g-cms-body"></div></details></div>';

      var details = article.querySelector('details');
      details.addEventListener('toggle', function () {
        if (details.open) lazyBody(item, details);
      });
      list.appendChild(article);
    });
  }

  fetch('/api/content/?limit=8', {
    credentials: 'same-origin',
    cache: 'no-store'
  })
    .then(function (response) {
      if (!response.ok) throw new Error('cms_list_unavailable');
      return response.json();
    })
    .then(function (data) {
      var items = Array.isArray(data.items) ? data.items : [];
      renderCurrent(items);
      renderLatest(items);
    })
    .catch(function () {
      renderHero(null);
      var current = findSection('The current dossier');
      if (current) current.remove();
      var latest = findSection('Across everything');
      if (latest) latest.remove();
    });
})();
