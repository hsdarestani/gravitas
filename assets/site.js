/* Shared behaviour for every page. Kept small and defensive. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DEPTH_KEY = 'gravitas:depth';
  function readDepth() { try { return localStorage.getItem(DEPTH_KEY) || 'overview'; } catch (e) { return 'overview'; } }
  function writeDepth(v) { try { localStorage.setItem(DEPTH_KEY, v); } catch (e) {} }
  function applyDepth(v) {
    document.body.classList.toggle('is-deep', v === 'deep');
    document.body.classList.toggle('is-overview', v !== 'deep');
    [].forEach.call(document.querySelectorAll('.depth button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.depth === v)); });
  }
  applyDepth(readDepth());

  // Copy updates from the annotated homepage review.
  [].forEach.call(document.querySelectorAll('.g-nav a[href="dossiers.html"]'), function (a) {
    a.textContent = 'Topics';
  });

  if (document.body.classList.contains('is-overview')) {
    document.title = 'Gravitas+ — Science, AI and the gravity of underlying questions';

    var heroTitle = document.querySelector('.lp-hero__title');
    if (heroTitle) heroTitle.innerHTML = 'Science, AI and the <em>gravity</em> of underlying questions.';

    var heroLead = document.querySelector('.lp-hero__grid .g-lead');
    if (heroLead) {
      heroLead.textContent = 'Gravitas+ is for people who always have questions — and follow them — about how science actually works, how it changes the world, and how AI/ML technologies can transform scientific research and education. Watch the film, then take it apart.';
    }

    var heroActions = document.querySelector('.lp-hero__grid .g-cluster');
    if (heroActions) {
      var primary = heroActions.querySelector('.g-btn--primary');
      if (primary) {
        primary.href = 'dossiers.html';
        var primaryTextUpdated = false;
        [].forEach.call(primary.childNodes, function (node) {
          if (!primaryTextUpdated && node.nodeType === 3 && node.nodeValue.trim()) {
            node.nodeValue = ' Explore topics';
            primaryTextUpdated = true;
          }
        });
        if (!primaryTextUpdated) primary.appendChild(document.createTextNode(' Explore topics'));
      }

      var secondary = heroActions.querySelector('.g-btn--secondary');
      if (secondary) secondary.textContent = 'Try lab';
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.depth button');
    if (!b) return;
    writeDepth(b.dataset.depth);
    applyDepth(b.dataset.depth);
  });

  var mb = document.querySelector('.lp-menu-btn');
  var nav = document.querySelector('.g-nav');
  if (mb && nav) {
    var setMenu = function (open) { nav.classList.toggle('is-open', open); mb.setAttribute('aria-expanded', String(open)); };
    mb.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!nav.classList.contains('is-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', function (e) { if (nav.classList.contains('is-open') && !nav.contains(e.target) && !mb.contains(e.target)) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    var mq = window.matchMedia('(min-width: 721px)');
    var onWide = function () { if (mq.matches) setMenu(false); };
    if (mq.addEventListener) mq.addEventListener('change', onWide);
    window.addEventListener('resize', onWide);
    onWide();
  }

  var rv = document.querySelectorAll('.rv');
  if (rv.length) {
    if (!('IntersectionObserver' in window) || reduce) {
      [].forEach.call(rv, function (e) { e.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
      [].forEach.call(rv, function (e) { io.observe(e); });
    }
  }

  var grid = document.querySelector('[data-filterable]');
  if (grid) {
    var chips = document.querySelectorAll('.chip[data-filter]');
    var box = document.querySelector('.search');
    var count = document.querySelector('.result-count');
    var empty = document.querySelector('.empty');
    var active = 'all';
    function run() {
      var q = (box && box.value || '').trim().toLowerCase();
      var shown = 0;
      [].forEach.call(grid.children, function (el) {
        if (!el.dataset) return;
        var okType = active === 'all' || (el.dataset.type || '').split(' ').indexOf(active) > -1;
        var hay = (el.textContent + ' ' + (el.dataset.tags || '')).toLowerCase();
        var okText = !q || hay.indexOf(q) > -1;
        var ok = okType && okText;
        el.classList.toggle('is-hidden', !ok);
        if (ok) shown++;
      });
      if (count) count.textContent = shown + (shown === 1 ? ' entry' : ' entries');
      if (empty) empty.classList.toggle('is-hidden', shown > 0);
    }
    [].forEach.call(chips, function (c) { c.addEventListener('click', function () { active = c.dataset.filter; [].forEach.call(chips, function (o) { o.setAttribute('aria-pressed', String(o === c)); }); run(); }); });
    if (box) box.addEventListener('input', run);
    run();
  }

  var secNav = document.querySelector('.dossier-nav');
  if (secNav && 'IntersectionObserver' in window) {
    var links = [].slice.call(secNav.querySelectorAll('a'));
    var map = {};
    links.forEach(function (l) { var t = document.querySelector(l.getAttribute('href')); if (t) map[l.getAttribute('href')] = t; });
    var spy = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) return; links.forEach(function (l) { l.classList.toggle('is-active', map[l.getAttribute('href')] === e.target); }); }); }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(map).forEach(function (k) { spy.observe(map[k]); });
  }

  [].forEach.call(document.querySelectorAll('.poll'), function (poll) {
    var opts = [].slice.call(poll.querySelectorAll('.poll__opt'));
    opts.forEach(function (o) {
      o.removeAttribute('data-share');
      o.addEventListener('click', function () {
        poll.classList.add('is-voted');
        opts.forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === o));
          var bar = x.querySelector('.poll__bar');
          var pct = x.querySelector('.poll__pct');
          if (bar) bar.style.width = '0';
          if (pct) pct.textContent = x === o ? 'Your vote' : '';
        });
      });
    });
  });

  [].forEach.call(document.querySelectorAll('.g-inline-form[data-newsletter-form]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = f.parentElement && f.parentElement.querySelector('[data-form-note]');
      var input = f.querySelector('input[type="email"]');
      var button = f.querySelector('button[type="submit"]');
      var email = input && input.value.trim();
      if (!email) { if (note) note.textContent = 'Add an email address and we will send a confirmation link.'; if (input) input.focus(); return; }
      if (button) button.disabled = true;
      if (note) note.textContent = 'Sending confirmation email…';
      fetch('/api/newsletter/subscribe/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: email, source: 'homepage' }) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw data; return data; }); })
        .then(function (data) {
          if (note) note.textContent = data.already_confirmed ? 'This email is already confirmed and subscribed.' : 'Check your inbox and click the confirmation link to finish subscribing.';
          if (!data.already_confirmed) f.reset();
        })
        .catch(function (err) { if (note) note.textContent = err && err.error === 'invalid_email' ? 'Please enter a valid email address.' : 'We could not send the confirmation email right now. Please try again shortly.'; })
        .finally(function () { if (button) button.disabled = false; });
    });
  });

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
    return fetch('/api/auth/csrf/', { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('csrf');
      return cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    });
  }
  function authPost(url, payload) {
    return csrfToken().then(function (token) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': token }, body: JSON.stringify(payload || {}) });
    }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw data; return data; }); });
  }
  function authMessage(error) {
    if (!error) return 'Something went wrong. Please try again.';
    if (error.error === 'invalid_email') return 'Please enter a valid email address.';
    if (error.error === 'password_too_short') return 'Use a password with at least ten characters.';
    if (error.error === 'account_exists') return 'An account with this email already exists.';
    if (error.error === 'invalid_credentials') return 'Email or password is incorrect.';
    return 'Something went wrong. Please try again.';
  }

  var signupForm = document.getElementById('p-up');
  var loginForm = document.getElementById('p-in');
  var resetForm = document.getElementById('p-reset');
  var authNote = document.querySelector('.auth__note[data-form-note]');
  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = signupForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (authNote) authNote.textContent = 'Creating your account…';
      authPost('/api/auth/signup/', { name: signupForm.elements.name.value.trim(), email: signupForm.elements.email.value.trim(), password: signupForm.elements.password.value, newsletter: !!(signupForm.elements.news && signupForm.elements.news.checked) })
        .then(function (data) { if (authNote) authNote.textContent = 'Account created. You’re signed in as ' + data.user.email + '.'; var signIn = document.querySelector('.gh-signin'); if (signIn) signIn.textContent = 'Account'; })
        .catch(function (err) { if (authNote) authNote.textContent = authMessage(err); })
        .finally(function () { if (button) button.disabled = false; });
    });
  }
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = loginForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (authNote) authNote.textContent = 'Signing in…';
      authPost('/api/auth/login/', { email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value, keep: !!(loginForm.elements.keep && loginForm.elements.keep.checked) })
        .then(function (data) { if (authNote) authNote.textContent = 'Signed in as ' + data.user.email + '.'; var signIn = document.querySelector('.gh-signin'); if (signIn) signIn.textContent = 'Account'; })
        .catch(function (err) { if (authNote) authNote.textContent = authMessage(err); })
        .finally(function () { if (button) button.disabled = false; });
    });
  }

  fetch('/api/auth/me/', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
    .then(function (res) { if (!res.ok) return null; return res.json(); })
    .then(function (data) { if (!data || !data.authenticated) return; var signIn = document.querySelector('.gh-signin'); if (signIn) { signIn.textContent = 'Account'; signIn.href = 'account.html'; } if (authNote) authNote.textContent = 'Signed in as ' + data.user.email + '.'; })
    .catch(function () {});
})();
