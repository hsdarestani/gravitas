import * as P from './ws-platform.js?v=20260914-7';

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

function stateBadge(item) {
  const value = item?.sync_state || 'pending';
  const labels = {
    synced: 'Mirrored', pending: 'Pending', error: 'Sync error', conflict: 'Conflict', readonly: 'Read only',
  };
  const badge = el('span', 'v-badge nc-note-badge', labels[value] || value);
  badge.dataset.state = value;
  return badge;
}

function time(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function openNative(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function shell(host, info) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc nc-notes');
  const head = el('header', 'ws-doc__head fl-head nc-notes__head');
  const copy = el('div');
  copy.append(el('span', 'fl-eyebrow', info.kind === 'admin' ? 'CORE / NATIVE APPS' : `${info.area.toUpperCase()} / NEXTCLOUD NOTES`));
  copy.append(el('h1', 'ws-doc__title', info.title));
  copy.append(el('p', 'ws-doc__meta', info.kind === 'admin'
    ? 'Gravitas and Nextcloud are two synchronized surfaces of the same workspace: Files/Team Folders for storage, Notes for writing, and Deck for execution.'
    : 'One note, two surfaces. Edits here and in Nextcloud Notes are reconciled without silent last-write-wins.'));
  head.append(copy);
  doc.append(head);
  host.append(doc);
  return { doc, head };
}

function loading(host, info) {
  const { doc } = shell(host, info);
  const grid = el('div', info.kind === 'admin' ? 'nc-mirror-grid' : 'nc-notes__layout');
  const first = el('div', 'fl-skeleton');
  const second = el('div', 'fl-skeleton nc-notes__skeleton-editor');
  grid.append(first, second);
  doc.append(grid);
}

function errorView(host, info, error, retry) {
  const { doc } = shell(host, info);
  const box = el('div', 'fl-state fl-state--error');
  box.append(el('strong', null, info.kind === 'admin' ? 'Mirror status could not be loaded.' : 'Notes could not be loaded.'));
  box.append(el('p', 'fl-muted', error?.message || 'The Nextcloud mirror did not answer. Saved Gravitas data was not deleted.'));
  box.append(action('Retry', retry, { solid: true }));
  doc.append(box);
}

function noteRow(item, active, choose) {
  const row = el('button', 'nc-note-row');
  row.type = 'button';
  if (active) row.setAttribute('aria-current', 'page');
  const title = el('strong', 'nc-note-row__title', item.title || 'Untitled');
  const meta = el('span', 'nc-note-row__meta');
  meta.append(stateBadge(item));
  const stamp = time(item.updated);
  if (stamp) meta.append(el('small', 'fl-muted', stamp));
  row.append(title, meta);
  row.addEventListener('click', () => choose(item.id));
  return row;
}

function syncSummary(data) {
  const counts = data?.sync?.counts || data?.counts || {};
  const bits = [];
  for (const [key, label] of [
    ['created', 'created'], ['pushed', 'pushed'], ['pulled', 'pulled'], ['adopted', 'adopted'], ['conflicts', 'conflicts'],
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

function injectAdminMirrorEntry() {
  if (!P.isCoreAdmin() || !location.pathname.startsWith('/workspace/core/admin')) return;
  const nav = $('.fl-index-nav');
  if (!nav || nav.querySelector('[data-nextcloud-mirror-link]')) return;
  const button = el('button', 'fl-index-link');
  button.type = 'button';
  button.dataset.nextcloudMirrorLink = '1';
  const glyph = el('span', 'fl-index-link__icon');
  glyph.innerHTML = window.GravitasIcons?.icon('files', 'g-wi') || '';
  button.append(glyph, document.createTextNode('Nextcloud Mirror'));
  if (location.pathname.replace(/\/$/, '') === '/workspace/core/admin/nextcloud') button.setAttribute('aria-current', 'page');
  button.addEventListener('click', () => navTo('/workspace/core/admin/nextcloud'));
  const deck = [...nav.children].find((node) => node.textContent?.includes('Nextcloud Deck'));
  if (deck) deck.before(button);
  else nav.append(button);
}

function mirrorPanel(title, state, detail, badges = []) {
  const panel = el('section', 'fl-panel nc-mirror-card');
  const head = el('div', 'fl-panel__head');
  const copy = el('div');
  copy.append(el('h2', 'fl-panel__title', title));
  copy.append(el('p', 'fl-muted', detail));
  head.append(copy);
  const badge = el('span', 'v-badge nc-mirror-state', state);
  badge.dataset.state = state.toLowerCase().replace(/\s+/g, '-');
  head.append(badge);
  panel.append(head);
  const body = el('div', 'fl-panel__body nc-mirror-card__body');
  if (badges.length) {
    const row = el('div', 'nc-mirror-badges');
    badges.filter(Boolean).forEach((value) => row.append(el('span', 'v-badge', String(value))));
    body.append(row);
  }
  panel.append(body);
  panel.body = body;
  return panel;
}

async function renderMirrorAdmin(host, info) {
  if (!P.isCoreAdmin()) {
    location.replace('/workspace/dashboard');
    return;
  }
  loading(host, info);
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
    errorView(host, info, error, () => renderMirrorAdmin(host, info));
    return;
  }

  const { doc, head } = shell(host, info);
  const refresh = action('Refresh status', () => renderMirrorAdmin(host, info));
  const openFiles = action('Open Nextcloud', () => openNative(cloudData?.nextcloud?.url), { solid: true });
  const headActions = el('div', 'nc-notes__head-actions');
  headActions.append(refresh, openFiles);
  head.append(headActions);

  const grid = el('div', 'nc-mirror-grid');
  const projectCount = cloudData?.projects?.length || 0;
  const identityReady = !!cloudData?.nextcloud?.identity_ready;
  const files = mirrorPanel(
    'Files & Team Folders',
    cloudData ? (identityReady ? 'Mirrored' : 'Identity pending') : 'Unavailable',
    'Research project folders, files, object ACLs and project membership are reflected in native Nextcloud storage.',
    [identityReady ? `Identity ${cloudData.nextcloud.username}` : '', `${projectCount} visible project mounts`],
  );
  if (cloudData?.nextcloud?.files_url) {
    const open = action('Open Files', () => openNative(cloudData.nextcloud.files_url), { tiny: true });
    files.body.append(open);
  }

  const noteItems = notesData?.items || [];
  const noteStates = noteItems.reduce((acc, item) => {
    const key = item.sync_state || 'pending';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const noteState = !notesData ? 'Unavailable' : (noteStates.conflict ? 'Conflict' : noteStates.error ? 'Retrying' : 'Mirrored');
  const notes = mirrorPanel(
    'Notes',
    noteState,
    'Core and Research personal notes use the official Nextcloud Notes app as a native writing surface while staying indexed in Gravitas for links, search and AI.',
    [`${noteItems.length} mapped notes`, noteStates.conflict ? `${noteStates.conflict} conflicts preserved` : '', noteStates.error ? `${noteStates.error} retrying` : ''],
  );
  const noteTools = el('div', 'nc-mirror-actions');
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
  const openNotes = action('Open Notes', () => openNative(notesData?.native_url), { tiny: true });
  noteTools.append(syncNotes, openNotes);
  notes.body.append(noteTools);

  const deckState = !deckData ? 'Unavailable' : (deckData.available ? 'Mirrored' : deckData.configured ? 'Unavailable' : 'Not configured');
  const deck = mirrorPanel(
    'Deck',
    deckState,
    'Core tasks mirror to Deck in both directions for execution fields: title, lane/status and due date. Concurrent edits are preserved as conflicts instead of overwritten.',
    [deckData?.mirror_mode === 'bidirectional-execution' ? 'Two-way execution' : '', deckData?.task_count != null ? `${deckData.task_count} Core tasks` : ''],
  );
  const deckTools = el('div', 'nc-mirror-actions');
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
  const openDeck = action('Open Deck', () => openNative(deckData?.board?.url), { tiny: true });
  deckTools.append(syncDeck, openDeck);
  deck.body.append(deckTools);

  const enabledApps = new Set((cloudData?.nextcloud?.apps || []).map((app) => app.id));
  const identity = mirrorPanel(
    'Identity, SSO & native apps',
    identityReady ? 'Connected' : 'Pending',
    'The same Gravitas account maps to a Nextcloud identity. Project access is translated to Nextcloud groups and Team Folder ACLs instead of maintained as a second manual permission system.',
    [enabledApps.has('notes') ? 'Notes' : '', enabledApps.has('deck') ? 'Deck' : '', enabledApps.has('groupfolders') ? 'Team Folders' : '', enabledApps.has('collectives') ? 'Collectives' : '', enabledApps.has('spreed') ? 'Talk' : ''],
  );
  grid.append(files, notes, deck, identity);
  doc.append(grid);

  const contract = el('section', 'fl-panel nc-mirror-contract');
  const contractHead = el('div', 'fl-panel__head');
  contractHead.append(el('div')).append(el('h2', 'fl-panel__title', 'Mirror contract'));
  const contractBody = el('div', 'fl-panel__body');
  const rows = [
    ['Files / Team Folders', 'Files, project folders, storage paths and project ACLs', 'Bidirectional storage + ACL reconciliation'],
    ['Notes', 'Core and Research personal notes', 'Bidirectional with ETag conflict protection'],
    ['Deck', 'Core task title, execution lane/status and due date', 'Bidirectional safe execution fields'],
    ['Gravitas only', 'LMS rules, certificates, research metadata, cross-layer links, audit history and object policies', 'Canonical relational context; linked to native Nextcloud objects rather than flattened into them'],
  ];
  rows.forEach(([surface, data, mode]) => {
    const row = el('div', 'nc-mirror-contract__row');
    row.append(el('strong', null, surface), el('span', null, data), el('span', 'fl-muted', mode));
    contractBody.append(row);
  });
  contract.append(contractHead, contractBody);
  doc.append(contract);
}

async function renderNativeNotes(host, info) {
  if ((info.space === 'core' && !P.canOpenCore()) || (info.space === 'research' && !P.canOpenResearch() && !P.canOpenCore())) {
    location.replace('/workspace/dashboard');
    return;
  }

  loading(host, info);
  let data;
  try {
    data = await P.call('/platform/nextcloud/notes/');
  } catch (error) {
    errorView(host, info, error, () => renderNativeNotes(host, info));
    return;
  }

  const { doc, head } = shell(host, info);
  const all = Array.isArray(data.items) ? data.items : [];
  const items = all.filter((item) => item.space === info.space);
  let selectedId = selections.get(info.space);
  if (!items.some((item) => String(item.id) === String(selectedId))) selectedId = items[0]?.id || null;
  if (selectedId) selections.set(info.space, selectedId);

  const headActions = el('div', 'nc-notes__head-actions');
  const status = el('span', 'fl-muted nc-notes__global-status', data.available === false ? 'Nextcloud is temporarily unavailable.' : syncSummary(data));
  const sync = action('Sync now', async () => {
    sync.disabled = true;
    status.textContent = 'Reconciling…';
    try {
      const result = await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
      status.textContent = syncSummary(result);
      await renderNativeNotes(host, info);
    } catch (error) {
      status.textContent = error?.message || 'Sync failed. The timer will retry automatically.';
      sync.disabled = false;
    }
  });
  const native = action('Open Nextcloud Notes', () => openNative(data.native_url), { solid: true });
  headActions.append(status, sync, native);
  head.append(headActions);

  const layout = el('div', 'nc-notes__layout');
  const sidebar = el('section', 'fl-panel nc-notes__list');
  const sidebarHead = el('div', 'fl-panel__head');
  const sidebarTitle = el('div');
  sidebarTitle.append(el('h2', 'fl-panel__title', 'Notes'));
  sidebarTitle.append(el('p', 'fl-muted', `${items.length} in ${info.area}`));
  const add = action('New note', async () => {
    add.disabled = true;
    try {
      const result = await P.call('/platform/nextcloud/notes/', {
        method: 'POST',
        body: { title: 'Untitled note', content: '', space: info.space },
      });
      selections.set(info.space, result.item.id);
      await renderNativeNotes(host, info);
    } catch (error) {
      status.textContent = error?.message || 'The note could not be created.';
      add.disabled = false;
    }
  }, { solid: true, tiny: true });
  sidebarHead.append(sidebarTitle, add);
  const listBody = el('div', 'fl-panel__body nc-notes__list-body');
  sidebar.append(sidebarHead, listBody);

  const editor = el('section', 'fl-panel nc-notes__editor');
  layout.append(sidebar, editor);
  doc.append(layout);

  const choose = (id) => {
    selections.set(info.space, id);
    renderNativeNotes(host, info);
  };
  if (!items.length) {
    const empty = el('div', 'fl-state');
    empty.append(el('strong', null, 'No notes yet.'));
    empty.append(el('p', 'fl-muted', 'Create one here, or create it in the Gravitas category in Nextcloud Notes. The mirror adopts it automatically.'));
    listBody.append(empty);
  } else {
    items.forEach((item) => listBody.append(noteRow(item, String(item.id) === String(selectedId), choose)));
  }

  const selected = items.find((item) => String(item.id) === String(selectedId));
  if (!selected) {
    const empty = el('div', 'fl-state nc-notes__empty-editor');
    empty.append(el('strong', null, 'Select or create a note.'));
    editor.append(empty);
    return;
  }

  const editorHead = el('div', 'fl-panel__head nc-notes__editor-head');
  const titleWrap = el('div', 'nc-note-title-wrap');
  const title = el('input', 'v-input nc-note-title');
  title.value = selected.title || '';
  title.setAttribute('aria-label', 'Note title');
  titleWrap.append(title, stateBadge(selected));
  const tools = el('div', 'nc-note-tools');
  const favorite = action(selected.favorite ? '★ Favorite' : '☆ Favorite', () => {
    selected.favorite = !selected.favorite;
    favorite.textContent = selected.favorite ? '★ Favorite' : '☆ Favorite';
    scheduleSave();
  }, { tiny: true });
  const open = action('Open native', () => openNative(selected.native_url), { tiny: true });
  tools.append(favorite, open);
  editorHead.append(titleWrap, tools);

  const body = el('div', 'nc-notes__editor-body');
  const textarea = el('textarea', 'v-input nc-note-content');
  textarea.value = selected.content || '';
  textarea.spellcheck = true;
  textarea.setAttribute('aria-label', 'Markdown note content');
  const saveState = el('p', 'nc-note-save-state fl-muted');
  const help = el('p', 'fl-muted nc-note-help', 'Markdown is stored in the official Nextcloud Notes app. Gravitas keeps the same note indexed for search, links and AI context.');
  body.append(textarea, saveState, help);

  if (selected.sync_state === 'conflict') {
    const conflict = el('div', 'ws-alert nc-note-conflict');
    conflict.append(el('p', 'ws-alert__title', 'This note changed in both places.'));
    conflict.append(el('p', null, 'Neither side was overwritten. Open the native copy to compare it with this Gravitas copy, then make the versions agree and run Sync now.'));
    conflict.append(action('Open Nextcloud copy', () => openNative(selected.native_url), { solid: true }));
    body.prepend(conflict);
  } else if (selected.sync_state === 'error') {
    const warning = el('div', 'ws-alert');
    warning.append(el('p', 'ws-alert__title', 'Saved in Gravitas; Nextcloud mirror is pending.'));
    warning.append(el('p', null, selected.sync_error || 'The background mirror will retry automatically.'));
    body.prepend(warning);
  }

  editor.append(editorHead, body);

  let saveTimer = null;
  let saving = false;
  let queued = false;
  const save = async () => {
    if (saving) { queued = true; return; }
    saving = true;
    saveState.textContent = 'Saving and mirroring…';
    try {
      const result = await P.call(`/platform/nextcloud/notes/${selected.id}/`, {
        method: 'PATCH',
        body: {
          title: title.value.trim() || 'Untitled note',
          content: textarea.value,
          favorite: !!selected.favorite,
          space: info.space,
        },
      });
      Object.assign(selected, result.item || {});
      saveState.textContent = selected.sync_state === 'error' ? 'Saved locally · mirror pending' : 'Saved · mirrored';
      selections.set(info.space, selected.id);
    } catch (error) {
      if (error?.status === 409) {
        if (error.data?.item) Object.assign(selected, error.data.item);
        saveState.textContent = 'Saved locally · conflict preserved';
        saveState.dataset.tone = 'bad';
      } else {
        saveState.textContent = 'Save failed';
        saveState.dataset.tone = 'bad';
      }
    } finally {
      saving = false;
      if (queued) { queued = false; save(); }
    }
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveState.textContent = 'Unsaved changes';
    saveState.removeAttribute('data-tone');
    saveTimer = setTimeout(save, 650);
  };
  title.addEventListener('input', scheduleSave);
  textarea.addEventListener('input', scheduleSave);
}

function schedule() {
  if (router.scheduled) return;
  router.scheduled = true;
  queueMicrotask(async () => {
    router.scheduled = false;
    injectAdminMirrorEntry();
    const info = route();
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
  schedule();
}
