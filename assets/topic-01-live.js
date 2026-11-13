/* =========================================================================
   TOPIC 01 FROM ITS RECORD
   Everything a reader sees of Topic 01, on its own page and in the rail on the
   home page, comes from one ContentItem, the record the Topic editor under
   Platform Admin saves. The HTML holds headings and empty containers.

   It used to be written into both HTML files by hand, so an admin's save
   changed nothing and the two pages could disagree. There is deliberately no
   copy of the content here to fall back on: a fallback is a second source that
   quietly goes stale, and a failed read says so and offers a retry instead.

   window.GQTopic01 is a promise for the record, or for null when it could not
   be read. topic-01-essay.js waits on it for the essay covers and the sources,
   so this script loads before it.

   The page was rebuilt on 2026-11-12 from a design review. What it took from
   that review is behaviour, not looks: a contents rail, a picker for several
   videos, a timeline read one milestone at a time, a vote whose results open
   after you answer, one room per part of the Topic. Every number on the page
   is one the backend returned: vote counts from the poll route, room activity
   from the Forum, nothing estimated and nothing seeded. Where the backend has
   nothing yet, the page says that rather than drawing a plausible zero.

   window.GQTopicToc lets the essay script add its count and sub-entries to
   the rail, because the essays arrive from their own route after this runs,
   and open another section (Show in Sources, Back to reading).
   ========================================================================= */
