/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  KNOWLEDGE (KMS) DATA LAYER
   The learning workspace's own store: sources, cards, skills and paths,
   held in the reader's account.

   Why a second store rather than an extension of the page store. Pages are
   documents; these are schedules. A card has a due date, a path has an
   order, and a skill has a level that is a claim about a person. Folding
   those into the note tree would mean either a note that is secretly a card
   or a card that cannot be written in, and both were tried in the previous
   build.

   The store is the account (/platform/kms/state/); see STORE below.

   THE MODEL, in the order the workspace uses it:

     Source   something to read, with the question it was opened for
     Note     what you wrote once the source was closed (a page, in the
              knowledge space of the ordinary page store)
     Card     one question cut from a note, with a due date
     Skill    what a run of finished cards and built things adds up to
     Path     the curriculum that says which of the above to do next

   Only the first three are ever created by hand. Skills are read off the
   others, and a path is the only place a person is asked to plan.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r2';

const LS_KEY = 'gravitas.ws.kms.v1';

/* ---- Scheduling ---------------------------------------------------------
   A Leitner ladder rather than SM-2. SM-2 needs a per-card ease factor that
   only pays for itself over thousands of reviews, and a team of five doing
   twenty cards a day will never reach the point where the extra parameter
   beats a fixed ladder. The intervals below are the standard doubling-ish
   sequence, stopped at ten weeks: past that the card has been learned and
   the queue should stop spending attention on it.

   `Again` drops two rungs rather than resetting to zero. A full reset after
   one bad morning is the single most common reason people abandon a review
   queue, because it turns one lapse into a week of re-earning ground. */
const LADDER = [0, 1, 3, 7, 16, 35, 70];

const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = (date) => date.toISOString().slice(0, 10);
const plusDays = (n) => iso(new Date(today().getTime() + n * DAY));
const daysUntil = (stamp) => Math.round((new Date(stamp + 'T00:00:00').getTime() - today().getTime()) / DAY);

const uid = (prefix) => prefix + '-' + Math.random().toString(36).slice(2, 9);

/* ==========================================================================
   STORE
   The account is the store. Everything here lives in /platform/kms/state/,
   so a card graded on a laptop is due on the phone, and nothing a person
   sees here was put there by the build.

   It used to be localStorage with a seeded sample workspace — four sources,
   five cards, three paths and three skills, real material written to show
   what the method looks like — and a "sync" that sent the wrong body
   without a CSRF token and so never reached the account. A second module,
   ws-kms-live.js, then took over two of the six screens to read the real
   account state, which left Sources, Paths and Skills showing samples that
   existed only in one browser. Now all six read this one store.

   Reads stay synchronous: views call ready() once, then read the in-memory
   copy. Writes change the copy at once and are saved a moment later; a save
   that fails is reported through saveState(), never by throwing into a view.
   ========================================================================== */

const EMPTY = () => ({ sources: [], cards: [], paths: [], skills: [], log: [] });

// The ids the old seed used. A browser that kept the seeded workspace holds
// these alongside anything its owner made; only the latter is worth keeping.
const SAMPLE_IDS = new Set([
  's-ebbinghaus', 's-roediger', 's-interference', 's-tufte',
  'c-1', 'c-2', 'c-3', 'c-4', 'c-5',
  'p-learning', 'p-evidence', 'p-operating',
  'learning', 'evidence', 'operating',
]);

function normalize(value) {
  const out = EMPTY();
  if (!value || typeof value !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (Array.isArray(value[key])) out[key] = value[key].filter((item) => item && typeof item === 'object');
  }
  for (const path of out.paths) if (!Array.isArray(path.steps)) path.steps = [];
  return out;
}

const isEmpty = (state) => Object.values(state).every((items) => !items.length);

/* What a person made in this browser before the account held it: the old
   local store, minus the seed. Read once, when the account is still empty. */
function browserLeftovers() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const old = normalize(JSON.parse(raw));
    const mine = (items) => items.filter((item) => !SAMPLE_IDS.has(item.id));
    const cards = mine(old.cards);
    const kept = new Set(cards.map((card) => card.id));
    const state = {
      sources: mine(old.sources),
      cards,
      paths: mine(old.paths),
      skills: mine(old.skills),
      log: old.log.filter((entry) => kept.has(entry.card)),
    };
    return isEmpty(state) ? null : state;
  } catch {
    return null;
  }
}

let store = EMPTY();
const sync = { ready: false, loading: null, timer: 0, saving: null, again: false, error: '' };

