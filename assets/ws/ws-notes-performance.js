import * as P from './ws-platform.js?v=20260914-7';

const state = {
  installed: false,
  observer: null,
  timer: null,
  lastSync: new Map(),
  inFlight: new Map(),
};

function routeInfo() {
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/workspace/research/editor' || path === '/workspace/research/notes') return { space: 'research', canonical: '/workspace/research/notes' };
  if (path === '/workspace/core/notes') return { space: 'core', canonical: '/workspace/core/notes' };
  return null;
}

function canonicalizeResearchNotes() {
  const info = routeInfo();
  if (!info || location.pathname.replace(/\/$/, '') !== '/workspace/research/editor') return info;
  const next = `${info.canonical}${location.search || ''}${location.hash || ''}`;
  history.replaceState(history.state, '', next);
  return info;
}

function summary(result) {
  const counts = result?.counts || {};
  const labels = [
    ['created', 'created'], ['pushed', 'pushed'], ['pulled', 'pulled'],
    ['adopted', 'adopted'], ['deleted', 'deleted'], ['conflicts', 'conflicts'],
  ];
  const bits = labels.filter(([key]) => Number(counts[key] || 0)).map(([key, label]) => `${counts[key]} ${label}`);
  return bits.length ? bits.join(' · ') : 'Up to date';
}

function editorIsBusy() {
  const active = document.activeElement;
  return !!active?.closest?.('.nc-notes__editor');
}

async function refreshAfterSync(space) {
  const current = routeInfo();
  if (!current || current.space !== space || editorIsBusy()) return;
  // The canonical Notes GET is local-only, so this repaint is cheap and picks
  // up notes adopted/pulled by the background reconciliation.
  dispatchEvent(new CustomEvent('ws:navigate'));
}

async function backgroundSync(info, status) {
  const now = Date.now();
  const last = state.lastSync.get(info.space) || 0;
  if (state.inFlight.get(info.space) || now - last < 45000) return;
  state.lastSync.set(info.space, now);
  state.inFlight.set(info.space, true);
  if (status) status.textContent = 'Local notes ready · syncing in background…';
  try {
    const result = await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
    if (status?.isConnected) status.textContent = `Local notes ready · ${summary(result)}`;
    setTimeout(() => refreshAfterSync(info.space), 80);
  } catch (error) {
    if (status?.isConnected) status.textContent = 'Local notes ready · Nextcloud sync will retry later';
    console.warn('Background Notes sync failed', error);
  } finally {
    state.inFlight.delete(info.space);
  }
}

function enhance() {
  const info = canonicalizeResearchNotes();
  if (!info) return;
  const doc = document.querySelector('#ws-view .nc-notes');
  const layout = doc?.querySelector('.nc-notes__layout');
  if (!doc || !layout) return;
  const status = doc.querySelector('.nc-notes__global-status');
  if (doc.dataset.fastNotesReady !== '1') {
    doc.dataset.fastNotesReady = '1';
    if (status) status.textContent = 'Local notes ready';
  }
  backgroundSync(info, status);
}

function schedule() {
  clearTimeout(state.timer);
  state.timer = setTimeout(enhance, 40);
}

export function installNotesPerformance() {
  if (state.installed) return;
  state.installed = true;
  // Normalize the legacy Editor alias before the workspace routers decide
  // which enhancements own the page. This also makes the Markdown index from
  // the Space integration available on the route shown in older navigation.
  canonicalizeResearchNotes();
  state.observer = new MutationObserver(schedule);
  state.observer.observe(document.getElementById('ws-view') || document.body, { childList: true, subtree: true });
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  schedule();
}