(function () {
  'use strict';

  var SLUG = 'answer-that-looked-right';
  var PAGE = 'topic-answer-that-looked-right.html';
  var CHANNEL = 'https://www.youtube.com/@GraviQuest';
  var ARROW = '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var BACK = '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

  var shell = document.querySelector('[data-topic-01-shell]');
  var rail = document.querySelector('[data-rail][data-public-featured-topic]');

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /* An address the record may point a reader at. Anything else renders as no
     link at all, because an admin's field is still not trusted markup. */
  function safeUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.charAt(0) === '/' && raw.charAt(1) !== '/') return raw;
    try {
      var url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (err) { return ''; }
  }

  function rows(value) {
    return Array.isArray(value) ? value.filter(function (row) { return row && typeof row === 'object'; }) : [];
  }

  function external(url) { return /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : ''; }

  /* Plain text with [label](url) links, which is all a timeline entry needs. */
  function inline(value) {
    return esc(value).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (whole, label, href) {
      var url = safeUrl(href.replace(/&amp;/g, '&'));
      return url ? '<a href="' + esc(url) + '"' + external(url) + '>' + label + '</a>' : label;
    });
  }

  function image(url, alt, size) {
    var src = safeUrl(url);
    if (!src) return '';
    return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="' + size[0] + '" height="' + size[1] + '" loading="lazy" decoding="async">';
  }

  function videos(data) {
    var list = rows(data.videos);
    if (list.length) return list;
    return data.video && typeof data.video === 'object' && Object.keys(data.video).length ? [data.video] : [];
  }

  function youtubeId(address) {
    try {
      var url = new URL(address);
      if (url.hostname.indexOf('youtu.be') >= 0) return url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.pathname.indexOf('/embed/') === 0) return url.pathname.split('/')[2] || '';
      return url.searchParams.get('v') || '';
    } catch (err) { return ''; }
  }

  function poster(video) {
    var src = safeUrl(video.poster_url);
    return src ? '<img class="video__img" alt="" decoding="async" src="' + esc(src) + '">' : '';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function longDate(iso) {
    var date = new Date(iso || '');
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function cookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { data.status = response.status; throw data; }
        return data;
      });
    });
  }

  function post(url, payload) {
    return fetch('/api/auth/csrf/', { credentials: 'same-origin', cache: 'no-store' }).then(function () {
      return fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': cookie('csrftoken') || cookie('gravitas_staging_csrftoken') },
        body: JSON.stringify(payload || {})
      });
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { data.status = response.status; throw data; }
        return data;
      });
    });
  }

  /* ---- Saying that a copy worked -------------------------------------------
     One way for every copy and share button on the page, the essay script's
     included (window.GQTopicFeedback). The button's mark turns into a tick
     for a moment and, where the button has a label, the label says what
     happened; an icon-only button keeps its size and its shape. A screen
     reader hears the same words from one polite status line.

     It replaced a helper that wrote "Copied" over the button's text node.
     On an icon-only button that text node was the whole button, so the icon
     was wiped and the round button stretched into a pill; and a second click
     inside the moment saved "Copied" as the label to go back to, so the
     button said Copied for good. */
  var CHECK = '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var SHARE = '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/></svg>';
  var idle = new WeakMap();
  var status = null;

  function announce(text) {
    if (!status) {
      status = document.createElement('p');
      status.className = 'g-visually-hidden';
      status.setAttribute('role', 'status');
      document.body.append(status);
    }
    status.textContent = '';
    setTimeout(function () { status.textContent = text; }, 30);
  }

  function flash(button, text, failed) {
    if (!idle.has(button)) idle.set(button, button.innerHTML);
    clearTimeout(button.gqTimer);
    var label = button.querySelector('span');
    button.innerHTML = (failed ? '' : CHECK) + (label ? '<span>' + esc(text) + '</span>' : '');
    if (!label && failed) button.innerHTML = idle.get(button);
    button.classList.toggle('is-done', !failed);
    button.classList.toggle('is-failed', !!failed);
    announce(text);
    button.gqTimer = setTimeout(function () {
      button.innerHTML = button.dataset.nextIdle || idle.get(button);
      if (button.dataset.nextIdle) { idle.set(button, button.dataset.nextIdle); delete button.dataset.nextIdle; }
      idle.delete(button);
      button.classList.remove('is-done', 'is-failed');
    }, 1600);
  }

  /* A button's resting markup, changed while it may be saying Copied. */
  function relabel(button, markup) {
    if (button.classList.contains('is-done')) button.dataset.nextIdle = markup;
    else button.innerHTML = markup;
  }

  function copyText(button, text, done) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.append(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      area.remove();
      return ok;
    }
    var write = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text) : Promise.reject();
    return write.then(function () { flash(button, done || 'Copied'); }, function () {
      if (fallback()) flash(button, done || 'Copied');
      else flash(button, 'Could not copy', true);
    });
  }

  window.GQTopicFeedback = { copy: copyText, flash: flash, relabel: relabel };

  /* Copy a link, or hand it to the system share sheet on a phone. */
  function share(button, url, title) {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: title, url: url }).catch(function () {});
      return;
    }
    copyText(button, url, 'Link copied');
  }

  function pageUrl(hash) { return location.href.split('#')[0] + (hash ? '#' + hash : ''); }

  /* ---- The Topic page --------------------------------------------------- */
  function fill(key, markup) {
    var node = shell.querySelector('[data-t1="' + key + '"]');
    if (node) node.innerHTML = markup;
    return node;
  }

  /* ---- Contents rail and the one open section ----------------------------
     Since the second pass of 2026-11-12 the page shows one section at a time,
     chosen in the rail, the way the workspace shows one screen beside its
     index. The rail is that index's row: a line mark, the name, one quiet line
     saying what the section holds, and the count the record has for it. The
     lit row's mark is set in orbit, a hairline ring with the accent body on
     it, exactly as ws-unified-design.css draws the workspace's.

     The sections were one long scroll before, which made the rail a table of
     contents and the reader's position a progress bar. Seven parts of very
     different length read better as places: the essays no longer push the
     discussion thousands of pixels down, and a link to #talk opens the
     Discussion rather than scrolling past everything above it.

     The section is the address. #video, #essay, #talk... open their section;
     #video-2 and #essay-2 open the section whose script reads its own choice
     from them; any other anchor opens the section holding it and scrolls to
     it. Choosing in the rail pushes a history entry, so Back returns to the
     section the reader came from. Each section ends with the one before and
     the one after, so the Topic can still be read in order. */
  var toc = { counts: {}, subs: {} };
  var current = '';
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function sectionList() { return Array.prototype.slice.call(shell.querySelectorAll('.tq-sec')); }
  function glyph(name) { return window.GravitasIcons ? window.GravitasIcons.icon(name, 'tq-toc__svg') : ''; }

  function drawToc() {
    var list = shell.querySelector('[data-t1-toc-list]');
    if (!list) return;
    list.innerHTML = sectionList().map(function (section) {
      var id = section.id;
      var count = toc.counts[id];
      var subs = toc.subs[id] || [];
      var hint = section.getAttribute('data-toc-hint');
      return '<li data-for="' + id + '"><a class="tq-toc__link" href="#' + id + '" data-toc-go="' + id + '">' +
        '<span class="tq-toc__icon">' + glyph(section.getAttribute('data-toc-icon')) + '</span>' +
        '<span class="tq-toc__name">' + esc(section.getAttribute('data-toc')) + '</span>' +
        (count ? '<b class="tq-toc__n" title="' + count + ' in this section">' + count + '</b>' : '') +
        (hint ? '<span class="tq-toc__hint">' + esc(hint) + '</span>' : '') + '</a>' +
        (subs.length ? '<div class="tq-toc__sub"><ol>' + subs.map(function (sub) {
          return '<li><a href="' + esc(sub.href) + '">' + esc(sub.label) + '</a></li>';
        }).join('') + '</ol></div>' : '') + '</li>';
    }).join('');
    spy(false);
  }

  /* Marks the lit row. The orbit swings only when the section changes, not
     on every redraw a count arriving causes. */
  function spy(moved) {
    var list = shell.querySelector('[data-t1-toc-list]');
    if (!list) return;
    list.querySelectorAll(':scope > li').forEach(function (item) {
      var on = item.getAttribute('data-for') === current;
      item.classList.toggle('is-open', on);
      var link = item.querySelector(':scope > a');
      if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      link.classList.toggle('is-still', on && !moved);
      if (on && moved && list.scrollWidth > list.clientWidth + 1) {
        var box = link.getBoundingClientRect(), frame = list.getBoundingClientRect();
        list.scrollBy({ left: box.left - frame.left - (frame.width - box.width) / 2, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
    });
  }

  /* The way on from each section, in reading order. */
  function drawPagers() {
    var sections = sectionList();
    sections.forEach(function (section, index) {
      var pager = section.querySelector(':scope > .tq-pager');
      if (!pager) {
        pager = document.createElement('nav');
        pager.className = 'tq-pager';
        pager.setAttribute('aria-label', 'More of this Topic');
        section.append(pager);
      }
      var before = sections[index - 1], after = sections[index + 1];
      function link(target, label, cls) {
        return '<a class="tq-pager__link ' + cls + '" href="#' + target.id + '" data-toc-go="' + target.id + '">' +
          '<span class="tq-pager__k">' + (cls === 'is-prev' ? BACK : '') + label + (cls === 'is-next' ? ARROW : '') + '</span>' +
          '<span class="tq-pager__t">' + esc(target.getAttribute('data-toc')) + '</span></a>';
      }
      pager.innerHTML = (before ? link(before, 'Before', 'is-prev') : '<span></span>') +
        (after ? link(after, 'Next', 'is-next') : '');
    });
  }

  /* Which section an address means, and what in it to scroll to. */
  function resolve(hash) {
    var name = (hash || '').replace(/^#/, '');
    var sections = sectionList();
    var fallback = { id: sections[0] ? sections[0].id : '', target: null };
    if (!name) return fallback;
    var by = /^(video|essay)-\d+$/.exec(name);
    if (by) return { id: by[1], target: null };
    var node = null;
    try { node = document.getElementById(decodeURIComponent(name)); } catch (err) { node = null; }
    var section = node && node.closest('.tq-sec');
    /* An address that names nothing on the page leaves the reader where they
       are. It used to open the first section, so a stray in-page link (a
       citation in the essay's Overview) threw the reader back to Videos. */
    if (!section || !shell.contains(section)) return current ? { id: current, target: null, stay: true } : fallback;
    return { id: section.id, target: node === section ? null : node };
  }

  /* Opens one section. `scroll` is 'top' to bring the section's head under
     the header when the reader is further down, an element to centre, or
     false to leave the page where it is (Back to reading restores its own
     place). Returns the open section. */
  function show(id, scroll) {
    var sections = sectionList();
    var section = sections.filter(function (node) { return node.id === id; })[0] || sections[0];
    if (!section) return null;
    var moved = section.id !== current;
    current = section.id;
    sections.forEach(function (node) {
      node.hidden = node !== section;
      if (node === section && moved) {
        node.classList.remove('is-entering');
        void node.offsetWidth;
        node.classList.add('is-entering');
      }
    });
    spy(moved);
    if (moved) document.dispatchEvent(new CustomEvent('gq:topic-section', { detail: { id: current } }));
    if (scroll === 'top') {
      var layout = shell.querySelector('.tq-layout');
      var header = document.querySelector('.g-header, header');
      var top = layout ? layout.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 64) - 16 : 0;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    } else if (scroll && scroll.scrollIntoView) {
      scroll.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
    return section;
  }

  function route(scrollTop) {
    var found = resolve(location.hash);
    if (found.stay) return;
    show(found.id, found.target || (scrollTop ? 'top' : false));
  }

  function go(id, focus) {
    if (('#' + id) !== location.hash) history.pushState(null, '', '#' + id);
    var section = show(id, 'top');
    if (focus && section) {
      var heading = section.querySelector('h2');
      if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    }
  }

  /* The home page runs this script for its rail and has no Topic shell, so
     the sections, the address and window.GQTopicToc exist only on the page. */
  if (shell) {
    shell.addEventListener('click', function (event) {
      var link = event.target.closest('[data-toc-go]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault();
      go(link.getAttribute('data-toc-go'), true);
    });
    window.addEventListener('popstate', function () { route(true); });
    window.addEventListener('hashchange', function () { route(true); });
  }

  if (shell) window.GQTopicToc = {
    set: function (id, count, subs) {
      toc.counts[id] = count;
      if (subs) toc.subs[id] = subs;
      drawToc();
    },
    /* For the essay script: open a section, then do what it needs there. */
    show: function (id, scroll) { return show(id, scroll === undefined ? 'top' : scroll); },
    current: function () { return current; }
  };

  /* ---- Videos -------------------------------------------------------------
     Since the third pass of 2026-11-12: the list of videos stands beside the
     player at the player's own height, the player names the video it holds
     (Video 2 of 4 · 6:15) and where it lives (YouTube, top right), and under
     both sit the title, what it is about, and the two things to do with it.
     That is the arrangement the design review drew; it reads as one object,
     where the version before it put a short list beside a tall player and
     the facts in a table under it.

     A published video starts as its still and a play button and only loads
     the player when the reader asks for it. YouTube's player is heavy and
     sets nothing until it is pressed, which is the point of the no-cookie
     address it plays from. With no still, the player loads as it is. A video
     that is not public yet shows its still and "Coming soon", never a play
     button that plays nothing.

     The choice is the address (#video-2), so it can be linked and survives a
     reload. */
  var BIGPLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8.5 5.6v12.8a.9.9 0 0 0 1.37.77l10.2-6.4a.9.9 0 0 0 0-1.54l-10.2-6.4A.9.9 0 0 0 8.5 5.6z"/></svg>';
  var EXT = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>';
  var TALK = '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3.2v-3.2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/></svg>';

  function playable(video) {
    var id = video.source_type === 'youtube' ? youtubeId(video.youtube_url) : '';
    if (id) return { kind: 'youtube', id: id };
    var file = video.source_type === 'self_hosted' ? safeUrl(video.self_hosted_url) : '';
    return file ? { kind: 'file', src: file } : null;
  }

  function embed(video, source, autoplay) {
    if (source.kind === 'youtube') {
      return '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(source.id) + (autoplay ? '?autoplay=1' : '') + '" title="' + esc(video.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    }
    var still = safeUrl(video.poster_url);
    return '<video controls preload="metadata"' + (autoplay ? ' autoplay' : '') + ' src="' + esc(source.src) + '"' + (still ? ' poster="' + esc(still) + '"' : '') + '></video>';
  }

  function stage(video, index, total) {
    var source = playable(video);
    var still = safeUrl(video.poster_url);
    var badge = (total > 1 ? 'Video ' + (index + 1) + ' of ' + total : 'Video') + (video.duration ? ' &middot; ' + esc(video.duration) : '');
    var watch = source && source.kind === 'youtube' ? safeUrl(video.youtube_url) : '';
    var where = watch
      ? '<a class="tq-stage__chip tq-stage__where" href="' + esc(watch) + '" target="_blank" rel="noopener">Watch on YouTube' + EXT + '</a>'
      : '<a class="tq-stage__chip tq-stage__where" href="' + CHANNEL + '" target="_blank" rel="noopener">GraviQuest on YouTube' + EXT + '</a>';
    if (source && !still) return '<div class="tq-stage is-playing">' + embed(video, source, false) + '</div>';
    var art = still ? '<img class="tq-stage__img" src="' + esc(still) + '" alt="" decoding="async">' : '<span class="tq-stage__title">' + esc(video.title) + '</span>';
    return '<div class="tq-stage' + (source ? '' : ' is-soon') + '">' + art + '<span class="tq-stage__shade" aria-hidden="true"></span>' +
      '<span class="tq-stage__chip tq-stage__badge">' + badge + '</span>' + where +
      (source
        ? '<button class="tq-stage__play" type="button" data-play aria-label="Play ' + esc(video.title) + '">' + BIGPLAY + '</button>'
        : '<span class="tq-stage__soon" role="img" aria-label="' + esc(video.title) + ' is not published yet">Coming soon</span>') +
      '</div>';
  }

  function namedLink(label, address) {
    var url = safeUrl(address);
    return url ? '<a href="' + esc(url) + '"' + external(url) + '>' + esc(label) + '</a>' : esc(label);
  }

  /* What the record knows about the video, in one quiet line. Where to watch
     it is on the player, so it is not repeated here. */
  function videoFacts(video) {
    var facts = [];
    if (video.duration) facts.push('<div><dt>Runtime</dt><dd>' + esc(video.duration) + '</dd></div>');
    if (video.info) facts.push('<div><dt>Field</dt><dd>' + esc(video.info) + '</dd></div>');
    if (video.companion_label) facts.push('<div><dt>Companion</dt><dd>' + namedLink(video.companion_label, video.companion_url) + '</dd></div>');
    if (video.transcript_label) facts.push('<div><dt>Transcript</dt><dd>' + namedLink(video.transcript_label, video.transcript_url) + '</dd></div>');
    return facts.length ? '<dl class="tq-vfacts">' + facts.join('') + '</dl>' : '';
  }

  function videoBelow(video, index) {
    return '<div class="tq-vbelow__text"><h3>' + esc(video.title) + '</h3>' +
      (video.description ? '<p>' + esc(video.description) + '</p>' : '') + videoFacts(video) + '</div>' +
      '<div class="tq-actions tq-vbelow__act"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-share-video="' + (index + 1) + '">' + SHARE + '<span>Share</span></button>' +
      '<a class="g-btn g-btn--primary g-btn--sm" href="#talk" data-room-jump="videos">' + TALK + '<span>Discuss the videos</span></a></div>';
  }

  function videoPicker(list) {
    return '<div class="tq-pick" role="list" aria-label="Videos in this Topic">' + list.map(function (video, index) {
      var thumb = safeUrl(video.poster_url);
      return '<a class="tq-pick__item" role="listitem" href="#video-' + (index + 1) + '" data-video="' + index + '">' +
        '<span class="tq-pick__thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async">' : '<span class="tq-pick__blank" aria-hidden="true">' + pad2(index + 1) + '</span>') +
        (video.duration ? '<span class="tq-pick__dur">' + esc(video.duration) + '</span>' : '') + '</span>' +
        '<span class="tq-pick__text"><small>Video ' + (index + 1) + '</small><b>' + esc(video.title) + '</b></span></a>';
    }).join('') + '</div>';
  }

  function renderVideos(list) {
    var several = list.length > 1;
    var host = fill('videos', list.length
      ? '<div class="tq-vlayout' + (several ? '' : ' is-single') + '">' + (several ? videoPicker(list) : '') + '<div class="tq-vmain" data-video-main></div></div>' +
        '<div class="tq-vbelow" data-video-below></div>'
      : '<p class="ta-empty">No video is published for this Topic yet.</p>');
    if (!list.length) return;
    var main = host.querySelector('[data-video-main]');
    var below = host.querySelector('[data-video-below]');
    var at = 0;
    function show(index) {
      at = index;
      main.innerHTML = stage(list[index], index, list.length);
      below.innerHTML = videoBelow(list[index], index);
      /* The cast, stills and transcript are the first video's, so they show
         with it and step aside while another video is chosen. */
      var section = host.closest('.tq-sec');
      if (section) section.classList.toggle('is-other-video', index > 0);
      host.querySelectorAll('[data-video]').forEach(function (link) {
        if (Number(link.getAttribute('data-video')) === index) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }
    host.addEventListener('click', function (event) {
      var pick = event.target.closest('[data-video]');
      if (pick && !event.metaKey && !event.ctrlKey && event.button === 0) {
        event.preventDefault();
        var index = Number(pick.getAttribute('data-video'));
        if (index !== at) show(index);
        history.replaceState(null, '', '#video-' + (index + 1));
        return;
      }
      if (event.target.closest('[data-play]')) {
        var holder = main.querySelector('.tq-stage');
        holder.classList.add('is-playing');
        holder.innerHTML = embed(list[at], playable(list[at]), true);
        var frame = holder.querySelector('iframe, video');
        if (frame) frame.focus();
        return;
      }
      var shareButton = event.target.closest('[data-share-video]');
      if (shareButton) share(shareButton, pageUrl('video-' + shareButton.getAttribute('data-share-video')), list[at].title);
    });
    var linked = /^#video-(\d+)$/.exec(location.hash);
    show(linked ? Math.min(list.length - 1, Math.max(0, Number(linked[1]) - 1)) : 0);
  }

  /* ---- Timeline -----------------------------------------------------------
     One milestone at a time on a stage, every milestone named on the line
     below it, so the whole span stays readable at a glance. The line is a tab
     list: arrow keys move along it, Home and End jump to its ends. */
  function renderTimeline(data) {
    var list = rows(data.timeline);
    var figure = data.timeline_figure || {};
    if (!list.length) { fill('timeline', ''); return 0; }
    var anyImage = list.some(function (row) { return safeUrl(row.image_url); });
    var host = fill('timeline',
      '<div class="tq-tl">' +
      '<div class="tq-tl__stage" data-tl-stage role="tabpanel" aria-live="polite"></div>' +
      '<ol class="tq-tl__line" role="tablist" aria-label="Milestones">' + list.map(function (row, index) {
        return '<li role="presentation"><button type="button" role="tab" id="tl-tab-' + index + '" aria-controls="tl-stage" data-tl="' + index + '" aria-selected="false" tabindex="-1">' +
          '<span class="tq-tl__dot" aria-hidden="true"></span><span class="tq-tl__yr">' + esc(row.date) + '</span><span class="tq-tl__name">' + esc(row.short || row.title) + '</span></button></li>';
      }).join('') + '</ol></div>' +
      (!anyImage && safeUrl(figure.image_url)
        ? '<figure class="tq-tl__figure">' + image(figure.image_url, figure.image_alt, [1280, 720]) + (figure.caption ? '<figcaption>' + esc(figure.caption) + '</figcaption>' : '') + '</figure>'
        : ''));
    var stage = host.querySelector('[data-tl-stage]');
    stage.id = 'tl-stage';
    var tabs = Array.prototype.slice.call(host.querySelectorAll('[data-tl]'));
    function show(index, focus) {
      var row = list[index];
      var pic = image(row.image_url, row.image_alt, [1280, 720]);
      stage.setAttribute('aria-labelledby', 'tl-tab-' + index);
      stage.classList.toggle('has-pic', !!pic);
      stage.innerHTML = (pic ? '<div class="tq-tl__pic">' + pic + '</div>' : '') +
        '<div class="tq-tl__text"><p class="g-eyebrow g-eyebrow--bare">Milestone ' + (index + 1) + ' of ' + list.length + ' &middot; ' + esc(row.date) + '</p>' +
        '<h3>' + esc(row.title) + '</h3><p>' + inline(row.description) + '</p>' +
        (row.why ? '<div class="tq-tl__why"><p class="tq-tl__why-k">Why it matters here</p><p>' + inline(row.why) + '</p></div>' : '') +
        '<div class="tq-tl__nav"><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-tl-step="-1"' + (index ? '' : ' disabled') + '>' + BACK + '<span>Previous</span></button>' +
        '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-tl-step="1"' + (index < list.length - 1 ? '' : ' disabled') + '><span>Next</span>' + ARROW + '</button></div></div>';
      tabs.forEach(function (tab, k) {
        tab.setAttribute('aria-selected', String(k === index));
        tab.tabIndex = k === index ? 0 : -1;
        tab.classList.toggle('is-past', k < index);
      });
      if (focus) tabs[index].focus();
      host.dataset.at = index;
    }
    host.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-tl]');
      if (tab) { show(Number(tab.getAttribute('data-tl'))); return; }
      var step = event.target.closest('[data-tl-step]');
      if (step) show(Math.min(list.length - 1, Math.max(0, Number(host.dataset.at) + Number(step.getAttribute('data-tl-step')))));
    });
    host.querySelector('[role="tablist"]').addEventListener('keydown', function (event) {
      var at = Number(host.dataset.at);
      var next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[event.key];
      if (next == null) return;
      event.preventDefault();
      show(Math.min(list.length - 1, Math.max(0, next)), true);
    });
    show(0);
    return list.length;
  }

  /* ---- Viewpoints ---------------------------------------------------------
     The positions, then the questions. A question's results open after the
     reader answers, or asks to see them, so other people's answers do not
     steer the first one. The counts are the poll route's. A reason is a
     comment on the poll's own key: it goes through the same moderation as
     every comment, and the published ones open with the results. */
  var LEVEL_WORDS = { choice: 'Choice', scale: 'Scale' };

  function renderPolls(data) {
    var views = data.viewpoints || {};
    fill('views', rows(views.items).map(function (view) {
      return '<article class="g-card tq-view"><p class="g-eyebrow g-eyebrow--bare">' + esc(view.label) + '</p><p>' + esc(view.text) + '</p>' + (view.cite ? '<cite>' + esc(view.cite) + '</cite>' : '') + '</article>';
    }).join(''));
    var polls = rows(views.polls).filter(function (poll) { return poll.id && rows(poll.options).length; });
    var host = fill('polls', '');
    if (!polls.length) return 0;
    host.innerHTML = '<div class="tq-polls' + (polls.length > 1 ? ' has-list' : '') + '">' +
      (polls.length > 1 ? '<div class="tq-polls__list" role="list" aria-label="Questions">' + polls.map(function (poll, index) {
        return '<button class="tq-polls__item" type="button" role="listitem" data-poll-pick="' + index + '"' + (index ? '' : ' aria-current="true"') + '>' +
          '<small>Viewpoint ' + (index + 1) + '</small><b>' + esc(poll.question) + '</b><span data-poll-total="' + esc(poll.id) + '"></span></button>';
      }).join('') + '</div>' : '') + '<div class="tq-poll" data-poll-panel></div></div>';
    var panel = host.querySelector('[data-poll-panel]');
    var state = {};

    function load(poll) {
      return getJSON('/api/content/' + SLUG + '/poll/?poll_id=' + encodeURIComponent(poll.id)).then(function (payload) {
        state[poll.id] = payload.poll;
        var total = host.querySelector('[data-poll-total="' + poll.id + '"]');
        if (total) total.textContent = plural(payload.poll.total_votes, 'vote', 'votes');
        return payload.poll;
      });
    }

    function results(live) {
      var total = live.total_votes || 0;
      return '<div class="tq-poll__results"><p class="tq-poll__k">Results &middot; ' + plural(total, 'vote', 'votes') + '</p><ul>' + live.options.map(function (option) {
        var pct = total ? Math.round(option.votes / total * 100) : 0;
        return '<li' + (live.selected === option.id ? ' class="is-mine"' : '') + '><div><span>' + esc(option.label) + (live.selected === option.id ? ' <em>Your answer</em>' : '') + '</span><b class="g-nums">' + pct + '%</b></div>' +
          '<span class="tq-poll__bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></li>';
      }).join('') + '</ul></div><div class="tq-poll__reasons" data-reasons><p class="tq-poll__k">Reasons</p><p class="ta-empty">Loading reasons&hellip;</p></div>';
    }

    function reasons(poll) {
      var box = panel.querySelector('[data-reasons]');
      getJSON('/api/community/comments/' + SLUG + '-poll-' + encodeURIComponent(poll.id) + '/').then(function (payload) {
        var list = payload.comments || [];
        box.innerHTML = '<p class="tq-poll__k">Reasons</p>' + (list.length ? '<ul class="tq-reasons">' + list.slice(0, 12).map(function (c) {
          return '<li><p>' + esc(c.body) + '</p><span>' + esc(c.author || 'Member') + '</span></li>';
        }).join('') + '</ul>' : '<p class="ta-empty">No published reasons yet. A moderator reads each one before it appears.</p>');
      }).catch(function () { box.innerHTML = '<p class="tq-poll__k">Reasons</p><p class="ta-empty">Reasons could not be loaded just now.</p>'; });
    }

    function draw(index, reveal) {
      var poll = polls[index];
      var live = state[poll.id];
      if (!live) { panel.innerHTML = '<p class="ta-empty">Loading this question&hellip;</p>'; load(poll).then(function () { draw(index, reveal); }).catch(function () { panel.innerHTML = '<p class="ta-empty">This question could not be loaded just now.</p>'; }); return; }
      var open = reveal || !!live.selected;
      var scale = live.kind === 'scale';
      var options = live.options;
      var picked = live.selected || '';
      panel.innerHTML = '<p class="g-eyebrow g-eyebrow--bare">Viewpoint ' + (index + 1) + ' of ' + polls.length + ' &middot; ' + LEVEL_WORDS[scale ? 'scale' : 'choice'] + '</p>' +
        '<h3>' + esc(live.question) + '</h3>' + (live.note ? '<p class="tq-poll__note">' + esc(live.note) + '</p>' : '') +
        '<form class="tq-poll__form" data-poll-form>' +
        '<fieldset><legend><span class="tq-step">1</span>Your answer</legend>' +
        (scale
          ? '<div class="tq-scale"><span>' + esc(options[0].label) + '</span><input type="range" min="0" max="' + (options.length - 1) + '" step="1" value="' + Math.max(0, options.findIndex(function (o) { return o.id === picked; })) + '" data-scale aria-label="' + esc(live.question) + '"><span>' + esc(options[options.length - 1].label) + '</span></div><p class="tq-scale__now" data-scale-now>' + (picked ? esc(options.find(function (o) { return o.id === picked; }).label) : 'Drag to choose') + '</p>'
          : '<div class="tq-choices">' + options.map(function (option) {
            return '<label class="tq-choice"><input type="radio" name="option" value="' + esc(option.id) + '"' + (picked === option.id ? ' checked' : '') + '><span>' + esc(option.label) + '</span></label>';
          }).join('') + '</div>') +
        '</fieldset>' +
        '<fieldset><legend><span class="tq-step">2</span>Because&hellip; <span class="g-tag">Optional</span></legend>' +
        '<label class="g-visually-hidden" for="reason-' + esc(live.id) + '">Your reason, in one or two lines</label>' +
        '<textarea class="g-textarea" id="reason-' + esc(live.id) + '" name="reason" rows="2" maxlength="600" placeholder="Say why, in a line or two. Members can add a reason; a moderator reads it first."></textarea></fieldset>' +
        '<div class="tq-poll__act"><button class="g-btn g-btn--primary g-btn--sm" type="submit">' + (live.selected ? 'Change my answer' : 'Submit my answer') + '</button>' +
        (open ? '' : '<button class="g-btn g-btn--ghost g-btn--sm" type="button" data-reveal>See results without answering</button>') +
        '<span class="g-hint" data-poll-note role="status"></span></div></form>' +
        (open ? results(live) : '<div class="tq-poll__locked">' + LOCK + '<div><b>Results open after you answer</b><span>Seeing them first can change what you think. Answer, then compare.</span></div></div>');
      if (open) reasons(live);

      var form = panel.querySelector('[data-poll-form]');
      var note = panel.querySelector('[data-poll-note]');
      var slider = panel.querySelector('[data-scale]');
      if (slider) slider.addEventListener('input', function () { panel.querySelector('[data-scale-now]').textContent = options[Number(slider.value)].label; slider.dataset.moved = '1'; });
      var reveal2 = panel.querySelector('[data-reveal]');
      if (reveal2) reveal2.addEventListener('click', function () { draw(index, true); });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var choice = slider ? (slider.dataset.moved || picked ? options[Number(slider.value)].id : '') : ((form.querySelector('input[name="option"]:checked') || {}).value || '');
        if (!choice) { note.textContent = scale ? 'Move the slider to your answer first.' : 'Choose an answer first.'; return; }
        var reason = form.elements.reason.value.trim();
        note.textContent = 'Saving…';
        post('/api/content/' + SLUG + '/poll/', { poll_id: live.id, option_id: choice }).then(function (payload) {
          state[live.id] = payload.poll;
          var total = host.querySelector('[data-poll-total="' + live.id + '"]');
          if (total) total.textContent = plural(payload.poll.total_votes, 'vote', 'votes');
          if (!reason) return 'Answer saved.';
          return post('/api/community/comments/' + SLUG + '-poll-' + encodeURIComponent(live.id) + '/', { body: reason })
            .then(function () { return 'Answer saved. Your reason appears once a moderator has read it.'; })
            .catch(function (error) { return error && error.error === 'authentication_required' ? 'Answer saved. Sign in to add a reason.' : 'Answer saved. The reason could not be sent.'; });
        }).then(function (message) {
          draw(index, true);
          var fresh = panel.querySelector('[data-poll-note]');
          if (fresh) fresh.textContent = message;
        }).catch(function () { note.textContent = 'Your answer could not be saved. Try again.'; });
      });
    }

    host.addEventListener('click', function (event) {
      var pick = event.target.closest('[data-poll-pick]');
      if (!pick) return;
      host.querySelectorAll('[data-poll-pick]').forEach(function (b) { if (b === pick) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      draw(Number(pick.getAttribute('data-poll-pick')));
    });
    polls.forEach(function (poll, index) { if (index) load(poll).catch(function () {}); });
    draw(0);
    return polls.length;
  }

  /* ---- Discussion ---------------------------------------------------------
     One room per part of the Topic, each a Forum discussion linked to a
     content key (ForumDiscussion, Django admin). The record lists the rooms
     and the question each one opens with; the Forum says whether the room is
     open and how busy it is. A room the Forum does not know yet says so and
     carries no link. */
  function roomCounts(topic) {
    var bits = [plural(topic.reply_count || 0, 'reply', 'replies')];
    if (topic.like_count) bits.push(plural(topic.like_count, 'like', 'likes'));
    return '<span class="tq-room__count g-nums">' + bits.join(' &middot; ') + '</span>';
  }

  function renderRooms(data) {
    var discussion = data.discussion || {};
    var rooms = rows(discussion.rooms).filter(function (room) { return /^[a-z0-9-]{1,180}$/.test(room.key || ''); });
    var host = fill('rooms',
      '<article class="tq-room tq-room--main" data-room="' + SLUG + '"><div class="tq-room__body">' +
      '<p class="g-eyebrow g-eyebrow--bare">Main conversation</p>' +
      '<h3>' + esc(discussion.question || 'What would make you check an answer?') + '</h3>' +
      '<div class="tq-room__live" data-room-live><p class="ta-empty">Checking the Forum&hellip;</p></div></div></article>' +
      (rooms.length ? '<div class="tq-rooms">' + rooms.map(function (room) {
        return '<article class="tq-room" id="room-' + esc(room.section || room.key) + '" data-room="' + esc(room.key) + '"><div class="tq-room__top"><span class="g-tag">' + esc(room.label || room.section || 'Room') + '</span></div>' +
          '<h4>' + esc(room.question) + '</h4><div class="tq-room__live" data-room-live><p class="ta-empty">Checking the Forum&hellip;</p></div></article>';
      }).join('') + '</div>' : ''));
    host.querySelectorAll('[data-room]').forEach(function (card) {
      var key = card.getAttribute('data-room');
      var live = card.querySelector('[data-room-live]');
      var main = card.classList.contains('tq-room--main');
      getJSON('/api/forum/discussions/' + encodeURIComponent(key) + '/').then(function (payload) {
        var topic = payload.discussion || {};
        var url = safeUrl(topic.url);
        var latest = (payload.posts || []).filter(function (p) { return p.number > 1 && p.text; }).slice(-(main ? 2 : 1));
        live.innerHTML = (latest.length ? '<ul class="tq-room__posts">' + latest.map(function (p) {
          return '<li><p>' + esc(p.text.length > 220 ? p.text.slice(0, 217) + '…' : p.text) + '</p><span>' + esc(p.username === 'system' ? 'GraviQuest' : p.username) + '</span></li>';
        }).join('') + '</ul>' : '<p class="tq-room__quiet">No replies yet. The first one sets the tone.</p>') +
          '<div class="tq-room__foot">' + roomCounts(topic) +
          (url ? '<a class="g-btn ' + (main ? 'g-btn--primary' : 'g-btn--secondary') + ' g-btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener"><span>' + (main ? 'Join the discussion' : 'Join in') + '</span>' + ARROW + '</a>' : '') + '</div>';
      }).catch(function (error) {
        card.classList.add('is-closed');
        live.innerHTML = '<div class="tq-room__foot"><span class="tq-room__quiet">' +
          (error && error.status === 404 ? 'This room opens with the Forum. It is not linked yet.' : 'The Forum could not be reached just now.') + '</span>' +
          (main ? '<a class="g-btn g-btn--secondary g-btn--sm" href="/forum.html">Open the Forum</a>' : '') + '</div>';
      });
    });
    /* "Discuss the videos" and its kind point at a room by its section. */
    document.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-room-jump]');
      if (!jump) return;
      /* The section's own room when the record lists one, else the main
         conversation: the link always lands on a room. */
      var room = document.getElementById('room-' + jump.getAttribute('data-room-jump')) || host.querySelector('.tq-room--main');
      if (!room) return;
      event.preventDefault();
      if (location.hash !== '#talk') history.pushState(null, '', '#talk');
      show('talk', room);
      room.classList.add('is-flash');
      setTimeout(function () { room.classList.remove('is-flash'); }, 1600);
    });
    return 1 + rooms.length;
  }

  /* ---- Where this goes next ---------------------------------------------- */
  function renderNext(data) {
    var cards = rows(data.next).filter(function (card) { return card.title; });
    fill('next', cards.map(function (card) {
      var proposed = card.status === 'proposed';
      var url = proposed ? '' : safeUrl(card.href);
      var pic = image(card.image_url, card.image_alt || '', [640, 360]);
      return '<' + (url ? 'a href="' + esc(url) + '"' : 'div') + ' class="g-card tq-next' + (url ? ' g-card--interactive' : ' is-proposed') + '">' +
        (pic ? '<span class="tq-next__pic">' + pic + '</span>' : '') +
        '<span class="tq-next__body"><span class="g-tag">' + esc(proposed ? 'Proposed Topic' : card.kicker || 'Next') + '</span>' +
        '<strong>' + esc(card.title) + '</strong><span>' + esc(card.text) + '</span>' +
        '<span class="tq-next__go">' + (url ? 'Open' + ARROW : 'Not published yet') + '</span></span></' + (url ? 'a' : 'div') + '>';
    }).join(''));
    return cards.length;
  }

  function renderPage(item) {
    var data = item.topic_data || {};
    var list = videos(data);

    document.title = item.title + ' · GraviQuest Topic ' + (data.number || '01');
    fill('number', esc(data.number));
    fill('eyebrow', 'Topic ' + esc(data.number || '01') + ((data.tags || [])[0] ? ' &middot; ' + esc(data.tags[0]) : ''));
    fill('title', esc(item.title));
    fill('lead', esc(data.hero_lead || item.summary));
    fill('tags', (data.tags || []).map(function (tag) { return '<span class="g-tag">' + esc(tag) + '</span>'; }).join(''));
    var published = longDate(item.published_at), updated = longDate(item.updated_at);
    fill('facts', (published ? '<div><dt>Published</dt><dd>' + published + '</dd></div>' : '') +
      (updated && updated !== published ? '<div><dt>Updated</dt><dd>' + updated + '</dd></div>' : ''));
    var shareButton = shell.querySelector('[data-t1-share]');
    if (shareButton) shareButton.addEventListener('click', function () { share(shareButton, pageUrl(), item.title); });

    renderVideos(list);
    toc.counts.video = list.length;
    var castHead = shell.querySelector('[data-t1-cast-head]');
    if (castHead) castHead.hidden = !rows(data.cast).length;
    fill('cast', rows(data.cast).map(function (person) {
      return '<li>' + image(person.image_url, person.image_alt, [480, 480]) + '<div><h3>' + esc(person.name) + '</h3><p>' + esc(person.bio) + '</p></div></li>';
    }).join(''));
    fill('stills', rows(data.stills).map(function (still) {
      return '<figure>' + image(still.image_url, still.image_alt, [1280, 720]) + '<figcaption>' + esc(still.caption) + '</figcaption></figure>';
    }).join(''));
    var transcript = rows(data.transcript);
    var transcriptNode = fill('transcript', transcript.map(function (line) {
      return '<li><b>' + esc(line.speaker) + '</b><span>' + esc(line.text) + '</span></li>';
    }).join(''));
    if (transcriptNode && !transcript.length) transcriptNode.closest('details').hidden = true;
    /* The cast, stills and transcript are the first video's. With more than
       one video, the transcript says whose it is. */
    if (transcriptNode && list.length > 1 && list[0].title) {
      transcriptNode.closest('details').querySelector('summary').textContent = 'Read the transcript of ' + list[0].title;
    }

    toc.counts.timeline = renderTimeline(data);
    fill('views-intro', esc(data.viewpoints_intro));
    toc.counts.views = renderPolls(data);
    fill('corrections', esc((data.discussion || {}).corrections));
    toc.counts.talk = renderRooms(data);
    fill('sources-intro', esc(data.sources_intro));
    toc.counts.related = renderNext(data);

    shell.querySelector('[data-t1-status]').hidden = true;
    shell.querySelectorAll('[data-t1-body]').forEach(function (node) { node.hidden = false; });
    shell.removeAttribute('aria-busy');
    drawToc();
    drawPagers();
    route(false);
  }

  /* ---- The rail on the home page -----------------------------------------
     Seven panels since 2026-11-12, in the Topic page's order: Videos, Essays,
     Timeline, Viewpoints, Discussion, Sources, Related. The cast and the
     exchange left the rail; the cast stays on the Topic page. */
  function panel(name) { return rail.querySelector('[data-t1-panel="' + name + '"]'); }

  function side(node, title, say) {
    if (!node) return;
    var heading = node.querySelector('h3');
    var line = node.querySelector('.trail__say');
    if (heading && title != null) heading.textContent = title;
    if (line && say != null) line.textContent = say;
  }

  function railVideos(item, data) {
    var node = panel('video');
    var landing = data.landing || {};
    var list = videos(data);
    var first = list[0] || {};
    /* With one video the panel speaks for the Topic. With several, the panel
       is about the video chosen in its list, so it opens on the first one's
       own title and the home-page wording written for it. */
    var several = list.length > 1;
    var say = landing.video_say || first.description || '';
    side(node, several ? first.title || item.title : item.title, say);
    var chapters = node.querySelector('.trail__chap');
    chapters.innerHTML = (landing.chapters || []).map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('');
    chapters.hidden = !chapters.children.length;
    var card = node.querySelector('.trail__video');
    card.insertAdjacentHTML('afterbegin', poster(first));
    if (safeUrl(first.poster_url)) card.classList.add('has-thumb');
    card.setAttribute('aria-label', (first.title || item.title) + ': chapters and full transcript on the Topic page');
    var tag = node.querySelector('[data-set-meta]');
    tag.innerHTML = (landing.video_runtime ? '<span class="g-nums">' + esc(landing.video_runtime) + '</span> &middot; ' : '') + esc(landing.video_status);
    if (!several) return;
    var set = document.createElement('ol');
    set.className = 'trail__set';
    set.setAttribute('aria-label', 'Videos in this Topic');
    list.forEach(function (video, index) {
      var row = document.createElement('li');
      var link = document.createElement('a');
      link.href = PAGE + '#video-' + (index + 1);
      /* The first row restores exactly what the panel opened with. A video
         without a runtime or a public source says "Soon", which is true. */
      link.dataset.title = video.title || item.title;
      link.dataset.say = index ? video.description || '' : say;
      link.dataset.meta = index ? (video.duration ? video.duration + ' · ' : '') + (video.source_type === 'youtube' ? 'On YouTube' : 'Soon') : tag.textContent;
      link.dataset.poster = safeUrl(video.poster_url);
      link.dataset.chapters = JSON.stringify(index ? video.chapters || [] : landing.chapters || []);
      if (!index) link.setAttribute('aria-current', 'true');
      link.innerHTML = '<span class="trail__set-n">' + pad2(index + 1) + '</span><span class="trail__set-t">' + esc(video.title) + '</span>';
      row.append(link);
      set.append(row);
    });
    node.querySelector('.trail__side').append(set);
    node.setAttribute('data-rail-set', '');
  }

  var LEVELS = [
    ['start', 'Start here', 'No background needed'],
    ['further', 'Go further', 'Some method expected'],
    ['primary', 'Primary', 'The papers themselves']
  ];

  function renderRail(item) {
    var data = item.topic_data || {};
    var landing = data.landing || {};
    var views = rows((data.viewpoints || {}).items).slice(0, 2);

    railVideos(item, data);

    var intro = panel('essays').querySelector('[data-topic-essay-intro]');
    intro.dataset.topicEssayIntro = landing.essays_intro || '';
    intro.textContent = landing.essays_intro || '';

    side(panel('timeline'), landing.timeline_title, landing.timeline_say);
    panel('timeline').querySelector('.trail__time').innerHTML = rows(data.timeline).map(function (row) {
      return '<li' + (row.key ? ' class="is-key"' : '') + '><time>' + esc(row.date) + '</time><span>' + esc(row.short || row.title) + '</span></li>';
    }).join('');

    side(panel('views'), landing.viewpoints_title, landing.viewpoints_say);
    panel('views').querySelector('.trail__views').innerHTML = views.map(function (view) {
      return '<div class="trail__view"><p class="trail__view-k">' + esc(view.label) + '</p><p>' + esc(view.short || view.text) + '</p>' + (view.cite ? '<cite>' + esc(view.cite) + '</cite>' : '') + '</div>';
    }).join('');

    side(panel('talk'), landing.discussion_title, landing.discussion_say);
    panel('talk').querySelector('.trail__q p').textContent = (data.discussion || {}).question || '';

    side(panel('sources'), landing.sources_title, landing.sources_say);
    var sources = rows(data.sources);
    panel('sources').querySelector('.trail__stairs').innerHTML = LEVELS.map(function (level) {
      var names = sources.filter(function (row) { return (row.level || 'start') === level[0]; }).slice(0, 2).map(function (row) {
        return '<li>' + esc(row.short || row.label) + '</li>';
      }).join('');
      return '<li><p class="trail__lvl"><b>' + level[1] + '</b><span>' + level[2] + '</span></p><ul>' + names + '</ul></li>';
    }).join('');

    var next = rows(data.next).filter(function (card) { return card.title; });
    side(panel('related'), landing.related_title || 'Where this goes next', landing.related_say || '');
    panel('related').querySelector('.trail__next').innerHTML = next.map(function (card) {
      var url = card.status === 'proposed' ? '' : safeUrl(card.href);
      return '<li>' + (url ? '<a href="' + esc(url) + '">' : '<span>') + '<small>' + esc(card.status === 'proposed' ? 'Proposed Topic' : card.kicker) + '</small><b>' + esc(card.title) + '</b>' + (url ? '</a>' : '</span>') + '</li>';
    }).join('');

    window.dispatchEvent(new Event('resize'));
  }

  /* ---- Reading it ------------------------------------------------------- */
  function failed() {
    var host = shell || rail;
    if (!host) return;
    host.querySelectorAll('[data-t1-hide-on-failure]').forEach(function (node) { node.hidden = true; });
    var status = host.querySelector('[data-t1-status]');
    status.hidden = false;
    status.replaceChildren('This Topic could not be loaded just now. ');
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'g-btn g-btn--ghost g-btn--sm';
    retry.textContent = 'Try again';
    retry.addEventListener('click', function () { location.reload(); });
    status.append(retry);
    if (shell) shell.removeAttribute('aria-busy');
  }

  window.GQTopic01 = !shell && !rail ? Promise.resolve(null) :
    fetch('/api/content/' + SLUG + '/', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('topic_unavailable');
        return response.json();
      })
      .then(function (payload) {
        if (shell) renderPage(payload.item);
        if (rail) renderRail(payload.item);
        return payload.item;
      })
      .catch(function (error) {
        if (window.console) console.error(error);
        failed();
        return null;
      });
})();
