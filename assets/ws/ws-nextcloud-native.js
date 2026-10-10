import * as P from './ws-platform.js?v=20261011-r3';
import * as K from './ws-admin-kit.js?v=20261011-r3';
import { renderNoteMarkdown, plainNoteText } from './ws-notes-markdown.js?v=20261011-r3';
import { attachCommands, replaceRange, wrapSelection } from './ws-notes-commands.js?v=20261011-r3';
import { startNotesSync } from './ws-notes-performance.js?v=20261011-r3';
import { renderSpaceIndex } from './ws-space-integration.js?v=20261011-r3';

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const selections = new Map();

function route() {
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/workspace/core/notes') return { kind: 'notes', space: 'core', title: 'Core Notes', area: 'Core' };
  if (path === '/workspace/research/notes' || path === '/workspace/research/editor') {
    return { kind: 'notes', space: 'research', title: 'Research Notes', area: 'Research' };
  }
  if (path === '/workspace/kms/notes') return { kind: 'notes', space: 'kms', title: 'Knowledge Notes', area: 'Knowledge' };
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
    ['Files & Team Folders', 'Files, project folders, storage paths and project ACLs', 'Bidirectional storage + ACL reconciliation'],
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

   Then the notebook became the one place a researcher writes:
   - A day picked on any calendar opens its note here (/notes?day=…), in the
     Journal folder. There used to be a second editor for days, with its own
     toolbar and its own save path, and a day clicked twice became two notes
     that Nextcloud told apart as "… (2)". The server now finds a day's note
     before making one, so whichever calendar opens it, it is the same file.
   - Notes can be filed in folders. A folder is a Nextcloud Notes category
     under Gravitas/Research, so it is a folder in the Notes app and in Files
     too, and one made there shows up here. Folders exist while they hold a
     note, as in Nextcloud; "New folder" therefore starts its first note.
   - The list is a tree of titles. Three-line rows of "Empty note" made a
     notebook of nine notes a long scroll; the preview now shows in search
     results, where it decides which row to open.
   ------------------------------------------------------------------------- */

const notebooks = new Map();
const book = {
  info: null, root: null, data: null, items: [],
  mode: 'edit', query: '', view: 'note', refs: {}, editor: null,
  naming: null, journalAll: false, collapsed: null,
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

/* ---- Days and folders ---------------------------------------------------- */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const JOURNAL_SHOWN = 7;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayDate = (key) => new Date(`${key}T00:00:00`);
const dayTitle = (key) => dayDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = (key) => dayDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shiftDay = (key, by) => {
  const date = dayDate(key);
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + by));
};
const isJournal = (item) => item?.kind === 'journal' && DAY_KEY.test(item?.journal_date || '');
const isOwn = (item) => !item?.project_id && item?.scope !== 'shared';
// Mirrors clean_folder() in nextcloud_notes.py, so what is shown while the
// request is in flight is what the server will store.
const cleanFolder = (value) => String(value || '').replace(/\\/g, '/').split('/')
  .map((part) => part.replace(/[\x00-\x1f]/g, '').trim().slice(0, 80).trim())
  .filter((part) => part && part !== '.' && part !== '..')
  .slice(0, 6)
  .join('/');

function allFolders() {
  const paths = new Set();
  for (const item of book.items) {
    if (!isOwn(item) || isJournal(item)) continue;
    const parts = cleanFolder(item.folder).split('/').filter(Boolean);
    parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join('/')));
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

/* Which groups are folded is remembered per space in this browser only. It
   is a convenience; losing it costs one click. */
function collapsedSet() {
  if (book.collapsed) return book.collapsed;
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(`gq.notes.collapsed.${book.info.space}`) || '[]'); } catch { stored = []; }
  book.collapsed = new Set(Array.isArray(stored) ? stored : []);
  return book.collapsed;
}
function setCollapsed(key, folded) {
  const set = collapsedSet();
  if (folded) set.add(key);
  else set.delete(key);
  try { localStorage.setItem(`gq.notes.collapsed.${book.info.space}`, JSON.stringify([...set])); } catch { /* private window */ }
}
function revealFolder(path) {
  const parts = cleanFolder(path).split('/').filter(Boolean);
  parts.forEach((_, index) => setCollapsed(`f:${parts.slice(0, index + 1).join('/')}`, false));
}

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
  if (book.info?.space !== info.space) book.collapsed = null;
  Object.assign(book, { info, root, data: state.data, items: state.items, view: 'note', naming: null });

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
  // A note created while this list was in flight is not in it yet; the one
  // being written stays in the list rather than vanishing until the next sync.
  if (local && !fresh.some((item) => same(item.id, local.id))) book.items.unshift(local);
  book.data = data;
  remember();
  setStatus(data.available === false ? 'Nextcloud is unavailable. Notes save here and mirror later.' : syncSummary(data));
  drawList();
  if (busy || book.view !== 'note') return;
  const selected = current();
  if (!editor || !selected || !same(selected.id, editor.id) || !editor.shows(selected)) drawMain();
}

/* A row is a title. In search results it also carries the first words and
   where the note lives, because there the reader is choosing between rows
   they cannot otherwise tell apart. */
