(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Frontend source-of-truth parity
     desdevrad/gravitasplus @ 4cb9c0ed0f12bcdc8b3277deadde1b818dd5d72f

     The production repository keeps the real Django/API integrations. Kiarash's
     repository remains the visual/content source of truth, so its pinned CSS is
     loaded after our local styles and the small markup deltas from his latest
     pass are normalized below without replacing the backend bridge.
     ---------------------------------------------------------------------- */
  var UPSTREAM_SHA = '4cb9c0ed0f12bcdc8b3277deadde1b818dd5d72f';
  var UPSTREAM_SHORT = UPSTREAM_SHA.slice(0, 12);

  if (!document.getElementById('gravitas-upstream-parity')) {
    var parityCss = document.createElement('link');
    parityCss.id = 'gravitas-upstream-parity';
    parityCss.rel = 'stylesheet';
    parityCss.href = 'assets/upstream-4cb9c0.css?v=' + UPSTREAM_SHORT;
    document.head.appendChild(parityCss);
  }

  function swapFilmWord(text) {
    return String(text || '').replace(/\bFilm\b/g, 'Video').replace(/\bfilm\b/g, 'video');
  }

  function normalizeTextTree(root) {
    if (!root) return;
    var blocked = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
    if (root.nodeType === 3) {
      var p = root.parentElement;
      if (!p || blocked[p.tagName]) return;
      var next = swapFilmWord(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && blocked[root.tagName]) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var el = node.parentElement;
        return el && !blocked[el.tagName] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var next = swapFilmWord(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  }

  function ensureLatestHeaderMarkup() {
    var nav = document.querySelector('.g-nav');
    if (!nav) return;

    if (!nav.querySelector('.gh-nav-signin')) {
      var sep = document.createElement('span');
      sep.className = 'g-nav__sep';
      sep.setAttribute('aria-hidden', 'true');
      nav.appendChild(sep);

      var sign = document.createElement('a');
      sign.className = 'g-nav__link gh-nav-signin';
      sign.href = 'account.html#in';
      sign.textContent = 'Sign in';
      nav.appendChild(sign);

      var join = document.createElement('a');
      join.className = 'g-btn g-btn--primary g-btn--sm gh-nav-join';
      join.href = 'community.html#join';
      join.textContent = 'Join Us';
      nav.appendChild(join);
    }
  }

  function normalizeLatestMarkup(root) {
    ensureLatestHeaderMarkup();

    [].forEach.call(document.querySelectorAll('[id="film"]'), function (el) {
      el.id = 'video';
    });
    [].forEach.call(document.querySelectorAll('a[href*="#film"]'), function (a) {
      a.setAttribute('href', a.getAttribute('href').replace('#film', '#video'));
    });
    [].forEach.call(document.querySelectorAll('[aria-label],[title]'), function (el) {
      ['aria-label', 'title'].forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        var old = el.getAttribute(attr);
        var next = swapFilmWord(old);
        if (next !== old) el.setAttribute(attr, next);
      });
    });
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', swapFilmWord(meta.getAttribute('content')));

    normalizeTextTree(root || document.body);
  }

  ensureLatestHeaderMarkup();
  normalizeLatestMarkup(document.body);

  if ('MutationObserver' in window && document.body) {
    var parityObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        [].forEach.call(m.addedNodes || [], function (node) {
          normalizeTextTree(node);
        });
      });
    });
    parityObserver.observe(document.body, { childList: true, subtree: true });
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
      method: 'GET',
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

  function noteFor(form) {
    if (!form) return null;
    if (form.id === 'p-up' || form.id === 'p-in' || form.id === 'p-reset') {
      return document.querySelector('.auth__note[data-form-note]');
    }
    return (form.parentElement && form.parentElement.querySelector('[data-form-note]')) || form.querySelector('[data-form-note]');
  }

  function setNote(form, text) {
    var note = noteFor(form);
    if (note) note.textContent = text;
  }

  function setBusy(form, busy) {
    var button = form && form.querySelector('button[type="submit"]');
    if (button) button.disabled = !!busy;
  }

  function errorText(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.error === 'invalid_email') return 'Please enter a valid email address.';
    if (err.error === 'account_exists') return 'An account with this email already exists.';
    if (err.error === 'invalid_credentials') return 'Email or password is incorrect.';
    if (err.error === 'invalid_or_expired_link') return 'This reset link is invalid or has expired.';
    if (err.error === 'password_invalid' && Array.isArray(err.messages) && err.messages.length) return err.messages.join(' ');
    if (err.error === 'email_delivery_failed') return 'Email delivery is temporarily unavailable. Please try again shortly.';
    return 'Something went wrong. Please try again.';
  }

  function markAccount(email) {
    [].forEach.call(document.querySelectorAll('.gh-signin, .gh-nav-signin'), function (signIn) {
      signIn.textContent = 'Account';
      signIn.href = 'account.html';
    });
    var note = document.querySelector('.auth__note[data-form-note]');
    if (note && email) note.textContent = 'Signed in as ' + email + '.';
  }

  var params = new URLSearchParams(location.search);
  var resetUid = params.get('reset_uid') || '';
  var resetToken = params.get('reset_token') || '';
  var resetForm = document.getElementById('p-reset');
  if (resetForm && resetUid && resetToken) {
    resetForm.innerHTML =
      '<button class="auth__back" type="button" data-tab="in">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
        'Back to sign in</button>' +
      '<h1 class="auth__h">Choose a new password.</h1>' +
      '<p class="auth__lede">Use at least ten characters.</p>' +
      '<label class="g-field"><span class="g-label">New password</span>' +
        '<input class="g-input" name="new_password" type="password" autocomplete="new-password" minlength="10" required></label>' +
      '<button class="g-btn g-btn--primary g-btn--lg g-full" type="submit">Set new password</button>';
    resetForm.hidden = false;
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.nodeType !== 1) return;

    var isSignup = form.id === 'p-up';
    var isLogin = form.id === 'p-in';
    var isReset = form.id === 'p-reset';
    var isNewsletter = form.matches && form.matches('.g-inline-form[data-demo-form]');
    if (!isSignup && !isLogin && !isReset && !isNewsletter) return;

    // Kiarash's site.js intentionally treats these as demo forms. In
    // production this capture handler wins before that demo listener.
    e.preventDefault();
    e.stopImmediatePropagation();
    setBusy(form, true);

    var job;
    if (isSignup) {
      setNote(form, 'Creating your account…');
      job = apiPost('/api/auth/signup/', {
        name: (form.elements.name && form.elements.name.value || '').trim(),
        email: (form.elements.email && form.elements.email.value || '').trim(),
        password: form.elements.password && form.elements.password.value || '',
        newsletter: !!(form.elements.news && form.elements.news.checked)
      }).then(function (data) {
        markAccount(data.user && data.user.email);
        setNote(form, data.newsletter_pending
          ? 'Account created. Check your inbox to confirm the newsletter subscription.'
          : 'Account created. You are signed in.');
      });
    } else if (isLogin) {
      setNote(form, 'Signing in…');
      job = apiPost('/api/auth/login/', {
        email: (form.elements.email && form.elements.email.value || '').trim(),
        password: form.elements.password && form.elements.password.value || '',
        keep: !!(form.elements.keep && form.elements.keep.checked)
      }).then(function (data) {
        markAccount(data.user && data.user.email);
        setNote(form, 'Signed in as ' + (data.user && data.user.email || 'your account') + '.');
      });
    } else if (isReset && resetUid && resetToken) {
      setNote(form, 'Updating your password…');
      job = apiPost('/api/auth/password-reset/confirm/', {
        uid: resetUid,
        token: resetToken,
        password: form.elements.new_password && form.elements.new_password.value || ''
      }).then(function () {
        setNote(form, 'Password updated. You can sign in now.');
        history.replaceState({}, '', 'account.html#in');
        window.setTimeout(function () { location.hash = 'in'; }, 100);
      });
    } else if (isReset) {
      setNote(form, 'Sending the reset link…');
      var resetEmail = (form.elements.email && form.elements.email.value || '').trim();
      job = apiPost('/api/auth/password-reset/request/', { email: resetEmail }).then(function () {
        setNote(form, 'If that address has an account, a reset link has been sent.');
        form.reset();
      });
    } else {
      var input = form.querySelector('input[type="email"]');
      var email = input && input.value.trim();
      if (!email) {
        setNote(form, 'Add an email address and we will send a confirmation link.');
        if (input) input.focus();
        setBusy(form, false);
        return;
      }
      setNote(form, 'Sending confirmation email…');
      job = fetch('/api/newsletter/subscribe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email, source: 'website' })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw data;
          return data;
        });
      }).then(function (data) {
        setNote(form, data.already_confirmed
          ? 'This email is already confirmed and subscribed.'
          : 'Check your inbox and click the confirmation link to finish subscribing.');
        if (!data.already_confirmed) form.reset();
      });
    }

    Promise.resolve(job).catch(function (err) {
      setNote(form, errorText(err));
    }).finally(function () {
      setBusy(form, false);
    });
  }, true);

  fetch('/api/auth/me/', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { if (data && data.authenticated) markAccount(data.user && data.user.email); })
    .catch(function () {});

  /* The thumbnail module is retained as a local fallback. It is pinned to the
     same upstream revision as the CSS layer, so production cannot drift when
     Kiarash pushes the next pass before we review/sync it. */
  (function upstreamThumbnailParity() {
    if (!document.querySelector('.video')) return;

    var DIR = 'https://cdn.jsdelivr.net/gh/desdevrad/gravitasplus@' + UPSTREAM_SHA + '/assets/thumbnails/';
    var EXT = ['webp', 'jpg', 'png'];

    function nameFor(card) {
      var explicit = card.getAttribute('data-thumb');
      if (explicit) return explicit;
      var href = card.getAttribute('href') || location.pathname;
      var file = href.split(/[?#]/)[0].split('/').pop();
      return file.replace(/\.html?$/i, '') || 'index';
    }

    function firstLoaded(urls, done) {
      if (!urls.length) { done(null); return; }
      var url = urls.shift();
      var probe = new Image();
      probe.onload = function () { done(url); };
      probe.onerror = function () { firstLoaded(urls, done); };
      probe.src = url;
    }

    window.setTimeout(function () {
      [].forEach.call(document.querySelectorAll('.video'), function (card) {
        if (card.querySelector('.video__img') || card.classList.contains('has-thumb')) return;
        var stem = nameFor(card);
        var urls = EXT.map(function (ext) { return DIR + stem + '.' + ext; });
        firstLoaded(urls, function (url) {
          if (!url || card.querySelector('.video__img')) return;
          var img = new Image();
          img.className = 'video__img';
          img.alt = '';
          img.decoding = 'async';
          img.loading = 'lazy';
          img.src = url;
          card.insertBefore(img, card.firstChild);
          requestAnimationFrame(function () { card.classList.add('has-thumb'); });
        });
      });
    }, 250);
  })();

  if (params.get('confirmed') === '1') {
    var n1 = document.querySelector('[data-form-note]');
    if (n1) n1.textContent = 'Subscription confirmed. Welcome to the newsletter.';
  } else if (params.get('confirmed') === '0') {
    var n0 = document.querySelector('[data-form-note]');
    if (n0) n0.textContent = 'That confirmation link is invalid or has expired.';
  }
})();
