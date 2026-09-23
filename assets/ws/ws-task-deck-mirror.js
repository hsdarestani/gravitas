import * as P from './ws-platform.js?v=20260923-checklist1';
import { renderCoreTasks } from './ws-views.js?v=20260923-checklist1';
import { observeSurface } from './ws-runtime-performance.js?v=20260920-perf1';

const state = {
  observer: null,
  scheduled: false,
  mounting: false,
  syncInFlight: null,
  timer: 0,
  lastSyncAt: 0,
};

function route() {
  return location.pathname.replace(/\/$/, '') || '/';
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function button(label, onClick, primary = false) {
  const node = el('button', primary ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function go(path) {
  if (path === route()) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function installStyle() {
  if (document.getElementById('ws-task-deck-mirror-style')) return;
  const style = document.createElement('style');
  style.id = 'ws-task-deck-mirror-style';
  style.textContent = `
    .ws-core-deck-mirror { margin:0 0 18px; }
    .ws-core-deck-mirror .v-panel__body { display:grid; gap:10px; }
    .ws-core-deck-mirror__lead { display:grid; gap:4px; }
    .ws-core-deck-mirror__lead h2 { margin:0; font-size:1rem; }
    .ws-core-deck-mirror__lead p { margin:0; max-width:900px; }
    .ws-core-deck-mirror__status[data-tone="bad"] { color:var(--danger,#d92d20); }
    .ws-core-deck-mirror__status[data-tone="ok"] { color:var(--success,#2e7d32); }
  `;
  document.head.append(style);
}

function mirrorPanel() {
  const panel = el('section', 'v-panel ws-core-deck-mirror');
  // Keep the legacy Deck-first overlay from replacing the native task page.
  // It checks this marker before doing destructive work.
  panel.dataset.coreDeckSurface = 'true';
  panel.dataset.coreDeckMirror = 'true';

  const body = el('div', 'v-panel__body');
  const lead = el('div', 'ws-core-deck-mirror__lead');
  lead.append(
    el('h2', '', 'Gravitas ↔ Nextcloud Deck'),
    el('p', 'v-note', 'Tasks stay available in both places. Title, status/lane and due date are synchronized in both directions; Gravitas keeps the project, initiative, owner and research context.'),
  );

  const actions = el('div', 'v-toolbar');
  const status = el('span', 'v-toolbar__count ws-core-deck-mirror__status', 'Connecting to Nextcloud…');
  actions.append(status);
  body.append(lead, actions);
  panel.append(body);
  panel._actions = actions;
  panel._status = status;
  return panel;
}

function describeSync(result) {
  const changes = result?.changes || {};
  const bits = [
    `${result?.tasks || 0} tasks`,
    `${changes.pushed ?? changes.created ?? 0} pushed`,
    `${changes.pulled || 0} pulled`,
  ];
  if (changes.moved) bits.push(`${changes.moved} moved`);
  if (changes.conflicts) bits.push(`${changes.conflicts} conflicts`);
  return `Synced · ${bits.join(' · ')}`;
}

async function syncDeck(panel, { automatic = false } = {}) {
  if (!panel?.isConnected || panel.dataset.canSync !== '1') return null;
  if (state.syncInFlight) return state.syncInFlight;

  const status = panel._status;
  const syncButton = panel.querySelector('[data-deck-sync]');
  if (syncButton) syncButton.disabled = true;
  status.dataset.tone = '';
  status.textContent = automatic ? 'Auto-syncing Gravitas and Deck…' : 'Syncing Gravitas and Deck…';

  state.syncInFlight = P.call('/platform/admin/deck/sync/', { method: 'POST', body: {} });
  try {
    const result = await state.syncInFlight;
    state.lastSyncAt = Date.now();
    status.dataset.tone = (result.changes?.conflicts || 0) ? 'bad' : 'ok';
    status.textContent = describeSync(result);

    // If Deck changed Gravitas, redraw the native task list immediately. The
    // marker is reinserted synchronously by this module before the legacy
    // observer can replace the page again.
    if ((result.changes?.pulled || 0) > 0 && route() === '/workspace/core/tasks') {
      dispatchEvent(new PopStateEvent('popstate'));
    }
    return result;
  } catch (error) {
    status.dataset.tone = 'bad';
    status.textContent = error?.data?.error || 'Deck sync failed.';
    return null;
  } finally {
    state.syncInFlight = null;
    if (syncButton?.isConnected) syncButton.disabled = false;
  }
}

async function hydratePanel(panel) {
  const actions = panel._actions;
  const status = panel._status;
  try {
    const cloud = await P.call('/platform/nextcloud/');
    const root = String(cloud.nextcloud?.url || '').replace(/\/$/, '');
    let deckUrl = root ? `${root}/index.php/apps/deck/` : '';
    let deckState = null;

    try {
      deckState = await P.call('/platform/admin/deck/');
      if (deckState.board?.url) deckUrl = deckState.board.url;
    } catch (error) {
      if (error?.status !== 403) console.warn('Deck status unavailable', error);
    }

    actions.innerHTML = '';
    if (deckUrl) {
      actions.append(button('Open Nextcloud Deck', () => window.open(deckUrl, '_blank', 'noopener'), false));
    }
    actions.append(button('Planning & Projects', () => go('/workspace/operating')));

    if (deckState) {
      panel.dataset.canSync = '1';
      const sync = button('Sync now', () => syncDeck(panel), true);
      sync.dataset.deckSync = 'true';
      actions.append(sync);
      status.textContent = `${deckState.task_count || 0} mirrored tasks · two-way sync`;

      // Opening Core Tasks should make both surfaces current without asking
      // the user to remember a separate reconcile step.
      if (Date.now() - state.lastSyncAt > 15000) {
        queueMicrotask(() => syncDeck(panel, { automatic: true }));
      }
    } else {
      panel.dataset.canSync = '0';
      status.textContent = deckUrl
        ? 'Tasks are visible here and in Deck. A Core admin can run reconciliation.'
        : 'Nextcloud Deck is not configured yet.';
    }
    actions.append(status);
  } catch (error) {
    status.dataset.tone = 'bad';
    status.textContent = 'Nextcloud status could not be loaded. Gravitas tasks remain available here.';
  }
}

function mountMirror() {
  if (route() !== '/workspace/core/tasks' || state.mounting) return;
  const host = document.getElementById('ws-view');
  if (!host || host.querySelector('[data-core-deck-mirror]')) return;

  state.mounting = true;
  try {
    // Re-render the authoritative Gravitas task view. The older Deck-first
    // layer may already have replaced it; this deliberately restores the
    // native page instead of trying to reconstruct its rows here.
    Promise.resolve(renderCoreTasks(host, { go })).catch((error) => {
      console.error('Core task view failed', error);
    });

    const doc = host.querySelector('.ws-doc');
    const head = doc?.querySelector(':scope > .ws-doc__head');
    if (!doc || !head) return;
    const panel = mirrorPanel();
    head.insertAdjacentElement('afterend', panel);
    hydratePanel(panel);
  } finally {
    state.mounting = false;
  }
}

function schedule() {
  if (route() !== '/workspace/core/tasks' || state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    mountMirror();
  });
}

export function installTaskDeckMirror() {
  installStyle();
  if (!state.observer) {
    state.observer = observeSurface({
      target: document.getElementById('ws-view'),
      active: () => route() === '/workspace/core/tasks',
      callback: schedule,
      subtree: false,
    });
    addEventListener('popstate', schedule);
    addEventListener('ws:navigate', schedule);
  }

  if (!state.timer) {
    state.timer = window.setInterval(() => {
      if (route() !== '/workspace/core/tasks' || document.visibilityState !== 'visible') return;
      const panel = document.querySelector('[data-core-deck-mirror][data-can-sync="1"]');
      if (panel && Date.now() - state.lastSyncAt >= 60000) {
        syncDeck(panel, { automatic: true });
      }
    }, 15000);
  }
  schedule();
}