function noteRow(item, active, { full = false, depth = 0 } = {}) {
  if (same(book.naming?.note, item.id)) return renameRow(item, depth);
  const row = el('button', `nb-row${full ? ' nb-row--full' : ''}`);
  row.type = 'button';
  row.dataset.id = item.id;
  if (depth) row.style.setProperty('--depth', depth);
  if (active) row.setAttribute('aria-current', 'page');
  const top = el('span', 'nb-row__top');
  top.append(glyph(isJournal(item) ? 'calendar' : 'notes'));
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
  row.append(top);
  const preview = snippetOf(item);
  const place = item.project_title || (item.scope === 'shared' ? 'Shared' : cleanFolder(item.folder) || (isJournal(item) ? 'Journal' : 'Notes'));
  if (full) {
    const snippet = el('span', 'nb-row__snippet', preview || 'Empty note');
    snippet.dir = 'auto';
    if (!preview) snippet.dataset.empty = '';
    row.append(snippet, el('span', 'nb-row__when', `${place} · ${ago(item.updated)}`));
  }
  row.title = `${preview ? `${preview}\n\n` : ''}${place} · edited ${fullDate(item.updated)}`;
  row.addEventListener('click', () => choose(item.id));

  // Only the reader's own notes can be filed; project notes live in their
  // project and shared notes in someone else's notebook.
  if (isOwn(item) && !isJournal(item) && item.can_edit !== false) {
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/x-gravitas-note', String(item.id));
      row.dataset.dragging = '';
    });
    row.addEventListener('dragend', () => delete row.dataset.dragging);
  }

  // Every row carries its own menu, shown when the row is pointed at, open
  // or reached by keyboard, as in Nextcloud Notes and Notion.
  const wrap = el('div', 'nb-item');
  const more = iconButton('more', `Actions for ${String(item.title || '').trim() || 'Untitled'}`, (event) => {
    event.stopPropagation();
    openRowMenu(item, more);
  }, 'nb-item__more');
  more.setAttribute('aria-haspopup', 'menu');
  wrap.append(row, more);
  return wrap;
}

function dropTarget(node, folder) {
  node.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('text/x-gravitas-note')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.dataset.drop = '';
  });
  node.addEventListener('dragleave', () => delete node.dataset.drop);
  node.addEventListener('drop', (event) => {
    delete node.dataset.drop;
    const id = event.dataTransfer.getData('text/x-gravitas-note');
    if (!id) return;
    event.preventDefault();
    moveNote(id, folder);
  });
}

/* A group in the sidebar: a header that folds it, an optional count and
   actions, and its rows. Folding is remembered by `key`. */
function section(label, key, { count = null, actions = [], folder = null } = {}) {
  const wrap = el('section', 'nb-group');
  const folded = collapsedSet().has(key);
  const head = el('div', 'nb-group__head');
  const toggle = el('button', 'nb-group__label');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!folded));
  toggle.append(glyph('chevron'), el('span', 'nb-group__name', label));
  if (count != null) toggle.append(el('span', 'nb-group__count', String(count)));
  toggle.addEventListener('click', () => { setCollapsed(key, !folded); drawList(); });
  head.append(toggle, ...actions);
  if (folder != null) dropTarget(head, folder);
  const body = el('div', 'nb-group__body');
  body.hidden = folded;
  wrap.append(head, body);
  book.refs.list.append(wrap);
  return body;
}

function folderTree(items) {
  const root = { name: '', path: '', folders: new Map(), notes: [] };
  for (const item of items) {
    let node = root;
    for (const part of cleanFolder(item.folder).split('/').filter(Boolean)) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path, folders: new Map(), notes: [] });
      node = node.folders.get(part);
    }
    node.notes.push(item);
  }
  return root;
}

const treeCount = (node) => node.notes.length + [...node.folders.values()].reduce((sum, child) => sum + treeCount(child), 0);

