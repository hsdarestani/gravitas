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
    //
    // Open Topic votes used to arrive as a section of their own, a grid of
    // callouts styled unlike anything around them. The page now keeps a
    // hidden list for them under Take Part, drawn as the home page's layer
    // rows, and this fills it only when there is something to show.
    var box = document.querySelector('[data-community-votes]');
    var host = box && box.querySelector('[data-community-polls]');
    if (!host) return;

    getJson('/api/community/polls/').then(function (data) {
      var polls = data.polls || [];
      if (!polls.length) return;
      polls.forEach(function (poll, i) {
        var leading = (poll.options || []).slice().sort(function (a,b) { return Number(b.votes||0)-Number(a.votes||0); })[0];
        var total = Number(poll.total_votes || 0);
        var li = document.createElement('li');
        li.className = 'lp-layer';
        li.innerHTML =
          '<a href="' + esc(poll.url) + '">' +
            '<span class="lp-layer__n">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<div><h3>' + esc(poll.title) + '</h3>' +
            '<p>' + esc([poll.question || 'Vote', total + (total === 1 ? ' vote' : ' votes'),
              total && leading ? leading.label + ' leads' : ''].filter(Boolean).join(' · ')) + '</p></div>' +
            '<svg class="lp-layer__go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          '</a>';
        host.appendChild(li);
      });
      box.hidden = false;
    }).catch(function () {});
  }

  function lab() {
    // Do not inject the former CMS lab catalog or restore old experiments.
    // The Lab lists only what its own registry publishes (lab-studio.js).
  }

  learn();
  community();
  lab();
})();