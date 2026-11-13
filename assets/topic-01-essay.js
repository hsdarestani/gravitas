/* =========================================================================
   TOPIC 01 · THE ESSAYS AND THE SOURCES
   The homepage rail and the Topic page read the same published route.

   Since 2026-11-12 each essay reads at three levels, Curious, Undergrad and
   Researcher, and each level is its own reviewed Markdown file, published
   from the research project through the same explicit workflow (see
   backend/core/topic_essay_sources.py). The route returns one entry per slot,
   each saying which essay and which level it is. A level that has not been
   published is not offered: the switch shows the levels that exist, and with
   only one it shows none.

   Overview is not a fourth text. It is drawn from the essay itself: the
   opening of its plainest published level, and its own "If you only
   remember" and "What you can do" boxes. If those boxes are renamed in the
   source, Overview shows the opening alone rather than inventing points.

   The reader adds four things the design review asked for, none of which
   holds data of its own:
   - a citation opens its reference beside the text instead of jumping away;
   - "Show in Sources" jumps to the bibliography and leaves a way back;
   - selected text can be handed to Pulsar as a question;
   - the end of an essay asks whether it was useful (its own route, real
     counts) and takes a note on the whole essay (the moderated comments).

   The bibliography is one list: the record's three reading levels and every
   reference the published essays cite, which used to be listed twice.
   ========================================================================= */
