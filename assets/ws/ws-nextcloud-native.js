import * as P from './ws-platform.js?v=20260914-7';
import * as K from './ws-admin-kit.js?v=20261002-admin1';
import { renderNoteMarkdown, plainNoteText } from './ws-notes-markdown.js?v=20261002-notebook1';

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const selections = new Map();
const router = { installed: false, scheduled: false };

function route() {
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/workspace/core/notes') return { kind: 'notes', space: 'core', title: 'Core Notes', area: 'Core' };
  if (path === '/workspace/research/notes' || path === '/workspace/research/editor') {
    return { kind: 'notes', space: 'research', title: 'Research Notes', area: 'Research' };
  }
  if (path === '/workspace/core/admin/nextcloud') {
    return { kind: 'admin', title: 'Nextcloud Mirror', area: 'Core Admin' };
  }
  return null;
}

function action(text, handler, { solid = false, tiny = false } = {}) {
  const button = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, text);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function setCrumbs(info) {
  const host = $('#ws-crumbs');
  if (!host) return;
  host.innerHTML = '';
  const parent = el('span', 'ws-crumbs__plain', info.area);
  const sep = el('span', 'ws-crumbs__sep', '/');
  const here = el('span', 'ws-crumbs__here', info.kind === 'admin' ? 'Nextcloud Mirror' : 'Notes');
  host.append(parent, sep, here);
}

function openNative(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function syncSummary(data) {
  const counts = data?.sync?.counts || data?.counts || {};
  const bits = [];
  for (const [key, label] of [
    ['created', 'created'], ['pushed', 'pushed'], ['pulled', 'pulled'], ['adopted', 'adopted'], ['deleted', 'deleted'], ['conflicts', 'conflicts'],
  ]) {
    if (Number(counts[key] || 0)) bits.push(`${counts[key]} ${label}`);
  }
  return bits.length ? bits.join(' · ') : 'Everything is mirrored.';
}

function navTo(path) {
  if (path === location.pathname) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  dispatchEvent(new CustomEvent('ws:navigate'));
}

/* The Mirror is not in five-layer's ADMIN_INDEX, so it is added here. It is
   built the way indexButton() builds an entry — series, hint, direct text
   node for the name — because an entry without them fell outside the
   index's own styling and read as a stray heading between Activity and
   Deck. */
function injectAdminMirrorEntry() {
  if (!P.isCoreAdmin() || !location.pathname.startsWith('/workspace/core/admin')) return;
  const nav = $('.fl-index-nav');
  if (!nav || nav.querySelector('[data-nextcloud-mirror-link]')) return;
  const button = el('button', 'fl-index-link');
  button.type = 'button';
  button.dataset.nextcloudMirrorLink = '1';
  button.dataset.series = '3';
  const glyph = el('span', 'fl-index-link__icon');
  glyph.innerHTML = window.GravitasIcons?.icon('storage', 'g-wi') || '';
  button.append(glyph, document.createTextNode('Nextcloud Mirror'));
  if ($('.fl-index-link__hint', nav)) {
    button.append(el('span', 'fl-index-link__hint', 'Files, Notes and Deck in sync'));
    button.dataset.hinted = '';
  }
  if (location.pathname.replace(/\/$/, '') === '/workspace/core/admin/nextcloud') button.setAttribute('aria-current', 'page');
  button.addEventListener('click', () => navTo('/workspace/core/admin/nextcloud'));
  const named = (node, pattern) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && pattern.test(child.nodeValue));
  const deck = [...nav.children].find((node) => named(node, /Deck/));
  if (deck) deck.before(button);
  else nav.append(button);
}

/* ---- Platform Admin · Nextcloud Mirror ------------------------------------
   Drawn with ws-admin-kit.js like every other Platform Admin screen: the
   shared page head, a tile per surface, the four surfaces as cards on the
   bento and the mirror contract as a list. It used to be the Notes
   screen's `nc-` shell with an eyebrow and a card style of its own. */
function mirrorCard(title, state, tone, detail, badges = [], tools = []) {
  const card = K.card({ title, note: detail, span: 6, actions: [K.badge(state, tone)] });
  const chips = badges.filter(Boolean);
  if (chips.length) card.body.append(K.cardActions(chips.map((value) => K.badge(String(value)))));
  const buttons = tools.filter(Boolean);
  if (buttons.length) card.body.append(K.cardActions(buttons));
  return card;
}

