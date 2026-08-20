/* =========================================================================
   GRAVITAS+ · BRAND PAGE
   Two behaviours, both optional: the page is complete and readable with the
   script blocked. Nothing here re-implements anything site.js already does.
   ========================================================================= */
(function () {
  'use strict';

  /* Keep the brand book presentation pinned to the same reviewed upstream
     revision as the public frontend without replacing production-only files. */
  var UPSTREAM_SHA = '4cb9c0ed0f12bcdc8b3277deadde1b818dd5d72f';
  if (!document.getElementById('brand-upstream-parity')) {
    var css = document.createElement('link');
    css.id = 'brand-upstream-parity';
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/gh/desdevrad/gravitasplus@' + UPSTREAM_SHA + '/assets/brand.css';
    document.head.appendChild(css);
  }

  function swapFilmWord(text) {
    return String(text || '').replace(/\bFilm\b/g, 'Video').replace(/\bfilm\b/g, 'video');
  }
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function (node) {
    var p = node.parentElement;
    if (!p || /^(SCRIPT|STYLE|CODE|PRE|TEXTAREA)$/.test(p.tagName)) return;
    var next = swapFilmWord(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });

  /* ---- copy a token or a hex ---------------------------------------------
     Every swatch, ramp step and token chip carries data-copy. One delegated
     listener rather than one per element, because there are well over a
     hundred of them and they are all the same interaction. */
  var toast = document.querySelector('.bk-toast');
  var timer = null;

  function say(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(function () { toast.classList.remove('is-on'); }, 1600);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Fallback for insecure origins, where the async clipboard is missing.
       A brand page opened from a file:// path is exactly that case. */
    return new Promise(function (resolve, reject) {
      var el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
      document.body.removeChild(el);
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!t) return;
    var value = t.getAttribute('data-copy');
    copy(value).then(
      function () { say('Copied ' + value); },
      function () { say('Could not copy. The value is ' + value); }
    );
  });

  /* ---- contents rail: mark the section being read ------------------------
     A section's offsetTop is fixed regardless of how much page is left to
     scroll, so comparing it against scroll position (rather than waiting for
     the section to cross a line on screen, which is what IntersectionObserver
     does) keeps working even for the three short sections at the end of the
     document, where there isn't enough page left below them to ever carry
     their own top up to the reading line. Only the very last section needs a
     special case, for the moment the page truly cannot scroll any further. */
  var links = Array.prototype.slice.call(document.querySelectorAll('.bk-toc a'));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if (sections.length) {
    var READ_LINE = 130;

    function markCurrent() {
      var y = window.scrollY + READ_LINE;
      var current = sections[0].id;
      sections.forEach(function (sec) {
        if (sec.offsetTop <= y) current = sec.id;
      });

      var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= maxScroll - 1) current = sections[sections.length - 1].id;

      links.forEach(function (a) {
        a.classList.toggle('is-current', a.getAttribute('href') === '#' + current);
      });
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; markCurrent(); });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    markCurrent();
  }
})();
