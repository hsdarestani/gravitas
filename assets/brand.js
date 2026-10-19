/* =========================================================================
   GRAVIQUEST · BRAND PAGE
   Two behaviours, both optional: the page is complete and readable with the
   script blocked. Nothing here re-implements anything site.js already does.
   ========================================================================= */
(function () {
  'use strict';

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

  /* ---- contents rail ------------------------------------------------------
     The HTML holds parts and chapters only. Each chapter's sections are read
     from its own h3s here, so the rail cannot list a heading the text no
     longer has. Only the chapter being read is open.

     Position is taken from offsetTop against the scroll position rather than
     from IntersectionObserver, which waits for an element to cross a line on
     screen: the short chapters at the end of the book never have enough page
     below them to carry their own top up to that line. The very last chapter
     needs one special case, for the moment the page cannot scroll further. */
  var toc = document.querySelector('.bk-toc');
  var chapters = [];

  function slug(text) {
    return text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  if (toc) {
    Array.prototype.forEach.call(toc.querySelectorAll('.bk-toc__part > ol > li > a'), function (a) {
      var sec = document.querySelector(a.getAttribute('href'));
      if (!sec) return;
      var heads = Array.prototype.filter.call(sec.children, function (el) { return el.tagName === 'H3'; });
      var subs = [];
      if (heads.length) {
        var wrap = document.createElement('div');
        wrap.className = 'bk-toc__sub';
        var ol = document.createElement('ol');
        heads.forEach(function (h) {
          if (!h.id) h.id = sec.id + '-' + slug(h.textContent);
          var li = document.createElement('li');
          var link = document.createElement('a');
          link.href = '#' + h.id;
          link.textContent = h.textContent;
          li.appendChild(link);
          ol.appendChild(li);
          subs.push({ el: h, link: link });
        });
        wrap.appendChild(ol);
        a.parentNode.appendChild(wrap);
      }
      var label = a.closest('.bk-toc__part').querySelector('.bk-toc__label');
      chapters.push({ el: sec, link: a, item: a.parentNode, subs: subs, part: label.getAttribute('href') });
    });
  }

  var parts = toc ? Array.prototype.map.call(toc.querySelectorAll('.bk-toc__label'), function (a) {
    return { el: document.querySelector(a.getAttribute('href')), link: a };
  }).filter(function (p) { return p.el; }) : [];

  if (chapters.length) {
    var READ_LINE = 140;

    function top(el) { return el.getBoundingClientRect().top + window.scrollY; }

    function last(list, y) {
      var found = null;
      list.forEach(function (x) { if (top(x.el) <= y) found = x; });
      return found;
    }

    function markCurrent() {
      var y = window.scrollY + READ_LINE;
      var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      var atEnd = window.scrollY >= maxScroll - 1;

      var ch = atEnd ? chapters[chapters.length - 1] : last(chapters, y);
      var sub = ch ? (atEnd ? ch.subs[ch.subs.length - 1] : last(ch.subs, y)) : null;
      var part = last(parts, y);

      /* A part's plate sits between the last chapter of one part and the first
         of the next. While it is on the reading line, the reader has left the
         old chapter already: the rail moves to the part's first chapter, with
         none of its sections marked yet, rather than staying on the chapter
         above, which is what jumping here from the cover used to show. */
      if (!atEnd && part && (!ch || top(part.el) > top(ch.el))) {
        ch = chapters.filter(function (c) { return c.part === '#' + part.el.id; })[0] || ch;
        sub = null;
      }

      chapters.forEach(function (c) {
        var on = c === ch;
        c.link.classList.toggle('is-current', on);
        c.item.classList.toggle('is-open', on);
        c.subs.forEach(function (s) { s.link.classList.toggle('is-current', on && s === sub); });
      });
      parts.forEach(function (p) { p.link.classList.toggle('is-current', p === part); });

      /* keep the open chapter in view inside the rail, which scrolls on its own */
      if (ch && ch !== markCurrent.last && toc.scrollHeight > toc.clientHeight) {
        var r = ch.link.offsetTop; // the sticky rail is the offsetParent
        if (r < toc.scrollTop || r > toc.scrollTop + toc.clientHeight - 80) {
          toc.scrollTop = Math.max(0, r - 48);
        }
      }
      markCurrent.last = ch;
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