function folderEl(node, depth, selectedId) {
  const key = `f:${node.path}`;
  const folded = collapsedSet().has(key);
  const wrap = el('div', 'nb-folder');
  const head = el('div', 'nb-folder__head');
  head.style.setProperty('--depth', depth);
  if (book.naming?.rename === node.path) {
    head.append(glyph('projects'), nameInput(node.name, (name) => renameFolder(node.path, name)));
    wrap.append(head);
    return wrap;
  }
  const toggle = el('button', 'nb-folder__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!folded));
  toggle.title = 'Double-click to rename';
  const name = el('span', 'nb-folder__name', node.name);
  name.dir = 'auto';
  toggle.append(glyph('chevron'), glyph('projects'), name, el('span', 'nb-folder__count', String(treeCount(node))));
  toggle.addEventListener('click', () => { setCollapsed(key, !folded); drawList(); });
  toggle.addEventListener('dblclick', (event) => {
    event.preventDefault();
    book.naming = { rename: node.path };
    drawList();
  });
  const add = iconButton('plus', `New note in ${node.name}`, (event) => {
    event.stopPropagation();
    createNote(add, { folder: node.path });
  }, 'nb-folder__add');
  head.append(toggle, add);
  dropTarget(head, node.path);
  wrap.append(head);
  if (!folded) {
    const kids = el('div', 'nb-folder__kids');
    for (const child of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) kids.append(folderEl(child, depth + 1, selectedId));
    node.notes.forEach((item) => kids.append(noteRow(item, same(item.id, selectedId), { depth: depth + 1 })));
    wrap.append(kids);
  }
  return wrap;
}

/* The one inline field the sidebar has: naming a new folder, or renaming
   one. Enter keeps it, Escape or leaving the field drops it. */
function nameInput(value, done) {
  const input = el('input', 'nb-name');
  // The list is redrawn when a background sync lands, which rebuilds this
  // field. What was typed lives on book.naming so the new field keeps it.
  const naming = book.naming;
  input.value = naming?.draft ?? value;
  input.placeholder = 'Folder name';
  input.setAttribute('aria-label', 'Folder name');
  let settled = false;
  const finish = (keep) => {
    if (settled) return;
    settled = true;
    book.naming = null;
    const name = cleanFolder(input.value);
    drawList();
    if (keep && name) done(name);
  };
  input.addEventListener('input', () => { if (naming) naming.draft = input.value; });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  // Losing focus keeps the name, unless the field lost it by being redrawn
  // away: that is not the reader leaving, and must not submit half a name.
  input.addEventListener('blur', () => { if (input.isConnected) finish(true); });
  requestAnimationFrame(() => {
    input.focus();
    const end = input.value.length;
    if (naming?.draft != null) input.setSelectionRange(end, end);
    else input.select();
  });
  return input;
}

function drawList() {
  const { list } = book.refs;
  if (!list) return;
  closeRowMenu();
  list.innerHTML = '';
  book.refs.index?.setAttribute('aria-pressed', String(book.view === 'index'));
  const selectedId = book.view === 'note' ? selections.get(book.info.space) : null;
  const query = book.query.trim().toLowerCase();

  if (query) {
    const found = [...book.items]
      .sort((a, b) => stamp(b.updated) - stamp(a.updated))
      .filter((item) => `${item.title || ''}\n${item.content || ''}\n${item.project_title || ''}\n${item.folder || ''}`.toLowerCase().includes(query));
    if (!found.length) {
      list.append(el('p', 'nb-list__empty', `Nothing matches “${book.query.trim()}”.`));
      return;
    }
    const body = section('Results', 's:results', { count: found.length });
    found.forEach((item) => body.append(noteRow(item, same(item.id, selectedId), { full: true })));
    return;
  }

  const byRecent = (a, b) => stamp(b.updated) - stamp(a.updated);
  const own = book.items.filter(isOwn);

  const pinned = book.items.filter((item) => item.favorite).sort(byRecent);
  if (pinned.length) {
    const body = section('Pinned', 's:pinned', { count: pinned.length });
    pinned.forEach((item) => body.append(noteRow(item, same(item.id, selectedId))));
  }

  // Journal: one note per day, newest day first, the last week in view.
  const days = own.filter(isJournal).sort((a, b) => b.journal_date.localeCompare(a.journal_date));
  const today = iconButton('calendar', 'Open today', () => openDay(dayKey(new Date())), 'nb-group__action');
  const journal = section('Journal', 's:journal', { count: days.length || null, actions: [today] });
  if (!days.length) {
    journal.append(el('p', 'nb-list__hint', 'Pick a day on the calendar, or open today, to start a day note.'));
  } else {
    const shown = book.journalAll ? days : days.slice(0, JOURNAL_SHOWN);
    shown.forEach((item) => journal.append(noteRow(item, same(item.id, selectedId))));
    if (days.length > JOURNAL_SHOWN) {
      const more = el('button', 'nb-list__more', book.journalAll ? 'Show fewer' : `Show all ${days.length} days`);
      more.type = 'button';
      more.addEventListener('click', () => { book.journalAll = !book.journalAll; drawList(); });
      journal.append(more);
    }
  }

  // Notes: the reader's own notes, filed in folders or loose at the root.
  const filed = own.filter((item) => !isJournal(item)).sort(byRecent);
  const newFolder = iconButton('projects', 'New folder', () => {
    setCollapsed('s:notes', false);
    book.naming = { create: true };
    drawList();
  }, 'nb-group__action');
  const notes = section('Notes', 's:notes', { count: filed.length || null, actions: [newFolder], folder: '' });
  if (book.naming?.create) {
    const row = el('div', 'nb-folder__head nb-folder__head--new');
    row.append(glyph('projects'), nameInput('', (name) => createNote(null, { folder: name })));
    notes.append(row);
  }
  const tree = folderTree(filed);
  for (const child of [...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) notes.append(folderEl(child, 0, selectedId));
  tree.notes.forEach((item) => notes.append(noteRow(item, same(item.id, selectedId))));
  if (!filed.length && !book.naming?.create) notes.append(el('p', 'nb-list__hint', 'No notes yet. Start one with New.'));

  const shared = book.items.filter((item) => !item.project_id && item.scope === 'shared').sort(byRecent);
  if (shared.length) {
    const body = section('Shared with you', 's:shared', { count: shared.length });
    shared.forEach((item) => body.append(noteRow(item, same(item.id, selectedId))));
  }

  const projects = new Map();
  book.items.filter((item) => item.project_id).sort(byRecent).forEach((item) => {
    const key = String(item.project_id);
    if (!projects.has(key)) projects.set(key, { id: key, title: item.project_title || 'Project', items: [] });
    projects.get(key).items.push(item);
  });
  [...projects.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((project) => {
      const body = section(project.title, `p:${project.id}`, { count: project.items.length });
      project.items.forEach((item) => body.append(noteRow(item, same(item.id, selectedId))));
    });
}

function choose(id) {
  book.root.dataset.pane = 'note';
  if (book.view === 'note' && same(id, selections.get(book.info.space)) && book.editor) return;
  book.editor?.flush();
  selections.set(book.info.space, id);
  book.view = 'note';
  const item = book.items.find((other) => same(other.id, id));
  if (item?.folder) revealFolder(item.folder);
  drawList();
  drawMain();
  book.refs.list?.querySelector('.nb-row[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
}

/* Adds a note the server just returned and opens it. */
/* The rest of the workspace keeps a light index of notes (ws-notes-store.js)
   for the calendar, search and backlinks. It is told what changed here
   rather than reading the list again. */
function announceChange(item) {
  if (item?.id != null) dispatchEvent(new CustomEvent('ws:notes-changed', { detail: { item } }));
}
function announceRemoval(id) {
  dispatchEvent(new CustomEvent('ws:notes-changed', { detail: { removed: String(id) } }));
}

function adopt(item, options) {
  announceChange(item);
  book.items = [item, ...book.items.filter((other) => !same(other.id, item.id))];
  remember();
  selections.set(book.info.space, item.id);
  book.view = 'note';
  book.mode = 'edit';
  book.query = '';
  if (book.refs.search) book.refs.search.value = '';
  book.root.dataset.pane = 'note';
  if (item.folder) revealFolder(item.folder);
  drawList();
  drawMain(options);
}

async function createNote(trigger, { folder = '', title = 'Untitled note' } = {}) {
  const { info } = book;
  if (trigger) trigger.disabled = true;
  book.editor?.flush();
  try {
    const body = { title, content: '', space: info.space };
    if (folder) {
      body.folder = folder;
      setStatus(`Creating ${folder}…`);
    }
    const result = await P.call('/platform/nextcloud/notes/', { method: 'POST', body });
    if (!book.root?.isConnected || book.info !== info) return;
    const item = result?.item;
    if (!item) {
      await refreshNotebook(info);
      return;
    }
    adopt(item, { fresh: true });
    // A server from before folders answers without a folder field and files
    // the note at the root. Say so, instead of leaving the reader to wonder
    // where their folder went.
    if (folder && !('folder' in item)) setStatus('Folders need the latest server update. The note was created without one.', 'warn');
    else if (folder) setStatus(`Created ${cleanFolder(item.folder) || folder}`);
  } catch (error) {
    setStatus(error?.data?.detail || error?.message || 'The note could not be created.', 'bad');
    drawList();
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

/* A day's note: found in the list when it exists, otherwise asked for. The
   server answers with the existing note when there is one, so two calendars
   or two tabs opening the same day still land on one file. */
async function openDay(key) {
  if (!DAY_KEY.test(key || '') || !book.info) return;
  const { info } = book;
  const found = book.items.find((item) => isJournal(item) && isOwn(item) && item.journal_date === key);
  announceDay(key);
  if (found) {
    if (book.query) { book.query = ''; book.refs.search.value = ''; }
    choose(found.id);
    return;
  }
  book.editor?.flush();
  setStatus(`Opening ${dayTitle(key)}…`);
  try {
    const result = await P.call('/platform/nextcloud/notes/', {
      method: 'POST',
      body: { title: dayTitle(key), content: '', space: info.space, kind: 'journal', journal_date: key },
    });
    if (!book.root?.isConnected || book.info !== info || !result?.item) return;
    setStatus(syncSummary(book.data));
    adopt(result.item, { write: true });
  } catch (error) {
    setStatus(error?.data?.detail || error?.message || 'That day could not be opened.', 'bad');
  }
}

/* ---- A note's own menu ----------------------------------------------------
   Pinning, sharing, filing, renaming and deleting, from the list, without
   opening the note first. One popover at a time, fixed to the viewport so the
   list's scrolling cannot clip it; it closes on a click elsewhere, Escape, or
   the list scrolling out from under it. */
const pop = { node: null, anchor: null, cleanup: null };

function closeRowMenu() {
  pop.cleanup?.();
  pop.node?.remove();
  pop.anchor?.setAttribute('aria-expanded', 'false');
  pop.anchor?.closest('.nb-item')?.removeAttribute('data-menu');
  Object.assign(pop, { node: null, anchor: null, cleanup: null });
}

function popItem(icon, label, handler, { tone = '', note = '', look = '' } = {}) {
  const item = el('button', 'nb-menu__item');
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  const text = el('span', 'nb-menu__text', label);
  item.append(glyph(icon), text);
  if (note) item.append(el('span', 'nb-menu__note', note));
  if (tone) item.dataset.tone = tone;
  if (look) item.dataset.look = look;
  item.addEventListener('click', () => handler(item, text));
  return item;
}

function placePop(node, anchor) {
  const box = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const left = Math.max(8, Math.min(box.right - width, innerWidth - width - 8));
  const below = box.bottom + 4;
  const top = below + height > innerHeight - 8 ? Math.max(8, box.top - height - 4) : below;
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

function openRowMenu(item, anchor) {
  if (pop.anchor === anchor) { closeRowMenu(); return; }
  closeRowMenu();
  const node = el('div', 'nb-menu nb-pop');
  node.setAttribute('role', 'menu');
  book.root.append(node);
  Object.assign(pop, { node, anchor });
  anchor.setAttribute('aria-expanded', 'true');
  anchor.closest('.nb-item')?.setAttribute('data-menu', '');
  fillRowMenu(item, node);
  placePop(node, anchor);
  node.querySelector('button')?.focus();

  const outside = (event) => { if (!node.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) closeRowMenu(); };
  const keys = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeRowMenu(); anchor.focus(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...node.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    event.preventDefault();
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const scrolled = () => closeRowMenu();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  book.refs.list?.addEventListener('scroll', scrolled, { passive: true });
  pop.cleanup = () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    book.refs.list?.removeEventListener('scroll', scrolled);
  };
}

function fillRowMenu(item, node) {
  node.replaceChildren();
  const editable = item.can_edit !== false && !item.readonly;
  const own = isOwn(item);

  node.append(popItem('star', item.favorite ? 'Remove from favorites' : 'Add to favorites', () => {
    closeRowMenu();
    setFavorite(item, !item.favorite);
  }, { look: 'star' }));
  if (own && editable) {
    node.append(popItem('share', 'Share…', () => { closeRowMenu(); openShare(item); }));
  }
  // Where the note lives, as in Nextcloud; for a filable note it opens the
  // folder list.
  const where = [book.info.area, ...(item.project_title ? [item.project_title] : isJournal(item) ? ['Journal'] : cleanFolder(item.folder).split('/').filter(Boolean))].join(' / ');
  const filable = own && editable && !isJournal(item);
  const location = popItem('projects', where, () => { if (filable) folderList(item, node); }, { note: filable ? 'Move' : '' });
  if (!filable) location.disabled = true;
  node.append(location);
  if (editable) {
    node.append(popItem('notes', 'Rename', () => {
      closeRowMenu();
      startRename(item);
    }));
  }
  if (item.native_url) {
    node.append(popItem('external', 'Open in Nextcloud Notes', () => { closeRowMenu(); openNative(item.native_url); }));
  }
  if (editable) {
    node.append(el('div', 'nb-menu__sep'));
    let armed = false;
    node.append(popItem('close', 'Delete note', async (button, text) => {
      if (!armed) {
        armed = true;
        text.textContent = 'Delete from Gravitas and Nextcloud?';
        return;
      }
      button.disabled = true;
      await deleteNote(item, (message) => { text.textContent = message; button.disabled = false; armed = false; });
    }, { tone: 'bad' }));
  }
}

function folderList(item, node) {
  const here = cleanFolder(item.folder);
  node.replaceChildren(el('p', 'nb-menu__label', 'Move to'));
  for (const path of ['', ...allFolders()]) {
    const option = popItem(path ? 'projects' : 'notes', path ? path.split('/').join(' / ') : 'No folder', () => {
      closeRowMenu();
      moveNote(item.id, path);
    });
    if (path === here) option.setAttribute('aria-current', 'true');
    node.append(option);
  }
  const field = el('input', 'nb-menu__input');
  field.placeholder = 'New folder, e.g. Thesis/Chapter 1';
  field.setAttribute('aria-label', 'New folder');
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const path = cleanFolder(field.value);
    if (!path) return;
    closeRowMenu();
    moveNote(item.id, path);
  });
  node.append(field);
  placePop(node, pop.anchor);
  (node.querySelector('[aria-current="true"]') || field).focus();
}

async function setFavorite(item, on) {
  const before = !!item.favorite;
  item.favorite = on;
  drawList();
  if (same(book.editor?.id, item.id)) book.editor.refresh();
  try {
    const result = await P.call(`/platform/nextcloud/notes/${item.id}/`, { method: 'PATCH', body: { favorite: on } });
    Object.assign(item, result?.item || {});
  } catch (error) {
    item.favorite = before;
    setStatus(error?.data?.detail || error?.message || 'Could not change favorites.', 'bad');
  }
  remember();
  drawList();
  if (same(book.editor?.id, item.id)) book.editor.refresh();
}

/* The open note is renamed in its own title, where the reader already is;
   any other note in place in the list. */
function startRename(item) {
  if (same(book.editor?.id, item.id) && book.view === 'note') {
    book.editor.focusTitle();
    return;
  }
  book.naming = { note: item.id };
  drawList();
}

function renameRow(item, depth) {
  const row = el('div', 'nb-row nb-row--rename');
  if (depth) row.style.setProperty('--depth', depth);
  const top = el('span', 'nb-row__top');
  const input = el('input', 'nb-name');
  input.value = String(item.title || '').trim();
  input.setAttribute('aria-label', 'Note title');
  input.dir = 'auto';
  let settled = false;
  const finish = async (keep) => {
    if (settled) return;
    settled = true;
    book.naming = null;
    const title = input.value.trim().slice(0, 240);
    if (!keep || !title || title === item.title) { drawList(); return; }
    const before = item.title;
    item.title = title;
    drawList();
    try {
      const result = await P.call(`/platform/nextcloud/notes/${item.id}/`, { method: 'PATCH', body: { title } });
      Object.assign(item, result?.item || {});
      announceChange(item);
    } catch (error) {
      item.title = before;
      setStatus(error?.data?.detail || error?.message || 'The note could not be renamed.', 'bad');
    }
    remember();
    drawList();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  top.append(glyph(isJournal(item) ? 'calendar' : 'notes'), input);
  row.append(top);
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return row;
}

async function deleteNote(item, report) {
  if (same(book.editor?.id, item.id)) book.editor.cancel();
  try {
    await P.call(`/platform/nextcloud/notes/${item.id}/`, { method: 'DELETE' });
  } catch (error) {
    report(error?.data?.detail || error?.message || 'Delete failed');
    return;
  }
  closeRowMenu();
  announceRemoval(item.id);
  book.items = book.items.filter((other) => !same(other.id, item.id));
  remember();
  if (same(selections.get(book.info.space), item.id)) {
    selections.delete(book.info.space);
    const next = [...book.items].sort((a, b) => stamp(b.updated) - stamp(a.updated))[0];
    if (next) selections.set(book.info.space, next.id);
    book.editor = null;
    drawMain();
  }
  drawList();
  setStatus(`Deleted “${String(item.title || '').trim() || 'Untitled'}”`);
}

/* ---- Sharing ---------------------------------------------------------------
   A note is shared with people, by email and role, through the same sharing
   service as projects and files (/platform/share/, type "resource"). There
   is no link sharing here: nothing serves a /shared/ page yet, and a link
   that opens a 404 is worse than no link. */
const SHARE_ROLES = [['view', 'Can view'], ['comment', 'Can comment'], ['edit', 'Can edit']];
const SHARE_ERRORS = {
  user_not_found: 'No Gravitas account uses that email.',
  permission_denied: 'Only the note’s owner can share it.',
  project_membership_required: 'That person has to be in the project first.',
  cloud_acl_sync_failed: 'Nextcloud did not accept the change. Nothing was shared; try again.',
};
const shareError = (error) => SHARE_ERRORS[error?.data?.error] || error?.data?.detail || error?.data?.error || error?.message || 'Sharing failed.';

function openShare(item) {
  book.root.querySelector('.nb-dialog')?.remove();
  const name = String(item.title || '').trim() || 'Untitled';
  const shade = el('div', 'nb-dialog');
  const box = el('section', 'nb-dialog__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Share ${name}`);
  const head = el('header', 'nb-dialog__head');
  const heading = el('h2', 'nb-dialog__title', `Share “${name}”`);
  heading.dir = 'auto';
  const close = iconButton('close', 'Close', () => done());
  head.append(heading, close);

  const form = el('form', 'nb-share__form');
  const email = el('input', 'nb-share__email');
  email.type = 'email';
  email.required = true;
  email.placeholder = 'Email of a Gravitas member';
  email.setAttribute('aria-label', 'Email');
  const role = el('select', 'nb-share__role');
  role.setAttribute('aria-label', 'Role');
  for (const [value, label] of SHARE_ROLES) role.append(new Option(label, value, value === 'edit', value === 'edit'));
  const invite = el('button', 'ws-btn ws-btn--solid', 'Share');
  invite.type = 'submit';
  form.append(email, role, invite);

  const message = el('p', 'nb-share__message');
  message.setAttribute('role', 'status');
  const people = el('div', 'nb-share__people');
  box.append(head, form, message, el('p', 'nb-share__label', 'People with access'), people);
  shade.append(box);
  book.root.append(shade);
  email.focus();

  function done() {
    shade.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.stopPropagation(); done(); }
  }
  document.addEventListener('keydown', onKey, true);
  shade.addEventListener('mousedown', (event) => { if (event.target === shade) done(); });

  async function load() {
    people.replaceChildren(el('p', 'nb-share__empty', 'Loading…'));
    let data;
    try {
      data = await P.call(`/platform/share/?type=resource&id=${encodeURIComponent(item.id)}`);
    } catch (error) {
      people.replaceChildren(el('p', 'nb-share__empty', shareError(error)));
      return;
    }
    people.replaceChildren();
    const owner = el('div', 'nb-share__person');
    owner.append(el('span', 'nb-share__who', 'You'), el('span', 'nb-share__what', 'Owner'));
    people.append(owner);
    for (const grant of data.grants || []) {
      const row = el('div', 'nb-share__person');
      const who = el('span', 'nb-share__who');
      who.append(el('strong', null, grant.name || grant.email), el('small', null, grant.email));
      const label = SHARE_ROLES.find(([value]) => value === grant.role)?.[1] || grant.role;
      const remove = el('button', 'ws-btn ws-btn--sm ws-btn--ghost', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await P.call('/platform/share/', { method: 'POST', body: { type: 'resource', id: item.id, action: 'revoke', grant_id: grant.id } });
          load();
        } catch (error) {
          message.textContent = shareError(error);
          remove.disabled = false;
        }
      });
      row.append(who, el('span', 'nb-share__what', label), remove);
      people.append(row);
    }
    if (!(data.grants || []).length) people.append(el('p', 'nb-share__empty', 'Only you can open this note.'));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!address) return;
    invite.disabled = true;
    message.removeAttribute('data-tone');
    message.textContent = '';
    try {
      await P.call('/platform/share/', { method: 'POST', body: { type: 'resource', id: item.id, action: 'grant', email: address, role: role.value } });
      message.textContent = `Shared with ${address}.`;
      email.value = '';
      load();
    } catch (error) {
      message.dataset.tone = 'bad';
      message.textContent = shareError(error);
    } finally {
      invite.disabled = false;
    }
  });

  load();
}

/* Yesterday and tomorrow beside a day note, named by date so the reader knows
   where a click lands, and Today when the note is not today's. */
function dayNav(key) {
  const nav = el('nav', 'nb-daynav');
  nav.setAttribute('aria-label', 'Neighbouring days');
  const step = (by) => {
    const target = shiftDay(key, by);
    const button = el('button', 'nb-daynav__step');
    button.type = 'button';
    button.setAttribute('aria-label', dayDate(target).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    const mark = glyph('chevron');
    if (by < 0) mark.dataset.flip = '';
    const label = el('span', null, dayShort(target));
    if (by < 0) button.append(mark, label);
    else button.append(label, mark);
    button.addEventListener('click', () => openDay(target));
    return button;
  };
  nav.append(step(-1));
  const todayKey = dayKey(new Date());
  if (key !== todayKey) {
    const today = el('button', 'nb-daynav__today', 'Today');
    today.type = 'button';
    today.addEventListener('click', () => openDay(todayKey));
    nav.append(today);
  }
  nav.append(step(1));
  return nav;
}

/* Another screen asks for a note by URL: /notes?day=2026-10-11 from a
   calendar, /notes?note=42 from a link. The query is taken off the address
   at once so a reload shows the notebook rather than repeating the request. */
function takeRequest() {
  const params = new URLSearchParams(location.search);
  const day = params.get('day');
  const note = params.get('note');
  const fresh = params.get('new');
  if (!day && !note && fresh == null) return null;
  history.replaceState(history.state, '', location.pathname + location.hash);
  return { day: DAY_KEY.test(day || '') ? day : null, note: note ? note.replace(/^p-/, '') : null, fresh };
}

async function serveRequest(request) {
  if (!request || !book.root?.isConnected) return;
  if (request.day) { openDay(request.day); return; }
  if (request.fresh != null) {
    createNote(null, { title: String(request.fresh).trim().slice(0, 240) || 'Untitled note' });
    return;
  }
  if (!request.note) return;
  // A note made a moment ago on another screen is not in a list fetched
  // before it; ask once more before giving up on it.
  if (!book.items.some((item) => same(item.id, request.note))) await refreshNotebook(book.info);
  if (book.items.some((item) => same(item.id, request.note))) choose(request.note);
  else setStatus('That note is not in this notebook, or is no longer shared with you.', 'warn');
}

// The dock calendar marks days that have a note; this tells it which day is
// open and that it now has one.
function announceDay(key) {
  dispatchEvent(new CustomEvent('ws:journal-day', { detail: { date: key } }));
}

async function moveNote(id, folder) {
  const item = book.items.find((other) => same(other.id, id));
  const target = cleanFolder(folder);
  if (!item || cleanFolder(item.folder) === target) return;
  if (same(book.editor?.id, id)) book.editor.flush();
  const before = item.folder;
  item.folder = target;
  if (target) revealFolder(target);
  drawList();
  try {
    const result = await P.call(`/platform/nextcloud/notes/${item.id}/`, { method: 'PATCH', body: { folder: target } });
    Object.assign(item, result?.item || {});
    setStatus(target ? `Moved to ${target}` : 'Moved out of its folder');
  } catch (error) {
    item.folder = before;
    setStatus(error?.data?.detail || error?.message || 'The note could not be moved.', 'bad');
  }
  remember();
  drawList();
  if (same(book.editor?.id, id)) book.editor.refresh();
}

async function renameFolder(path, name) {
  const parent = path.split('/').slice(0, -1).join('/');
  const next = cleanFolder(parent ? `${parent}/${name}` : name);
  if (!next || next === path) { drawList(); return; }
  const moved = book.items.filter((item) => isOwn(item) && (item.folder === path || String(item.folder || '').startsWith(`${path}/`)));
  setStatus(`Renaming ${path}…`);
  const results = await Promise.allSettled(moved.map((item) => {
    const target = next + String(item.folder).slice(path.length);
    return P.call(`/platform/nextcloud/notes/${item.id}/`, { method: 'PATCH', body: { folder: target } })
      .then((result) => Object.assign(item, result?.item || { folder: target }));
  }));
  const failed = results.filter((result) => result.status === 'rejected').length;
  setStatus(failed ? `${failed} of ${moved.length} notes could not be moved. Try again.` : `Renamed to ${next}`, failed ? 'bad' : '');
  revealFolder(next);
  remember();
  drawList();
  book.editor?.refresh();
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
  renderSpaceIndex(slot).catch((error) => console.warn('Space index unavailable', error));
}

/* ---- Editing helpers -------------------------------------------------------
   replaceRange and wrapSelection live in ws-notes-commands.js with the block
   menu and the selection toolbar, which use them too. Every programmatic edit
   goes through insertText there, so Ctrl+Z undoes a bold or a continued list
   the way it undoes typing. */
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

function drawEditor(main, note, { fresh = false, write = false } = {}) {
  dispatchEvent(new CustomEvent('ws:note-open', { detail: { id: String(note.id), title: String(note.title || '').trim(), space: note.space } }));
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
  function drawCrumbs() {
    const trail = [info.area];
    if (note.project_title) trail.push(note.project_title);
    else if (isJournal(note)) trail.push('Journal');
    else trail.push(...cleanFolder(note.folder).split('/').filter(Boolean));
    crumbs.replaceChildren();
    for (const part of trail) crumbs.append(el('span', null, part), el('span', 'nb-bar__sep', '/'));
    crumbs.append(here);
  }
  drawCrumbs();
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
  body.placeholder = isJournal(note)
    ? 'What happened today? Type / for headings, lists, to-dos, tables and equations.'
    : 'Write something. Type / for headings, lists, to-dos, tables and equations.';
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
  foot.append(counts, el('span', 'nb-foot__hint', '/ blocks · select text to format · Ctrl+K link · Ctrl+E read · Saved as Markdown in Nextcloud'));
  main.append(bar, scroll, foot);
  // "+" and the grip sit beside each line of the page, not in the bar.
  const commands = locked ? null : attachCommands(body, { scroller: scroll, gutterHost: page });

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
    else if (note.scope === 'shared') meta.append(el('span', null, `Shared · ${note.owner_name || 'Collaborator'}`));
    else if (!isJournal(note)) meta.append(el('span', null, cleanFolder(note.folder) ? `In ${cleanFolder(note.folder).replace(/\//g, ' / ')}` : 'Personal'));
    if (note.favorite) meta.append(el('span', null, 'Pinned'));
    if (isJournal(note)) meta.append(dayNav(note.journal_date));
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
      announceChange(note);
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
      commands?.close();
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
    menu.replaceChildren(...baseItems);
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
  if (!locked && isOwn(note)) {
    menu.append(menuItem('share', 'Share…', () => { closeMenu(); openShare(note); }));
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
      announceRemoval(note.id);
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
  /* Filing: the menu turns into the list of folders, with a field for a new
     one at the bottom. Day notes stay in the Journal and project notes in
     their project, so neither offers it. */
  if (!locked && isOwn(note) && !isJournal(note)) {
    menu.append(menuItem('projects', 'Move to folder…', () => {
      const here = cleanFolder(note.folder);
      const options = ['', ...allFolders()];
      menu.replaceChildren(el('p', 'nb-menu__label', 'Move to'));
      for (const path of options) {
        const item = menuItem(path ? 'projects' : 'notes', path ? path.split('/').join(' / ') : 'No folder', () => {
          closeMenu();
          moveNote(note.id, path);
        });
        if (path === here) item.setAttribute('aria-current', 'true');
        menu.append(item);
      }
      const field = el('input', 'nb-menu__input');
      field.placeholder = 'New folder, e.g. Thesis/Chapter 1';
      field.setAttribute('aria-label', 'New folder');
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const path = cleanFolder(field.value);
        if (!path) return;
        closeMenu();
        moveNote(note.id, path);
      });
      menu.append(field);
      (menu.querySelector('[aria-current="true"]') || field).focus();
    }));
  }
  if (!locked) menu.append(remove);
  const baseItems = [...menu.children];

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
    // A note deleted from the list must not be saved again by this editor.
    focusTitle: () => {
      if (page.dataset.mode === 'read') setMode('edit');
      title.focus();
      title.select();
    },
    cancel: () => { clearTimeout(timer); timer = null; dirty = false; queued = false; },
    destroy: () => { resize.disconnect(); commands?.destroy(); },
    refresh: () => { drawCrumbs(); drawMeta(); },
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
    } else if (write && !locked) {
      body.focus();
      body.setSelectionRange(body.value.length, body.value.length);
    }
  });
}

