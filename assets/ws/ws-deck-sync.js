/* ==========================================================================
   GRAVIQUEST WORKSPACE  ·  CORE TASKS ⇄ NEXTCLOUD DECK
   One row above the Core task board: where the Deck sync stands, and the
   three things to do about it (open Deck, go to Planning, sync now).

   Title, lane and due date sync both ways; Gravitas keeps the project, key
   result, owner and research context. A host-side reconciliation timer keeps
   the mirror current. Opening the board must NEVER start a blocking full
   reconciliation: the user can explicitly request one with Sync now.

   This used to be ws-task-deck-mirror.js, an overlay that watched #ws-view,
   redrew the whole task board if it thought something else had replaced it,
   and inserted this row under the head. An older overlay beside it,
   ws-task-deck-fixes.js, had once replaced the board with a "Deck is the
   board" hero, and the two carried markers to stop each other. The board now
   asks for this row itself, so neither guard is needed.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261016-task1';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const button = (label, handler, solid = false) => {
  const node = el('button', `ws-btn${solid ? ' ws-btn--solid' : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};

// Deduplicate explicit sync requests across redraws.
const sync = { inFlight: null };

function describe(result) {
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

/* `onPulled` redraws the board when Deck changed something in Gravitas. */
export function deckPanel({ go, onPulled } = {}) {
  const panel = el('section', 'v-panel ws-core-deck-mirror');
  panel.dataset.coreDeckSurface = 'true';
  panel.dataset.coreDeckMirror = 'true';
  const body = el('div', 'v-panel__body');
  const lead = el('div', 'ws-core-deck-mirror__lead');
  const title = el('div', 'ws-core-deck-mirror__title');
  const status = el('span', 'v-toolbar__count ws-core-deck-mirror__status', 'Connecting to Nextcloud…');
  title.append(el('h2', null, 'Synced with Nextcloud Deck'), status);
  lead.append(title, el('p', 'v-note', 'Title, lane and due date sync both ways. GraviQuest keeps the project, initiative, owner and research context.'));
  const actions = el('div', 'v-toolbar');
  body.append(lead, actions);
  panel.append(body);

  let canSync = false;
  let syncButton = null;
 
  async function run() {
    if (!canSync || !panel.isConnected) return null;
    if (sync.inFlight) return sync.inFlight;
    if (syncButton) syncButton.disabled = true;
    delete status.dataset.tone;
    status.textContent = 'Syncing GraviQuest and Deck…';
    sync.inFlight = P.call('/platform/admin/deck/sync/', { method: 'POST', body: {} });
    try {
      const result = await sync.inFlight;
      status.dataset.tone = result?.changes?.conflicts ? 'bad' : 'ok';
      status.textContent = describe(result);
      if ((result?.changes?.pulled || 0) > 0 && onPulled) onPulled();
      return result;
    } catch (error) {
      // Background reconciliation is a separate host timer, not this request.
      status.dataset.tone = 'bad';
      const detail = String(error?.data?.detail || '').slice(0, 180);
      status.textContent = detail
        ? `${error?.data?.error || 'Deck sync failed'}: ${detail}`
        : (error?.data?.error || 'Deck sync failed.');
      return null;
    } finally {
      sync.inFlight = null;
      if (syncButton?.isConnected) syncButton.disabled = false;
    }
  }

  (async () => {
    try {
      const cloud = await P.call('/platform/nextcloud/');
      const root = String(cloud.nextcloud?.url || '').replace(/\/$/, '');
      let deckUrl = root ? `${root}/index.php/apps/deck/` : '';
      let deck = null;
      try {
        deck = await P.call('/platform/admin/deck/');
        if (deck.board?.url) deckUrl = deck.board.url;
      } catch (error) {
        if (error?.status !== 403) console.warn('Deck status unavailable', error);
      }
      if (!panel.isConnected) return;
      actions.replaceChildren();
      if (deckUrl) actions.append(button('Open Deck', () => window.open(deckUrl, '_blank', 'noopener')));
      actions.append(button('Planning & Projects', () => go?.('/workspace/operating')));
      if (deck) {
        canSync = true;
        syncButton = button('Sync now', () => run(), true);
        actions.append(syncButton);
        status.textContent = `${deck.task_count || 0} tasks · background sync enabled`;
      } else {
        status.textContent = deckUrl
          ? 'Tasks are visible here and in Deck. A Core admin can run reconciliation.'
          : 'Nextcloud Deck is not configured yet.';
      }
    } catch {
      if (!panel.isConnected) return;
      status.dataset.tone = 'bad';
      status.textContent = 'Nextcloud status could not be loaded. GraviQuest tasks remain available here.';
    }
  })();

  return panel;
}
