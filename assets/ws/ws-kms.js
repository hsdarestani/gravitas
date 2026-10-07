/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  KNOWLEDGE (KMS) DATA LAYER
   The learning workspace's own store. Same contract as ws-api.js: a view
   asks for data and always receives data, the server is used when the route
   exists, and the browser keeps the work when it does not.

   Why a second store rather than an extension of the page store. Pages are
   documents; these are schedules. A card has a due date, a path has an
   order, and a skill has a level that is a claim about a person. Folding
   those into the note tree would mean either a note that is secretly a card
   or a card that cannot be written in, and both were tried in the previous
   build.

   Nothing here invents a backend that does not exist. `sync()` posts to
   /api/platform/kms/ when a build carries it and is a no-op otherwise, so
   the day those routes land the workspace starts using them without a
   rewrite at every call site.

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

const LS_KEY = 'gravitas.ws.kms.v1';
const API = '/api';

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
   SEED
   Real material rather than filler. Somebody opening the knowledge
   workspace cold should see what a distilled source, a scheduled card and a
   half-finished path actually look like, because none of the three are
   self-explanatory from an empty state.
   ========================================================================== */

function seed() {
  return {
    sources: [
      {
        id: 's-ebbinghaus',
        title: 'Memory: A Contribution to Experimental Psychology',
        author: 'Hermann Ebbinghaus',
        kind: 'book',
        question: 'How fast is forgetting when nothing is done about it?',
        state: 'distilled',
        pageId: 'k-spaced',
        added: plusDays(-58),
      },
      {
        id: 's-roediger',
        title: 'The Critical Role of Retrieval Practice in Long-Term Retention',
        author: 'Roediger & Butler',
        kind: 'paper',
        question: 'Does testing beat re-reading, and by how much?',
        state: 'reading',
        pageId: null,
        added: plusDays(-11),
      },
      {
        id: 's-interference',
        title: 'Retrieval-induced forgetting, thirty years on',
        author: 'Anderson (review)',
        kind: 'paper',
        question: 'Is forgetting interference or decay?',
        state: 'queued',
        pageId: null,
        added: plusDays(-4),
      },
      {
        id: 's-tufte',
        title: 'The Visual Display of Quantitative Information',
        author: 'Edward Tufte',
        kind: 'book',
        question: 'What makes a chart honest?',
        state: 'queued',
        pageId: null,
        added: plusDays(-2),
      },
    ],

    cards: [
      {
        id: 'c-1',
        front: 'What does spaced repetition claim does the work: the repetition, or the interval?',
        back: 'The interval. Retrieving a fact at the edge of forgetting strengthens it more than re-reading it while it is still fresh.',
        pageId: 'k-spaced',
        skill: 'learning',
        rung: 3,
        due: plusDays(-1),
        lapses: 1,
      },
      {
        id: 'c-2',
        front: 'Why does the workspace show a review queue instead of a list of everything learned?',
        back: 'A list of everything is a list nobody opens. A queue of the six things about to be forgotten can be finished before coffee.',
        pageId: 'k-spaced',
        skill: 'learning',
        rung: 4,
        due: plusDays(0),
        lapses: 0,
      },
      {
        id: 'c-3',
        front: 'In the distillation method, which pass is the one that counts?',
        back: 'The fourth: closing the source and writing the answer from memory. A note copied from an open paper feels like understanding and tests as nothing.',
        pageId: 'k-distil',
        skill: 'learning',
        rung: 4,
        due: plusDays(0),
        lapses: 0,
      },
      {
        id: 'c-4',
        front: 'What is the useful half of Bayes for editorial work?',
        back: 'Asking what you believed before the paper arrived, and by how much it should move you. A study that could not have changed your mind has told you nothing.',
        pageId: 'k-bayes',
        skill: 'evidence',
        rung: 4,
        due: plusDays(6),
        lapses: 0,
      },
      {
        id: 'c-5',
        front: 'Why may a blueprint section have two owners while a task may not?',
        back: 'Shared task ownership produces the state where each owner believes the other is doing it, and that state is invisible on a board until the deadline passes.',
        pageId: 'c-std-owner',
        skill: 'operating',
        rung: 4,
        due: plusDays(0),
        lapses: 0,
      },
    ],

    paths: [
      {
        id: 'p-learning',
        title: 'Learning how to learn',
        aim: 'Run the capture → distil → recall loop without thinking about it, and be able to teach it to a new team member.',
        owner: 'Everyone',
        skill: 'learning',
        steps: [
          { id: 'st-1', title: 'Read Ebbinghaus on the forgetting curve', kind: 'read',   ref: 's-ebbinghaus', done: true },
          { id: 'st-2', title: 'Distil it into a note in your own words',  kind: 'note',   ref: 'k-spaced',    done: true },
          { id: 'st-3', title: 'Cut three cards from that note',           kind: 'recall', ref: null,          done: true },
          { id: 'st-4', title: 'Read Roediger & Butler on retrieval practice', kind: 'read', ref: 's-roediger', done: false },
          { id: 'st-5', title: 'Write the method up as a standard',        kind: 'note',   ref: 'k-distil',    done: false },
          { id: 'st-6', title: 'Teach it in a weekly and collect objections', kind: 'build', ref: null,        done: false },
        ],
      },
      {
        id: 'p-evidence',
        title: 'Reading evidence like an editor',
        aim: 'Judge whether a paper should move the dossier, and say why in one paragraph a reader can check.',
        owner: 'Sajad',
        skill: 'evidence',
        steps: [
          { id: 'se-1', title: 'Priors, and what would change them', kind: 'note',   ref: 'k-bayes', done: true },
          { id: 'se-2', title: 'Write the strongest version of an opposing case', kind: 'build', ref: 'cu-against', done: true },
          { id: 'se-3', title: 'Review: sample size is not evidence strength', kind: 'recall', ref: null, done: false },
          { id: 'se-4', title: 'Audit one live dossier claim against its primary source', kind: 'build', ref: null, done: false },
        ],
      },
      {
        id: 'p-operating',
        title: 'Running the content studio',
        aim: 'Take a section of the Content Studio Blueprint from approved scope to shipped tasks without a second meeting.',
        owner: 'Core team',
        skill: 'operating',
        steps: [
          { id: 'so-1', title: 'Read the blueprint end to end', kind: 'read', ref: null, done: true },
          { id: 'so-2', title: 'Learn the one-owner-per-task standard', kind: 'note', ref: 'c-std-owner', done: true },
          { id: 'so-3', title: 'Cut one section into tasks with named owners', kind: 'build', ref: null, done: false },
          { id: 'so-4', title: 'Run it through a cycle and log what broke', kind: 'build', ref: null, done: false },
        ],
      },
    ],

    /* Skills are declared, but their level is never typed in. It is computed
       from cards held and path steps finished, so the number on the screen
       is a claim the workspace can defend rather than one somebody set
       optimistically in March. */
    skills: [
      { id: 'learning',  name: 'Deliberate learning', target: 3, note: 'Capture, distil, rehearse, and know when to stop.' },
      { id: 'evidence',  name: 'Reading evidence',    target: 4, note: 'Judging what a study is worth to an argument.' },
      { id: 'operating', name: 'Operating the studio', target: 3, note: 'Turning an approved blueprint into work with owners.' },
    ],

    log: [],
  };
}

/* ==========================================================================
   STORE
   ========================================================================== */

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // A stored shape from an older build is merged over the seed rather
      // than trusted whole, so a field added here does not arrive undefined
      // in a browser that already has data.
      return { ...seed(), ...parsed };
    }
  } catch {
    // Storage denied. The session still works; it just will not outlive the tab.
  }
  return seed();
}

let store = load();
let timer = 0;

function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* quota or denied */ }
    sync();
  }, 300);
}

/* Fire-and-forget upload for the day the routes exist. It must never reject
   into a view: a knowledge workspace that throws because an optional
   endpoint is missing is worse than one that quietly keeps working. */
function sync() {
  fetch(API + '/platform/kms/state/', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store),
  }).catch(() => { /* not deployed on this build */ });
}

export const kmsOnServer = () => false;

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