async function renderMirrorAdmin(host, info) {
  if (!P.isCoreAdmin()) {
    location.replace('/workspace/dashboard');
    return;
  }
  K.loading(host, info.title, { tiles: 4, cards: [6, 6] });
  let cloudData = null;
  let notesData = null;
  let deckData = null;
  try {
    const results = await Promise.allSettled([
      P.call('/platform/nextcloud/'),
      P.call('/platform/nextcloud/notes/'),
      P.call('/platform/admin/deck/'),
    ]);
    if (results.every((result) => result.status === 'rejected')) throw results[0].reason;
    cloudData = results[0].status === 'fulfilled' ? results[0].value : null;
    notesData = results[1].status === 'fulfilled' ? results[1].value : null;
    deckData = results[2].status === 'fulfilled' ? results[2].value : null;
  } catch (error) {
    K.failure(host, info.title, error, () => renderMirrorAdmin(host, info));
    return;
  }

  const doc = K.page(host, {
    title: info.title,
    meta: 'Gravitas and Nextcloud are two synchronized surfaces of one workspace: Files and Team Folders for storage, Notes for writing, Deck for execution.',
    actions: [
      action('Open Nextcloud', () => openNative(cloudData?.nextcloud?.url), { solid: true }),
      action('Refresh status', () => renderMirrorAdmin(host, info)),
    ],
  });

  const projectCount = cloudData?.projects?.length || 0;
  const identityReady = !!cloudData?.nextcloud?.identity_ready;
  const noteItems = notesData?.items || [];
  const noteStates = noteItems.reduce((acc, item) => {
    const key = item.sync_state || 'pending';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const enabledApps = new Set((cloudData?.nextcloud?.apps || []).map((app) => app.id));

  doc.append(K.tiles([
    K.tile({ value: projectCount, label: 'Project mounts', icon: 'storage', featured: true, note: identityReady ? 'Identity connected' : 'Identity pending' }),
    K.tile({ value: noteItems.length, label: 'Mapped notes', icon: 'notes', note: noteStates.conflict ? `${noteStates.conflict} conflicts preserved` : 'No conflicts' }),
    K.tile({ value: deckData?.task_count ?? 0, label: 'Core tasks in Deck', icon: 'board', note: deckData?.available ? 'Mirrored' : 'Not mirrored' }),
    K.tile({ value: enabledApps.size, label: 'Native apps', icon: 'space-core', note: 'Enabled in Nextcloud' }),
  ]));

  const files = mirrorCard(
    'Files & Team Folders',
    cloudData ? (identityReady ? 'Mirrored' : 'Identity pending') : 'Unavailable',
    cloudData ? (identityReady ? 'ok' : 'warn') : 'bad',
    'Research project folders, files, object ACLs and membership are reflected in native Nextcloud storage.',
    [identityReady ? `Identity ${cloudData.nextcloud.username}` : '', `${projectCount} visible project mounts`],
    [cloudData?.nextcloud?.files_url ? action('Open Files', () => openNative(cloudData.nextcloud.files_url), { tiny: true }) : null],
  );

  const noteState = !notesData ? ['Unavailable', 'bad'] : (noteStates.conflict ? ['Conflict', 'bad'] : noteStates.error ? ['Retrying', 'warn'] : ['Mirrored', 'ok']);
  const syncNotes = action('Sync Notes now', async () => {
    syncNotes.disabled = true;
    syncNotes.textContent = 'Syncing…';
    try {
      await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
      await renderMirrorAdmin(host, info);
    } catch (error) {
      syncNotes.textContent = error?.message || 'Sync failed';
      syncNotes.disabled = false;
    }
  }, { tiny: true });
  const notes = mirrorCard(
    'Notes', noteState[0], noteState[1],
    'Core and Research notes use the official Nextcloud Notes app as a native writing surface while staying indexed in Gravitas for links, search and AI.',
    [`${noteItems.length} mapped notes`, noteStates.conflict ? `${noteStates.conflict} conflicts preserved` : '', noteStates.error ? `${noteStates.error} retrying` : ''],
    [syncNotes, action('Open Notes', () => openNative(notesData?.native_url), { tiny: true })],
  );

  const deckState = !deckData ? ['Unavailable', 'bad'] : (deckData.available ? ['Mirrored', 'ok'] : deckData.configured ? ['Unavailable', 'bad'] : ['Not configured', 'warn']);
  const syncDeck = action('Reconcile Deck', async () => {
    syncDeck.disabled = true;
    syncDeck.textContent = 'Reconciling…';
    try {
      const result = await P.call('/platform/admin/deck/sync/', { method: 'POST' });
      const c = result.changes || {};
      syncDeck.textContent = c.conflicts ? `${c.conflicts} conflicts preserved` : 'Reconciled';
      setTimeout(() => renderMirrorAdmin(host, info), 700);
    } catch (error) {
      syncDeck.textContent = error?.data?.detail || error?.message || 'Sync failed';
      syncDeck.disabled = false;
    }
  }, { tiny: true });
  if (!deckData?.configured) syncDeck.disabled = true;
  const deck = mirrorCard(
    'Deck', deckState[0], deckState[1],
    'Core tasks mirror to Deck in both directions for execution fields: title, lane/status and due date. Concurrent edits are preserved as conflicts instead of overwritten.',
    [deckData?.mirror_mode === 'bidirectional-execution' ? 'Two-way execution' : '', deckData?.task_count != null ? `${deckData.task_count} Core tasks` : ''],
    [syncDeck, action('Open Deck', () => openNative(deckData?.board?.url), { tiny: true })],
  );

  const identity = mirrorCard(
    'Identity, SSO & native apps',
    identityReady ? 'Connected' : 'Pending', identityReady ? 'ok' : 'warn',
    'The same Gravitas account maps to a Nextcloud identity. Project access becomes Nextcloud groups and Team Folder ACLs instead of a second manual permission system.',
    [enabledApps.has('notes') ? 'Notes' : '', enabledApps.has('deck') ? 'Deck' : '', enabledApps.has('groupfolders') ? 'Team Folders' : '', enabledApps.has('collectives') ? 'Collectives' : '', enabledApps.has('spreed') ? 'Talk' : ''],
  );

  const contract = K.card({ title: 'Mirror contract', note: 'What each surface owns, and how it is kept in step.' });
  const rows = [
    ['Files / Team Folders', 'Files, project folders, storage paths and project ACLs', 'Bidirectional storage + ACL reconciliation'],
    ['Notes', 'Core and Research personal notes', 'Bidirectional with ETag conflict protection'],
    ['Deck', 'Core task title, execution lane/status and due date', 'Bidirectional safe execution fields'],
    ['Gravitas only', 'LMS rules, certificates, research metadata, cross-layer links, audit history and object policies', 'Canonical relational context; linked to native Nextcloud objects rather than flattened into them'],
  ];
  contract.body.append(K.list(rows.map(([surface, data, mode], index) => K.row({
    title: surface, meta: mode, body: data,
    lead: K.avatar(surface, { mark: ['storage', 'notes', 'board', 'space-core'][index], series: (index % 4) + 1 }),
  }))));

  doc.append(K.bento([files.box, notes.box, deck.box, identity.box, contract.box]));
}

/* ---- Research and Core Notes · the notebook --------------------------------
   Notes used to be a dashboard page: a page head, four stat tiles, the Space
   Markdown index as a long panel above everything, and then two cards — a
   list and a bordered monospace textarea — a scroll below the fold. A
   researcher who opened Notes to write had to find the place to write first,
   and opening a note re-fetched and redrew the whole page, skeleton and all.

   It is now a notebook in the manner of Obsidian or Notion: the notes on the
   left, and the open note filling the rest of the pane as a page — a large
   title, one quiet line of facts, and the body, borderless, at a reading
   width, with a Read view that renders the Markdown. The data contract did
   not change. The same routes are called, conflicts are still shown and
   still resolved by an explicit choice, and ws-notes-performance.js still
   reconciles with Nextcloud in the background. What changed is that the page
   is laid out for writing rather than for reporting on writing.

   Three decisions carry it:
   - Notes are fetched once per visit and kept per space. Choosing a note
     redraws the editor pane from that state and never goes to the network.
     A refresh after a background sync updates the list in place, and leaves
     an editor alone while it holds unsaved text or the caret.
   - The stat tiles are gone. What they counted is in the list, where it can
     be acted on: a Pinned group, and a dot on a note that needs attention.
     "Pending" is not attention — every note is pending for a moment after
     each edit, and a dot that flickers on every keystroke means nothing.
   - The Space index is a view of the main pane, opened from the sidebar.
     ws-space-integration.js fills it when it is opened, instead of walking
     every managed Markdown file in Nextcloud before the first note shows.
   ------------------------------------------------------------------------- */

const notebooks = new Map();
const book = {
  info: null, root: null, data: null, items: [],
  mode: 'edit', query: '', view: 'note', refs: {}, editor: null,
};

const SYNC = {
  synced: ['Mirrored to Nextcloud', 'ok'],
  pending: ['Waiting to mirror', 'quiet'],
  error: ['Mirror will retry', 'warn'],
  conflict: ['Changed in both places', 'bad'],
  readonly: ['Read only in Nextcloud', 'quiet'],
  blocked: ['Outside your access', 'bad'],
};

const same = (a, b) => a != null && b != null && String(a) === String(b);
const syncOf = (item) => SYNC[item?.sync_state || 'pending'] || [String(item?.sync_state), 'quiet'];
const needsAttention = (item) => ['error', 'conflict', 'blocked'].includes(item?.sync_state);
const stamp = (value) => Date.parse(value || '') || 0;

function glyph(name) {
  const node = el('span', 'nb-glyph');
  node.innerHTML = window.GravitasIcons?.icon(name, 'g-wi') || '';
  return node;
}

function iconButton(name, label, handler, cls = '') {
  const button = el('button', `nb-ibtn${cls ? ` ${cls}` : ''}`);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(glyph(name));
  if (handler) button.addEventListener('click', handler);
  return button;
}

function ago(value) {
  const at = stamp(value);
  if (!at) return '';
  const seconds = (Date.now() - at) / 1000;
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return relative.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return relative.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 6 * 86400) return relative.format(-Math.round(seconds / 86400), 'day');
  const date = new Date(at);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: thisYear ? undefined : 'numeric' }).format(date);
}

