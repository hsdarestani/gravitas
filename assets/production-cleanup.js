(function () {
  'use strict';

  function cleanText(node, patterns) {
    if (!node) return;
    var text = node.textContent || '';
    patterns.forEach(function (pair) {
      text = text.replace(pair[0], pair[1]);
    });
    node.textContent = text
      .replace(/^\s*·\s*/g, '')
      .replace(/\s*·\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function removeIfPrototypeMetric(node) {
    if (!node) return;
    var text = (node.textContent || '').trim();
    if (/^(?:\d+\s*(?:min|minutes?|steps?)|~?\d+\s*hours?|\d+\s*(?:days?|weeks?)\s+ago|updated\s+monthly|dossier\s+\d+)$/i.test(text)) {
      node.remove();
    }
  }

  function loadHomepageCms() {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    if (document.querySelector('script[data-gravitas-home-cms]')) return;
    var script = document.createElement('script');
    script.src = '/assets/cms-home.js';
    script.async = true;
    script.dataset.gravitasHomeCms = '1';
    document.head.appendChild(script);
  }

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

  function enableAccountControls() {
    var accountCard = document.querySelector('.auth-live__card');
    if (!accountCard) return;

    document.querySelectorAll('#p-up input[name="password"], #p-reset input[type="password"]').forEach(function (input) {
      input.minLength = 10;
    });

    fetch('/api/auth/me/', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.authenticated || !data.user || accountCard.querySelector('[data-live-account]')) return;
        var panel = document.createElement('div');
        panel.className = 'callout g-mt-md';
        panel.dataset.liveAccount = '1';

        var copy = document.createElement('p');
        copy.className = 'g-muted';
        copy.textContent = 'Signed in as ' + data.user.email + '.';

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'g-btn g-btn--ghost g-btn--sm';
        button.textContent = 'Sign out';
        button.addEventListener('click', function () {
          button.disabled = true;
          apiPost('/api/auth/logout/', {})
            .then(function () { location.href = 'account.html#in'; location.reload(); })
            .catch(function () { button.disabled = false; });
        });

        panel.appendChild(copy);
        panel.appendChild(button);
        accountCard.appendChild(panel);
      }).catch(function () {});
  }

  function enableCommunity() {
    var reasoning = document.getElementById('arg');
    var form = reasoning && reasoning.closest('form');
    if (!form || form.dataset.liveCommunity === '1') return;
    form.dataset.liveCommunity = '1';

    var contentKey = 'weekly-thought-experiment';
    var note = form.querySelector('[data-form-note]');
    var discussion = document.createElement('section');
    discussion.className = 'g-mt-lg';
    discussion.setAttribute('aria-live', 'polite');
    discussion.innerHTML = '<h3>Published reasoning</h3><div data-live-comments class="g-stack g-stack--sm"><p class="g-muted">Loading discussion…</p></div>';
    form.insertAdjacentElement('afterend', discussion);
    var commentsBox = discussion.querySelector('[data-live-comments]');

    function render(items) {
      commentsBox.innerHTML = '';
      if (!items || !items.length) {
        commentsBox.innerHTML = '<p class="g-muted">No published responses yet. Submitted reasoning is moderated before it appears here.</p>';
        return;
      }
      items.forEach(function (item) {
        var article = document.createElement('article');
        article.className = 'callout';
        if (item.parent_id) article.style.marginLeft = 'clamp(.75rem,3vw,2rem)';

        var author = document.createElement('strong');
        author.textContent = item.author || 'Member';
        var body = document.createElement('p');
        body.textContent = item.body || '';
        var meta = document.createElement('small');
        meta.className = 'g-muted';
        try { meta.textContent = new Date(item.created_at).toLocaleDateString(); } catch (e) { meta.textContent = ''; }

        var reply = document.createElement('button');
        reply.type = 'button';
        reply.className = 'g-btn g-btn--ghost g-btn--sm g-mt-sm';
        reply.textContent = 'Reply';
        reply.addEventListener('click', function () {
          if (article.querySelector('[data-reply-box]')) return;
          var box = document.createElement('div');
          box.className = 'g-stack g-stack--xs g-mt-sm';
          box.dataset.replyBox = '1';
          var textarea = document.createElement('textarea');
          textarea.className = 'g-textarea';
          textarea.maxLength = 5000;
          textarea.placeholder = 'Write a reply…';
          var submit = document.createElement('button');
          submit.type = 'button';
          submit.className = 'g-btn g-btn--primary g-btn--sm';
          submit.textContent = 'Submit reply';
          var replyNote = document.createElement('small');
          replyNote.className = 'g-muted';
          submit.addEventListener('click', function () {
            var value = textarea.value.trim();
            if (!value) { replyNote.textContent = 'Write a reply first.'; textarea.focus(); return; }
            submit.disabled = true;
            replyNote.textContent = 'Submitting for moderation…';
            apiPost('/api/community/comments/' + contentKey + '/', { body: value, parent_id: item.id })
              .then(function () {
                textarea.value = '';
                replyNote.textContent = 'Reply submitted. It will appear after moderation.';
              })
              .catch(function (err) {
                replyNote.textContent = err && err.error === 'authentication_required'
                  ? 'Sign in to reply.'
                  : 'Could not submit this reply right now.';
              })
              .finally(function () { submit.disabled = false; });
          });
          box.appendChild(textarea);
          box.appendChild(submit);
          box.appendChild(replyNote);
          article.appendChild(box);
          textarea.focus();
        });

        article.appendChild(author);
        article.appendChild(body);
        article.appendChild(meta);
        article.appendChild(reply);
        commentsBox.appendChild(article);
      });
    }

    fetch('/api/community/comments/' + contentKey + '/', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) { render(data.comments || []); })
      .catch(function () { commentsBox.innerHTML = '<p class="g-muted">Discussion is temporarily unavailable.</p>'; });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var body = reasoning.value.trim();
      var button = form.querySelector('button[type="submit"]');
      if (!body) {
        if (note) note.textContent = 'Write two or three sentences before submitting.';
        reasoning.focus();
        return;
      }
      if (button) button.disabled = true;
      if (note) note.textContent = 'Submitting for moderation…';
      apiPost('/api/community/comments/' + contentKey + '/', { body: body })
        .then(function () {
          form.reset();
          if (note) note.textContent = 'Submitted. Your reasoning will appear after moderation.';
        })
        .catch(function (err) {
          if (note) note.textContent = err && err.error === 'authentication_required'
            ? 'Sign in to submit your reasoning.'
            : 'Could not submit right now. Please try again.';
        })
        .finally(function () { if (button) button.disabled = false; });
    }, true);
  }

  function enableLabCompletion() {
    var gameForm = document.getElementById('tform');
    var guessButton = document.getElementById('guess');
    if (!gameForm || !guessButton || !document.getElementById('ntests') || gameForm.dataset.liveLab === '1') return;
    gameForm.dataset.liveLab = '1';

    var labKey = 'hypothesis-machine';
    var marker = document.createElement('p');
    marker.className = 'g-muted g-mt-sm';
    gameForm.insertAdjacentElement('afterend', marker);

    fetch('/api/lab/progress/' + labKey + '/', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
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
        var summary = (document.getElementById('rev-body') || {}).textContent || '';
        if (!title) return;
        apiPost('/api/lab/progress/' + labKey + '/', {
          state: { tests: tests, confirmation_attempts: conf, falsification_attempts: fals },
          result: { title: title, summary: summary },
          score: tests ? Math.round(fals / tests * 100) : 0,
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

  function showNewsletterConfirmation() {
    if (!/newsletter\.html$/.test(location.pathname)) return;
    var value = new URLSearchParams(location.search).get('confirmed');
    if (value !== '1' && value !== '0') return;
    var note = document.querySelector('[data-form-note]');
    if (!note) return;
    note.textContent = value === '1'
      ? 'Email confirmed. You are subscribed to Gravitas+.'
      : 'That confirmation link is invalid or expired. Subscribe again to receive a new link.';
  }

  function disablePrototypePollPercentages() {
    document.querySelectorAll('.poll').forEach(function (poll) {
      if (poll.dataset.livePollTransparent === '1') return;
      poll.dataset.livePollTransparent = '1';
      var options = [].slice.call(poll.querySelectorAll('.poll__opt'));
      options.forEach(function (option) {
        option.removeAttribute('data-share');
        var bar = option.querySelector('.poll__bar');
        var pct = option.querySelector('.poll__pct');
        if (bar) bar.style.width = '0';
        if (pct) pct.textContent = '';
      });
      poll.addEventListener('click', function (e) {
        var option = e.target.closest && e.target.closest('.poll__opt');
        if (!option || !poll.contains(option)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        poll.classList.add('is-voted');
        options.forEach(function (item) {
          item.setAttribute('aria-pressed', String(item === option));
          var bar = item.querySelector('.poll__bar');
          var pct = item.querySelector('.poll__pct');
          if (bar) bar.style.width = '0';
          if (pct) pct.textContent = item === option ? 'Your vote' : '';
        });
        var hint = poll.parentElement && poll.parentElement.querySelector('[data-poll-live-note]');
        if (!hint) {
          hint = document.createElement('p');
          hint.className = 'g-muted g-mt-sm';
          hint.dataset.pollLiveNote = '1';
          hint.textContent = 'Vote noted on this device. Aggregate voting is not enabled yet.';
          poll.insertAdjacentElement('afterend', hint);
        }
      }, true);
    });
  }

  function run() {
    var heroCredit = document.querySelector('.lp-hero__credit');
    cleanText(heroCredit, [
      [/\s*·\s*312K\s+subscribers\b/gi, '']
    ]);

    document.querySelectorAll('.video__meta').forEach(function (node) {
      cleanText(node, [
        [/^\s*\d{1,2}:\d{2}\s*·\s*/g, ''],
        [/\s*·\s*418K\s+views\b/gi, '']
      ]);
    });

    document.querySelectorAll('.entry__meta span').forEach(removeIfPrototypeMetric);

    document.querySelectorAll('.g-eyebrow, .g-eyebrow--bare').forEach(function (node) {
      cleanText(node, [
        [/\bDossier\s+04\s*·\s*/gi, '']
      ]);
    });

    document.querySelectorAll('dt').forEach(function (dt) {
      if ((dt.textContent || '').trim().toLowerCase() === 'reading time') {
        var dd = dt.nextElementSibling;
        dt.remove();
        if (dd && dd.tagName === 'DD') dd.remove();
      }
    });

    document.querySelectorAll('.lp-social__link[href="#"]').forEach(function (link) {
      var item = link.closest('li');
      if (item) item.remove();
      else link.remove();
    });

    document.querySelectorAll('.lp-social').forEach(function (list) {
      if (!list.querySelector('a')) {
        var wrapper = list.closest('div');
        if (wrapper && wrapper.querySelector('.g-footer__heading')) wrapper.remove();
        else list.remove();
      }
    });

    loadHomepageCms();
    enableAccountControls();
    enableCommunity();
    enableLabCompletion();
    showNewsletterConfirmation();
    disablePrototypePollPercentages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
