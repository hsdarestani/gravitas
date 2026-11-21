/* =========================================================================
   TOPIC · ANNOTATIONS AND THE SELECTION BAR
   What a reader can do with the words of an essay: select a passage and
   ask Pulsar about it or annotate it, comment on a section from its
   heading, and read what other readers marked, in the text and in a panel
   beside it. window.GQAnnotations.

   From the design review of 2026-11-19 (tests/topic.html). The review kept
   its annotations in the browser and drew invented ones; here an
   annotation is a comment on the essay's own key
   (`<slug>-essay-<n>-annotations`) whose anchor says what it is about:

     { kind: 'passage', level, quote, prefix, suffix }
     { kind: 'heading', heading }

   WHY A QUOTE AND NOT AN OFFSET. The essays are republished from reviewed
   Markdown, at three reading levels, and an offset into one rendering means
   nothing in the next. A quote with a few words either side survives a
   republish that does not touch it, and it finds the same sentence at
   another level where that level says the same thing. Where it does not,
   the annotation is not drawn and not counted at that level, which is what
   the review asked for: a note shows where its words are.

   The text is searched with its whitespace collapsed, because the rendered
   HTML breaks lines where the Markdown did and a reader's selection does
   not. Each collapsed character remembers the text node and offset it came
   from, so a match is wrapped exactly, across inline markup (an <abbr>, a
   citation) and across nodes.

   Marks and section buttons show while the panel is open, the way the
   review drew them: an essay is for reading, and someone who wants the
   notes asks for them with one button that carries their count.
   ========================================================================= */