function fullDate(value) {
  const at = stamp(value);
  return at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(at)) : '';
}

/* The preview under a title is the note's first words, without repeating
   the title when the body opens with it — Nextcloud Notes writes the title
   as the first line of the file, so most mirrored notes do. */
function snippetOf(item) {
  let text = plainNoteText(item.content);
  const title = String(item.title || '').trim();
  if (title && text.toLowerCase().startsWith(title.toLowerCase())) text = text.slice(title.length).trim();
  return text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text;
}

function wordCount(text) {
  const plain = plainNoteText(text);
  return plain ? plain.split(/\s+/).length : 0;
}

function remember() {
  if (book.info) notebooks.set(book.info.space, { data: book.data, items: book.items });
}

function current() {
  return book.items.find((item) => same(item.id, selections.get(book.info?.space)));
}

function setStatus(text, tone = '') {
  const node = book.refs.status;
  if (!node) return;
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute('data-tone');
}

function frame(host, info) {
  book.editor?.destroy();
  book.editor = null;
  host.innerHTML = '';
  const root = el('div', 'nc-notes nb');
  root.dataset.space = info.space;
  root.dataset.pane = 'list';
  const side = el('aside', 'nb-side');
  side.setAttribute('aria-label', `${info.area} notes`);
  const main = el('section', 'nb-main');
  main.setAttribute('aria-label', 'Note');
  root.append(side, main);
  host.append(root);
  return { root, side, main };
}

function loadingNotebook(host, info) {
  const { root, side, main } = frame(host, info);
  root.dataset.loading = '';
  root.setAttribute('aria-busy', 'true');
  for (let i = 0; i < 5; i += 1) side.append(el('div', 'nb-skel nb-skel--row'));
  const page = el('div', 'nb-page');
  page.append(el('div', 'nb-skel nb-skel--title'));
  for (let i = 0; i < 4; i += 1) page.append(el('div', 'nb-skel nb-skel--line'));
  main.append(page);
}

function failedNotebook(host, info, error) {
  const { main } = frame(host, info);
  const box = el('div', 'nb-empty');
  box.append(glyph('alert'));
  box.append(el('h2', 'nb-empty__title', 'Notes could not be loaded.'));
  box.append(el('p', 'nb-empty__text', error?.message || 'The Nextcloud mirror did not answer. Saved Gravitas data was not deleted.'));
  box.append(action('Retry', () => renderNativeNotes(host, info), { solid: true }));
  main.append(box);
}

