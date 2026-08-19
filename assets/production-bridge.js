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
    var signIn = document.querySelector('.gh-signin');
    if (signIn) {
      signIn.textContent = 'Account';
      signIn.href = 'account.html';
    }
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

  /* ----------------------------------------------------------------------
     Upstream frontend parity: desdevrad/gravitasplus @ 8f1a95984140

     Kiarash's latest pass adds real poster thumbnails to .video frames,
     removes the repeated metadata strip, keeps the play ring readable in the
     light theme, and gives the still a subtle zoom on hover. The canonical
     upstream site.js/site.css are synchronized by the post-deploy workflow;
     this bridge is also a safe production fallback so the visual change is
     visible even before those static assets finish syncing. It deliberately
     leaves all auth/newsletter/backend behaviour above untouched.
     ---------------------------------------------------------------------- */
  (function upstreamThumbnailParity() {
    if (!document.querySelector('.video')) return;

    if (!document.getElementById('upstream-thumbnail-parity')) {
      var style = document.createElement('style');
      style.id = 'upstream-thumbnail-parity';
      style.textContent =
        '.video__meta{display:none!important}' +
        '.video__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;' +
          'transition:opacity var(--g-dur-slow) var(--g-ease-orbit),transform var(--g-dur-slow) var(--g-ease-orbit)}' +
        '.video.has-thumb .video__img{opacity:1}' +
        '.video.has-thumb::after{content:"";position:absolute;inset:0;pointer-events:none;background:rgb(3 3 3/.14)}' +
        '.video__play{position:relative;z-index:1}' +
        '.video:hover .video__img{transform:scale(1.03)}' +
        '.video.is-flat:hover .video__img{transform:none}' +
        ':root[data-theme="light"] .video.has-thumb .video__play{' +
          'border-color:rgb(241 239 236/.7);background:rgb(3 3 3/.35);color:var(--g-white-tint)}' +
        ':root[data-theme="light"] .video.has-thumb:hover .video__play{' +
          'background:rgb(0 48 73/.6);color:var(--g-white-tint)}' +
        '@media (prefers-reduced-motion:reduce){.video__img{transition:opacity var(--g-dur-fast) linear}' +
          '.video:hover .video__img{transform:none}}';
      document.head.appendChild(style);
    }

    var DIR = 'https://desdevrad.github.io/gravitasplus/assets/thumbnails/';
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
    }, 500);
  })();

  if (params.get('confirmed') === '1') {
    var n1 = document.querySelector('[data-form-note]');
    if (n1) n1.textContent = 'Subscription confirmed. Welcome to the newsletter.';
  } else if (params.get('confirmed') === '0') {
    var n0 = document.querySelector('[data-form-note]');
    if (n0) n0.textContent = 'That confirmation link is invalid or has expired.';
  }
})();