/* Resolves once the account state is in memory. Every view awaits it before
   drawing, so a screen never shows an empty workspace that is only empty
   because the request has not answered yet. */
export function ready() {
  if (sync.ready) return Promise.resolve();
  if (sync.loading) return sync.loading;
  sync.loading = (async () => {
    const payload = await P.call('/platform/kms/state/');
    store = normalize(payload.state);
    if (isEmpty(store)) {
      const leftovers = browserLeftovers();
      if (leftovers) {
        store = leftovers;
        await save();
      }
    }
    sync.ready = true;
  })().finally(() => { sync.loading = null; });
  return sync.loading;
}

export const isReady = () => sync.ready;

async function save() {
  // Saving before the account has been read would replace the account with
  // whatever happens to be in memory — at worst one new source.
  if (!sync.ready && !sync.loading) return null;
  if (sync.saving) { sync.again = true; return sync.saving; }
  sync.saving = (async () => {
    try {
      const payload = await P.call('/platform/kms/state/', { method: 'PUT', body: { state: store } });
      // The server cleans what it stores; adopt that, but keep local edits
      // made while the request was in flight.
      if (!sync.again) store = normalize(payload.state);
      sync.error = '';
    } catch (error) {
      sync.error = error?.message || 'save_failed';
    }
    dispatchEvent(new CustomEvent('ws:kms-saved', { detail: { ok: !sync.error } }));
  })().finally(() => {
    sync.saving = null;
    if (sync.again) { sync.again = false; save(); }
  });
  return sync.saving;
}

function persist() {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(save, 300);
}

/* '' when the last save reached the account, otherwise why it did not. */
export const saveState = () => sync.error;

export const kmsOnServer = () => sync.ready;

/* ==========================================================================
   READS
   ========================================================================== */

export const sources = () => structuredClone(store.sources);
export const paths = () => structuredClone(store.paths);
export const cards = () => structuredClone(store.cards);
export const skills = () => structuredClone(store.skills);

export const source = (id) => store.sources.find((item) => item.id === id) || null;
export const path = (id) => store.paths.find((item) => item.id === id) || null;

/* The queue: everything due today or overdue, oldest debt first. Capped at
   twenty, which is not arbitrary — it is roughly ten minutes of reviewing,
   and a queue that cannot be emptied in one sitting is one people stop
   opening. What is left over is still due tomorrow. */
export function dueCards(limit = 20) {
  return store.cards
    .filter((card) => daysUntil(card.due) <= 0)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, limit)
    .map((card) => structuredClone(card));
}

export function queueCounts() {
  const due = store.cards.filter((card) => daysUntil(card.due) <= 0).length;
  const soon = store.cards.filter((card) => {
    const days = daysUntil(card.due);
    return days > 0 && days <= 7;
  }).length;
  const held = store.cards.filter((card) => card.rung >= 4).length;
  return { total: store.cards.length, due, soon, held };
}