function mountNotebook(host, info, state) {
  const { root, side, main } = frame(host, info);
  book.editor = null;
  Object.assign(book, { info, root, data: state.data, items: state.items, view: 'note' });

  const head = el('div', 'nb-side__head');
  const name = el('div', 'nb-side__name');
  name.append(el('span', 'nb-side__eyebrow', info.area), el('h1', 'nb-side__title', 'Notes'));
  const create = el('button', 'nb-new');
  create.type = 'button';
  create.title = 'New note';
  create.append(glyph('plus'), el('span', null, 'New'));
  create.addEventListener('click', () => createNote(create));
  head.append(name, create);

  const searchWrap = el('label', 'nb-search');
  const search = el('input', 'nb-search__input');
  search.type = 'search';
  search.placeholder = 'Search notes or #tag';
  search.setAttribute('aria-label', 'Search notes');
  search.value = book.query;
  search.addEventListener('input', () => { book.query = search.value; drawList(); });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      search.value = '';
      book.query = '';
      drawList();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      book.refs.list.querySelector('.nb-row')?.focus();
    }
  });
  searchWrap.append(glyph('search'), search);

  const list = el('nav', 'nb-list');
  list.setAttribute('aria-label', `${info.area} notes`);
  list.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const rows = [...list.querySelectorAll('.nb-row')];
    const at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && at === 0) search.focus();
    else rows[Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  });

  const foot = el('div', 'nb-side__foot');
  const status = el('p', 'nb-sync-status');
  status.setAttribute('role', 'status');
  const tools = el('div', 'nb-side__tools');
  const sync = iconButton('cycle', 'Sync with Nextcloud now', async () => {
    sync.disabled = true;
    sync.dataset.busy = '';
    setStatus('Reconciling with Nextcloud…');
    book.editor?.flush();
    try {
      const result = await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
      setStatus(syncSummary(result));
      await refreshNotebook(info);
    } catch (error) {
      setStatus(error?.message || 'Sync failed. It will retry automatically.', 'bad');
    } finally {
      sync.disabled = false;
      delete sync.dataset.busy;
    }
  });
  const index = iconButton('files', 'Space index', () => {
    book.editor?.flush();
    book.view = book.view === 'index' ? 'note' : 'index';
    root.dataset.pane = 'note';
    drawList();
    drawMain();
  });
  tools.append(sync, index);
  if (info.space === 'research') tools.append(iconButton('calendar', 'Calendar', () => navTo('/workspace/research/calendar')));
  tools.append(iconButton('external', 'Open Nextcloud Notes', () => openNative(book.data?.native_url)));
  foot.append(status, tools);

  side.append(head, searchWrap, list, foot);
  book.refs = { root, side, main, list, search, status, index };
  setStatus(book.data?.available === false
    ? 'Nextcloud is unavailable. Notes save here and mirror later.'
    : syncSummary(book.data), book.data?.available === false ? 'warn' : '');

  root.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'e' && book.editor) {
      event.preventDefault();
      book.editor.toggleMode();
    } else if (key === 's') {
      event.preventDefault();
      book.editor?.flush();
    }
  });

  if (!current() && book.items.length) selections.set(info.space, [...book.items].sort((a, b) => stamp(b.updated) - stamp(a.updated))[0].id);
  if (current()) root.dataset.pane = 'note';
  drawList();
  drawMain();
}

async function refreshNotebook(info) {
  let data;
  try {
    data = await P.call('/platform/nextcloud/notes/');
  } catch {
    setStatus('Could not refresh. Showing the notes already loaded.', 'warn');
    return;
  }
  if (!book.root?.isConnected || book.info?.space !== info.space) return;
  applyData(data);
}

function applyData(data) {
  const { space } = book.info;
  const editor = book.editor;
  const busy = !!editor && (editor.dirty() || editor.focused());
  const local = busy ? book.items.find((item) => same(item.id, editor.id)) : null;
  const fresh = (Array.isArray(data.items) ? data.items : []).filter((item) => item.space === space);
  book.items = fresh.map((item) => (local && same(item.id, local.id) ? local : item));
  book.data = data;
  remember();
  setStatus(data.available === false ? 'Nextcloud is unavailable. Notes save here and mirror later.' : syncSummary(data));
  drawList();
  if (busy || book.view !== 'note') return;
  const selected = current();
  if (!editor || !selected || !same(selected.id, editor.id) || !editor.shows(selected)) drawMain();
}

function noteRow(item, active) {
  const row = el('button', 'nb-row');
  row.type = 'button';
  if (active) row.setAttribute('aria-current', 'page');
  const top = el('span', 'nb-row__top');
  const title = el('span', 'nb-row__title', String(item.title || '').trim() || 'Untitled');
  title.dir = 'auto';
  top.append(title);
  if (needsAttention(item)) {
    const dot = el('span', 'nb-dot');
    dot.dataset.state = item.sync_state;
    dot.title = syncOf(item)[0];
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', syncOf(item)[0]);
    top.append(dot);
  }
  const preview = snippetOf(item);
  const snippet = el('span', 'nb-row__snippet', preview || 'Empty note');
  snippet.dir = 'auto';
  if (!preview) snippet.dataset.empty = '';
  const context = item.project_title
    ? `${item.project_title} · `
    : item.scope === 'shared' ? 'Shared · ' : 'Personal · ';
  const when = el('span', 'nb-row__when', `${context}${ago(item.updated)}`);
  when.title = item.project_title
    ? `${item.project_title} · ${fullDate(item.updated)}`
    : `${item.scope === 'shared' ? 'Shared' : 'Personal'} note · ${fullDate(item.updated)}`;
  row.append(top, snippet, when);
  row.addEventListener('click', () => choose(item.id));
  return row;
}

