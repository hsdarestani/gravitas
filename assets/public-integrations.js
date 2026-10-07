(function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function getJson(url) {
    return fetch(url, {credentials: 'same-origin', cache: 'no-store'})
      .then(function (response) {
        if (!response.ok) throw new Error('http_' + response.status);
        return response.json();
      });
  }

  function dateLabel(value) {
    if (!value) return '';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  }

  function magazine() {
    if (location.pathname !== '/magazine.html') return;
    var list = document.querySelector('[data-filterable]');
    if (!list) return;

    var articleSlug = new URLSearchParams(location.search).get('article');
    if (articleSlug) {
      getJson('/api/content/' + encodeURIComponent(articleSlug) + '/').then(function (data) {
        var item = data.item;
        if (!item || item.kind !== 'article') throw new Error('not_article');
        var main = document.getElementById('main');
        main.innerHTML =
          '<section class="page-head"><div class="g-container"><p class="crumb"><a href="magazine.html">Magazine</a></p>' +
          '<h1>' + esc(item.title) + '</h1><p class="g-lead">' + esc(item.summary || '') + '</p></div></section>' +
          '<section class="g-section"><div class="g-container"><article class="g-prose" data-cms-article></article></div></section>';
        var article = main.querySelector('[data-cms-article]');
        article.innerHTML = item.body || '';
        document.title = item.title + ' · Gravitas+';
      }).catch(function () {
        var main = document.getElementById('main');
        main.innerHTML = '<section class="page-head"><div class="g-container"><h1>Article unavailable</h1><p class="g-lead">This article is not published or could not be loaded.</p></div></section>';
      });
      return;
    }

    Promise.all([
      getJson('/api/content/?kind=article&limit=100').catch(function () { return {items: []}; }),
      getJson('/api/content/?kind=topic&limit=100').catch(function () { return {items: []}; })
    ]).then(function (rows) {
      var articles = rows[0].items || [];
      var topics = rows[1].items || [];
      var dynamic = [];

      articles.forEach(function (item) {
        dynamic.push({
          key: 'article:' + item.slug,
          title: item.title,
          summary: item.summary || '',
          href: '/magazine.html?article=' + encodeURIComponent(item.slug),
          type: 'Essay',
          meta: dateLabel(item.published_at)
        });
      });

      topics.forEach(function (item) {
        var topic = item.topic_data || {};
        var essay = topic.essay || {};
        if (!essay.overview_html && !essay.indepth_html && !essay.body_html) return;
        dynamic.push({
          key: 'topic:' + item.slug,
          title: item.title,
          summary: item.summary || 'Essay from the Topic archive.',
          href: '/topic.html?slug=' + encodeURIComponent(item.slug) + '#essay',
          type: 'Topic essay',
          meta: dateLabel(item.published_at)
        });
      });

      var existing = new Set(Array.prototype.map.call(list.querySelectorAll('a.entry'), function (a) {
        return (a.getAttribute('href') || '').replace(location.origin, '');
      }));
      dynamic.forEach(function (item) {
        if (existing.has(item.href)) return;
        var a = document.createElement('a');
        a.className = 'entry';
        a.href = item.href;
        a.dataset.type = 'essay';
        a.dataset.tags = 'essay';
        a.innerHTML =
          '<span class="entry__type">' + esc(item.type) + '</span><div>' +
          '<h3>' + esc(item.title) + '</h3><p>' + esc(item.summary) + '</p>' +
          '<div class="entry__meta"><span>' + esc(item.meta || 'Gravitas+') + '</span></div></div>';
        list.prepend(a);
      });
      window.dispatchEvent(new Event('input'));
    });
  }

  function learn() {
    if (location.pathname !== '/learn.html') return;
    var grid = document.querySelector('.g-grid.g-grid--2');
    if (!grid) return;
    getJson('/api/lms/courses/').then(function (data) {
      var courses = data.courses || [];
      var existing = new Set(Array.prototype.map.call(grid.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href'); }));
      courses.forEach(function (course) {
        var href = '/workspace/learning/courses/' + course.id;
        if (existing.has(href)) return;
        var a = document.createElement('a');
        a.className = 'path-card';
        a.href = href;
        a.innerHTML =
          '<span class="path-card__tag">Course</span>' +
          '<h3>' + esc(course.title) + '</h3>' +
          '<p>' + esc(course.summary || 'Structured Gravitas+ learning course.') + '</p>' +
          '<p class="path-card__meta">' + esc([
            course.lesson_count != null ? course.lesson_count + ' lessons' : '',
            course.certificate_enabled ? 'Certificate' : '',
            course.access_type ? String(course.access_type).replace(/_/g, ' ') : ''
          ].filter(Boolean).join(' · ')) + '</p>';
        grid.prepend(a);
      });
    }).catch(function () {});
  }

  function community() {
    if (location.pathname !== '/community.html') return;
    var roles = [
      ['Viewers (Public)', 'Read public Topics, Magazine, Learning Paths and Labs without a member workspace.'],
      ['Members', 'Save content, comment, vote and track personal Topic progress.'],
      ['Learners', 'Members with Learning access: courses, assessments, certificates and learning progress.'],
      ['Researchers', 'Members with Research access: research projects, evidence, journal and collaboration.'],
      ['Gravitas+ Team', 'Internal Core workspace for operating, production and administration.']
    ];

    var roleGrid = document.querySelector('.roles');
    if (roleGrid) {
      roleGrid.innerHTML = '';
      roles.forEach(function (role) {
        var card = document.createElement('div');
        card.className = 'role';
        card.innerHTML = '<h4>' + esc(role[0]) + '</h4><p>' + esc(role[1]) + '</p>';
        roleGrid.appendChild(card);
      });
      var head = roleGrid.closest('section') && roleGrid.closest('section').querySelector('.g-section-head');
      if (head) {
        var eyebrow = head.querySelector('.g-eyebrow'); if (eyebrow) eyebrow.textContent = 'Access model';
        var h2 = head.querySelector('h2'); if (h2) h2.textContent = 'Five Ways to Belong';
      }
    }

    var joinRoles = document.querySelector('.join__roles');
    if (joinRoles) {
      joinRoles.innerHTML = roles.map(function (role) {
        return '<span role="listitem" class="join__role">' + esc(role[0]) + '</span>';
      }).join('');
    }
    var joinTitle = document.querySelector('.join__h');
    if (joinTitle) joinTitle.textContent = 'Start as a member.';

    getJson('/api/community/polls/').then(function (data) {
      var polls = data.polls || [];
      if (!polls.length) return;
      var anchor = roleGrid && roleGrid.closest('section');
      var section = document.createElement('section');
      section.className = 'g-section';
      section.innerHTML =
        '<div class="g-container"><div class="g-section-head"><p class="g-eyebrow">Topic votes</p>' +
        '<h2>What the community is deciding</h2><p>Every published Topic vote appears here and links back to its context.</p></div>' +
        '<div class="g-grid g-grid--2" data-community-polls></div></div>';
      var host = section.querySelector('[data-community-polls]');
      polls.forEach(function (poll) {
        var card = document.createElement('a');
        card.className = 'callout';
        card.href = poll.url;
        var leading = (poll.options || []).slice().sort(function (a,b) { return Number(b.votes||0)-Number(a.votes||0); })[0];
        card.innerHTML =
          '<p class="g-eyebrow">' + esc(poll.question || 'Vote') + '</p>' +
          '<h3>' + esc(poll.title) + '</h3>' +
          '<p>' + esc(poll.explanation || poll.summary || '') + '</p>' +
          '<p class="g-subtle">' + esc(String(poll.total_votes || 0) + ' votes' + (leading ? ' · ' + leading.label + ' currently leads' : '')) + '</p>';
        host.appendChild(card);
      });
      if (anchor) anchor.insertAdjacentElement('afterend', section);
      else document.getElementById('main').appendChild(section);
    }).catch(function () {});
  }

  function lab() {
    if (location.pathname !== '/lab.html') return;
    var slug = new URLSearchParams(location.search).get('lab');
    if (slug) {
      getJson('/api/labs/' + encodeURIComponent(slug) + '/').then(function (data) {
        var item = data.lab;
        var main = document.getElementById('main');
        main.innerHTML =
          '<section class="page-head"><div class="g-container"><p class="crumb"><a href="lab.html">Interactive Lab</a></p>' +
          '<h1>' + esc(item.title) + '</h1><p class="g-lead">' + esc(item.summary || item.description || '') + '</p></div></section>' +
          '<section class="g-section"><div class="g-container"><iframe title="' + esc(item.title) + '" src="' + esc(item.run_url) + '" ' +
          'style="width:100%;min-height:70vh;border:1px solid var(--g-hairline);border-radius:1rem;background:#fff" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe></div></section>';
        document.title = item.title + ' · Interactive Lab · Gravitas+';
      }).catch(function () {});
      return;
    }

    var games = document.querySelector('.games');
    if (!games) return;
    getJson('/api/labs/').then(function (data) {
      (data.labs || []).forEach(function (item) {
        var a = document.createElement('a');
        a.className = 'game-card';
        a.href = '/lab.html?lab=' + encodeURIComponent(item.slug);
        a.innerHTML =
          '<div class="game-card__art"><div class="g-ic-plate" aria-hidden="true">+</div></div>' +
          '<div class="game-card__b"><h3>' + esc(item.title) + '</h3><p>' + esc(item.summary || item.description || '') + '</p>' +
          '<p class="game-card__meta">' + esc(item.duration_text || 'Interactive Lab') + '</p></div>';
        games.prepend(a);
      });
    }).catch(function () {});
  }

  magazine();
  learn();
  community();
  lab();
})();