/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  NOTES ⇄ NEXTCLOUD, IN THE BACKGROUND
   The notebook opens on what the database already holds (a plain GET of
   /platform/nextcloud/notes/ never waits on Nextcloud). Reconciling with
   the Nextcloud Notes app — pulling edits made there, pushing ones made
   here, adopting notes created there — happens afterwards, when the
   browser is idle, at most once every 45 seconds per space, and never while
   someone is typing.

   The notebook starts this itself. It used to be an overlay that watched
   #ws-view for the notebook to appear, rewrote its status line, and after a
   sync fired a navigation event so that something would redraw the list.
   Now the notebook passes in how to tell it what happened.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r4';
import { scheduleIdle } from './ws-runtime-performance.js?v=20261011-r4';

const state = { lastSync: new Map(), inFlight: new Set(), timer: 0, idle: false };
const MIN_GAP = 45000;

function summary(result) {
  const counts = result?.counts || {};
  const bits = [['created', 'created'], ['pushed', 'pushed'], ['pulled', 'pulled'], ['adopted', 'adopted'], ['deleted', 'deleted'], ['conflicts', 'conflicts']]
    .filter(([key]) => Number(counts[key] || 0))
    .map(([key, label]) => `${counts[key]} ${label}`);
  return bits.length ? bits.join(' · ') : 'Up to date';
}

/* `busy()` says whether the reader is writing; `status(text, tone)` sets the
   notebook's sync line; `synced()` refreshes the list after a sync that may
   have changed it. */
export function startNotesSync({ space, busy = () => false, status = () => {}, synced = () => {} }) {
  const run = async () => {
    if (busy()) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => startNotesSync({ space, busy, status, synced }), 1200);
      return;
    }
    if (state.inFlight.has(space) || Date.now() - (state.lastSync.get(space) || 0) < MIN_GAP) return;
    state.lastSync.set(space, Date.now());
    state.inFlight.add(space);
    status('Syncing with Nextcloud in the background…');
    try {
      const result = await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
      status(summary(result));
      synced();
    } catch {
      status('Nextcloud did not answer. Notes are saved here and will sync later.', 'warn');
    } finally {
      state.inFlight.delete(space);
    }
  };
  scheduleIdle(state, 'idle', run, 1200);
}