function drawList() {
  const { list } = book.refs;
  if (!list) return;
  list.innerHTML = '';
  book.refs.index?.setAttribute('aria-pressed', String(book.view === 'index'));
  if (!book.items.length) {
    list.append(el('p', 'nb-list__empty', 'No notes yet. Start one with New.'));
    return;
  }
  const query = book.query.trim().toLowerCase();
  const sorted = [...book.items].sort((a, b) => stamp(b.updated) - stamp(a.updated));
  const matches = query
    ? sorted.filter((item) => `${item.title || ''}\n${item.content || ''}\n${item.project_title || ''}`.toLowerCase().includes(query))
    : sorted;
  if (!matches.length) {
    list.append(el('p', 'nb-list__empty', `Nothing matches “${book.query.trim()}”.`));
    return;
  }
  const selectedId = book.view === 'note' ? selections.get(book.info.space) : null;
  const group = (label, rows) => {
    if (!rows.length) return;
    const section = el('div', 'nb-group');
    const heading = el('h2', 'nb-group__label', label);
    heading.append(el('span', 'nb-group__count', String(rows.length)));
    section.append(heading);
    rows.forEach((item) => section.append(noteRow(item, same(item.id, selectedId))));
    list.append(section);
  };
  group('Pinned', matches.filter((item) => item.favorite));
  const ordinary = matches.filter((item) => !item.favorite);
  if (query) {
    group('Results', ordinary);
    return;
  }
  group('Personal', ordinary.filter((item) => !item.project_id && item.scope !== 'shared'));
  group('Shared', ordinary.filter((item) => !item.project_id && item.scope === 'shared'));
  const projects = new Map();
  ordinary.filter((item) => item.project_id).forEach((item) => {
    const key = String(item.project_id);
    if (!projects.has(key)) projects.set(key, { title: item.project_title || 'Project', items: [] });
    projects.get(key).items.push(item);
  });
  [...projects.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((project) => group(project.title, project.items));
}

function choose(id) {
  book.root.dataset.pane = 'note';
  if (book.view === 'note' && same(id, selections.get(book.info.space)) && book.editor) return;
  book.editor?.flush();
  selections.set(book.info.space, id);
  book.view = 'note';
  drawList();
  drawMain();
}

async function createNote(trigger) {
  const { info } = book;
  if (trigger) trigger.disabled = true;
  book.editor?.flush();
  try {
    const result = await P.call('/platform/nextcloud/notes/', {
      method: 'POST',
      body: { title: 'Untitled note', content: '', space: info.space },
    });
    if (!book.root?.isConnected || book.info !== info) return;
    const item = result?.item;
    if (!item) {
      await refreshNotebook(info);
      return;
    }
    book.items = [item, ...book.items.filter((other) => !same(other.id, item.id))];
    remember();
    selections.set(info.space, item.id);
    book.view = 'note';
    book.mode = 'edit';
    book.query = '';
    book.refs.search.value = '';
    book.root.dataset.pane = 'note';
    drawList();
    drawMain({ fresh: true });
  } catch (error) {
    setStatus(error?.data?.detail || error?.message || 'The note could not be created.', 'bad');
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

function drawMain(options = {}) {
  const { main } = book.refs;
  book.editor?.destroy();
  main.innerHTML = '';
  book.editor = null;
  if (book.view === 'index') {
    drawIndex(main);
    return;
  }
  const note = current();
  if (!note) {
    drawEmpty(main);
    return;
  }
  drawEditor(main, note, options);
}

function drawEmpty(main) {
  const box = el('div', 'nb-empty');
  box.append(glyph('notes'));
  box.append(el('h2', 'nb-empty__title', 'Start your notebook'));
  box.append(el('p', 'nb-empty__text', 'Personal, shared and project notes live in one Research notebook. Your own notes mirror to Nextcloud; shared content follows its Gravitas ACL.'));
  const create = action('New note', () => createNote(create), { solid: true });
  box.append(create);
  main.append(box);
}

function drawIndex(main) {
  const bar = el('header', 'nb-bar');
  const back = iconButton('chevron', 'Back to notes', () => {
    book.view = 'note';
    drawList();
    drawMain();
  }, 'nb-back nb-back--always');
  const crumbs = el('div', 'nb-bar__crumbs');
  crumbs.append(el('span', null, book.info.area), el('span', 'nb-bar__sep', '/'), el('span', 'nb-bar__here', 'Space index'));
  bar.append(back, crumbs);
  const scroll = el('div', 'nb-scroll');
  const page = el('div', 'nb-index');
  page.append(el('h2', 'nb-index__title', 'Space index'));
  page.append(el('p', 'nb-index__lede', 'Every managed Markdown file in your Space: spaces, categories, projects, tasks and notes. Structural files stay in Files; notes stay editable here and in Nextcloud Notes.'));
  const slot = el('div', 'nb-index__slot');
  slot.dataset.spaceIndexSlot = '1';
  page.append(slot);
  scroll.append(page);
  main.append(bar, scroll);
  dispatchEvent(new CustomEvent('ws:space-index'));
}

/* ---- Editing helpers -------------------------------------------------------
   Every programmatic edit goes through insertText, so Ctrl+Z undoes a bold or
   a continued list the way it undoes typing. Assigning .value would empty the
   browser's undo stack, which in a writing surface is losing work. */
function replaceRange(area, start, end, text, caret = null, caretEnd = caret) {
  area.focus();
  area.setSelectionRange(start, end);
  let done = false;
  try {
    done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
  } catch {
    done = false;
  }
  if (!done) {
    area.setRangeText(text, start, end, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (caret != null) area.setSelectionRange(caret, caretEnd);
}

function wrapSelection(area, mark) {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const chosen = value.slice(s, e);
  const n = mark.length;
  if (chosen.length >= 2 * n && chosen.startsWith(mark) && chosen.endsWith(mark)) {
    replaceRange(area, s, e, chosen.slice(n, -n), s, e - 2 * n);
  } else if (value.slice(s - n, s) === mark && value.slice(e, e + n) === mark) {
    replaceRange(area, s - n, e + n, chosen, s - n, e - n);
  } else {
    replaceRange(area, s, e, `${mark}${chosen}${mark}`, s + n, e + n);
  }
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/* Enter on a list item starts the next one, numbered and unticked; Enter on
   an empty item ends the list, as in Obsidian, Notion and Nextcloud Notes. */
function continueList(area) {
  const { selectionStart: s, selectionEnd: e, value } = area;
  if (s !== e) return false;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const before = value.slice(lineStart, s);
  const m = LIST_LINE.exec(before);
  if (!m) return false;
  const lineEnd = value.indexOf('\n', s) === -1 ? value.length : value.indexOf('\n', s);
  if (before.length === m[0].length && !value.slice(s, lineEnd).trim()) {
    replaceRange(area, lineStart, s, '', lineStart);
    return true;
  }
  const marker = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
  const next = `\n${m[1]}${marker}${m[3]}${m[4] ? '[ ] ' : ''}`;
  replaceRange(area, s, s, next, s + next.length);
  return true;
}

/* Tab indents list items and leaves every other line to the browser, so Tab
   still moves focus out of a paragraph for someone using the keyboard. */
function indentList(area, outdent) {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  if (!lines.some((line) => LIST_LINE.test(line)) || !lines.every((line) => LIST_LINE.test(line) || !line.trim())) return false;
  const changed = lines.map((line) => {
    if (!line.trim()) return line;
    return outdent ? line.replace(/^( {1,2}|\t)/, '') : `  ${line}`;
  });
  const next = changed.join('\n');
  if (next === block) return true;
  const shift = changed[0].length - lines[0].length;
  replaceRange(area, lineStart, lineEnd, next, Math.max(lineStart, s + shift), e + (next.length - block.length));
  return true;
}

function conflictBox(note, report) {
  const box = el('div', 'nb-alert');
  box.dataset.tone = note.sync_state === 'conflict' || note.sync_state === 'blocked' ? 'bad' : 'warn';
  if (note.sync_state === 'conflict') {
    const remoteDeleted = String(note.sync_error || '').startsWith('deleted_in_nextcloud');
    const movedOut = note.sync_error === 'moved_outside_gravitas' || note.sync_error === 'space_access_required';
    box.append(el('strong', 'nb-alert__title', remoteDeleted
      ? 'The Nextcloud copy was deleted.'
      : movedOut
        ? 'The Nextcloud copy moved outside your allowed Gravitas space.'
        : 'This note changed in both places.'));
    box.append(el('p', null, remoteDeleted
      ? 'Choose whether to restore the Gravitas copy to Nextcloud or accept the Nextcloud deletion.'
      : movedOut
        ? 'No data was overwritten. Move the native note back to an allowed Gravitas category, or keep the Gravitas copy.'
        : 'Neither side was overwritten. Compare both versions, then choose the copy that should win.'));
    const tools = el('div', 'nb-alert__tools');
    const resolve = (winner) => async () => {
      keep.disabled = true;
      take.disabled = true;
      try {
        const result = await P.call(`/platform/nextcloud/notes/${note.id}/resolve/`, { method: 'POST', body: { winner } });
        if (result.deleted) selections.delete(book.info.space);
        else if (result.item) Object.assign(note, result.item);
        book.editor?.destroy();
        book.editor = null;
        await refreshNotebook(book.info);
        if (!book.editor) drawMain();
      } catch (error) {
        report(error?.data?.detail || error?.message || 'Conflict resolution failed');
        keep.disabled = false;
        take.disabled = false;
      }
    };
    const keep = action('Keep Gravitas version', resolve('gravitas'), { solid: true, tiny: true });
    const take = action(remoteDeleted ? 'Accept deletion' : 'Use Nextcloud version', resolve('nextcloud'), { tiny: true });
    tools.append(keep, take);
    if (!remoteDeleted) tools.append(action('Open Nextcloud copy', () => openNative(note.native_url), { tiny: true }));
    box.append(tools);
  } else {
    box.append(el('strong', 'nb-alert__title', note.sync_state === 'blocked'
      ? 'This note is outside your current workspace access.'
      : 'Saved in Gravitas; the Nextcloud mirror is pending.'));
    box.append(el('p', null, note.sync_error || 'The background mirror will retry automatically.'));
  }
  return box;
}

function drawEditor(main, note, { fresh = false } = {}) {
  const { info } = book;
  const locked = note.can_edit === false || !!note.readonly || note.sync_state === 'blocked';

  /* Bar: where you are, whether it is saved, and the few things you do to a
     whole note. Everything else is in the text. */
  const bar = el('header', 'nb-bar');
  const back = iconButton('chevron', 'Back to notes', () => {
    flush();
    book.root.dataset.pane = 'list';
  }, 'nb-back');
  const crumbs = el('div', 'nb-bar__crumbs');
  const here = el('span', 'nb-bar__here', String(note.title || '').trim() || 'Untitled');
  here.dir = 'auto';
  crumbs.append(el('span', null, info.area), el('span', 'nb-bar__sep', '/'), here);
  const saveState = el('span', 'nb-save');
  saveState.setAttribute('role', 'status');
  const modes = el('div', 'nb-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'View');
  const editMode = el('button', 'nb-mode', 'Edit');
  const readMode = el('button', 'nb-mode', 'Read');
  editMode.type = 'button';
  readMode.type = 'button';
  editMode.title = 'Edit (Ctrl+E)';
  readMode.title = 'Read (Ctrl+E)';
  modes.append(editMode, readMode);
  const star = iconButton('star', 'Pin note', null, 'nb-star');
  const moreWrap = el('div', 'nb-more');
  const more = iconButton('more', 'More actions', null);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  const menu = el('div', 'nb-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  moreWrap.append(more, menu);
  bar.append(back, crumbs, saveState, modes, star, moreWrap);

  /* Page: the note itself. */
  const scroll = el('div', 'nb-scroll');
  const page = el('article', 'nb-page');
  const title = el('textarea', 'nb-title');
  title.rows = 1;
  title.value = note.title || '';
  title.placeholder = 'Untitled';
  title.dir = 'auto';
  title.spellcheck = true;
  title.readOnly = locked;
  title.setAttribute('aria-label', 'Note title');
  const meta = el('div', 'nb-meta');
  const body = el('textarea', 'nb-body');
  body.value = note.content || '';
  body.placeholder = 'Start writing. Markdown works: # heading, - list, - [ ] task, [[another note]], #tag, $E = mc^2$';
  body.dir = 'auto';
  body.spellcheck = true;
  body.readOnly = locked;
  body.setAttribute('aria-label', 'Note text, in Markdown');
  const reader = el('div', 'nb-reader');
  reader.hidden = true;
  if (['conflict', 'error', 'blocked'].includes(note.sync_state)) page.append(conflictBox(note, (text) => setSave(text, 'bad')));
  page.append(title, meta, body, reader);
  scroll.append(page);

  const foot = el('footer', 'nb-foot');
  const counts = el('span', 'nb-foot__counts');
  foot.append(counts, el('span', 'nb-foot__hint', 'Markdown · Ctrl+B bold · Ctrl+I italic · Ctrl+E read · Ctrl+S save'));
  main.append(bar, scroll, foot);

  /* ---- State and saving ---- */
  let timer = null;
  let saving = false;
  let queued = false;
  let dirty = false;
  let shownState = note.sync_state;

  function setSave(text, tone = '') {
    saveState.textContent = text;
    if (tone) saveState.dataset.tone = tone;
    else saveState.removeAttribute('data-tone');
  }

  function drawMeta() {
    meta.innerHTML = '';
    const [label, tone] = syncOf(note);
    const pill = el('span', 'nb-pill', label);
    pill.dataset.tone = tone;
    const edited = el('span', null, note.updated ? `Edited ${ago(note.updated).toLowerCase()}` : 'Not saved yet');
    edited.title = fullDate(note.updated);
    meta.append(pill, edited);
    if (note.project_title) meta.append(el('span', null, `Project · ${note.project_title}`));
    else meta.append(el('span', null, note.scope === 'shared' ? `Shared · ${note.owner_name || 'Collaborator'}` : 'Personal'));
    if (note.favorite) meta.append(el('span', null, 'Pinned'));
    star.disabled = locked;
    star.dataset.on = note.favorite ? '1' : '';
    star.setAttribute('aria-pressed', String(!!note.favorite));
    star.title = note.favorite ? 'Unpin note' : 'Pin note';
    star.setAttribute('aria-label', star.title);
  }

  function drawCounts() {
    const words = wordCount(body.value);
    const minutes = Math.max(1, Math.round(words / 220));
    counts.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${body.value.length.toLocaleString()} characters${words ? ` · ${minutes} min read` : ''}`;
  }

  async function save() {
    clearTimeout(timer);
    timer = null;
    if (saving) { queued = true; return; }
    if (!dirty) return;
    saving = true;
    dirty = false;
    setSave('Saving…');
    try {
      const result = await P.call(`/platform/nextcloud/notes/${note.id}/`, {
        method: 'PATCH',
        body: { title: title.value.trim() || 'Untitled note', content: body.value, favorite: !!note.favorite, space: info.space },
      });
      Object.assign(note, result.item || {});
      setSave(note.sync_state === 'error' ? 'Saved · mirror pending' : 'Saved');
    } catch (error) {
      if (error?.status === 409) {
        if (error.data?.item) Object.assign(note, error.data.item);
        setSave('Saved · conflict kept', 'bad');
      } else {
        dirty = true;
        setSave('Not saved · Ctrl+S to retry', 'bad');
      }
    } finally {
      saving = false;
      shownState = note.sync_state;
      remember();
      if (book.editor?.id === note.id) drawMeta();
      if (book.root?.isConnected) drawList();
      if (queued) { queued = false; save(); }
    }
  }

  function touch() {
    dirty = true;
    setSave('Editing…');
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  }

  function flush() {
    if (dirty || timer) save();
  }

  /* ---- Layout: both fields grow with their text, so the page scrolls as
     one document instead of a box scrolling inside a box. ---- */
  function fit(node) {
    if (node.hidden || !node.isConnected) return;
    const top = scroll.scrollTop;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
    scroll.scrollTop = top;
  }
  const resize = new ResizeObserver(() => { fit(title); fit(body); });
  resize.observe(scroll);

  /* ---- Read view ---- */
  const hooks = {
    wiki(name) {
      const wanted = name.trim().toLowerCase();
      const target = book.items.find((item) => String(item.title || '').trim().toLowerCase() === wanted);
      return target ? () => choose(target.id) : null;
    },
    tag(name) {
      book.query = `#${name}`;
      book.refs.search.value = book.query;
      book.root.dataset.pane = 'list';
      drawList();
    },
    toggle: locked ? null : (line, checked) => {
      const lines = body.value.split('\n');
      if (lines[line] == null) return;
      lines[line] = lines[line].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
      body.value = lines.join('\n');
      touch();
      setMode('read');
    },
  };

  function setMode(mode, keep = true) {
    if (keep) book.mode = mode;
    page.dataset.mode = mode;
    editMode.setAttribute('aria-pressed', String(mode === 'edit'));
    readMode.setAttribute('aria-pressed', String(mode === 'read'));
    if (mode === 'read') {
      reader.replaceChildren(body.value.trim()
        ? renderNoteMarkdown(body.value, hooks)
        : el('p', 'nb-reader__empty', 'Nothing written yet.'));
      body.hidden = true;
      reader.hidden = false;
    } else {
      reader.hidden = true;
      body.hidden = false;
      fit(body);
    }
  }

  editMode.addEventListener('click', () => { setMode('edit'); body.focus(); });
  readMode.addEventListener('click', () => setMode('read'));

  /* ---- Menu ---- */
  const closeMenu = () => {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
  function outside(event) {
    if (!moreWrap.contains(event.target)) closeMenu();
  }
  function escape(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeMenu();
    more.focus();
  }
  more.addEventListener('click', () => {
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    menu.querySelector('button')?.focus();
  });
  const menuItem = (icon, label, handler) => {
    const item = el('button', 'nb-menu__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    const text = el('span', null, label);
    item.append(glyph(icon), text);
    item.addEventListener('click', () => handler(item, text));
    return item;
  };
  if (note.native_url) {
    menu.append(menuItem('external', 'Open in Nextcloud Notes', () => {
      closeMenu();
      openNative(note.native_url);
    }));
  }
  menu.append(menuItem('notes', 'Copy as Markdown', async () => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(`# ${title.value.trim() || 'Untitled'}\n\n${body.value}`);
      setSave('Copied');
    } catch {
      setSave('Copy is not allowed here', 'bad');
    }
  }));
  let armed = false;
  let armTimer = null;
  const remove = menuItem('close', 'Delete note', async (item, text) => {
    if (!armed) {
      armed = true;
      text.textContent = 'Delete from Gravitas and Nextcloud?';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed = false; text.textContent = 'Delete note'; }, 5000);
      return;
    }
    clearTimeout(armTimer);
    clearTimeout(timer);
    dirty = false;
    item.disabled = true;
    try {
      await P.call(`/platform/nextcloud/notes/${note.id}/`, { method: 'DELETE' });
      closeMenu();
      book.items = book.items.filter((other) => !same(other.id, note.id));
      remember();
      selections.delete(info.space);
      const next = [...book.items].sort((a, b) => stamp(b.updated) - stamp(a.updated))[0];
      if (next) selections.set(info.space, next.id);
      book.editor = null;
      drawList();
      drawMain();
    } catch (error) {
      text.textContent = error?.data?.detail || error?.message || 'Delete failed';
      item.disabled = false;
      armed = false;
    }
  });
  remove.dataset.tone = 'bad';
  if (!locked) menu.append(remove);

  star.addEventListener('click', () => {
    note.favorite = !note.favorite;
    drawMeta();
    dirty = true;
    save();
  });

  /* ---- Typing ---- */
  title.addEventListener('input', () => {
    if (title.value.includes('\n')) title.value = title.value.replace(/\s*\n+\s*/g, ' ');
    here.textContent = title.value.trim() || 'Untitled';
    fit(title);
    touch();
  });
  title.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' && !event.isComposing) || (event.key === 'ArrowDown' && title.selectionStart === title.value.length)) {
      event.preventDefault();
      if (page.dataset.mode === 'read') setMode('edit');
      body.focus();
      body.setSelectionRange(0, 0);
    }
  });
  body.addEventListener('input', () => {
    fit(body);
    drawCounts();
    touch();
  });
  body.addEventListener('keydown', (event) => {
    if (locked) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'b') { event.preventDefault(); wrapSelection(body, '**'); return; }
      if (key === 'i') { event.preventDefault(); wrapSelection(body, '*'); return; }
    }
    if (event.key === 'Enter' && !mod && !event.shiftKey && !event.altKey && !event.isComposing) {
      if (continueList(body)) event.preventDefault();
    } else if (event.key === 'Tab' && !mod && !event.altKey) {
      if (indentList(body, event.shiftKey)) event.preventDefault();
    } else if (event.key === 'ArrowUp' && body.selectionStart === 0 && body.selectionEnd === 0) {
      event.preventDefault();
      title.focus();
    }
  });
  // A click in the empty page below the text puts the caret at its end, the
  // way a page in Notion or Obsidian takes a click anywhere under the text.
  scroll.addEventListener('mousedown', (event) => {
    if (locked || page.dataset.mode !== 'edit' || (event.target !== scroll && event.target !== page)) return;
    event.preventDefault();
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
  });

  book.editor = {
    id: note.id,
    dirty: () => dirty || saving || !!timer,
    focused: () => page.contains(document.activeElement),
    shows: (item) => item.title === title.value && (item.content || '') === body.value && item.sync_state === shownState && !!item.favorite === !!note.favorite,
    flush,
    destroy: () => resize.disconnect(),
    toggleMode: () => {
      setMode(page.dataset.mode === 'read' ? 'edit' : 'read');
      if (page.dataset.mode === 'edit') body.focus();
    },
  };

  drawMeta();
  drawCounts();
  setMode(locked ? 'read' : book.mode, !locked);
  requestAnimationFrame(() => {
    fit(title);
    fit(body);
    if (fresh) {
      title.focus();
      title.select();
    }
  });
}

