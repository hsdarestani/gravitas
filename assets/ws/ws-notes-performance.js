/* ==========================================================================
   GRAVIQUEST WORKSPACE  ·  NOTES ⇄ NEXTCLOUD, IN THE BACKGROUND
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

import * as P from './ws-platform.js?v=20261016-task1';
import { scheduleIdle } from './ws-runtime-performance.js?v=20261016-task1';

// Reconciliation spans ALL of a user's native Notes, not one workspace.
 // Keep one global in-flight run and a conservative cooldown; Core and
 // Research must not trigger the same expensive DAV sweep independently.
const state = { lastSync: 0, inFlight: false, timer: 0, idle: false };
const MIN_GAP = 150000;

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
    if (document.visibilityState === 'hidden') return;
    if (busy()) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => startNotesSync({ space, busy, status, synced }), 10000);
      return;
    }
    if (state.inFlight || Date.now() - state.lastSync < MIN_GAP) return;
    state.lastSync = Date.now();
    state.inFlight = true;
    status('Syncing with Nextcloud in the background…');
    try {
      const result = await P.call('/platform/nextcloud/notes/sync/', { method: 'POST' });
      status(summary(result));
      synced();
    } catch {
      status('Nextcloud did not answer. Notes are saved here and will sync later.', 'warn');
    } finally {
      state.inFlight = false;
    }
  };
  // Give the initial navigation time to settle before the expensive
  // full-account DAV sweep. requestIdleCallback alone often fires instantly,
  // so an actual grace period is required.
  clearTimeout(state.timer);
  state.timer = setTimeout(() => scheduleIdle(state, 'idle', run, 3000), 12000);
}