(function () {
  'use strict';

  var T = function () { return window.GQTalk; };
  var esc = function (v) { return T().esc(v); };
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var SKIP = '.tq-refs, .tq-hc, button, .ta-essay-figure meter, script, style';

  var ICON = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5l1-4L16 5l3 3L8.5 18.5z"/><path d="M14 7l3 3"/></svg>',
    talk: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3.2v-3.2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>',
    read: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h9a4 4 0 0 1 4 4v11H9a4 4 0 0 1-4-4z"/><path d="M9 9h5M9 12.5h5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  /* ---- Text index ---------------------------------------------------------- */
  function textNodes(root) {
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        return parent && !parent.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var node;
    while ((node = walker.nextNode())) out.push(node);
    return out;
  }

  /* The article's text with every run of whitespace as one space, and for
     each character the node and offset it stands for. */
  function index(root) {
    var flat = '', map = [], lastSpace = true;
    textNodes(root).forEach(function (node) {
      var value = node.nodeValue;
      for (var i = 0; i < value.length; i++) {
        var ch = value.charAt(i);
        if (/\s/.test(ch)) {
          if (lastSpace) continue;
          flat += ' '; map.push([node, i]); lastSpace = true;
        } else {
          flat += ch; map.push([node, i]); lastSpace = false;
        }
      }
    });
    return { flat: flat, map: map };
  }

  var squash = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };

  /* Where a quote is, preferring the occurrence whose neighbours match. */
  function locate(idx, anchor) {
    var quote = squash(anchor.quote);
    if (quote.length < 2) return -1;
    var best = -1, bestScore = -1, from = 0, at;
    var prefix = squash(anchor.prefix), suffix = squash(anchor.suffix);
    while ((at = idx.flat.indexOf(quote, from)) >= 0) {
      var score = 0;
      if (prefix && idx.flat.slice(Math.max(0, at - prefix.length - 1), at).trim().endsWith(prefix)) score += 2;
      if (suffix && idx.flat.slice(at + quote.length, at + quote.length + suffix.length + 1).trim().startsWith(suffix)) score += 2;
      if (score > bestScore) { best = at; bestScore = score; }
      if (score >= 4) break;
      from = at + 1;
    }
    return best;
  }

  /* Wraps flat[start, end) in marks, one per text node it crosses. */
  function wrap(idx, start, end, id, cls) {
    var pieces = [];
    for (var i = start; i < end; i++) {
      var hit = idx.map[i];
      var last = pieces[pieces.length - 1];
      if (last && last.node === hit[0]) last.end = hit[1] + 1;
      else pieces.push({ node: hit[0], start: hit[1], end: hit[1] + 1 });
    }
    var first = null;
    /* Back to front, so splitting a node does not move the pieces before it. */
    for (var p = pieces.length - 1; p >= 0; p--) {
      var piece = pieces[p];
      if (!piece.node.parentNode) continue;
      var range = document.createRange();
      range.setStart(piece.node, piece.start);
      range.setEnd(piece.node, Math.min(piece.end, piece.node.nodeValue.length));
      var mark = document.createElement('mark');
      mark.className = 'tq-an' + (cls ? ' ' + cls : '');
      mark.dataset.an = id;
      try { range.surroundContents(mark); first = mark; } catch (err) { /* a piece across an element boundary is skipped */ }
    }
    if (first) {
      first.tabIndex = 0;
      first.setAttribute('role', 'button');
      first.setAttribute('aria-label', 'Annotated passage. Open the note.');
    }
    return first;
  }

  function unwrap(root) {
    root.querySelectorAll('mark.tq-an').forEach(function (mark) {
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    });
    root.querySelectorAll('.tq-hc').forEach(function (node) { node.remove(); });
  }

  function headings(article) {
    return Array.prototype.slice.call(article.querySelectorAll('h4')).filter(function (h) { return !h.closest('.tq-refs, .ta-essay-box, .ta-essay-figure'); });
  }
  function headingText(h) {
    var copy = h.cloneNode(true);
    copy.querySelectorAll('.tq-hc').forEach(function (b) { b.remove(); });
    return squash(copy.textContent);
  }

  /* ---- The selection bar ----------------------------------------------------
     One small bar over a selection, for every essay on the page: Ask Pulsar
     anywhere in the essay, Annotate where the text is the reader's (In
     depth), Copy everywhere. It settles once the selection does: on release,
     on a keyboard selection, and on the handles a phone draws, which send no
     mouseup. On a touch screen it sits under the selection, because the
     system's own menu takes the space above. */
  var bar = null, barState = null, pressing = false, settle = 0;
  var scopes = [];   // { root, title, annotate: fn(selectionInfo) | null }

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'tq-selbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Selected text');
    bar.hidden = true;
    document.body.append(bar);
    bar.addEventListener('pointerdown', function (event) { event.preventDefault(); });
    bar.addEventListener('click', function (event) {
      var button = event.target.closest('[data-sel]');
      if (!button || !barState) return;
      var what = button.getAttribute('data-sel');
      var info = barState;
      hideBar();
      if (what === 'ask') {
        var term = !/\s/.test(info.text) && info.text.length <= 40;
        if (window.GravitasChat) window.GravitasChat.ask(term
          ? 'In the GraviQuest essay "' + info.scope.title() + '", what does "' + info.text + '" mean here?'
          : 'In the GraviQuest essay "' + info.scope.title() + '", explain this passage: "' + info.text + '"');
        window.getSelection().removeAllRanges();
      } else if (what === 'annotate' && info.scope.annotate) {
        info.scope.annotate(info);
      } else if (what === 'copy') {
        var done = function () { T().toast('Copied the passage.'); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(info.text).then(done, function () {});
      }
    });
    return bar;
  }

  function hideBar() { if (bar) bar.hidden = true; barState = null; }

  function scopeOf(node) {
    for (var i = 0; i < scopes.length; i++) if (scopes[i].root.isConnected && scopes[i].root.contains(node)) return scopes[i];
    return null;
  }

  function placeBar() {
    var selection = window.getSelection();
    var text = selection && !selection.isCollapsed ? squash(selection.toString()) : '';
    if (!text || text.length > 600 || !selection.rangeCount) { hideBar(); return; }
    var scope = scopeOf(selection.anchorNode);
    if (!scope || scope !== scopeOf(selection.focusNode)) { hideBar(); return; }
    if (selection.anchorNode.parentElement && selection.anchorNode.parentElement.closest('button, input, textarea, select, form, .tk')) { hideBar(); return; }
    var range = selection.getRangeAt(0);
    var box = range.getBoundingClientRect();
    if (!box.width && !box.height) { hideBar(); return; }
    var canAnnotate = !!(scope.annotate && scope.article && scope.article() && scope.article().contains(range.commonAncestorContainer));
    var pulsar = window.GravitasChat;
    ensureBar();
    bar.innerHTML =
      (pulsar ? '<button type="button" data-sel="ask">' + (window.GravitasIcons ? window.GravitasIcons.icon('pulsar', 'tq-selbar__mark') : '') + '<span>Ask Pulsar</span></button>' : '') +
      (canAnnotate ? '<button type="button" data-sel="annotate">' + ICON.pen + '<span>Annotate</span></button>' : '') +
      '<button type="button" data-sel="copy" aria-label="Copy the passage">' + ICON.copy + '</button>';
    barState = { text: text, range: range.cloneRange(), scope: scope };
    var wasHidden = bar.hidden;
    bar.hidden = false;
    var header = (document.querySelector('.g-header') || {}).getBoundingClientRect ? document.querySelector('.g-header').getBoundingClientRect().bottom : 0;
    var under = matchMedia('(pointer: coarse)').matches || box.top - bar.offsetHeight - 12 < header;
    bar.style.left = (Math.max(12, Math.min(window.innerWidth - bar.offsetWidth - 12, box.left + box.width / 2 - bar.offsetWidth / 2)) + window.scrollX) + 'px';
    bar.style.top = ((under ? box.bottom + 12 : box.top - bar.offsetHeight - 12) + window.scrollY) + 'px';
    bar.style.transformOrigin = under ? '50% 0' : '50% 100%';
    if (wasHidden) { bar.classList.remove('is-in'); void bar.offsetWidth; bar.classList.add('is-in'); }
  }

  document.addEventListener('pointerdown', function (event) { if (!bar || !bar.contains(event.target)) pressing = true; });
  document.addEventListener('pointerup', function () { pressing = false; setTimeout(placeBar, 0); });
  document.addEventListener('pointercancel', function () { pressing = false; });
  document.addEventListener('keyup', function (event) { if (event.shiftKey || event.key.indexOf('Arrow') === 0) placeBar(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') hideBar(); });
  document.addEventListener('selectionchange', function () {
    clearTimeout(settle);
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) { hideBar(); return; }
    if (!pressing) settle = setTimeout(placeBar, 180);
  });
  window.addEventListener('resize', hideBar);
  document.addEventListener('gq:topic-section', hideBar);

  function registerScope(scope) {
    scopes = scopes.filter(function (s) { return s.root.isConnected && s.root !== scope.root; });
    scopes.push(scope);
  }

  /* ---- An essay's annotations ---------------------------------------------- */
  var KINDS = [['all', 'All'], ['passage', 'Passages'], ['heading', 'Sections']];
  var WHEN = [['all', 'Any date'], ['week', 'Past 7 days'], ['month', 'Past 30 days'], ['older', 'Older']];
  var SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['liked', 'Most liked'], ['replies', 'Most replies']];

  /* opts: { slug, essay (n), title, level, levelLabel, article, panel,
     wholeKey, onCount(n), onOpen(open), open } */
  function attach(opts) {
    var key = opts.slug + '-essay-' + opts.essay + '-annotations';
    var article = opts.article;
    var panel = opts.panel;
    var state = { open: !!opts.open, kind: 'all', when: 'all', sort: 'new', who: 'all', query: '', filters: false, found: {}, heads: {}, pending: null, rows: [] };
    var talk = null;

    function draw() {
      unwrap(article);
      state.found = {}; state.heads = {};
      var roots = state.rows.filter(function (c) { return !c.parent_id; });
      var idx = index(article);
      var hs = headings(article);
      var names = hs.map(headingText);
      roots.forEach(function (c) {
        var a = c.anchor || {};
        if (a.kind === 'heading') {
          var at = names.indexOf(squash(a.heading));
          if (at >= 0) { state.found[c.id] = true; state.heads[at] = (state.heads[at] || 0) + 1; }
          return;
        }
        if (a.kind !== 'passage') return;
        var pos = locate(idx, a);
        if (pos < 0) return;
        state.found[c.id] = true;
        /* Shown only while the panel is open. With it closed the passage is
           still wrapped, but quietly (no colour, not clickable), so the margin
           can say where the notes are. The index has to be rebuilt after each
           wrap because a wrap splits text nodes. */
        var first = wrap(idx, pos, pos + squash(a.quote).length, c.id, (c.mine ? 'is-mine' : '') + (c.status === 'pending' ? ' is-pending' : '') + (state.open ? '' : ' is-quiet'));
        if (first && !state.open) { first.removeAttribute('tabindex'); first.removeAttribute('role'); first.removeAttribute('aria-label'); }
        idx = index(article);
      });
      if (state.open) {
        hs.forEach(function (h, i) {
          var n = state.heads[i] || 0;
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'tq-hc' + (n ? ' has' : '');
          button.dataset.hc = String(i);
          button.setAttribute('aria-label', n ? n + (n === 1 ? ' comment' : ' comments') + ' on this section. Add yours.' : 'Comment on this section');
          button.innerHTML = ICON.talk + '<span>' + (n || 'Comment') + '</span>';
          h.append(button);
        });
      }
      drawMargin();
      var count = roots.filter(function (c) { return state.found[c.id]; }).length;
      if (opts.onCount) opts.onCount(count);
      if (talk) talk.redraw();
      paintStatus();
    }

    /* The margin, from the review of 2026-11-21: opening the panel used to
       take its width out of the text, which narrowed to half and lost the
       reader's line. On a wide screen the text now keeps one width and one
       place, with a column beside it held for annotations either way: the
       panel when it is open, and when it is closed a small count beside each
       paragraph or heading that has notes. A count opens the panel on its
       first note; hovering it tints the passages it counts. On a narrower
       screen the column does not exist (CSS hides the layer) and the panel
       is a sheet over the page, so the text does not move there either. */
    var margin = null;
    function drawMargin() {
      var host = article.parentNode;
      if (!margin) {
        margin = document.createElement('div');
        margin.className = 'tq-amargin';
        host.append(margin);
        margin.addEventListener('click', function (event) {
          var b = event.target.closest('[data-am]');
          if (!b) return;
          if (b.dataset.am) activate(Number(b.dataset.am), false);
          else setOpen(true);
        });
        margin.addEventListener('mouseover', function (event) { hint(event.target.closest('[data-am-ids]')); });
        margin.addEventListener('mouseout', function () { hint(null); });
        if (window.ResizeObserver) new ResizeObserver(function () { if (!state.open) place(); }).observe(article);
      }
      margin.replaceChildren();
      margin.hidden = state.open;
      if (state.open) return;
      var groups = [];
      var seen = new Map();
      article.querySelectorAll('mark.tq-an').forEach(function (m) {
        var block = m.closest('p, li, blockquote, figure, td, h4') || m.parentNode;
        var g = seen.get(block);
        if (!g) { g = { block: block, ids: [] }; seen.set(block, g); groups.push(g); }
        var id = Number(m.dataset.an);
        if (g.ids.indexOf(id) < 0) g.ids.push(id);
      });
      headings(article).forEach(function (h, i) {
        if (state.heads[i]) groups.push({ block: h, ids: [], n: state.heads[i] });
      });
      groups.forEach(function (g) {
        var n = g.n || g.ids.length;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tq-amark';
        b.dataset.am = g.ids.length ? String(g.ids[0]) : '';
        b.dataset.amIds = g.ids.join(' ');
        b.setAttribute('aria-label', n + (n === 1 ? ' note' : ' notes') + (g.ids.length ? ' on this passage' : ' on this section') + '. Open annotations.');
        b.innerHTML = ICON.talk + '<span class="g-nums">' + n + '</span>';
        b._block = g.block;
        margin.append(b);
      });
      place();
    }
    /* Each count sits level with its paragraph, and below the one above it
       when two paragraphs are too close for both. */
    function place() {
      if (!margin || margin.hidden) return;
      var top = margin.getBoundingClientRect().top;
      var items = Array.prototype.slice.call(margin.children).map(function (b) {
        return { b: b, y: b._block.getBoundingClientRect().top - top };
      }).sort(function (x, y) { return x.y - y.y; });
      var floor = -Infinity;
      items.forEach(function (it) {
        var y = Math.max(it.y, floor);
        it.b.style.top = y + 'px';
        floor = y + 34;
      });
    }
    function hint(button) {
      var ids = button ? button.dataset.amIds.split(' ') : [];
      article.querySelectorAll('mark.tq-an.is-quiet').forEach(function (m) { m.classList.toggle('is-hint', ids.indexOf(m.dataset.an) >= 0); });
    }

    function matches(c) {
      if (!state.found[c.id]) return false;
      var a = c.anchor || {};
      if (state.kind !== 'all' && a.kind !== state.kind) return false;
      var age = (Date.now() - new Date(c.created_at).getTime()) / 864e5;
      if (state.when === 'week' && age > 7) return false;
      if (state.when === 'month' && age > 30) return false;
      if (state.when === 'older' && age <= 30) return false;
      return true;
    }

    function activeFilters() { return (state.kind !== 'all') + (state.when !== 'all') + (state.who !== 'all') + (state.sort !== 'new'); }

    function paintStatus() {
      if (!panel.isConnected) return;
      var status = panel.querySelector('[data-an-status]');
      if (!status) return;
      var all = state.rows.filter(function (c) { return !c.parent_id && state.found[c.id]; });
      var shown = all.filter(matches).filter(function (c) {
        if (state.who !== 'all' && c.author !== state.who) return false;
        if (!state.query) return true;
        return (c.body + ' ' + c.author + ' ' + ((c.anchor || {}).quote || '')).toLowerCase().indexOf(state.query) >= 0;
      });
      status.querySelector('[data-an-n]').textContent = shown.length === all.length ? T().plural(all.length, 'annotation', 'annotations') : shown.length + ' of ' + all.length + ' annotations';
      status.querySelector('[data-an-clear]').hidden = !(activeFilters() || state.query);
      var tog = panel.querySelector('[data-an-filters]');
      /* Icon only (review of 2026-11-22): in a 296px panel the word "Filters"
         squeezed the search box; the count of active filters rides on the icon. */
      if (tog) tog.innerHTML = ICON.filter + '<span class="g-visually-hidden">Filters</span>' + (activeFilters() ? '<b class="tq-apanel__badge g-nums">' + activeFilters() + '</b>' : '');
      var who = panel.querySelector('[data-an-who]');
      if (who) {
        var names = Array.from(new Set(all.map(function (c) { return c.author; }))).sort();
        who.innerHTML = '<option value="all">All authors</option>' + names.map(function (n) { return '<option' + (state.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
      }
    }

    function renderAnchor(c) {
      var a = c.anchor || {};
      if (a.kind === 'heading') return '<button class="tq-an-ref is-section" type="button" data-an-jump="' + c.id + '">' + ICON.read + '<span>Section · ' + esc(a.heading) + '</span></button>';
      if (a.kind === 'passage') return '<button class="tq-an-ref" type="button" data-an-jump="' + c.id + '"><q>' + esc(a.quote) + '</q></button>';
      return '';
    }

    function compose() {
      var box = panel.querySelector('[data-an-compose]');
      if (!box) return;
      var p = state.pending;
      if (!p) { box.innerHTML = ''; return; }
      var draft = T().readDraft(key, 'new');
      box.innerHTML = '<form class="tq-an-new" data-an-form><p class="tq-an-new__k">' + (p.kind === 'heading' ? 'New comment on a section' : 'New annotation') + '</p>' +
        (p.kind === 'heading' ? '<p class="tq-an-ref is-section is-static">' + ICON.read + '<span>' + esc(p.heading) + '</span></p>' : '<p class="tq-an-ref is-static"><q>' + esc(p.quote) + '</q></p>') +
        '<label class="g-visually-hidden" for="an-new-' + opts.essay + '">Your note</label>' +
        '<textarea class="g-textarea" id="an-new-' + opts.essay + '" rows="3" maxlength="5000" placeholder="What does this passage make you think, or doubt?" required>' + esc(draft) + '</textarea>' +
        '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Save note</button><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-an-cancel>Cancel</button></div>' +
        '<p class="g-hint">Members can annotate. A moderator reads every note before others see it.</p><div data-an-signin></div></form>';
      var field = box.querySelector('textarea');
      field.focus();
      field.addEventListener('input', function () { T().writeDraft(key, 'new', field.value.trim()); });
    }

    function drawPanel() {
      panel.innerHTML =
        '<div class="tq-apanel__head"><p class="tq-apanel__title">' + ICON.pen + '<b>Annotations</b><span>' + esc(opts.levelLabel || '') + '</span></p>' +
        '<button class="tq-icon-btn tq-icon-btn--sm" type="button" data-an-close aria-label="Close annotations">' + T().icon.close + '</button></div>' +
        '<div class="tq-apanel__tools"><label class="tk-search">' + T().icon.search + '<span class="g-visually-hidden">Search annotations</span><input type="search" placeholder="Search annotations" autocomplete="off" data-an-q value="' + esc(state.query) + '"></label>' +
        '<button class="tq-icon-btn tq-apanel__ftog" type="button" aria-expanded="' + state.filters + '" title="Filters" data-an-filters></button></div>' +
        '<div class="tq-apanel__filters" ' + (state.filters ? '' : 'hidden') + ' data-an-fbox>' +
          '<div class="tq-seg" role="group" aria-label="Type of annotation">' + KINDS.map(function (k) { return '<button type="button" data-an-kind="' + k[0] + '" aria-pressed="' + (state.kind === k[0]) + '">' + k[1] + '</button>'; }).join('') + '</div>' +
          '<div class="tq-apanel__row"><label><span>Author</span><select class="g-select" data-an-who></select></label>' +
          '<label><span>Date</span><select class="g-select" data-an-when>' + WHEN.map(function (w) { return '<option value="' + w[0] + '"' + (state.when === w[0] ? ' selected' : '') + '>' + w[1] + '</option>'; }).join('') + '</select></label>' +
          '<label><span>Sort</span><select class="g-select" data-an-sort>' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (state.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label></div></div>' +
        '<p class="tq-apanel__status" data-an-status role="status"><span data-an-n></span><button class="tk-link" type="button" data-an-clear hidden>Clear filters</button></p>' +
        '<div data-an-compose></div>' +
        '<button class="tq-apanel__whole" type="button" data-an-whole hidden>' + ICON.read + '<span><b data-an-whole-n></b><small>Read them at the end of the essay</small></span>' + ICON.arrow + '</button>' +
        '<div class="tq-apanel__list" data-an-list></div>' +
        '<p class="tq-apanel__help">Select any passage to annotate it, or use the button beside a section heading.</p>';
      talk = T().mount(panel.querySelector('[data-an-list]'), {
        key: key, compose: false, tools: false, pageSize: 12,
        empty: 'No annotations at this level yet. Select a passage and choose Annotate.',
        filter: matches, renderAnchor: renderAnchor,
        onDraw: function (rows) { state.rows = rows; },
        onCount: function () {}
      });
      talk.set({ sort: state.sort, who: state.who, query: state.query });
      compose();
      paintStatus();
      wholeCount();
    }

    function wholeCount() {
      if (!opts.wholeKey) return;
      T().list(opts.wholeKey).then(function (rows) {
        var n = rows.filter(function (c) { return !c.parent_id; }).length;
        var button = panel.querySelector('[data-an-whole]');
        if (!button) return;
        button.hidden = !n;
        button.querySelector('[data-an-whole-n]').textContent = n + (n === 1 ? ' note' : ' notes') + ' on the whole essay';
      }).catch(function () {});
    }

    function setOpen(open) {
      state.open = open;
      panel.hidden = !open;
      if (open && !panel.firstChild) drawPanel();
      if (opts.onOpen) opts.onOpen(open);
      draw();
    }

    function load(force) {
      return T().list(key, force).then(function (rows) { state.rows = rows; draw(); }).catch(function () { if (opts.onCount) opts.onCount(0); });
    }

    function activate(id, fromMark) {
      if (!state.open) setOpen(true);
      article.querySelectorAll('mark.tq-an').forEach(function (m) { m.classList.toggle('is-on', Number(m.dataset.an) === id); });
      if (talk) talk.setActive(id);
      if (!fromMark) {
        var c = state.rows.filter(function (r) { return r.id === id; })[0];
        var target = article.querySelector('mark.tq-an[data-an="' + id + '"]');
        if (!target && c && c.anchor && c.anchor.kind === 'heading') {
          var at = headings(article).map(headingText).indexOf(squash(c.anchor.heading));
          target = headings(article)[at];
        }
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' });
          target.classList.remove('is-flash'); void target.offsetWidth; target.classList.add('is-flash');
        }
      }
    }

    /* A passage from the selection bar: its quote, and the words either
       side so the same words elsewhere in the essay are not confused with it. */
    function annotate(info) {
      var idx = index(article);
      var probe = document.createRange();
      probe.setStart(article, 0);
      probe.setEnd(info.range.startContainer, info.range.startOffset);
      var before = squash(probe.toString());
      var quote = info.text;
      var at = idx.flat.indexOf(quote, Math.max(0, before.length - 2));
      if (at < 0) at = idx.flat.indexOf(quote);
      state.pending = {
        kind: 'passage', quote: quote, level: opts.level,
        prefix: at > 0 ? idx.flat.slice(Math.max(0, at - 32), at) : '',
        suffix: at >= 0 ? idx.flat.slice(at + quote.length, at + quote.length + 32) : ''
      };
      window.getSelection().removeAllRanges();
      if (!state.open) setOpen(true);
      compose();
    }

    panel.addEventListener('click', function (event) {
      var t = event.target;
      if (t.closest('[data-an-close]')) { setOpen(false); var tog = document.querySelector('[data-an-toggle]'); if (tog) tog.focus({ preventScroll: true }); return; }
      if (t.closest('[data-an-filters]')) {
        state.filters = !state.filters;
        panel.querySelector('[data-an-fbox]').hidden = !state.filters;
        t.closest('[data-an-filters]').setAttribute('aria-expanded', String(state.filters));
        return;
      }
      var kind = t.closest('[data-an-kind]');
      if (kind) {
        state.kind = kind.getAttribute('data-an-kind');
        panel.querySelectorAll('[data-an-kind]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === kind)); });
        talk.redraw(); paintStatus(); return;
      }
      if (t.closest('[data-an-clear]')) {
        state.kind = 'all'; state.when = 'all'; state.sort = 'new'; state.who = 'all'; state.query = '';
        drawPanel(); return;
      }
      if (t.closest('[data-an-cancel]')) { state.pending = null; T().writeDraft(key, 'new', ''); compose(); return; }
      var jump = t.closest('[data-an-jump]');
      if (jump) { activate(Number(jump.getAttribute('data-an-jump')), false); return; }
      if (t.closest('[data-an-whole]')) {
        var notes = document.querySelector('[data-whole-notes]');
        if (notes) notes.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' });
      }
    });
    panel.addEventListener('input', function (event) {
      if (event.target.matches('[data-an-q]')) { state.query = event.target.value.trim().toLowerCase(); talk.set({ query: state.query }); paintStatus(); }
    });
    panel.addEventListener('change', function (event) {
      var t = event.target;
      if (t.matches('[data-an-who]')) { state.who = t.value; talk.set({ who: state.who }); }
      if (t.matches('[data-an-when]')) { state.when = t.value; talk.redraw(); }
      if (t.matches('[data-an-sort]')) { state.sort = t.value; talk.set({ sort: state.sort }); }
      paintStatus();
    });
    panel.addEventListener('submit', function (event) {
      if (!event.target.matches('[data-an-form]')) return;
      event.preventDefault();
      var form = event.target;
      var field = form.querySelector('textarea');
      var text = field.value.trim();
      if (!text || !state.pending) return;
      var p = state.pending;
      var anchor = p.kind === 'heading' ? { kind: 'heading', heading: p.heading } : { kind: 'passage', level: p.level, quote: p.quote, prefix: p.prefix, suffix: p.suffix };
      T().me().then(function (who) {
        if (!who.authenticated) { form.querySelector('[data-an-signin]').innerHTML = T().signInPrompt('annotate'); return null; }
        return T().post(key, text, { anchor: anchor }).then(function (comment) {
          state.pending = null;
          T().writeDraft(key, 'new', '');
          compose();
          T().toast('Note saved. You can see it now; others will once a moderator has read it.');
          return load(true).then(function () { if (talk) return talk.refresh(); }).then(function () { activate(comment.id, true); });
        });
      }).catch(function (error) { T().toast(T().failure(error, 'save the note')); });
    });

    /* Marks and section buttons live in the article. */
    function onArticle(event) {
      var mark = event.target.closest('mark.tq-an');
      if (mark && (event.type === 'click' || event.key === 'Enter' || event.key === ' ')) {
        if (event.type === 'keydown') event.preventDefault();
        activate(Number(mark.dataset.an), true);
        return;
      }
      var hc = event.target.closest('.tq-hc');
      if (hc && event.type === 'click') {
        var h = hc.closest('h4');
        state.pending = { kind: 'heading', heading: headingText(h) };
        if (!state.open) setOpen(true);
        compose();
      }
    }
    article.addEventListener('click', onArticle);
    article.addEventListener('keydown', onArticle);

    registerScope({ root: opts.scopeRoot || article, article: function () { return article; }, title: function () { return opts.title; }, annotate: annotate });

    T().on(key, function () { load(false); });
    T().on(opts.wholeKey || '-', wholeCount);
    panel.hidden = !state.open;
    if (state.open) drawPanel();
    load(false);

    return {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      toggle: function () { setOpen(!state.open); return state.open; },
      isOpen: function () { return state.open; },
      annotate: annotate
    };
  }

  /* A scope with no annotations (Overview): the bar offers Ask Pulsar and Copy. */
  function askOnly(root, title) {
    registerScope({ root: root, article: function () { return null; }, title: function () { return title; }, annotate: null });
  }

  window.GQAnnotations = { attach: attach, askOnly: askOnly, hideBar: hideBar };
})();