(function () {
  'use strict';
  const API = '/api/topics/answer-that-looked-right/essays/';
  const SLUG = 'answer-that-looked-right';
  const TOPIC_PAGE = 'topic-answer-that-looked-right.html';
  const LEVELS = [
    ['curious', 'Curious', 'Plain language, the main idea'],
    ['undergrad', 'Undergrad', 'The full line of reasoning'],
    ['researcher', 'Researcher', 'Full detail, methods and extras'],
  ];
  const SOURCE_LEVELS = [['start', 'Start here'], ['further', 'Go further'], ['primary', 'Primary']];
  const STORE = 'gq:topic01:reading';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const host = document.querySelector('[data-essays]');
  const sourcesHost = document.querySelector('[data-sources]');
  const excerpt = document.querySelector('[data-topic-essay-excerpt]');

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const pad2 = n => String(n).padStart(2, '0');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const ICON = {
    arrow: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    back: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    ext: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    copy: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5v9h-3v-9zM7.5 10.5l3.6-6.3a1.6 1.6 0 0 1 3 .9l-.6 4h5a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.6H7.5"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 13.5v-9h-3v9zM7.5 13.5l3.6 6.3a1.6 1.6 0 0 0 3-.9l-.6-4h5a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.6H7.5"/></svg>',
    close: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>',
    share: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/></svg>',
  };

  function cookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }
  async function getJSON(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(data, { status: response.status });
    return data;
  }
  async function post(url, payload) {
    await fetch('/api/auth/csrf/', { credentials: 'same-origin', cache: 'no-store' });
    const response = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': cookie('csrftoken') || cookie('gravitas_staging_csrftoken') },
      body: JSON.stringify(payload || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(data, { status: response.status });
    return data;
  }
  function readStore() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (err) { return {}; } }
  function writeStore(value) { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (err) { /* a convenience only */ } }
  function longDate(iso) {
    const date = new Date(iso || '');
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    return template.content;
  }
  function words(html) { return (fragment(html).textContent || '').trim().split(/\s+/).filter(Boolean).length; }
  const minutes = count => Math.max(1, Math.round(count / 220));
  function firstParagraph(html) {
    const text = fragment(html).querySelector('p')?.textContent?.trim() || '';
    return text.length > 360 ? text.slice(0, 357).trimEnd() + '…' : text;
  }
  /* topic-01-live.js says a copy worked the same way for every button on the
     page (a tick, the button keeping its shape). It loads first on both pages
     that run this; the fallback only matters if it failed to load. */
  function copy(button, text, done) {
    if (window.GQTopicFeedback) return window.GQTopicFeedback.copy(button, text, done);
    return navigator.clipboard?.writeText(text).catch(() => {});
  }
  const pulsarMark = () => window.GravitasIcons?.icon('pulsar', 'tq-ask__mark') || '';

  /* ---- The route, grouped by essay ------------------------------------- */
  /* The route names each entry's essay and level. A backend from before the
     levels does not, and its two slots were the two essays in full; reading
     the slot keeps the page whole while the two halves deploy. */
  const LEGACY_SLOTS = { overview: [1, 'researcher'], deep: [2, 'researcher'] };

  function group(essays) {
    const byEssay = new Map();
    for (const [slot, raw] of Object.entries(essays || {})) {
      const legacy = LEGACY_SLOTS[slot] || [0, ''];
      const item = { ...raw, essay: raw.essay || legacy[0], level: raw.level || legacy[1], label: raw.label || (legacy[0] ? 'Essay ' + legacy[0] : '') };
      const n = Number(item.essay) || 0;
      if (!n || !LEVELS.some(([key]) => key === item.level)) continue;
      if (!byEssay.has(n)) byEssay.set(n, { n, title: '', label: item.label || 'Essay ' + n, levels: {}, published: '' });
      const entry = byEssay.get(n);
      entry.levels[item.level] = { slot, title: item.title, html: item.html, words: words(item.html) };
      /* The fullest level names the essay; a plainer one may retitle itself. */
      if (item.level === 'researcher' || !entry.title) entry.title = item.title || entry.title;
      if ((item.published_at || '') > entry.published) entry.published = item.published_at;
    }
    return [...byEssay.values()].sort((a, b) => a.n - b.n).map(entry => {
      entry.order = LEVELS.map(([key]) => key).filter(key => entry.levels[key]);
      entry.fullest = entry.levels[entry.order[entry.order.length - 1]];
      return entry;
    });
  }

  /* ---- Home page: the essays are one panel of the rail ------------------ */
  function fillRail(found) {
    const first = found[0];
    document.querySelectorAll('[data-topic-essay-title]').forEach(node => { node.textContent = first ? first.title : 'Topic 01 essay'; });
    if (excerpt) {
      const text = first ? firstParagraph(first.fullest.html) : '';
      excerpt.textContent = text;
      excerpt.closest('blockquote').hidden = !text;
    }
    const panel = excerpt?.closest('.trail__panel');
    const side = panel?.querySelector('.trail__side');
    if (!side || found.length < 2) return;
    document.querySelectorAll('[data-topic-essay-intro]').forEach(node => { node.textContent = node.dataset.topicEssayIntro; });
    const list = document.createElement('ol');
    list.className = 'trail__set';
    list.setAttribute('aria-label', 'Essays in this Topic');
    found.forEach((essay, index) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = TOPIC_PAGE + '#essay-' + essay.n;
      link.dataset.title = essay.title;
      link.dataset.open = firstParagraph(essay.fullest.html);
      if (!index) link.setAttribute('aria-current', 'true');
      link.innerHTML = '<span class="trail__set-n">' + pad2(index + 1) + '</span><span class="trail__set-t">' + esc(essay.title) + '</span>';
      item.append(link);
      list.append(item);
    });
    const act = side.querySelector('.trail__act');
    if (act) act.before(list); else side.append(list);
    panel.setAttribute('data-rail-set', '');
  }

  /* ---- Overview ---------------------------------------------------------- */
  function boxNamed(html, pattern) {
    for (const box of fragment(html).querySelectorAll('.ta-essay-box')) {
      const heading = box.querySelector('h5');
      if (heading && pattern.test(heading.textContent)) return box;
    }
    return null;
  }
  function overview(essay) {
    const plainest = essay.levels[essay.order[0]];
    const opening = [...fragment(plainest.html).children].filter(node => node.tagName === 'P').slice(0, essay.order[0] === 'curious' ? 3 : 2);
    const source = essay.order.map(key => essay.levels[key].html).reverse();
    const remember = source.map(html => boxNamed(html, /remember/i)).find(Boolean);
    const todo = source.map(html => boxNamed(html, /what you can do/i)).find(Boolean);
    const list = (box, tag) => {
      if (!box) return '';
      const items = [...box.querySelectorAll('li')].map(li => '<li>' + li.innerHTML + '</li>').join('');
      return items ? '<' + tag + '>' + items + '</' + tag + '>' : '';
    };
    const points = list(remember, 'ol');
    const actions = list(todo, 'ul');
    return '<div class="tq-ov' + (points || actions ? '' : ' is-single') + '">' +
      '<div class="tq-ov__sum"><p class="tq-ov__k">Summary</p><div class="g-prose">' + opening.map(p => p.outerHTML).join('') + '</div>' +
      '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-mode-go="depth"><span>Read in depth</span>' + ICON.arrow + '</button></div>' +
      (points || actions ? '<div class="tq-ov__side">' +
        (points ? '<p class="tq-ov__k">Key points</p>' + points : '') +
        (actions ? '<p class="tq-ov__k">What you can do</p>' + actions : '') + '</div>' : '') +
      '</div>';
  }

  /* ---- The reader --------------------------------------------------------
     The References heading and what follows it fold into one closed block.
     They stay in the page, because the citation pop-over reads from them. */
  function readerMarkup(level) {
    const content = fragment(level.html);
    const heading = [...content.querySelectorAll('h4')].find(node => /^references$/i.test(node.textContent.trim()));
    if (heading) {
      const details = document.createElement('details');
      details.className = 'tq-refs';
      const body = document.createElement('div');
      let node = heading.nextSibling;
      while (node) { const next = node.nextSibling; body.append(node); node = next; }
      const count = body.querySelectorAll('.ta-essay-ref').length || body.querySelectorAll('p, li').length;
      details.innerHTML = '<summary>References &middot; ' + count + '</summary>';
      details.append(body);
      heading.replaceWith(details);
    }
    const holder = document.createElement('div');
    holder.append(content);
    return holder.innerHTML;
  }

  /* A reference entry: the paragraph that holds its anchor, with any link in
     it, or else the first DOI or address written in its text. */
  function entryFor(anchor) {
    const entry = anchor?.closest('p, li');
    if (!entry) return null;
    const text = entry.textContent.replace(/\s+/g, ' ').trim();
    const linked = entry.querySelector('a[href^="http"]')?.href;
    const written = (text.match(/https?:\/\/[^\s)]+/) || [])[0];
    const url = (linked || written || '').replace(/[.,;]$/, '');
    return { text, url };
  }

  /* ---- Bibliography ------------------------------------------------------ */
  function referencesOf(essay) {
    const found = new Map();
    for (const key of [...essay.order].reverse()) {
      for (const anchor of fragment(essay.levels[key].html).querySelectorAll('.ta-essay-ref')) {
        const ref = anchor.id.replace(/^.*?-ref-/, 'ref-');
        if (found.has(ref)) continue;
        const entry = entryFor(anchor);
        if (entry && entry.text) found.set(ref, { ...entry, ref, essay: essay.n });
      }
    }
    return [...found.values()];
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (err) { return ''; } }
  function safeHttp(url) { try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch (err) { return ''; } }
  /* A picture the record points at: a site path or an http(s) address. */
  function safeSrc(url) {
    const raw = String(url || '').trim();
    return raw.charAt(0) === '/' && raw.charAt(1) !== '/' ? raw : safeHttp(raw);
  }

  function drawSources(record, found) {
    if (!sourcesHost) return 0;
    const data = record?.topic_data || {};
    const items = [];
    (Array.isArray(data.sources) ? data.sources : []).forEach(row => {
      if (!row || !row.label) return;
      const level = SOURCE_LEVELS.find(([key]) => key === (row.level || 'start')) || SOURCE_LEVELS[0];
      items.push({ group: level[0], kind: level[1], title: row.label, url: safeHttp(row.url), cite: row.label + (row.url ? '. ' + row.url : '') });
    });
    found.forEach(essay => referencesOf(essay).forEach(ref => {
      items.push({ group: 'essay-' + essay.n, kind: 'Essay ' + essay.n, title: ref.text, url: safeHttp(ref.url), cite: ref.text, id: 'src-e' + essay.n + '-' + ref.ref });
    }));
    if (!items.length) { sourcesHost.innerHTML = '<p class="ta-empty">No sources are listed yet.</p>'; return 0; }
    items.forEach((item, index) => { item.n = index + 1; });
    const groups = [['all', 'All', items.length]].concat(
      SOURCE_LEVELS.map(([key, label]) => [key, label, items.filter(i => i.group === key).length]),
      found.map(essay => ['essay-' + essay.n, 'Cited in Essay ' + essay.n, items.filter(i => i.group === 'essay-' + essay.n).length]),
    ).filter(([, , count]) => count);
    sourcesHost.innerHTML =
      '<div class="tq-src__tools"><label class="g-visually-hidden" for="src-q">Search the sources</label>' +
      '<input class="search" id="src-q" type="search" placeholder="Search title, author or website" autocomplete="off" data-src-q>' +
      '<div class="tq-src__chips" role="group" aria-label="Filter sources">' + groups.map(([key, label, count], index) =>
        '<button class="chip" type="button" data-src-group="' + key + '" aria-pressed="' + (index ? 'false' : 'true') + '">' + esc(label) + ' <span class="g-nums">' + count + '</span></button>').join('') + '</div>' +
      '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-src-cite-all>' + ICON.copy + '<span>Copy all</span></button></div>' +
      '<p class="result-count" data-src-count role="status"></p>' +
      '<ol class="tq-src__list" data-src-list></ol>' +
      '<div class="tq-src__more"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-src-more hidden></button></div>';
    const list = sourcesHost.querySelector('[data-src-list]');
    const count = sourcesHost.querySelector('[data-src-count]');
    const more = sourcesHost.querySelector('[data-src-more]');
    const copyAll = sourcesHost.querySelector('[data-src-cite-all]');
    let filter = 'all', query = '', all = false;
    const visible = () => items.filter(item => (filter === 'all' || item.group === filter) &&
      (!query || (item.title + ' ' + item.kind + ' ' + hostOf(item.url)).toLowerCase().includes(query)));
    function draw() {
      const shown = visible();
      const cut = all || query || filter !== 'all' ? shown : shown.slice(0, 12);
      count.textContent = shown.length === items.length ? plural(items.length, 'source', 'sources') : shown.length + ' of ' + items.length + ' sources';
      list.innerHTML = cut.length ? cut.map(item =>
        '<li class="tq-src"' + (item.id ? ' id="' + esc(item.id) + '"' : '') + '><span class="tq-src__n g-nums">' + pad2(item.n) + '</span>' +
        '<div class="tq-src__main"><p class="tq-src__kind">' + esc(item.kind) + '</p><p class="tq-src__title">' + esc(item.title) + '</p>' +
        (item.url ? '<p class="tq-src__host">' + esc(hostOf(item.url)) + '</p>' : '') + '</div>' +
        '<div class="tq-src__act">' + (item.url ? '<a class="tq-icon-btn" href="' + esc(item.url) + '" target="_blank" rel="noopener" aria-label="Open the source in a new tab">' + ICON.ext + '</a>' : '') +
        '<button class="tq-icon-btn" type="button" data-src-cite="' + item.n + '" aria-label="Copy the citation">' + ICON.copy + '</button></div></li>').join('')
        : '<li class="empty">No source matches. Try another word or filter.</li>';
      more.hidden = cut.length >= shown.length;
      more.innerHTML = '<span>Show all ' + shown.length + ' sources</span>' + ICON.arrow;
      /* It copies what the filter shows, so it says so when that is not all. */
      const label = ICON.copy + '<span>' + (shown.length === items.length ? 'Copy all' : 'Copy ' + plural(shown.length, 'citation', 'citations')) + '</span>';
      if (window.GQTopicFeedback) window.GQTopicFeedback.relabel(copyAll, label); else copyAll.innerHTML = label;
      copyAll.disabled = !shown.length;
    }
    sourcesHost.addEventListener('input', event => { if (event.target.matches('[data-src-q]')) { query = event.target.value.trim().toLowerCase(); draw(); } });
    sourcesHost.addEventListener('click', event => {
      const chip = event.target.closest('[data-src-group]');
      if (chip) {
        filter = chip.dataset.srcGroup;
        sourcesHost.querySelectorAll('[data-src-group]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
        draw(); return;
      }
      const one = event.target.closest('[data-src-cite]');
      if (one) { copy(one, items[Number(one.dataset.srcCite) - 1].cite, 'Citation copied'); return; }
      const allButton = event.target.closest('[data-src-cite-all]');
      if (allButton) { const shown = visible(); copy(allButton, shown.map(item => item.cite).join('\n\n'), plural(shown.length, 'citation', 'citations') + ' copied'); return; }
      if (event.target.closest('[data-src-more]')) { all = true; draw(); }
    });
    draw();
    sourcesHost.has = id => items.some(item => item.id === id);
    /* "Show in Sources" needs the item drawn, whatever the filter. */
    sourcesHost.reveal = id => {
      if (!items.some(item => item.id === id)) return null;
      filter = 'all'; query = ''; all = true;
      sourcesHost.querySelector('[data-src-q]').value = '';
      sourcesHost.querySelectorAll('[data-src-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.srcGroup === 'all')));
      draw();
      return document.getElementById(id);
    };
    return items.length;
  }

  /* ---- Pop-over, back-to-reading, Ask Pulsar ----------------------------- */
  const pop = document.createElement('div');
  pop.className = 'tq-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Reference');
  pop.tabIndex = -1;
  pop.hidden = true;
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'g-btn g-btn--primary g-btn--sm tq-back';
  backButton.innerHTML = ICON.back + '<span>Back to reading</span>';
  backButton.hidden = true;
  const askButton = document.createElement('button');
  askButton.type = 'button';
  askButton.className = 'tq-ask';
  askButton.hidden = true;
  let popFrom = null, readingAt = null;

  /* `restore` hands focus back to the citation: on Escape and the close
     button, where the reader is still in the text. Not on a click elsewhere,
     which would pull focus off whatever was clicked. */
  function closePop(restore) {
    if (pop.hidden) return;
    pop.hidden = true;
    popFrom?.setAttribute('aria-expanded', 'false');
    if (restore) popFrom?.focus({ preventScroll: true });
    popFrom = null;
  }
  function openPop(link, entry, sourceId) {
    closePop(false);
    popFrom = link;
    link.setAttribute('aria-expanded', 'true');
    const url = safeHttp(entry.url);
    pop.innerHTML = '<div class="tq-pop__head"><p class="tq-pop__k">Reference</p>' +
      '<button class="tq-icon-btn tq-icon-btn--sm" type="button" data-pop-close aria-label="Close the reference">' + ICON.close + '</button></div>' +
      '<p class="tq-pop__t">' + esc(entry.text) + '</p>' +
      (url || sourceId ? '<div class="tq-pop__act">' +
        (url ? '<a class="g-btn g-btn--secondary g-btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener"><span>Open the source</span>' + ICON.ext + '</a>' : '') +
        (sourceId ? '<button class="g-btn g-btn--ghost g-btn--sm" type="button" data-pop-sources="' + esc(sourceId) + '"><span>Show in Sources</span>' + ICON.arrow + '</button>' : '') +
        '</div>' : '');
    pop.hidden = false;
    const box = link.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 32);
    pop.style.width = width + 'px';
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, box.left - 24));
    pop.style.left = (left + window.scrollX) + 'px';
    /* Below the citation, or above it when the window has no room below. It
       grows out of the citation, so its origin is the citation's side. */
    const above = box.bottom + pop.offsetHeight + 16 > window.innerHeight && box.top - pop.offsetHeight - 16 > 0;
    pop.style.top = (above ? box.top + window.scrollY - pop.offsetHeight - 8 : box.bottom + window.scrollY + 8) + 'px';
    pop.style.transformOrigin = Math.round(box.left + box.width / 2 - left) + 'px ' + (above ? '100%' : '0');
    pop.focus({ preventScroll: true });
  }
  pop.addEventListener('click', event => {
    if (event.target.closest('[data-pop-close]')) { closePop(true); return; }
    const jump = event.target.closest('[data-pop-sources]');
    if (!jump) return;
    const target = sourcesHost?.reveal?.(jump.dataset.popSources);
    readingAt = window.scrollY;
    closePop(false);
    if (!target) return;
    /* Sources is its own section: open it, then find the entry there. The
       reader's place in the essay is kept, and Back to reading returns to it. */
    if (window.GQTopicToc) {
      if (location.hash !== '#sources') history.pushState(null, '', '#sources');
      window.GQTopicToc.show('sources', target);
    } else {
      target.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' });
    }
    target.classList.add('is-flash');
    setTimeout(() => target.classList.remove('is-flash'), 1600);
    /* Focus goes with the reader, not left on a citation in a hidden section. */
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    backButton.hidden = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!pop.hidden) closePop(true);
    askButton.hidden = true;
  });
  document.addEventListener('click', event => {
    if (!pop.hidden && !pop.contains(event.target) && !event.target.closest('[data-cite]')) closePop(false);
  });
  /* Placed in page coordinates against the layout it opened in. */
  window.addEventListener('resize', () => { closePop(false); askButton.hidden = true; });
  /* The way back belongs to the trip to Sources. Opening any other section
     ends that trip, and the button with it. */
  document.addEventListener('gq:topic-section', event => {
    askButton.hidden = true;
    closePop(false);
    if (event.detail.id !== 'sources') { backButton.hidden = true; readingAt = null; }
  });
  backButton.addEventListener('click', () => {
    if (readingAt == null) return;
    const at = readingAt;   // opening the section below clears readingAt
    if (window.GQTopicToc && window.GQTopicToc.current() !== 'essay') {
      history.pushState(null, '', '#essay');
      window.GQTopicToc.show('essay', false);
      window.scrollTo({ top: at, behavior: 'instant' });
    } else {
      window.scrollTo({ top: at, behavior: reduce() ? 'auto' : 'smooth' });
    }
    readingAt = null;
    backButton.hidden = true;
  });

  /* ---- The Topic page ---------------------------------------------------- */
  function drawPage(found, record) {
    if (!found.length) {
      host.innerHTML = '<p class="ta-empty">The essays are not published yet.</p>';
      return;
    }
    document.body.append(pop, backButton, askButton);
    const covers = Array.isArray(record?.topic_data?.essay_covers) ? record.topic_data.essay_covers : [];
    const stored = readStore();
    const linked = /^#essay-(\d+)$/.exec(location.hash);
    const state = {
      essay: Math.max(0, found.findIndex(e => e.n === Number(linked ? linked[1] : stored.essay))),
      mode: stored.mode === 'depth' ? 'depth' : 'overview',
      level: stored.level || '',
    };
    const several = found.length > 1;

    host.innerHTML =
      (several ? '<div class="tq-epick" role="list" aria-label="Essays in this Topic">' + found.map((essay, index) => {
        const cover = covers[index] || {};
        const src = safeSrc(cover.image_url);
        return '<a class="tq-epick__item" role="listitem" href="#essay-' + essay.n + '" data-essay-pick="' + index + '">' +
          (src ? '<span class="tq-epick__pic"><img src="' + esc(src) + '" alt="' + esc(cover.image_alt || '') + '" loading="lazy" decoding="async"></span>' : '') +
          '<span class="tq-epick__text"><small>Essay ' + essay.n + ' of ' + found.length + ' &middot; ' + minutes(essay.fullest.words) + ' min in depth</small><b>' + esc(essay.title) + '</b></span></a>';
      }).join('') + '</div>' : '') +
      '<div class="tq-essay" data-essay-main></div>';
    const main = host.querySelector('[data-essay-main]');

    function levelFor(essay) {
      if (state.level && essay.levels[state.level]) return state.level;
      return essay.order.includes('undergrad') ? 'undergrad' : essay.order[essay.order.length - 1];
    }

    function draw(focusSwitch) {
      const essay = found[state.essay];
      const level = levelFor(essay);
      const text = essay.levels[level];
      host.querySelectorAll('[data-essay-pick]').forEach(link => {
        if (Number(link.dataset.essayPick) === state.essay) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      const time = state.mode === 'overview' ? 'about 2 min' : minutes(text.words) + ' min';
      main.innerHTML =
        '<header class="tq-essay__head" id="essay-' + essay.n + '"><p class="g-eyebrow g-eyebrow--bare">' + esc(essay.label) + (several ? ' of ' + found.length : '') + '</p>' +
        '<h3>' + esc(essay.title) + '</h3>' +
        '<dl class="tq-facts">' + (essay.published ? '<div><dt>Published</dt><dd>' + longDate(essay.published) + '</dd></div>' : '') +
        '<div><dt>Reading time</dt><dd>' + time + '</dd></div></dl></header>' +
        '<div class="tq-modes"><div class="depth" role="group" aria-label="Reading mode">' +
        '<button type="button" data-mode="overview" aria-pressed="' + (state.mode === 'overview') + '">Overview</button>' +
        '<button type="button" data-mode="depth" aria-pressed="' + (state.mode === 'depth') + '">In depth</button></div>' +
        (state.mode === 'depth' && essay.order.length > 1 ? '<div class="depth" role="group" aria-label="Reading level">' + LEVELS.filter(([key]) => essay.levels[key]).map(([key, label, note]) =>
          '<button type="button" data-level="' + key + '" aria-pressed="' + (key === level) + '" title="' + esc(note) + '">' + label + '</button>').join('') + '</div>' : '') +
        '<p class="tq-modes__note">' + (state.mode === 'overview' ? 'A short summary. Choose In depth for the full text.' : esc((LEVELS.find(([key]) => key === level) || [])[2] || '')) + '</p></div>' +
        (state.mode === 'overview'
          ? overview(essay)
          : '<article class="g-prose tq-reader" data-reader aria-label="' + esc(essay.title) + '">' + readerMarkup(text) + '</article>' + endBlock(essay));
      /* Citations open their reference in both modes. Overview carries them
         too (its summary and its boxes are the essay's own text) but used to
         leave them as plain in-page links to a list that is not drawn there. */
      main.querySelectorAll('a[href^="#"]').forEach(link => {
        if (!/-ref-/.test(link.getAttribute('href'))) return;
        link.dataset.cite = '';
        link.setAttribute('aria-haspopup', 'dialog');
        link.setAttribute('aria-expanded', 'false');
      });
      if (state.mode === 'depth') wireEnd(essay);
      if (focusSwitch) main.querySelector('[data-mode][aria-pressed="true"]')?.focus({ preventScroll: true });
      writeStore({ essay: essay.n, mode: state.mode, level: state.level });
    }

    host.addEventListener('click', event => {
      const pick = event.target.closest('[data-essay-pick]');
      if (pick && !event.metaKey && !event.ctrlKey && event.button === 0) {
        event.preventDefault();
        state.essay = Number(pick.dataset.essayPick);
        history.replaceState(null, '', '#essay-' + found[state.essay].n);
        draw();
        return;
      }
      const mode = event.target.closest('[data-mode], [data-mode-go]');
      if (mode) {
        state.mode = mode.dataset.mode || mode.dataset.modeGo;
        draw(true);
        if (mode.dataset.modeGo) main.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      const level = event.target.closest('[data-level]');
      if (level) { state.level = level.dataset.level; draw(); return; }
      const cite = event.target.closest('[data-cite]');
      if (cite) {
        event.preventDefault();
        const id = cite.getAttribute('href').slice(1);
        /* In depth, the references are on the page. In Overview they are
           not, so the entry is read from the essay's published levels. */
        const essayNow = found[state.essay];
        const anchor = document.getElementById(id) || essayNow.order
          .map(key => fragment(essayNow.levels[key].html).getElementById(id))
          .find(Boolean);
        const entry = entryFor(anchor);
        if (!entry) { anchor?.scrollIntoView(); return; }
        const essay = found[state.essay];
        const sourceId = 'src-e' + essay.n + '-' + id.replace(/^.*?-ref-/, 'ref-');
        if (pop.hidden || popFrom !== cite) openPop(cite, entry, sourcesHost?.has?.(sourceId) ? sourceId : '');
        else closePop();
      }
    });

    /* Selected text in the essay, handed to Pulsar as a question. Any
       selection counts, one word or part of one: the reader who stops at a
       term is the one most likely to want it explained. It used to need
       twelve characters, which in practice meant three words.

       The button follows the selection once it settles: on mouse or touch
       release, on a keyboard selection, and on the selection handles a phone
       draws, which send no mouseup. While a pointer is still down it waits,
       rather than chasing the drag. On a touch screen it sits under the
       selection, because the system's own menu takes the space above. */
    let pressing = false, settle = 0;
    function placeAsk() {
      const selection = window.getSelection();
      const text = selection && !selection.isCollapsed ? selection.toString().replace(/\s+/g, ' ').trim() : '';
      if (!text || text.length > 800 || !window.GravitasChat || !selection.rangeCount ||
          !main.contains(selection.anchorNode) || !main.contains(selection.focusNode) ||
          selection.anchorNode.parentElement?.closest('button, input, textarea, select, form')) { askButton.hidden = true; return; }
      const box = selection.getRangeAt(0).getBoundingClientRect();
      if (!box.width && !box.height) { askButton.hidden = true; return; }
      askButton.innerHTML = pulsarMark() + '<span>Ask Pulsar</span>';
      askButton.dataset.text = text;
      const wasHidden = askButton.hidden;
      askButton.hidden = false;
      const header = document.querySelector('.g-header, header')?.getBoundingClientRect().bottom || 0;
      const under = matchMedia('(pointer: coarse)').matches || box.top - askButton.offsetHeight - 10 < header;
      askButton.style.left = (Math.max(16, Math.min(window.innerWidth - askButton.offsetWidth - 16, box.left + box.width / 2 - askButton.offsetWidth / 2)) + window.scrollX) + 'px';
      askButton.style.top = ((under ? box.bottom + 10 : box.top - askButton.offsetHeight - 10) + window.scrollY) + 'px';
      askButton.style.transformOrigin = under ? '50% 0' : '50% 100%';
      if (wasHidden) { askButton.classList.remove('is-in'); void askButton.offsetWidth; askButton.classList.add('is-in'); }
    }
    document.addEventListener('pointerdown', event => { if (!askButton.contains(event.target)) pressing = true; });
    document.addEventListener('pointerup', () => { pressing = false; setTimeout(placeAsk, 0); });
    document.addEventListener('pointercancel', () => { pressing = false; });
    document.addEventListener('keyup', event => { if (event.shiftKey || event.key.startsWith('Arrow')) placeAsk(); });
    document.addEventListener('selectionchange', () => {
      clearTimeout(settle);
      if (window.getSelection()?.isCollapsed) { askButton.hidden = true; return; }
      if (!pressing) settle = setTimeout(placeAsk, 180);
    });
    askButton.addEventListener('pointerdown', event => event.preventDefault());
    askButton.addEventListener('click', () => {
      const essay = found[state.essay];
      const text = askButton.dataset.text || '';
      const term = !/\s/.test(text) && text.length <= 40;
      window.GravitasChat?.ask(term
        ? 'In the GraviQuest essay "' + essay.title + '", what does "' + text + '" mean here?'
        : 'In the GraviQuest essay "' + essay.title + '", explain this passage: "' + text + '"');
      askButton.hidden = true;
      window.getSelection()?.removeAllRanges();
    });

    /* ---- The end of an essay ---------------------------------------------- */
    function endBlock(essay) {
      const key = SLUG + '-essay-' + essay.n;
      return '<section class="tq-end" aria-labelledby="end-' + essay.n + '">' +
        '<div class="tq-end__head"><h4 id="end-' + essay.n + '">You reached the end</h4><p>Say whether it was useful, and add a note on the whole essay.</p></div>' +
        '<div class="tq-end__grid">' +
        '<div class="g-card tq-useful" data-useful><p class="tq-useful__q"><b>Was this essay useful to you?</b><span>One tap tells the next reader where to start.</span></p>' +
        '<div class="tq-useful__btns">' +
        '<button class="tq-useful__btn" type="button" data-react="useful" aria-pressed="false">' + ICON.up + '<b class="g-nums" data-react-n="useful">&ndash;</b><span>Useful</span></button>' +
        '<button class="tq-useful__btn" type="button" data-react="not_useful" aria-pressed="false">' + ICON.down + '<b class="g-nums" data-react-n="not_useful">&ndash;</b><span>Not for me</span></button></div>' +
        '<p class="tq-useful__sum" data-react-sum role="status"></p></div>' +
        '<form class="g-card tq-note" data-comment-form="' + key + '"><label class="g-label" for="note-' + essay.n + '">Comment on the whole essay</label>' +
        '<p class="tq-note__hint">Not tied to one passage. It joins the notes from other readers below.</p>' +
        '<textarea class="g-textarea" id="note-' + essay.n + '" name="body" rows="3" maxlength="5000" placeholder="What did this essay change for you, or leave out?"></textarea>' +
        '<div class="tq-note__act"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Post note</button><span class="g-hint" data-form-note>Members can post. A moderator reads every note first.</span></div></form>' +
        '</div>' +
        '<div class="tq-wn" data-notes="' + key + '"><div class="tq-wn__head"><h5>What readers said about the whole essay</h5><span class="result-count" data-notes-count></span></div>' +
        '<div class="tq-wn__tools" hidden><label class="g-visually-hidden" for="wn-q-' + essay.n + '">Search notes</label><input class="search" id="wn-q-' + essay.n + '" type="search" placeholder="Search notes" data-notes-q>' +
        '<label class="g-visually-hidden" for="wn-s-' + essay.n + '">Sort notes</label><select class="g-select" id="wn-s-' + essay.n + '" data-notes-sort><option value="new">Newest first</option><option value="old">Oldest first</option><option value="liked">Most liked</option></select></div>' +
        '<ul class="tq-wn__list" data-notes-list><li class="ta-empty">Loading notes&hellip;</li></ul><div class="tq-wn__more"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-notes-more hidden></button></div></div>' +
        '<div class="tq-actions"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-share-essay>' + ICON.share + '<span>Share this essay</span></button>' +
        '<a class="g-btn g-btn--primary g-btn--sm" href="#talk" data-room-jump="essays">Discuss the essays</a></div></section>';
    }

    function wireEnd(essay) {
      const useful = main.querySelector('[data-useful]');
      const url = API + essay.n + '/reaction/';
      function paint(reaction) {
        useful.querySelectorAll('[data-react]').forEach(button => button.setAttribute('aria-pressed', String(reaction.selected === button.dataset.react)));
        useful.querySelector('[data-react-n="useful"]').textContent = reaction.useful;
        useful.querySelector('[data-react-n="not_useful"]').textContent = reaction.not_useful;
        const total = reaction.useful + reaction.not_useful;
        useful.querySelector('[data-react-sum]').innerHTML = total
          ? '<span class="tq-useful__bar" aria-hidden="true"><i style="width:' + Math.round(reaction.useful / total * 100) + '%"></i></span>' +
            Math.round(reaction.useful / total * 100) + '% of ' + plural(total, 'reader', 'readers') + ' found it useful' + (reaction.selected ? '. You can change your answer.' : '.')
          : 'No answers yet.';
      }
      getJSON(url).then(data => paint(data.reaction)).catch(() => { useful.querySelector('[data-react-sum]').textContent = 'Answers could not be loaded just now.'; });
      useful.addEventListener('click', event => {
        const button = event.target.closest('[data-react]');
        if (!button) return;
        const value = button.getAttribute('aria-pressed') === 'true' ? '' : button.dataset.react;
        useful.querySelectorAll('[data-react]').forEach(b => { b.disabled = true; });
        post(url, { value }).then(data => paint(data.reaction))
          .catch(() => { useful.querySelector('[data-react-sum]').textContent = 'Your answer could not be saved. Try again.'; })
          .finally(() => useful.querySelectorAll('[data-react]').forEach(b => { b.disabled = false; }));
      });
      main.querySelector('[data-share-essay]').addEventListener('click', event => {
        const url = location.href.split('#')[0] + '#essay-' + essay.n;
        if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title: essay.title, url }).catch(() => {}); return; }
        copy(event.currentTarget, url, 'Link copied');
      });

      const notes = main.querySelector('[data-notes]');
      const list = notes.querySelector('[data-notes-list]');
      const more = notes.querySelector('[data-notes-more]');
      let all = [], query = '', sort = 'new', shown = 4;
      function drawNotes() {
        const filtered = all.filter(c => !query || (c.body + ' ' + c.author).toLowerCase().includes(query))
          .sort((a, b) => sort === 'old' ? a.created_at.localeCompare(b.created_at) : sort === 'liked' ? (b.like_count - a.like_count) || b.created_at.localeCompare(a.created_at) : b.created_at.localeCompare(a.created_at));
        notes.querySelector('[data-notes-count]').textContent = plural(all.length, 'note', 'notes') + (filtered.length !== all.length ? ' · ' + filtered.length + ' match' : '');
        list.innerHTML = filtered.length ? filtered.slice(0, shown).map(c =>
          '<li class="tq-wn__item"><p class="tq-wn__who"><b>' + esc(c.author) + '</b><time datetime="' + esc(c.created_at) + '">' + longDate(c.created_at) + '</time></p><p>' + esc(c.body) + '</p></li>').join('')
          : '<li class="ta-empty">' + (all.length ? 'No note matches.' : 'No published notes on the whole essay yet. The first one sets the tone.') + '</li>';
        const left = filtered.length - shown;
        more.hidden = left <= 0;
        more.textContent = 'Show ' + Math.min(4, left) + ' more · ' + left + ' left';
      }
      getJSON('/api/community/comments/' + SLUG + '-essay-' + essay.n + '/').then(data => {
        all = (data.comments || []).filter(c => !c.parent_id);
        notes.querySelector('.tq-wn__tools').hidden = all.length < 4;
        drawNotes();
      }).catch(() => { list.innerHTML = '<li class="ta-empty">Notes could not be loaded just now. They are still there.</li>'; });
      notes.addEventListener('input', event => { if (event.target.matches('[data-notes-q]')) { query = event.target.value.trim().toLowerCase(); shown = 4; drawNotes(); } });
      notes.addEventListener('change', event => { if (event.target.matches('[data-notes-sort]')) { sort = event.target.value; drawNotes(); } });
      more.addEventListener('click', () => { shown += 4; drawNotes(); });
    }

    draw();
    window.GQTopicToc?.set('essay', found.length, several ? found.map(essay => ({ label: essay.title, href: '#essay-' + essay.n })) : null);
    /* The rail lists the essays as #essay-1, #essay-2; topic-01-live.js opens
       this section for them, and this picks the essay. */
    function follow() {
      const asked = /^#essay-(\d+)$/.exec(location.hash);
      const index = asked ? found.findIndex(e => e.n === Number(asked[1])) : -1;
      if (index < 0 || index === state.essay) return;
      state.essay = index;
      draw();
    }
    window.addEventListener('hashchange', follow);
    window.addEventListener('popstate', follow);
  }

  /* The record first: the page needs its covers and its sources, and the
     rail's intro text, which topic-01-live.js writes. */
  (window.GQTopic01 || Promise.resolve(null))
    .then(record => getJSON(API).then(data => ({ record, found: group(data.essays) })))
    .then(({ record, found }) => {
      fillRail(found);
      if (host) drawPage(found, record);
      const total = drawSources(record, found);
      if (sourcesHost) window.GQTopicToc?.set('sources', total);
    })
    .catch(error => {
      if (window.console) console.error(error);
      if (excerpt) excerpt.closest('blockquote').hidden = true;
      document.querySelectorAll('[data-topic-essay-title]').forEach(node => { node.textContent = 'Topic 01 essay'; });
      if (host) host.innerHTML = '<p class="ta-empty" role="status">The essays are temporarily unavailable. Reload to try again.</p>';
      (window.GQTopic01 || Promise.resolve(null)).then(record => {
        if (!sourcesHost) return;
        const total = drawSources(record, []);
        window.GQTopicToc?.set('sources', total);
      });
    });
})();