export function pathProgress(item) {
  const total = item.steps.length;
  const done = item.steps.filter((step) => step.done).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/* The next unfinished step of the path with the most momentum. This is the
   one answer the Overview owes somebody who opens the workspace without a
   plan, and it is deliberately a single row rather than a ranked list: a
   list is another decision, and the decision is what they came here to
   avoid making. */
export function nextStep() {
  const open = store.paths
    .map((item) => ({ item, step: item.steps.find((step) => !step.done), progress: pathProgress(item) }))
    .filter((entry) => entry.step);
  if (!open.length) return null;
  open.sort((a, b) => b.progress.percent - a.progress.percent);
  return open[0];
}

/* A skill's level, computed rather than claimed. Two ingredients, because
   either alone is gameable: cards held say the knowledge is retained, path
   steps finished say it has been used on something real. A level is only
   granted where both agree. */
export function skillLevel(id) {
  const own = store.cards.filter((card) => card.skill === id);
  const held = own.filter((card) => card.rung >= 4).length;
  const steps = store.paths
    .filter((item) => item.skill === id)
    .flatMap((item) => item.steps);
  const applied = steps.filter((step) => step.done).length;

  const retained = held >= 6 ? 3 : held >= 3 ? 2 : held >= 1 ? 1 : 0;
  const practised = applied >= 6 ? 3 : applied >= 4 ? 2 : applied >= 2 ? 1 : 0;

  return {
    level: Math.min(retained, practised) + (retained >= 3 && practised >= 3 ? 1 : 0),
    // Both halves are returned, not just the level they produce. The screen
    // has to say which of the two is holding the level down, and it cannot
    // work that out from the single number: "2 of 3 cards held" is short of
    // the next rung or comfortably past it depending entirely on how many
    // path steps are finished beside it.
    retained,
    practised,
    held,
    cards: own.length,
    applied,
    steps: steps.length,
  };
}

export const LEVEL_NAME = ['Not started', 'Aware', 'Working', 'Fluent', 'Teaching'];

/* ==========================================================================
   WRITES
   ========================================================================== */

export function addSource({ title, author = '', kind = 'paper', question = '' }) {
  const made = {
    id: uid('s'), title, author, kind, question,
    state: 'queued', pageId: null, added: iso(today()),
  };
  store.sources.unshift(made);
  persist();
  return structuredClone(made);
}

export function setSourceState(id, state) {
  const found = store.sources.find((item) => item.id === id);
  if (!found) return null;
  found.state = state;
  persist();
  return structuredClone(found);
}

/* Called when a source has been distilled into a page. The link is stored on
   the source rather than in the page, so a note can be rewritten, retitled
   or moved without the reading queue losing track of what it came from. */
export function attachNote(id, pageId) {
  const found = store.sources.find((item) => item.id === id);
  if (!found) return null;
  found.pageId = pageId;
  found.state = 'distilled';
  persist();
  return structuredClone(found);
}

export function addCard({ front, back = '', pageId = null, skill = null }) {
  const made = { id: uid('c'), front, back, pageId, skill, rung: 0, due: iso(today()), lapses: 0 };
  store.cards.push(made);
  persist();
  return structuredClone(made);
}

export function removeCard(id) {
  store.cards = store.cards.filter((card) => card.id !== id);
  persist();
}

/* One of 'again' | 'hard' | 'good'. Three buttons, not four: the fourth
   ("easy") exists in other systems to skip ahead, and every time somebody
   presses it they are telling you the card should not have been in the deck.
   Deleting it is the honest version of that, and removeCard is right there. */
export function grade(id, verdict) {
  const card = store.cards.find((item) => item.id === id);
  if (!card) return null;

  if (verdict === 'again') {
    card.rung = Math.max(0, card.rung - 2);
    card.lapses += 1;
  } else if (verdict === 'hard') {
    card.rung = Math.max(0, card.rung - 1);
  } else {
    card.rung = Math.min(LADDER.length - 1, card.rung + 1);
  }

  card.due = plusDays(LADDER[card.rung] || 0);
  // A card graded 'again' comes back in this same sitting rather than
  // tomorrow, which is the only way the queue teaches anything on the day
  // you got it wrong.
  if (verdict === 'again') card.due = iso(today());

  store.log.unshift({ at: new Date().toISOString(), card: card.id, verdict });
  store.log = store.log.slice(0, 400);
  persist();
  return structuredClone(card);
}

export function toggleStep(pathId, stepId) {
  const found = store.paths.find((item) => item.id === pathId);
  const step = found?.steps.find((item) => item.id === stepId);
  if (!step) return null;
  step.done = !step.done;
  persist();
  return structuredClone(found);
}

export function addPath({ title, aim = '', owner = '', skill = null }) {
  const made = { id: uid('p'), title, aim, owner, skill, steps: [] };
  store.paths.push(made);
  persist();
  return structuredClone(made);
}

export function addStep(pathId, { title, kind = 'build', ref = null }) {
  const found = store.paths.find((item) => item.id === pathId);
  if (!found) return null;
  found.steps.push({ id: uid('st'), title, kind, ref, done: false });
  persist();
  return structuredClone(found);
}

/* ---- Reviewing history --------------------------------------------------
   Used by the Overview's streak. Counted in local days rather than in
   24-hour windows, so reviewing at 23:50 and again at 00:10 is two days,
   which is what the person doing it believes happened. */
export function reviewStreak() {
  if (!store.log.length) return 0;
  const days = new Set(store.log.map((entry) => entry.at.slice(0, 10)));
  let streak = 0;
  for (let i = 0; i < 400; i += 1) {
    if (!days.has(plusDays(-i))) {
      // Today not yet reviewed does not break a streak that is still alive
      // from yesterday; it just has not been extended.
      if (i === 0) continue;
      break;
    }
    streak += 1;
  }
  return streak;
}

export function reviewedToday() {
  const key = iso(today());
  return store.log.filter((entry) => entry.at.slice(0, 10) === key).length;
}

export { daysUntil, iso };