async function renderNativeNotes(host, info) {
  if ((info.space === 'core' && !P.canOpenCore()) || (info.space === 'research' && !P.canOpenResearch() && !P.canOpenCore())) {
    location.replace('/workspace/dashboard');
    return;
  }

  // Already showing this notebook (a background sync asked for a repaint):
  // update it in place rather than tearing down the note being written.
  if (book.root?.isConnected && host.contains(book.root) && book.info?.space === info.space) {
    await refreshNotebook(info);
    return;
  }

  const cached = notebooks.get(info.space);
  if (cached) mountNotebook(host, info, cached);
  else loadingNotebook(host, info);

  let data;
  try {
    data = await P.call('/platform/nextcloud/notes/');
  } catch (error) {
    if (!cached && route()?.space === info.space) failedNotebook(host, info, error);
    else if (cached) setStatus('Could not refresh. Showing the notes already loaded.', 'warn');
    return;
  }
  if (route()?.space !== info.space) return;
  if (cached && book.root?.isConnected && book.info === info) {
    applyData(data);
    return;
  }
  const items = (Array.isArray(data.items) ? data.items : []).filter((item) => item.space === info.space);
  notebooks.set(info.space, { data, items });
  mountNotebook(host, info, { data, items });
}

function schedule() {
  if (router.scheduled) return;
  router.scheduled = true;
  queueMicrotask(async () => {
    router.scheduled = false;
    injectAdminMirrorEntry();
    const info = route();
    // Leaving a note mid-sentence still saves it: the editor's closures
    // outlive the DOM the next screen replaced.
    if (info?.kind !== 'notes') book.editor?.flush();
    if (!info) return;
    setCrumbs(info);
    const host = $('#ws-view');
    if (!host) return;
    if (info.kind === 'admin') await renderMirrorAdmin(host, info);
    else await renderNativeNotes(host, info);
    injectAdminMirrorEntry();
  });
}

export function installNextcloudNativeRouter() {
  if (router.installed) return;
  router.installed = true;
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  addEventListener('pagehide', () => book.editor?.flush());
  schedule();
}