async function renderNativeNotes(host, info) {
  if ((info.space === 'core' && !P.canOpenCore()) || (info.space !== 'core' && !P.canOpenResearch() && !P.canOpenCore())) {
    location.replace('/workspace/dashboard');
    return;
  }

  const request = takeRequest();

  // Already showing this notebook (a background sync asked for a repaint, or
  // the calendar asked for a day): update it in place rather than tearing
  // down the note being written.
  if (book.root?.isConnected && host.contains(book.root) && book.info?.space === info.space) {
    serveRequest(request);
    await refreshNotebook(info);
    return;
  }

  const cached = notebooks.get(info.space);
  if (cached) {
    mountNotebook(host, info, cached);
    serveRequest(request);
  } else {
    loadingNotebook(host, info);
  }

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
    syncInBackground(info);
    return;
  }
  const items = (Array.isArray(data.items) ? data.items : []).filter((item) => item.space === info.space);
  notebooks.set(info.space, { data, items });
  mountNotebook(host, info, { data, items });
  serveRequest(request);
  syncInBackground(info);
}

function syncInBackground(info) {
  startNotesSync({
    space: info.space,
    busy: () => !!book.editor && (book.editor.dirty() || book.editor.focused()),
    status: (text, tone = '') => { if (book.info?.space === info.space) setStatus(text, tone); },
    synced: () => { if (book.root?.isConnected && book.info?.space === info.space) refreshNotebook(info); },
  });
}

/* ws-app is the one router; it calls these. This module used to listen to
   popstate and ws:navigate on its own and draw into the view whenever the
   path looked like a notebook, beside the two other routers doing the same. */
export function renderNotesRoute(host) {
  if (location.pathname.replace(/\/$/, '') === '/workspace/research/editor') {
    history.replaceState(history.state, '', `/workspace/research/notes${location.search}${location.hash}`);
  }
  const info = route();
  if (!info || info.kind !== 'notes') return Promise.resolve();
  setCrumbs(info);
  return renderNativeNotes(host, info);
}

export function renderMirrorRoute(host) {
  return renderMirrorAdmin(host, { kind: 'admin', title: 'Nextcloud Mirror', area: 'Core Admin' });
}

/* Leaving a note mid-sentence still saves it: ws-app calls this whenever it
   draws anything other than a notebook, and the page calls it on the way out. */
export function leaveNotes() {
  book.editor?.flush();
}
addEventListener('pagehide', leaveNotes);
