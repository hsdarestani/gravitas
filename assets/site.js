/* Shared behaviour for every page. Kept small and defensive, nothing here
   should ever be the reason a page fails to render. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- theme -----------------------------------------------------------
     The attribute is already set by the inline snippet in <head>; setting it
     there rather than here is the whole point, because a theme applied after
     first paint means every light-mode visitor gets a flash of the dark site.
     This module only owns the *toggle* and the broadcast.

     Two states, and dark is the default outright. Following the OS sounded
     considerate and behaved badly: the same visitor got a dark site on their
     phone and a light one on a laptop set to auto, from a setting they made
     for their mail client. The site has a look; you get it until you say
     otherwise, and saying otherwise is one button. */
  var THEME_KEY = 'gravitas:theme';

  function resolved() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'light'));
      btn.setAttribute('title', theme === 'light' ? 'Switch to dark' : 'Switch to light');
    }
    // Canvases can't inherit a CSS colour, so the simulations listen for this
    // and re-read their palette. Without it the hero keeps painting white
    // lines on a cream page.
    window.dispatchEvent(new CustomEvent('gravitas:theme', { detail: { theme: theme } }));
  }

  apply(resolved());

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-toggle');
    if (!btn) return;
    var next = resolved() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (err) {}
    apply(next);
  });


  /* Read a themed colour channel for canvas work. Returns "r, g, b" so
     callers can build rgba() at whatever alpha they need. */
  window.gravitasInk = function (name, fallback) {
    var v = getComputedStyle(document.documentElement)
              .getPropertyValue('--g-canvas-' + name).trim();
    return v ? v.replace(/\s+/g, ',') : (fallback || '241,239,236');
  };

  /* ---- depth switch ----------------------------------------------------
     One control, two readings of the same page. The alternative, a separate
     "for researchers" section, splits the audience at the door and halves the
     value of every piece. This keeps one canonical page and lets the reader
     decide how much of it they want. */
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
    var mq = window.matchMedia('(min-width: 881px)');
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

  /* ---- archive filtering ------------------------------------------------
     Type chips plus free text, combined. The count is announced so the result
     of a filter is never ambiguous. */
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
  var secNav = document.querySelector('.topic-nav');
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

  /* ---- polls -------------------------------------------------------------
     Removed. This seeded each option from a hard-coded share attribute and
     rendered it as a percentage, which looked like a tally of real votes and
     was not one — there is no poll model in the backend to tally. The three
     positions are still worth reading, so they stayed as a static .stance
     list; what went is the button that pretended to count. Bring this back
     only alongside a real endpoint. */

  /* ---- reading progress --------------------------------------------------
     Only on pages that are actually long, an article body or a topic's
     layers. Putting it on every page would make it chrome, and chrome that
     says nothing is just another thing to ignore. It measures the article,
     not the document, so the footer doesn't count as unread text. */
  // div.art, not .art: the prose column, never the lab's card canvases.
  var longform = document.querySelector('div.art') || document.querySelector('.layer');
  if (longform) {
    var bar = document.createElement('div');
    bar.className = 'readbar';
    bar.setAttribute('aria-hidden', 'true');   // the scrollbar already says this to AT
    bar.innerHTML = '<i></i>';
    document.body.appendChild(bar);
    var fill = bar.firstChild;

    // The tracked region runs from the top of the first long block to the
    // bottom of the last, so 100% lands when the reading ends rather than when
    // the page does.
    var blocks = document.querySelectorAll('div.art, .layer');
    var last = blocks[blocks.length - 1];
    var ticking = false;

    function update() {
      ticking = false;
      var startY = longform.getBoundingClientRect().top + window.scrollY;
      var endY = last.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
      var span = endY - startY;
      if (span <= 0) { fill.style.width = '0'; return; }
      var p = (window.scrollY - startY) / span;
      fill.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---- video thumbnails --------------------------------------------------
     A .video card is a poster frame with a play button on it, and the frame
     was an empty gradient. Rather than paste a path into every card, the file
     is looked up from the page the card points at: the card linking to
     topic-computable-universe.html asks for
     assets/thumbnails/topic-computable-universe.webp, and a .video with no
     href — the one on a topic page, which is already on the page it means —
     asks for its own filename. Export a still under the page's name, drop it
     in the folder, and it appears in every card that links there. No markup
     to edit, and no list in the code that has to be kept in step with the
     folder, which is the thing that always drifts.

     A browser cannot read a directory listing, so "the folder has one" can
     only mean "the file loaded". Each extension is tried in turn and the
     first that decodes wins; webp is first because that is what we export, so
     the usual case costs one request. Nothing found is not an error — the
     card keeps the gradient it has always had, which is why a topic without
     artwork yet needs no special casing. */
  var THUMB_DIR = 'assets/thumbnails/';
  var THUMB_EXT = ['webp', 'jpg', 'png'];

  // data-thumb overrides the lookup, for a card whose art is not named after
  // its destination: data-thumb="video-04-alt" reads video-04-alt.webp.
  function thumbName(card) {
    if (card.getAttribute('data-thumb')) return card.getAttribute('data-thumb');
    var href = card.getAttribute('href') || location.pathname;
    var file = href.split(/[?#]/)[0].split('/').pop();
    return file.replace(/\.html?$/i, '') || 'index';
  }

  // Sequential, not parallel: three simultaneous requests to find one file is
  // two wasted every time, and the misses are the common case early on.
  function firstThatLoads(urls, done) {
    if (!urls.length) { done(null); return; }
    var url = urls.shift();
    var probe = new Image();
    probe.onload = function () { done(url); };
    probe.onerror = function () { firstThatLoads(urls, done); };
    probe.src = url;
  }

  [].forEach.call(document.querySelectorAll('.video'), function (card) {
    var name = thumbName(card);
    var urls = THUMB_EXT.map(function (ext) { return THUMB_DIR + name + '.' + ext; });

    firstThatLoads(urls, function (url) {
      if (!url) return;
      var img = new Image();
      img.className = 'video__img';
      // Decorative: the card already carries its own aria-label, and naming
      // the video twice is noise to a screen reader, not information.
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = url;
      card.insertBefore(img, card.firstChild);
      // Next frame, so the element is in the document before the class flips
      // and the fade actually has two states to run between.
      requestAnimationFrame(function () { card.classList.add('has-thumb'); });
    });
  });

  /* ---- auth completion safety -------------------------------------------
     production-bridge owns the real signup/login work and normally opens the
     workspace after it has handed any guest library to the authenticated
     account. That handover is useful but non-essential: a slow auxiliary
     request must never leave a successfully authenticated person parked on
     the account form forever.

     This listener is registered before the deferred production bridge. It
     does not submit, mutate or compete with the auth flow. Four seconds after
     an auth form was submitted it asks the authoritative session endpoint;
     if the session is already valid and the bridge has not navigated yet, it
     opens the workspace. The bridge is loaded there too, so a guest library
     that was still pending is retried on the next page without losing data. */
  if (document.getElementById('p-up') || document.getElementById('p-in')) {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || (form.id !== 'p-up' && form.id !== 'p-in')) return;

      var attempts = 0;
      function checkSession() {
        if (location.pathname !== '/signup' && location.pathname !== '/login') return;
        attempts += 1;
        fetch('/api/auth/me/', {
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json' }
        }).then(function (response) {
          return response.ok ? response.json() : null;
        }).then(function (data) {
          if (data && data.authenticated) {
            location.href = '/workspace';
            return;
          }
          if (attempts < 8) window.setTimeout(checkSession, 1000);
        }).catch(function () {
          if (attempts < 8) window.setTimeout(checkSession, 1000);
        });
      }

      window.setTimeout(checkSession, 4000);
    }, true);
  }

  /* ---- newsletter / forms ------------------------------------------------
     Removed with the polls, for the same reason. This caught every form the
     prototype had flagged as a demo and answered "this is a front-end demo",
     which on a live site reads as a submission that quietly went nowhere.
     Every form it used to cover is now handled for real in
     assets/production-bridge.js: the auth forms by id, the newsletter by
     .g-inline-form, and the discussion forms by the [data-comment-form]
     content key they post against. The demo flag is gone from the public HTML
     and the demo-data gate now bans the attribute outright. */
})();