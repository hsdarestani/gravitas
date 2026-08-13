/* Live Community and Lab integrations for Gravitas+. */
(function () {
  'use strict';

  function cookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var value = parts[i].trim();
      if (value.indexOf(prefix) === 0) return decodeURIComponent(value.slice(prefix.length));
    }
    return '';
  }

  function csrfToken() {
    return fetch('/api/auth/csrf/', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('csrf');
      return cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    });
  }

  function apiPost(url, payload) {
    return csrfToken().then(function (token) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-CSRFToken': token
        },
        body: JSON.stringify(payload || {})
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw data;
        return data;
      });
    });
  }

  function setText(el, value) { if (el) el.textContent = value; }

  var reasoning = document.getElementById('arg');
  var communityForm = reasoning && reasoning.closest('form');
  if (communityForm) {
    var contentKey = 'weekly-thought-experiment';
    var note = communityForm.querySelector('[data-form-note]');
    var discussion = document.createElement('section');
    discussion.className = 'g-mt-lg';
    discussion.setAttribute('aria-live', 'polite');
    discussion.innerHTML = '<h3>Published reasoning</h3><div data-live-comments class="g-stack g-stack--sm"><p class="g-muted">Loading discussion…</p></div>';
    communityForm.insertAdjacentElement('afterend', discussion);
    var commentsBox = discussion.querySelector('[data-live-comments]');

    function renderComments(items) {
      commentsBox.innerHTML = '';
      if (!items || !items.length) {
        commentsBox.innerHTML = '<p class="g-muted">No published responses yet. Submitted reasoning is moderated before it appears here.</p>';
        return;
      }
      items.forEach(function (item) {
        var article = document.createElement('article');
        article.className = 'callout';
        var author = document.createElement('strong');
        author.textContent = item.author || 'Member';
        var body = document.createElement('p');
        body.textContent = item.body || '';
        var meta = document.createElement('small');
        meta.className = 'g-muted';
        try { meta.textContent = new Date(item.created_at).toLocaleDateString(); } catch (e) { meta.textContent = ''; }
        article.appendChild(author);
        article.appendChild(body);
        article.appendChild(meta);
        commentsBox.appendChild(article);
      });
    }

    function loadComments() {
      fetch('/api/community/comments/' + contentKey + '/', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (res) { return res.ok ? res.json() : Promise.reject(); })
        .then(function (data) { renderComments(data.comments || []); })
        .catch(function () { commentsBox.innerHTML = '<p class="g-muted">Discussion is temporarily unavailable.</p>'; });
    }

    communityForm.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var body = reasoning.value.trim();
      var button = communityForm.querySelector('button[type="submit"]');
      if (!body) {
        setText(note, 'Write two or three sentences before submitting.');
        reasoning.focus();
        return;
      }
      if (button) button.disabled = true;
      setText(note, 'Submitting for moderation…');
      apiPost('/api/community/comments/' + contentKey + '/', { body: body })
        .then(function () {
          communityForm.reset();
          setText(note, 'Submitted. Your reasoning will appear after moderation.');
        })
        .catch(function (err) {
          setText(note, err && err.error === 'authentication_required'
            ? 'Sign in to submit your reasoning.'
            : 'Could not submit right now. Please try again.');
        })
        .finally(function () { if (button) button.disabled = false; });
    }, true);

    loadComments();
  }

  var gameForm = document.getElementById('tform');
  var guessButton = document.getElementById('guess');
  if (gameForm && guessButton && document.getElementById('ntests')) {
    var labKey = 'hypothesis-machine';
    var marker = document.createElement('p');
    marker.className = 'g-muted g-mt-sm';
    gameForm.insertAdjacentElement('afterend', marker);

    fetch('/api/lab/progress/' + labKey + '/', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (res.status === 401) return null;
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (!data || !data.exists || !data.progress || !data.progress.completed) return;
      var saved = data.progress;
      var tests = saved.state && saved.state.tests;
      var fals = saved.state && saved.state.falsification_attempts;
      marker.textContent = 'Previous completion saved to your account' +
        (tests !== undefined ? ': ' + tests + ' tests' : '') +
        (fals !== undefined ? ', ' + fals + ' falsification attempts.' : '.');
    }).catch(function () {});

    guessButton.addEventListener('click', function () {
      window.setTimeout(function () {
        var tests = parseInt((document.getElementById('ntests') || {}).textContent || '0', 10) || 0;
        var conf = parseInt((document.getElementById('nconf') || {}).textContent || '0', 10) || 0;
        var fals = parseInt((document.getElementById('nfals') || {}).textContent || '0', 10) || 0;
        var title = (document.getElementById('rev-title') || {}).textContent || '';
        var body = (document.getElementById('rev-body') || {}).textContent || '';
        var score = tests ? Math.round(fals / tests * 100) : 0;
        if (!title) return;
        apiPost('/api/lab/progress/' + labKey + '/', {
          state: { tests: tests, confirmation_attempts: conf, falsification_attempts: fals },
          result: { title: title, summary: body },
          score: score,
          completed: true
        }).then(function () {
          marker.textContent = 'Completion saved to your account.';
        }).catch(function (err) {
          marker.textContent = err && err.error === 'authentication_required'
            ? 'Sign in to save Lab completions across sessions.'
            : 'Your result was not saved this time.';
        });
      }, 0);
    });
  }
})();
