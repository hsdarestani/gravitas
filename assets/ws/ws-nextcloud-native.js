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
  if (path === '/workspace/core/notes') return { space: 'core', title: 'Core Notes', area: 'Core' };
  if (path === '/workspace/research/notes' || path === '/workspace/research/editor') {
    return { space: 'research', title: 'Research Notes', area: 'Research' };
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
  const here = el('span', 'ws-crumbs__here', 'Notes');
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
  copy.append(el('span', 'fl-eyebrow', `${info.area.toUpperCase()} / NEXTCLOUD NOTES`));
  copy.append(el('h1', 'ws-doc__title', info.title));
  copy.append(el('p', 'ws-doc__meta', 'One note, two surfaces. Edits here and in Nextcloud Notes are reconciled without silent last-write-wins.'));
  head.append(copy);
  doc.append(head);
  host.append(doc);
  return { doc, head };
}

function loading(host, info) {
  const { doc } = shell(host, info);
  const grid = el('div', 'nc-notes__layout');
  const list = el('div', 'fl-skeleton');
  const editor = el('div', 'fl-skeleton nc-notes__skeleton-editor');
  grid.append(list, editor);
  doc.append(grid);
}

function errorView(host, info, error, retry) {
  const { doc } = shell(host, info);
  const box = el('div', 'fl-state fl-state--error');
  box.append(el('strong', null, 'Notes could not be loaded.'));
  box.append(el('p', 'fl-muted', error?.message || 'The Nextcloud mirror did not answer. Your saved notes were not deleted.'));
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
    const info = route();
    if (!info) return;
    setCrumbs(info);
    const host = $('#ws-view');
    if (host) await renderNativeNotes(host, info);
  });
}

export function installNextcloudNativeRouter() {
  if (router.installed) return;
  router.installed = true;
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  schedule();
}
