/* Shared behaviour for every page. Kept small and defensive — nothing here
   should ever be the reason a page fails to render. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- depth switch ---------------------------------------------------- */
  var DEPTH_KEY = 'gravitas:depth';
  function readDepth() {
    try { return localStorage.getItem(DEPTH_KEY) || 'overview'; }
    catch (e) { return 'overview'; }
  }
  function writeDepth(v) { try { localStorage.setItem(DEPTH_KEY, v); } catch (e) {} }

  function applyDepth(v) {
    document.body.classList.toggle('is-deep', v === 'deep');
    document.body.classList.toggle('is-overview', v !== 'deep');
    [].forEach.call(document.querySelectorAll('.depth button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.depth === v));
    });
  }
  applyDepth(readDepth());
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.depth button');
    if (!b) return;
    writeDepth(b.dataset.depth);
    applyDepth(b.dataset.depth);
  });

  /* ---- mobile menu ----------------------------------------------------- */
  var mb = document.querySelector('.lp-menu-btn');
  var nav = document.querySelector('.g-nav');
  if (mb && nav) {
    var setMenu = function (open) {
      nav.classList.toggle('is-open', open);
      mb.setAttribute('aria-expanded', String(open));
    };
    mb.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!nav.classList.contains('is-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && !mb.contains(e.target)) setMenu(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    var mq = window.matchMedia('(min-width: 721px)');
    var onWide = function () { if (mq.matches) setMenu(false); };
    if (mq.addEventListener) mq.addEventListener('change', onWide);
    window.addEventListener('resize', onWide);
    onWide();
  }

  /* ---- reveal on scroll ------------------------------------------------- */
  var rv = document.querySelectorAll('.rv');
  if (rv.length) {
    if (!('IntersectionObserver' in window) || reduce) {
      [].forEach.call(rv, function (e) { e.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
      [].forEach.call(rv, function (e) { io.observe(e); });
    }
  }

  /* ---- archive filtering ------------------------------------------------ */
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
    [].forEach.call(chips, function (c) {
      c.addEventListener('click', function () {
        active = c.dataset.filter;
        [].forEach.call(chips, function (o) { o.setAttribute('aria-pressed', String(o === c)); });
        run();
      });
    });
    if (box) box.addEventListener('input', run);
    run();
  }

  /* ---- in-page section nav --------------------------------------------- */
  var secNav = document.querySelector('.dossier-nav');
  if (secNav && 'IntersectionObserver' in window) {
    var links = [].slice.call(secNav.querySelectorAll('a'));
    var map = {};
    links.forEach(function (l) {
      var t = document.querySelector(l.getAttribute('href'));
      if (t) map[l.getAttribute('href')] = t;
    });
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (l) { l.classList.toggle('is-active', map[l.getAttribute('href')] === e.target); });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(map).forEach(function (k) { spy.observe(map[k]); });
  }

  /* ---- polls ------------------------------------------------------------ */
  [].forEach.call(document.querySelectorAll('.poll'), function (poll) {
    var opts = [].slice.call(poll.querySelectorAll('.poll__opt'));
    var seeds = opts.map(function (o) { return parseFloat(o.dataset.share || '0'); });
    var total = seeds.reduce(function (a, b) { return a + b; }, 0) || 1;
    opts.forEach(function (o) {
      o.addEventListener('click', function () {
        poll.classList.add('is-voted');
        opts.forEach(function (x) { x.setAttribute('aria-pressed', String(x === o)); });
        opts.forEach(function (x, k) {
          var pct = Math.round(seeds[k] / total * 100);
          x.querySelector('.poll__bar').style.width = pct + '%';
          x.querySelector('.poll__pct').textContent = pct + '%';
        });
      });
    });
  });

  /* ---- newsletter / forms ---------------------------------------------- */
  [].forEach.call(document.querySelectorAll('.g-inline-form[data-demo-form]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = f.parentElement && f.parentElement.querySelector('[data-form-note]');
      var input = f.querySelector('input[type="email"]');
      var button = f.querySelector('button[type="submit"]');
      var email = input && input.value.trim();

      if (!email) {
        if (note) note.textContent = 'Add an email address and we will send the next issue.';
        if (input) input.focus();
        return;
      }

      if (button) button.disabled = true;
      if (note) note.textContent = 'Subscribing…';

      fetch('/api/newsletter/subscribe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw data;
          return data;
        });
      }).then(function () {
        if (note) note.textContent = 'You’re subscribed. The next Gravitas+ issue will arrive by email.';
        f.reset();
      }).catch(function (err) {
        if (note) note.textContent = err && err.error === 'invalid_email'
          ? 'Please enter a valid email address.'
          : 'Subscription failed for now. Please try again in a moment.';
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  });
})();
