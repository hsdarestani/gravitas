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
          '<p>' + esc(course.summary || 'Structured GraviQuest learning course.') + '</p>' +
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
    // This used to replace the page's roles with the account access tiers,
    // internal Core team included, and retitle the join band to match, so the
    // live page never showed what community.html said. The access model is
    // the workspace's business; the public page describes what members do.
    var roleGrid = document.querySelector('.roles');

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
    // Do not inject the former CMS lab catalog or restore old experiments.
    // The public Lab is intentionally header-only during scope discussion.
  }

  learn();
  community();
  lab();
})();