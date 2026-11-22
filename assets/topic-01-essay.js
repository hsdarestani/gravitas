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

   The second design review (2026-11-19, tests/topic.html) set the essay on a
   stage beside its list, the way the videos are, and added what a reader
   does with the text, all of it on real routes:
   - select a passage to ask Pulsar about it or annotate it, comment on a
     section from its heading, and read other readers' notes in the text and
     in a panel beside it (topic-annotations.js, the comment route);
   - a citation previews its reference on hover or focus and opens it on a
     click, with Show in Sources and a way back;
   - the end of an essay asks whether it was useful (its own route, real
     counts) and holds the conversation on the whole essay, with replies;
   - the bibliography says what kind each source is, its year, and where in
     the essays it is cited, with a jump to the sentence, and cites in four
     formats.
   The rail lists the essay's sections while it is read in depth, with how
   far the reader has got.

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
  /* The three levels the home page's rail promises ("sorted into three
     levels so you can climb"), with the same words. References the essays
     cite are not levelled by the editors, so they form a fourth group after
     the three, and say so. */
  const SOURCE_LEVELS = [['start', 'Start here', 'No background needed'], ['further', 'Go further', 'Some method expected'], ['primary', 'Primary', 'The papers themselves']];
  const ESSAY_GROUP = ['essay', 'Cited in the essays', 'Every reference the essays cite'];
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
  const slugify = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const ICON = {
    arrow: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    back: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    ext: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    copy: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5v9h-3v-9zM7.5 10.5l3.6-6.3a1.6 1.6 0 0 1 3 .9l-.6 4h5a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.6H7.5"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 13.5v-9h-3v9zM7.5 13.5l3.6 6.3a1.6 1.6 0 0 0 3-.9l-.6-4h5a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.6H7.5"/></svg>',
    close: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>',
    share: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/></svg>',
    pen: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5l1-4L16 5l3 3L8.5 18.5z"/><path d="M14 7l3 3"/></svg>',
    talk: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3.2v-3.2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    download: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>',
  };
  const glyph = (name, cls) => window.GravitasIcons?.icon(name, cls || '') || '';

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
  function firstParagraph(html, limit) {
    const max = limit || 360;
    const text = fragment(html).querySelector('p')?.textContent?.trim() || '';
    return text.length > max ? text.slice(0, max - 3).trimEnd() + '…' : text;
  }
  /* topic-01-live.js says a copy worked the same way for every button on the
     page (a tick, the button keeping its shape). It loads first on both pages
     that run this; the fallback only matters if it failed to load. */
  function copy(button, text, done) {
    if (window.GQTopicFeedback) return window.GQTopicFeedback.copy(button, text, done);
    return navigator.clipboard?.writeText(text).catch(() => {});
  }

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
      entry.plainest = entry.levels[entry.order[0]];
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
    const plainest = essay.plainest;
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
    return '<div class="tq-ov' + (points || actions ? '' : ' is-single') + '" data-overview>' +
      /* Review of 2026-11-22: the summary sits on the page at reading size,
         not inside a coloured card, and only the side panel (key points, then
         what you can do) is a card. */
      '<div class="tq-ov__sum"><div class="g-prose">' + opening.map(p => p.outerHTML).join('') + '</div>' +
      '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-mode-go="depth"><span>Read in depth</span>' + ICON.arrow + '</button></div>' +
      (points || actions ? '<aside class="tq-ov__side">' +
        (points ? '<div class="tq-ov__part"><p class="tq-ov__k">Key points</p>' + points + '</div>' : '') +
        (actions ? '<div class="tq-ov__part"><p class="tq-ov__k">What you can do</p>' + actions + '</div>' : '') + '</aside>' : '') +
      '</div>';
  }

  /* ---- The reader --------------------------------------------------------
     The References heading and what follows it fold into one closed block.
     They stay in the page, because the citation pop-over reads from them.
     Each section heading gets an address, so the rail can list the
     sections and a link can open one. */
  function readerMarkup(level, essayN) {
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
    const seen = {};
    [...content.querySelectorAll('h4')].forEach(h => {
      if (h.closest('.tq-refs, .ta-essay-box, .ta-essay-figure')) return;
      let id = 'essay-' + essayN + '-' + (slugify(h.textContent) || 'section');
      if (seen[id]) id += '-' + (++seen[id]); else seen[id] = 1;
      h.id = id;
    });
    const holder = document.createElement('div');
    holder.append(content);
    return holder.innerHTML;
  }
  function sectionsOf(article) {
    return [...article.querySelectorAll('h4[id]')].map(h => {
      const copy = h.cloneNode(true);
      copy.querySelectorAll('.tq-hc').forEach(b => b.remove());
      return { id: h.id, label: copy.textContent.replace(/\s+/g, ' ').trim() };
    });
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

  /* Where an essay cites a reference: the sentence around each citation
     link, the section it is in and the level it was read at. Taken from the
     fullest level first, so a sentence is quoted once. */
  function usesOf(essay, ref) {
    const out = [];
    const seen = new Set();
    for (const key of [...essay.order].reverse()) {
      const content = fragment(essay.levels[key].html);
      let section = '';
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.tagName === 'H4') { if (/^references$/i.test(node.textContent.trim())) break; section = node.textContent.trim(); continue; }
        if (node.tagName !== 'A' || !/-ref-/.test(node.getAttribute('href') || '')) continue;
        if (node.getAttribute('href').replace(/^.*?-ref-/, 'ref-') !== ref) continue;
        const block = node.closest('p, li, figcaption');
        if (!block) continue;
        const text = block.textContent.replace(/\s+/g, ' ').trim();
        const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
        const label = node.textContent.replace(/\s+/g, ' ').trim();
        let sentence = sentences.find(s => s.includes(label)) || text;
        sentence = sentence.trim();
        if (sentence.length > 220) sentence = sentence.slice(0, 217).trimEnd() + '…';
        if (seen.has(sentence)) continue;
        seen.add(sentence);
        out.push({ essay: essay.n, level: key, section, sentence, href: node.getAttribute('href') });
      }
    }
    return out;
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (err) { return ''; } }
  function safeHttp(url) { try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch (err) { return ''; } }
  /* A picture the record points at: a site path or an http(s) address. */
  function safeSrc(url) {
    const raw = String(url || '').trim();
    return raw.charAt(0) === '/' && raw.charAt(1) !== '/' ? raw : safeHttp(raw);
  }

  /* What kind of thing a source is, read from its address and its text. A
     reading, not a fact the record holds, so it errs toward "Web page". */
  const KINDS = [
    ['paper', 'Paper', 'magazine'],
    ['preprint', 'Preprint', 'notes'],
    ['policy', 'Policy or legal', 'balance'],
    ['news', 'News or blog', 'discussion'],
    ['web', 'Web page', 'webpage'],
  ];
  function kindOf(title, url) {
    const host = hostOf(url);
    const text = title || '';
    if (/arxiv|biorxiv|medrxiv|ssrn|osf\.io|researchsquare|preprints\.org/.test(host) || /\bpreprint\b|arXiv|bioRxiv|medRxiv/.test(text)) return 'preprint';
    if (/\.gov$|\.gov\.|europa\.eu|court|legislation|nih\.gov|grants\.|ukri|nsf\.gov|icmje|cope\b|publicationethics|stm-assoc/.test(host) || /\bguidance\b|\bpolicy\b|\bnotice\b|\bv\.\s/i.test(text)) return 'policy';
    if (/doi\.org|nature\.com\/articles\/s|science\.org\/doi|thelancet|cell\.com|pnas|plos|springer|wiley|elsevier|sciencedirect|acm\.org|ieee|aclanthology|jamanetwork|bmj\.com|nejm|royalsociety|tandfonline|sagepub|frontiersin|mdpi|neurips|openreview/.test(host)) return 'paper';
    if (/news|blog|medium\.com|substack|nytimes|theguardian|wired|theverge|technologyreview|scientificamerican|statnews|retractionwatch|timeshighereducation|sciencebusiness|gptzero|axios|bbc|reuters|ft\.com|economist/.test(host) || /nature\.com\/articles\/d4/.test(url || '')) return 'news';
    return 'web';
  }
  function yearOf(text) {
    const paren = String(text || '').match(/\((19|20)\d{2}[a-z]?\)/);
    if (paren) return paren[0].slice(1, 5);
    const loose = String(text || '').match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    return loose ? loose[0] : '';
  }
  function doiOf(text, url) {
    const found = (String(url || '') + ' ' + String(text || '')).match(/10\.\d{4,9}\/[^\s"<>,;]+/);
    return found ? found[0].replace(/[.)]+$/, '') : '';
  }

  /* Four ways to cite. The record holds a citation as written, not as fields,
     so BibTeX and RIS carry it as a note with the year, address and DOI read
     from it; a reference manager imports that cleanly and loses nothing. */
  const FORMATS = [['plain', 'As listed'], ['bibtex', 'BibTeX'], ['ris', 'RIS'], ['link', 'Link']];
  function formatSource(item, format) {
    const brace = s => String(s || '').replace(/[{}]/g, '');
    if (format === 'bibtex') {
      return '@misc{' + item.key.toLowerCase().replace(/[^a-z0-9]+/g, '') + ',\n  note = {' + brace(item.title) + '},\n' +
        (item.year ? '  year = {' + item.year + '},\n' : '') + (item.url ? '  url = {' + item.url + '},\n' : '') +
        (item.doi ? '  doi = {' + item.doi + '},\n' : '') + '}';
    }
    if (format === 'ris') {
      return 'TY  - GEN\nN1  - ' + item.title + (item.year ? '\nPY  - ' + item.year : '') + (item.url ? '\nUR  - ' + item.url : '') + (item.doi ? '\nDO  - ' + item.doi : '') + '\nER  - ';
    }
    if (format === 'link') return item.short + (item.url ? ' — ' + item.url : '');
    return item.cite;
  }

  let openEssayAt = null;   // set by drawPage: (essayN, level, href) => void

  function drawSources(record, found) {
    if (!sourcesHost) return 0;
    const data = record?.topic_data || {};
    const items = [];
    (Array.isArray(data.sources) ? data.sources : []).forEach(row => {
      if (!row || !row.label) return;
      const level = SOURCE_LEVELS.find(([key]) => key === (row.level || 'start')) || SOURCE_LEVELS[0];
      const url = safeHttp(row.url);
      items.push({ group: level[0], level: level[0], where: [level[0]], label: level[1], title: row.label, short: row.short || row.label, url, cite: row.label + (row.url ? '. ' + row.url : ''), uses: [] });
    });
    found.forEach(essay => referencesOf(essay).forEach(ref => {
      const url = safeHttp(ref.url);
      const short = ref.text.length > 120 ? ref.text.slice(0, 117).trimEnd() + '…' : ref.text;
      items.push({ group: 'essay-' + essay.n, level: 'essay', where: ['essay-' + essay.n], label: 'Essay ' + essay.n, title: ref.text, short, url, cite: ref.text,
        id: 'src-e' + essay.n + '-' + ref.ref, uses: usesOf(essay, ref.ref) });
    }));
    if (!items.length) { sourcesHost.innerHTML = '<p class="ta-empty">No sources are listed yet.</p>'; return 0; }
    /* Climb order: the three levels, then what the essays cite. */
    const GROUPS = SOURCE_LEVELS.concat([ESSAY_GROUP]);
    const rank = item => GROUPS.findIndex(([key]) => key === item.level);
    items.sort((a, b) => rank(a) - rank(b));
    items.forEach((item, index) => {
      item.n = index + 1;
      item.key = item.group.indexOf('essay-') === 0 ? 'E' + item.group.slice(6) + '·' + pad2(item.n) : 'S' + pad2(item.n);
      item.kind = kindOf(item.title, item.url);
      item.year = yearOf(item.title);
      item.doi = doiOf(item.title, item.url);
    });
    const kinds = KINDS.filter(([key]) => items.some(i => i.kind === key));
    const years = [...new Set(items.map(i => i.year).filter(Boolean))].sort((a, b) => b - a);
    const groups = GROUPS.filter(([key]) => items.some(i => i.level === key));
    const wheres = SOURCE_LEVELS.map(([key, label]) => [key, label]).concat(found.map(e => ['essay-' + e.n, 'Cited in Essay ' + e.n]))
      .filter(([key]) => items.some(i => i.where.includes(key)));
    const st = { level: 'all', kind: 'all', year: 'all', where: 'all', query: '', all: false, more: false, open: '', tab: 'where', format: 'plain' };

    sourcesHost.innerHTML =
      '<div class="tq-src__tools">' +
        '<label class="tk-search tq-src__search">' + (window.GQTalk ? window.GQTalk.icon.search : '') + '<span class="g-visually-hidden">Search the sources</span><input type="search" placeholder="Search title, author, DOI or website" autocomplete="off" data-src-q></label>' +
        '<button class="g-btn g-btn--ghost g-btn--sm" type="button" aria-expanded="false" data-src-more-filters>' + glyph('filter', 'g-btn__icon') + '<span>More filters</span></button>' +
        '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-src-cite-all>' + ICON.copy + '<span>Cite all</span></button>' +
      '</div>' +
      '<div class="tq-src__chips tq-src__levels" role="group" aria-label="Level">' +
        [['all', 'All levels']].concat(groups).map(([key, label], k) =>
          '<button class="chip" type="button" data-src-level="' + key + '" aria-pressed="' + (key === 'all') + '">' +
            (key !== 'all' && key !== 'essay' ? '<span class="g-nums tq-src__step">' + pad2(k) + '</span>' : '') + esc(label) +
            ' <span class="g-nums">' + (key === 'all' ? items.length : items.filter(i => i.level === key).length) + '</span></button>').join('') +
      '</div>' +
      '<div class="tq-src__chips" role="group" aria-label="Kind of source">' +
        [['all', 'All', null]].concat(kinds).map(([key, label]) =>
          '<button class="chip" type="button" data-src-kind="' + key + '" aria-pressed="' + (key === 'all') + '">' + esc(label) + ' <span class="g-nums">' + (key === 'all' ? items.length : items.filter(i => i.kind === key).length) + '</span></button>').join('') +
      '</div>' +
      '<div class="tq-src__filters" hidden data-src-filters>' +
        '<label><span>Year</span><select class="g-select" data-src-year><option value="all">Any year</option>' + years.map(y => '<option>' + y + '</option>').join('') + '</select></label>' +
        '<label><span>Where</span><select class="g-select" data-src-where><option value="all">Anywhere</option>' + wheres.map(([key, label]) => '<option value="' + key + '">' + esc(label) + '</option>').join('') + '</select></label>' +
      '</div>' +
      '<p class="result-count" data-src-count role="status"></p>' +
      '<ol class="tq-src__list" data-src-list></ol>' +
      '<div class="tq-src__more"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-src-all hidden></button></div>' +
      '<dialog class="tq-dialog" data-src-dialog aria-labelledby="src-dialog-t"></dialog>';
    const list = sourcesHost.querySelector('[data-src-list]');
    const count = sourcesHost.querySelector('[data-src-count]');
    const more = sourcesHost.querySelector('[data-src-all]');
    const dialog = sourcesHost.querySelector('[data-src-dialog]');

    const visible = () => items.filter(item =>
      (st.level === 'all' || item.level === st.level) &&
      (st.kind === 'all' || item.kind === st.kind) &&
      (st.year === 'all' || item.year === st.year) &&
      (st.where === 'all' || item.where.includes(st.where)) &&
      (!st.query || (item.title + ' ' + item.label + ' ' + hostOf(item.url) + ' ' + item.doi + ' ' + item.key).toLowerCase().includes(st.query)));
    const filtered = () => st.level !== 'all' || st.kind !== 'all' || st.year !== 'all' || st.where !== 'all' || !!st.query;

    function card(item) {
      const kind = KINDS.find(([key]) => key === item.kind);
      const open = st.open === item.key;
      /* The level is the heading above the row now, so the row names only where the essays cite it. */
      const usedIn = item.uses.length ? [...new Set(item.uses.map(u => 'Essay ' + u.essay))].join(', ') : '';
      /* Review of 2026-11-22: the whole row is one target that opens and
         closes the panel, and the row keeps a single icon, the external link.
         Inside, one switch chooses between where it is used and Cite (the row
         used to carry its own Cite and chevron buttons, which duplicated it). */
      const panel = !open ? '' : '<div class="tq-src__panel is-' + st.tab + '">' +
        '<div class="tq-seg" role="group" aria-label="About this source"><button type="button" data-src-tab="where" aria-pressed="' + (st.tab === 'where') + '">Where it is used</button><button type="button" data-src-tab="cite" aria-pressed="' + (st.tab === 'cite') + '">Cite</button></div>' +
        (st.tab === 'where'
          ? (item.uses.length
            ? '<p class="tq-src__why">Cited in ' + plural(item.uses.length, 'place', 'places') + ' in the essays. Open one to read it in context.</p><div class="tq-src__uses">' + item.uses.slice(0, 4).map((u, k) =>
              '<button type="button" class="tq-src__use" data-src-use="' + k + '"><small>Essay ' + u.essay + (u.section ? ' · ' + esc(u.section) : '') + '</small><span>“' + esc(u.sentence) + '”</span></button>').join('') + '</div>'
            : '<p class="tq-src__why">' + (item.group.indexOf('essay-') === 0 ? 'Listed in the essay’s references.' : 'On the reading list at the level “' + esc(item.label) + '”. Not cited in a sentence of the essays.') + '</p>') +
            '<p class="tq-src__full">' + esc(item.title) + '</p>'
          : '<div class="tq-src__citebar">' +
            '<div class="tq-seg tq-seg--sm" role="group" aria-label="Citation format">' + FORMATS.map(([key, label]) => '<button type="button" data-src-format="' + key + '" aria-pressed="' + (st.format === key) + '">' + label + '</button>').join('') + '</div>' +
            '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-src-copy>' + ICON.copy + '<span>Copy</span></button></div>' +
            '<pre class="tq-src__pre">' + esc(formatSource(item, st.format)) + '</pre>') +
        '</div>';
      return '<li class="tq-src' + (open ? ' is-open' : '') + '"' + (item.id ? ' id="' + esc(item.id) + '"' : '') + ' data-src-key="' + esc(item.key) + '">' +
        '<div class="tq-src__row">' +
          '<button class="tq-src__hit" type="button" data-src-open aria-expanded="' + open + '" aria-label="' + (open ? 'Hide' : 'Show') + ' details: ' + esc(item.short) + '"></button>' +
          '<span class="tq-src__tile is-' + item.kind + '" aria-hidden="true">' + glyph(kind[2], 'tq-src__glyph') + '</span>' +
          '<div class="tq-src__main"><p class="tq-src__meta"><b class="g-nums">' + esc(item.key) + '</b><span>' + esc(kind[1]) + '</span>' + (item.year ? '<span class="g-nums">' + item.year + '</span>' : '') + '</p>' +
            '<p class="tq-src__title">' + esc(item.short) + '</p>' +
            '<p class="tq-src__host">' + esc(hostOf(item.url) || 'No link') + (usedIn ? ' · <span class="tq-src__used">' + esc(usedIn) + '</span>' : '') + '</p></div>' +
          '<div class="tq-src__act">' +
            (item.url ? '<a class="tq-icon-btn" href="' + esc(item.url) + '" target="_blank" rel="noopener" aria-label="Open the source in a new tab" title="Open">' + ICON.ext + '</a>' : '') +
          '</div></div>' + panel + '</li>';
    }

    function draw() {
      const shown = visible();
      const cut = st.all || filtered() ? shown : shown.slice(0, 12);
      count.textContent = shown.length === items.length ? plural(items.length, 'source', 'sources') : shown.length + ' of ' + items.length + ' sources';
      /* Each level opens with its own heading, so the climb is visible in
         the list and not only in the chips. */
      let last = '';
      list.innerHTML = cut.length ? cut.map(item => {
        let head = '';
        if (item.level !== last) {
          last = item.level;
          const g = GROUPS.find(([key]) => key === item.level) || ESSAY_GROUP;
          const step = SOURCE_LEVELS.findIndex(([key]) => key === g[0]);
          head = '<li class="tq-src__lvl" role="presentation">' + (step >= 0 ? '<span class="g-nums">' + pad2(step + 1) + '</span>' : '') +
            '<b>' + esc(g[1]) + '</b><span>' + esc(g[2]) + '</span></li>';
        }
        return head + card(item);
      }).join('')
        : '<li class="tq-src__empty">No source matches. <button class="tk-link" type="button" data-src-clear>Clear search and filters</button></li>';
      more.hidden = cut.length >= shown.length;
      more.innerHTML = '<span>Show all ' + shown.length + ' sources</span>' + ICON.arrow;
    }
    const byKey = key => items.find(item => item.key === key);

    function openDialog() {
      const shown = visible();
      const text = () => shown.map(item => formatSource(item, st.format)).join('\n\n');
      dialog.innerHTML = '<div class="tq-dialog__head"><h3 id="src-dialog-t">Cite ' + (shown.length === items.length ? 'all sources' : plural(shown.length, 'source', 'sources') + ' shown') + '</h3>' +
        '<button class="tq-icon-btn tq-icon-btn--sm" type="button" data-dialog-close aria-label="Close">' + ICON.close + '</button></div>' +
        '<div class="tq-seg" role="group" aria-label="Citation format">' + FORMATS.map(([key, label]) => '<button type="button" data-dialog-format="' + key + '" aria-pressed="' + (st.format === key) + '">' + label + '</button>').join('') + '</div>' +
        '<label class="g-visually-hidden" for="src-all-text">Citations</label><textarea class="g-textarea tq-dialog__text" id="src-all-text" rows="14" readonly></textarea>' +
        '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="button" data-dialog-copy>' + ICON.copy + '<span>Copy list</span></button>' +
        '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-dialog-download>' + ICON.download + '<span>Download</span></button></div>';
      const area = dialog.querySelector('textarea');
      area.value = text();
      dialog.onclick = event => {
        if (event.target === dialog || event.target.closest('[data-dialog-close]')) { dialog.close(); return; }
        const fmt = event.target.closest('[data-dialog-format]');
        if (fmt) {
          st.format = fmt.dataset.dialogFormat;
          dialog.querySelectorAll('[data-dialog-format]').forEach(b => b.setAttribute('aria-pressed', String(b === fmt)));
          area.value = text();
          return;
        }
        const copyButton = event.target.closest('[data-dialog-copy]');
        if (copyButton) { copy(copyButton, area.value, plural(shown.length, 'citation', 'citations') + ' copied'); return; }
        if (event.target.closest('[data-dialog-download]')) {
          const ext = { bibtex: 'bib', ris: 'ris' }[st.format] || 'txt';
          const blob = new Blob([area.value + '\n'], { type: 'text/plain;charset=utf-8' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'graviquest-topic-01-sources.' + ext;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(link.href), 2000);
        }
      };
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      area.focus();
      area.setSelectionRange(0, 0);
    }

    sourcesHost.addEventListener('input', event => { if (event.target.matches('[data-src-q]')) { st.query = event.target.value.trim().toLowerCase(); draw(); } });
    sourcesHost.addEventListener('change', event => {
      if (event.target.matches('[data-src-year]')) { st.year = event.target.value; draw(); }
      if (event.target.matches('[data-src-where]')) { st.where = event.target.value; draw(); }
    });
    sourcesHost.addEventListener('keydown', event => {
      if (event.key === 'Escape' && st.open && !dialog.open) {
        const key = st.open; st.open = ''; draw();
        sourcesHost.querySelector('[data-src-key="' + key + '"] [data-src-open]')?.focus();
      }
    });
    sourcesHost.addEventListener('click', event => {
      const t = event.target;
      const lvl = t.closest('[data-src-level]');
      if (lvl) {
        st.level = lvl.dataset.srcLevel;
        sourcesHost.querySelectorAll('[data-src-level]').forEach(b => b.setAttribute('aria-pressed', String(b === lvl)));
        draw(); return;
      }
      const chip = t.closest('[data-src-kind]');
      if (chip) {
        st.kind = chip.dataset.srcKind;
        sourcesHost.querySelectorAll('[data-src-kind]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
        draw(); return;
      }
      const filtersButton = t.closest('[data-src-more-filters]');
      if (filtersButton) {
        st.more = !st.more;
        filtersButton.setAttribute('aria-expanded', String(st.more));
        sourcesHost.querySelector('[data-src-filters]').hidden = !st.more;
        return;
      }
      if (t.closest('[data-src-clear]')) {
        Object.assign(st, { level: 'all', kind: 'all', year: 'all', where: 'all', query: '' });
        sourcesHost.querySelectorAll('[data-src-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.srcLevel === 'all')));
        sourcesHost.querySelector('[data-src-q]').value = '';
        sourcesHost.querySelector('[data-src-year]').value = 'all';
        sourcesHost.querySelector('[data-src-where]').value = 'all';
        sourcesHost.querySelectorAll('[data-src-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.srcKind === 'all')));
        draw(); return;
      }
      if (t.closest('[data-src-cite-all]')) { openDialog(); return; }
      if (t.closest('[data-src-all]')) { st.all = true; draw(); return; }
      const row = t.closest('[data-src-key]');
      if (!row) return;
      const item = byKey(row.dataset.srcKey);
      const refocus = sel => sourcesHost.querySelector('[data-src-key="' + item.key + '"] ' + sel)?.focus({ preventScroll: true });
      if (t.closest('[data-src-open]')) { const same = st.open === item.key; st.open = same ? '' : item.key; st.tab = 'where'; draw(); refocus('[data-src-open]'); return; }
      const tab = t.closest('[data-src-tab]');
      if (tab) { st.tab = tab.dataset.srcTab; draw(); refocus('[data-src-tab="' + st.tab + '"]'); return; }
      const fmt = t.closest('[data-src-format]');
      if (fmt) { st.format = fmt.dataset.srcFormat; draw(); refocus('[data-src-format="' + st.format + '"]'); return; }
      const copyButton = t.closest('[data-src-copy]');
      if (copyButton) { copy(copyButton, formatSource(item, st.format), 'Citation copied'); return; }
      const use = t.closest('[data-src-use]');
      if (use && openEssayAt) {
        const u = item.uses[Number(use.dataset.srcUse)];
        openEssayAt(u.essay, u.level, u.href, window.scrollY);
      }
    });
    draw();
    sourcesHost.has = id => items.some(item => item.id === id);
    /* "Show in Sources" needs the item drawn and open, whatever the filter. */
    sourcesHost.reveal = id => {
      const item = items.find(i => i.id === id);
      if (!item) return null;
      Object.assign(st, { kind: 'all', year: 'all', where: 'all', query: '', all: true, open: item.key, tab: 'where' });
      sourcesHost.querySelector('[data-src-q]').value = '';
      sourcesHost.querySelectorAll('[data-src-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.srcKind === 'all')));
      draw();
      return document.getElementById(id);
    };
    return items.length;
  }

  /* ---- Pop-over and back-to-reading ------------------------------------- */
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
  let popFrom = null, readingAt = null, popHover = false, hoverTimer = 0;

  /* `restore` hands focus back to the citation: on Escape and the close
     button, where the reader is still in the text. Not on a click elsewhere,
     which would pull focus off whatever was clicked. */
  function closePop(restore) {
    if (pop.hidden) return;
    pop.hidden = true;
    popFrom?.setAttribute('aria-expanded', 'false');
    if (restore) popFrom?.focus({ preventScroll: true });
    popFrom = null;
    popHover = false;
  }
  /* `hover` opens it as a preview: no focus moves, and leaving closes it. */
  function openPop(link, entry, sourceId, hover) {
    closePop(false);
    popFrom = link;
    popHover = !!hover;
    link.setAttribute('aria-expanded', 'true');
    const url = safeHttp(entry.url);
    const year = yearOf(entry.text);
    const kind = KINDS.find(([key]) => key === kindOf(entry.text, url));
    pop.innerHTML = '<div class="tq-pop__head"><p class="tq-pop__k"><span>' + esc(kind[1]) + '</span>' + (year ? '<span class="g-nums">' + year + '</span>' : '') + '</p>' +
      '<button class="tq-icon-btn tq-icon-btn--sm" type="button" data-pop-close aria-label="Close the reference">' + ICON.close + '</button></div>' +
      '<p class="tq-pop__t">' + esc(entry.text) + '</p>' +
      (url || sourceId ? '<div class="tq-pop__act">' +
        (sourceId ? '<button class="g-btn g-btn--primary g-btn--sm" type="button" data-pop-sources="' + esc(sourceId) + '"><span>Show in Sources</span>' + ICON.arrow + '</button>' : '') +
        (url ? '<a class="g-btn g-btn--secondary g-btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener"><span>Open the source</span>' + ICON.ext + '</a>' : '') +
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
    if (!hover) pop.focus({ preventScroll: true });
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
  pop.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
  pop.addEventListener('pointerleave', () => { if (popHover) hoverTimer = setTimeout(() => closePop(false), 260); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !pop.hidden) closePop(true);
  });
  document.addEventListener('click', event => {
    if (!pop.hidden && !pop.contains(event.target) && !event.target.closest('[data-cite]')) closePop(false);
  });
  /* Placed in page coordinates against the layout it opened in. */
  window.addEventListener('resize', () => closePop(false));
  /* The way back belongs to the trip to Sources. Opening any other section
     ends that trip, and the button with it. */
  document.addEventListener('gq:topic-section', event => {
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
    document.body.append(pop, backButton);
    const stored = readStore();
    const linked = /^#essay-(\d+)$/.exec(location.hash);
    const state = {
      essay: Math.max(0, found.findIndex(e => e.n === Number(linked ? linked[1] : stored.essay))),
      mode: stored.mode === 'depth' ? 'depth' : 'overview',
      level: stored.level || '',
      annotations: !!stored.annotations,
    };
    const several = found.length > 1;
    let notes = null, annotations = null, progressFrame = 0;

    /* Essays carry no picture, at the owner's request (2026-11-21): no
       cover in the picker and none behind the stage, which keeps its plain
       deep-space gradient. Until then each essay borrowed its own cover or
       a frame of the Topic's video. */

    host.innerHTML =
      '<div class="tq-elayout' + (several ? '' : ' is-single') + '">' +
      (several ? '<div class="tq-pick" role="list" aria-label="Essays in this Topic">' + found.map((essay, index) => {
        return '<a class="tq-pick__item tq-pick__item--essay" role="listitem" href="#essay-' + essay.n + '" data-essay-pick="' + index + '">' +
          '<span class="tq-pick__text"><small>Essay ' + essay.n + ' &middot; ' + minutes(essay.fullest.words) + ' min</small><b>' + esc(essay.title) + '</b></span></a>';
      }).join('') + '</div>' : '') +
      '<div class="tq-estage" data-essay-stage></div></div>' +
      '<div class="tq-modes" data-essay-modes></div>' +
      '<div class="tq-essay" data-essay-main></div>';
    const stageNode = host.querySelector('[data-essay-stage]');
    const modes = host.querySelector('[data-essay-modes]');
    const main = host.querySelector('[data-essay-main]');

    function levelFor(essay) {
      if (state.level && essay.levels[state.level]) return state.level;
      return essay.order.includes('undergrad') ? 'undergrad' : essay.order[essay.order.length - 1];
    }
    const levelLabel = key => (LEVELS.find(([k]) => k === key) || [key, key])[1];

    function drawStage(essay, level) {
      const text = essay.levels[level];
      const time = state.mode === 'overview' ? 'About 2 min' : minutes(text.words) + ' min';
      stageNode.innerHTML =
        '<span class="tq-estage__shade" aria-hidden="true"></span>' +
        '<div class="tq-estage__text" id="essay-' + essay.n + '"><p class="tq-estage__k">' + esc(essay.label) + (several ? ' of ' + found.length : '') + ' &middot; ' + esc(record?.topic_data?.tags?.[0] || 'AI in research') + '</p>' +
          '<h3>' + esc(essay.title) + '</h3><p class="tq-estage__sum">' + esc(firstParagraph(essay.plainest.html, 230)) + '</p></div>' +
        '<dl class="tq-estage__facts">' +
          (essay.published ? '<div><dt>Published</dt><dd>' + longDate(essay.published) + '</dd></div>' : '') +
          '<div><dt>Reading time</dt><dd>' + time + (state.mode === 'depth' ? ' &middot; ' + levelLabel(level) : '') + '</dd></div>' +
          '<div><dt>Levels</dt><dd>' + essay.order.map(levelLabel).join(', ') + '</dd></div></dl>';
    }

    function drawModes(essay, level, count) {
      const depth = state.mode === 'depth';
      modes.innerHTML =
        '<div class="tq-tabs" role="tablist" aria-label="Reading mode">' +
          '<button type="button" role="tab" id="tab-overview" aria-controls="essay-panel" aria-selected="' + !depth + '" tabindex="' + (depth ? -1 : 0) + '" data-mode="overview">Summary</button>' +
          '<button type="button" role="tab" id="tab-depth" aria-controls="essay-panel" aria-selected="' + depth + '" tabindex="' + (depth ? 0 : -1) + '" data-mode="depth">In depth</button></div>' +
        (depth && essay.order.length > 1 ? '<div class="depth" role="group" aria-label="Reading level">' + LEVELS.filter(([key]) => essay.levels[key]).map(([key, label, note]) =>
          '<button type="button" data-level="' + key + '" aria-pressed="' + (key === level) + '" title="' + esc(note) + '">' + label + '</button>').join('') + '</div>' : '') +
        (depth ? '<button class="g-btn g-btn--ghost g-btn--sm tq-modes__anno" type="button" data-an-toggle aria-pressed="' + state.annotations + '">' + ICON.pen + '<span>Annotations</span><b class="tq-modes__n g-nums" data-an-count>' + (count == null ? '·' : count) + '</b></button>' : '') +
        '<p class="tq-modes__note">' + (depth ? esc((LEVELS.find(([key]) => key === level) || [])[2] || '') + '. Select any passage to ask Pulsar or annotate it.' : 'A short summary. Choose In depth for the full text and the reading levels.') + '</p>';
    }

    function draw(focusSwitch) {
      const essay = found[state.essay];
      const level = levelFor(essay);
      const text = essay.levels[level];
      host.querySelectorAll('[data-essay-pick]').forEach(link => {
        if (Number(link.dataset.essayPick) === state.essay) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      drawStage(essay, level);
      drawModes(essay, level, null);
      const wholeKey = SLUG + '-essay-' + essay.n;
      main.innerHTML = '<div id="essay-panel" role="tabpanel" aria-labelledby="' + (state.mode === 'depth' ? 'tab-depth' : 'tab-overview') + '">' +
        (state.mode === 'overview'
          ? overview(essay)
          : '<div class="tq-readwrap' + (state.annotations ? ' is-annotating' : '') + '" data-readwrap>' +
              '<article class="g-prose tq-reader" data-reader aria-label="' + esc(essay.title) + ', ' + esc(levelLabel(level)) + ' level">' + readerMarkup(text, essay.n) + '</article>' +
              '<aside class="tq-apanel" data-apanel aria-label="Annotations" hidden></aside></div>') +
        endBlock(essay) + '</div>';
      /* Citations open their reference in both modes. Overview carries them
         too (its summary and its boxes are the essay's own text). */
      main.querySelectorAll('a[href^="#"]').forEach(link => {
        if (!/-ref-/.test(link.getAttribute('href'))) return;
        link.dataset.cite = '';
        link.setAttribute('aria-haspopup', 'dialog');
        link.setAttribute('aria-expanded', 'false');
      });
      annotations = null;
      if (state.mode === 'depth' && window.GQAnnotations) {
        const article = main.querySelector('[data-reader]');
        annotations = window.GQAnnotations.attach({
          slug: SLUG, essay: essay.n, title: essay.title, level, levelLabel: levelLabel(level),
          article, panel: main.querySelector('[data-apanel]'), scopeRoot: main, wholeKey, open: state.annotations,
          onCount: n => { const badge = modes.querySelector('[data-an-count]'); if (badge) badge.textContent = n; },
          onOpen: open => {
            state.annotations = open;
            main.querySelector('[data-readwrap]')?.classList.toggle('is-annotating', open);
            modes.querySelector('[data-an-toggle]')?.setAttribute('aria-pressed', String(open));
            writeStore({ essay: essay.n, mode: state.mode, level: state.level, annotations: open });
          },
        });
      } else if (window.GQAnnotations) {
        window.GQAnnotations.askOnly(main, essay.title);
      }
      wireEnd(essay, wholeKey);
      railFor(essay);
      if (focusSwitch) modes.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
      writeStore({ essay: essay.n, mode: state.mode, level: state.level, annotations: state.annotations });
    }

    /* The rail: the essays, and under the open one its sections while it is
       read in depth, with how far down the reader is. */
    function railFor(essay) {
      if (!window.GQTopicToc) return;
      const article = main.querySelector('[data-reader]');
      const sections = article ? sectionsOf(article) : [];
      window.GQTopicToc.set('essay', found.length, found.map(e => ({
        label: e.title, href: '#essay-' + e.n, current: e.n === essay.n,
        children: e.n === essay.n && sections.length ? sections.map(s => ({ label: s.label, href: '#' + s.id })) : null,
        progress: e.n === essay.n && sections.length,
      })));
      trackProgress();
    }
    function trackProgress() {
      cancelAnimationFrame(progressFrame);
      progressFrame = requestAnimationFrame(() => {
        const article = main.querySelector('[data-reader]');
        if (!article || !article.isConnected || !window.GQTopicToc || window.GQTopicToc.current() !== 'essay') return;
        const box = article.getBoundingClientRect();
        const total = Math.max(1, box.height - window.innerHeight * 0.5);
        const pct = Math.round(Math.min(1, Math.max(0, (window.innerHeight * 0.3 - box.top) / total)) * 100);
        let active = '';
        article.querySelectorAll('h4[id]').forEach(h => { if (h.getBoundingClientRect().top <= window.innerHeight * 0.3) active = h.id; });
        window.GQTopicToc.progress('essay', pct, active ? '#' + active : '');
      });
    }
    window.addEventListener('scroll', trackProgress, { passive: true });

    /* For Sources: open an essay at a level and bring a citation into view. */
    openEssayAt = (essayN, level, href, fromY) => {
      const index = found.findIndex(e => e.n === essayN);
      if (index < 0) return;
      state.essay = index; state.mode = 'depth'; state.level = level;
      if (window.GQTopicToc) {
        if (location.hash !== '#essay') history.pushState(null, '', '#essay');
        window.GQTopicToc.show('essay', false);
      }
      draw();
      const link = main.querySelector('[data-reader] a[href="' + CSS.escape(href) + '"]');
      const block = link?.closest('p, li, figcaption') || link;
      if (block) {
        block.scrollIntoView({ block: 'center', behavior: 'instant' });
        block.classList.remove('is-flash'); void block.offsetWidth; block.classList.add('is-flash');
        setTimeout(() => block.classList.remove('is-flash'), 1800);
      }
      if (fromY != null) {
        /* The way back from here is to Sources. */
        readingAt = null;
      }
    };

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
        if (mode.dataset.modeGo) modes.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      const level = event.target.closest('[data-level]');
      if (level) {
        state.level = level.dataset.level;
        draw();
        modes.querySelector('[data-level="' + state.level + '"]')?.focus({ preventScroll: true });
        return;
      }
      if (event.target.closest('[data-an-toggle]')) { if (annotations) annotations.toggle(); return; }
      const cite = event.target.closest('[data-cite]');
      if (cite) {
        event.preventDefault();
        clearTimeout(hoverTimer);
        if (!pop.hidden && popFrom === cite && !popHover) { closePop(); return; }
        showCite(cite, false);
      }
    });
    /* The tabs move with the arrow keys, as a tab list does. */
    modes.addEventListener('keydown', event => {
      if (!event.target.matches('[role="tab"]') || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) return;
      event.preventDefault();
      state.mode = state.mode === 'overview' ? 'depth' : 'overview';
      draw(true);
    });

    function showCite(cite, hover) {
      const id = cite.getAttribute('href').slice(1);
      /* In depth, the references are on the page. In Overview they are
         not, so the entry is read from the essay's published levels. */
      const essayNow = found[state.essay];
      const anchor = document.getElementById(id) || essayNow.order
        .map(key => fragment(essayNow.levels[key].html).getElementById(id))
        .find(Boolean);
      const entry = entryFor(anchor);
      if (!entry) { if (!hover) anchor?.scrollIntoView(); return; }
      const sourceId = 'src-e' + essayNow.n + '-' + id.replace(/^.*?-ref-/, 'ref-');
      openPop(cite, entry, sourcesHost?.has?.(sourceId) ? sourceId : '', hover);
    }
    /* A preview on hover, for a mouse; the click still opens it to keep. */
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      main.addEventListener('pointerover', event => {
        const cite = event.target.closest('[data-cite]');
        if (!cite || (popFrom === cite && !pop.hidden)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => { if (pop.hidden || popHover) showCite(cite, true); }, 160);
      });
      main.addEventListener('pointerout', event => {
        const cite = event.target.closest('[data-cite]');
        if (!cite || (event.relatedTarget && (cite.contains(event.relatedTarget) || pop.contains(event.relatedTarget)))) return;
        clearTimeout(hoverTimer);
        if (popHover) hoverTimer = setTimeout(() => closePop(false), 260);
      });
    }

    /* ---- The end of an essay ---------------------------------------------- */
    function endBlock(essay) {
      return '<section class="tq-end" aria-labelledby="end-' + essay.n + '">' +
        '<div class="tq-end__head"><span class="tq-end__line" aria-hidden="true"></span><div><h4 id="end-' + essay.n + '">You reached the end</h4>' +
        '<p>Say whether it was useful, say what you think of the whole essay, and read what other readers said.</p></div></div>' +
        '<div class="tq-useful" data-useful>' +
          '<div class="tq-useful__q"><b>Was this essay useful to you?</b><span data-react-say>One tap tells the next reader where to start.</span></div>' +
          '<div class="tq-useful__btns">' +
            '<button class="tq-useful__btn is-up" type="button" data-react="useful" aria-pressed="false">' + ICON.up + '<b class="g-nums" data-react-n="useful">&ndash;</b><span>Useful</span></button>' +
            '<button class="tq-useful__btn is-down" type="button" data-react="not_useful" aria-pressed="false">' + ICON.down + '<b class="g-nums" data-react-n="not_useful">&ndash;</b><span>Not for me</span></button></div>' +
          '<div class="tq-useful__meter" data-react-meter hidden><span class="tq-useful__bar" aria-hidden="true"><i></i></span><p data-react-sum role="status"></p></div>' +
        '</div>' +
        '<div class="tq-wholenotes" data-whole-notes></div>' +
        '<div class="tq-actions"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-share-essay>' + ICON.share + '<span>Share this essay</span></button>' +
        '<a class="g-btn g-btn--primary g-btn--sm" href="#talk" data-room-jump="essays">' + ICON.talk + '<span>Discuss the essays</span></a></div></section>';
    }

    function burst(button) {
      if (reduce()) return;
      const spray = document.createElement('span');
      spray.className = 'tq-burst';
      spray.setAttribute('aria-hidden', 'true');
      spray.innerHTML = Array.from({ length: 10 }, (_, i) => '<i style="--a:' + (i * 36) + 'deg;--d:' + (30 + (i % 3) * 9) + 'px"></i>').join('');
      button.append(spray);
      setTimeout(() => spray.remove(), 700);
    }

    function wireEnd(essay, wholeKey) {
      const useful = main.querySelector('[data-useful]');
      const url = API + essay.n + '/reaction/';
      function paint(reaction, popped) {
        useful.querySelectorAll('[data-react]').forEach(button => {
          const on = reaction.selected === button.dataset.react;
          button.setAttribute('aria-pressed', String(on));
          if (on && popped === button.dataset.react) { button.classList.remove('is-pop'); void button.offsetWidth; button.classList.add('is-pop'); burst(button); }
        });
        useful.querySelector('[data-react-n="useful"]').textContent = reaction.useful;
        useful.querySelector('[data-react-n="not_useful"]').textContent = reaction.not_useful;
        const total = reaction.useful + reaction.not_useful;
        const meter = useful.querySelector('[data-react-meter]');
        meter.hidden = !total;
        useful.querySelector('[data-react-say]').textContent = reaction.selected
          ? (reaction.selected === 'useful' ? 'Thank you. You can change your answer.' : 'Thank you. Tell us why in a note below.')
          : 'One tap tells the next reader where to start.';
        if (total) {
          const pct = Math.round(reaction.useful / total * 100);
          meter.querySelector('i').style.width = pct + '%';
          useful.querySelector('[data-react-sum]').textContent = pct + '% of ' + plural(total, 'reader', 'readers') + ' found it useful';
        }
      }
      getJSON(url).then(data => paint(data.reaction)).catch(() => { useful.querySelector('[data-react-say]').textContent = 'Answers could not be loaded just now.'; });
      useful.addEventListener('click', event => {
        const button = event.target.closest('[data-react]');
        if (!button) return;
        const value = button.getAttribute('aria-pressed') === 'true' ? '' : button.dataset.react;
        useful.querySelectorAll('[data-react]').forEach(b => { b.disabled = true; });
        post(url, { value }).then(data => paint(data.reaction, value))
          .catch(() => { useful.querySelector('[data-react-say]').textContent = 'Your answer could not be saved. Try again.'; })
          .finally(() => useful.querySelectorAll('[data-react]').forEach(b => { b.disabled = false; }));
      });
      main.querySelector('[data-share-essay]').addEventListener('click', event => {
        const link = location.href.split('#')[0] + '#essay-' + essay.n;
        if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title: essay.title, url: link }).catch(() => {}); return; }
        copy(event.currentTarget, link, 'Link copied');
      });
      const holder = main.querySelector('[data-whole-notes]');
      if (window.GQTalk) {
        notes = window.GQTalk.mount(holder, {
          key: wholeKey, scope: 'whole', title: 'What readers said about the whole essay', titleTag: 'h4', collapsible: true, layout: 'grid',
          label: 'Comment on the whole essay', placeholder: 'What did this essay change for you, or leave out?', button: 'Post note',
          hint: 'Not tied to one passage. Members can post; a moderator reads every note first.',
          empty: 'No notes on the whole essay yet. The first one sets the tone.',
          signInWhat: 'post a note',
        });
      }
    }

    draw();
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
    document.addEventListener('gq:topic-section', event => { if (event.detail.id === 'essay') trackProgress(); });
  }

  /* The record first: the page needs its sources, and the
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
