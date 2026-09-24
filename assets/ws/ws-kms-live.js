/* ==========================================================================
   GRAVITAS+ · LIVE PERSONAL KNOWLEDGE / RECALL

   The previous KMS screen booted from a seeded localStorage object. That made
   a new account look populated and made review results browser-specific. This
   router owns the two Learning surfaces that are exposed in navigation and
   backs them with the authenticated KMS state API plus the canonical page
   service. No demo material is introduced here.
   ========================================================================== */

const API = '/api';
const LEGACY_KEY = 'gravitas.ws.kms.v1';
const LADDER = [0, 1, 3, 7, 16, 35, 70];
const DAY = 86400000;
const SAMPLE_SOURCE_IDS = new Set(['s-ebbinghaus', 's-roediger', 's-interference', 's-tufte']);
const SAMPLE_CARD_IDS = new Set(['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);
const SAMPLE_PATH_IDS = new Set(['p-learning', 'p-evidence', 'p-operating']);
const SAMPLE_SKILL_IDS = new Set(['learning', 'evidence', 'operating']);

const runtime = {
  installed: false,
  scheduled: false,
  state: null,
  statePromise: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function cookie(name) {
  const row = document.cookie.split('; ').find((value) => value.startsWith(name + '='));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : '';
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    const csrf = cookie('csrftoken');
    if (csrf) headers['X-CSRFToken'] = csrf;
  }
  const response = await fetch(API + path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `http_${response.status}`);
    error.status = response.status;
    error.data = payload;
    throw error;
  }
  return payload;
}

function emptyState() {
  return { sources: [], cards: [], paths: [], skills: [], log: [] };
}

function normalizeState(value) {
  const out = emptyState();
  if (!value || typeof value !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (Array.isArray(value[key])) out[key] = value[key].filter((item) => item && typeof item === 'object');
  }
  return out;
}

function legacyUserState() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = normalizeState(JSON.parse(raw));
    const customCards = old.cards.filter((item) => !SAMPLE_CARD_IDS.has(item.id));
    const customCardIds = new Set(customCards.map((item) => item.id));
    const migrated = {
      sources: old.sources.filter((item) => !SAMPLE_SOURCE_IDS.has(item.id)),
      cards: customCards,
      paths: old.paths.filter((item) => !SAMPLE_PATH_IDS.has(item.id)),
      skills: old.skills.filter((item) => !SAMPLE_SKILL_IDS.has(item.id)),
      log: old.log.filter((item) => customCardIds.has(item.card)),
    };
    return Object.values(migrated).some((items) => items.length) ? migrated : null;
  } catch {
    return null;
  }
}

async function saveState() {
  if (!runtime.state) return;
  const payload = await request('/platform/kms/state/', { method: 'PUT', body: { state: runtime.state } });
  runtime.state = normalizeState(payload.state);
}

async function loadState() {
  if (runtime.state) return runtime.state;
  if (runtime.statePromise) return runtime.statePromise;
  runtime.statePromise = (async () => {
    const payload = await request('/platform/kms/state/');
    runtime.state = normalizeState(payload.state);
    const empty = Object.values(runtime.state).every((items) => items.length === 0);
    if (empty) {
      const legacy = legacyUserState();
      if (legacy) {
        runtime.state = legacy;
        await saveState();
      }
    }
    return runtime.state;
  })().finally(() => { runtime.statePromise = null; });
  return runtime.statePromise;
}

function dayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function iso(date) { return date.toISOString().slice(0, 10); }
function plusDays(days) { return iso(new Date(dayStart().getTime() + days * DAY)); }
function daysUntil(stamp) {
  const time = new Date(`${stamp}T00:00:00`).getTime();
  return Number.isFinite(time) ? Math.round((time - dayStart().getTime()) / DAY) : 0;
}
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

function go(path) {
  if (path === location.pathname) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  dispatchEvent(new CustomEvent('ws:navigate'));
}

function shell(title, subtitle) {
  const host = $('#ws-view');
  if (!host) return null;
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', title), el('p', 'ws-doc__meta', subtitle));
  doc.append(head);
  host.append(doc);
  return { host, doc, head };
}

function notice(title, detail, bad = false) {
  const node = el('div', 'ws-alert');
  // Loading and empty are not failures; only a failure gets the red rule.
  node.dataset.tone = bad ? 'bad' : 'quiet';
  node.append(el('strong', 'ws-alert__title', title), el('p', null, detail));
  return node;
}

function button(text, handler, solid = false) {
  const node = el('button', `ws-btn${solid ? ' ws-btn--solid' : ''}`, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function setIndexActive(path) {
  for (const node of document.querySelectorAll('.fl-index-link')) {
    const text = node.textContent?.trim().toLowerCase();
    const active = path.endsWith('/base') ? text === 'personal learning notes' : text === 'recall & review';
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
}

async function createNote(status) {
  status.textContent = 'Creating note…';
  const payload = await request('/workspace/pages/', {
    method: 'POST',
    body: { title: 'Untitled', kind: 'note', space: 'kms' },
  });
  if (!payload.page?.id) throw new Error('note_not_created');
  go(`/workspace/page/${payload.page.id}`);
}

async function loadKnowledgePages() {
  const payload = await request('/workspace/pages/');
  return (payload.pages || []).filter((page) => page.space === 'kms' && page.kind === 'note');
}

async function addRecallCard(page) {
  const firstText = (page.blocks || []).map((block) => String(block.text || '').trim()).find(Boolean) || '';
  const front = prompt('Question / prompt for this recall card', page.title || '');
  if (!front?.trim()) return false;
  const back = prompt('Answer', firstText);
  if (back == null) return false;
  const state = await loadState();
  state.cards.push({
    id: uid('c'),
    front: front.trim(),
    back: back.trim(),
    pageId: String(page.id),
    skill: null,
    rung: 0,
    due: iso(dayStart()),
    lapses: 0,
  });
  await saveState();
  return true;
}

async function renderBase() {
  const view = shell('Knowledge Base', 'Personal learning notes stored in your account. Turn any note into real recall cards when it is ready.');
  if (!view) return;
  setIndexActive('/workspace/kms/base');
  const status = el('span', 'v-note', 'Loading notes…');
  const add = button('New note', async () => {
    add.disabled = true;
    try {
      await createNote(status);
    } catch (error) {
      status.textContent = error?.message === 'cloud_unavailable'
        ? 'Note service is available, but its cloud mirror is temporarily unavailable.'
        : 'Note could not be created. Try again.';
      add.disabled = false;
    }
  }, true);
  const actions = el('div', 'v-toolbar');
  actions.append(add, status);
  view.doc.append(actions);

  const panel = el('section', 'v-panel');
  const panelHead = el('div', 'v-panel__head');
  panelHead.append(el('h2', 'v-panel__title', 'Notes'));
  panel.append(panelHead);
  const body = el('div', 'v-panel__body');
  panel.append(body);
  view.doc.append(panel);

  try {
    const [pages] = await Promise.all([loadKnowledgePages(), loadState()]);
    status.textContent = 'Saved to your account';
    body.innerHTML = '';
    if (!pages.length) {
      body.append(notice('Nothing distilled yet', 'Create a note here, or distil a source into your own words. New notes open directly in the editor.'));
      return;
    }
    pages.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    for (const page of pages) {
      const row = el('div', 'v-row');
      const main = el('button', 'v-row__main');
      main.type = 'button';
      main.append(el('strong', null, page.title || 'Untitled'));
      const words = (page.blocks || []).reduce((total, block) => total + String(block.text || '').split(/\s+/).filter(Boolean).length, 0);
      main.append(el('small', null, `${words} words · ${new Date(page.updated || page.created).toLocaleDateString()}`));
      main.addEventListener('click', () => go(`/workspace/page/${page.id}`));
      const card = button('Make recall card', async () => {
        card.disabled = true;
        try {
          const made = await addRecallCard(page);
          status.textContent = made ? 'Recall card saved' : 'Card not created';
        } catch {
          status.textContent = 'Recall card could not be saved';
        } finally {
          card.disabled = false;
        }
      });
      card.classList.add('ws-btn--tiny');
      row.append(main, card);
      body.append(row);
    }
  } catch (error) {
    status.textContent = 'Unavailable';
    body.innerHTML = '';
    body.append(notice('Knowledge base unavailable', 'The account-backed note service did not answer. No sample notes were substituted.', true));
  }
}

function dueCards(state) {
  return state.cards
    .filter((card) => daysUntil(card.due || iso(dayStart())) <= 0)
    .sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
    .slice(0, 20);
}

async function renderRecall() {
  const view = shell('Recall & Review', 'Account-backed spaced review. Every grade changes the real review schedule and is available on your other devices.');
  if (!view) return;
  setIndexActive('/workspace/kms/recall');
  const body = el('div');
  view.doc.append(body);
  body.append(notice('Loading review queue', 'Reading your saved recall schedule…'));

  let state;
  try {
    state = await loadState();
  } catch {
    body.innerHTML = '';
    body.append(notice('Review queue unavailable', 'Your saved KMS state could not be loaded. No demo cards were substituted.', true));
    return;
  }

  let queue = dueCards(state);
  let index = 0;
  let revealed = false;
  const draw = () => {
    body.innerHTML = '';
    if (!queue.length || index >= queue.length) {
      const done = notice('Review queue clear', state.cards.length
        ? 'Nothing else is due today.'
        : 'You have no recall cards yet. Create one from Personal learning notes.');
      const open = button('Open personal learning notes', () => go('/workspace/kms/base'), true);
      done.append(open);
      body.append(done);
      return;
    }
    const card = queue[index];
    const progress = el('div', 'v-toolbar');
    progress.append(el('span', 'v-toolbar__count', `${index + 1} of ${queue.length}`));
    const due = daysUntil(card.due || iso(dayStart()));
    progress.append(el('span', 'v-note', due < 0 ? `${Math.abs(due)} days overdue` : 'Due today'));
    body.append(progress);

    const panel = el('section', 'v-panel kms-recall-card');
    const panelBody = el('div', 'v-panel__body');
    panelBody.append(el('h2', 'ws-doc__title', card.front || 'Untitled card'));
    if (!revealed) {
      panelBody.append(button('Show the answer', () => { revealed = true; draw(); }, true));
    } else {
      panelBody.append(el('div', 'kms-recall-answer', card.back || 'No answer was saved for this card.'));
      const grading = el('div', 'v-toolbar');
      for (const [verdict, label] of [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good']]) {
        const gradeButton = button(label, async () => {
          gradeButton.disabled = true;
          if (verdict === 'again') {
            card.rung = Math.max(0, Number(card.rung || 0) - 2);
            card.lapses = Number(card.lapses || 0) + 1;
          } else if (verdict === 'hard') {
            card.rung = Math.max(0, Number(card.rung || 0) - 1);
          } else {
            card.rung = Math.min(LADDER.length - 1, Number(card.rung || 0) + 1);
          }
          card.due = verdict === 'again' ? iso(dayStart()) : plusDays(LADDER[card.rung] || 0);
          state.log.unshift({ at: new Date().toISOString(), card: card.id, verdict });
          state.log = state.log.slice(0, 2000);
          try {
            await saveState();
            queue = dueCards(state);
            // Again remains due and returns later rather than immediately
            // trapping the reader on the same card.
            if (verdict === 'again' && queue.length > 1) {
              const current = queue.shift();
              queue.push(current);
            }
            index = 0;
            revealed = false;
            draw();
          } catch {
            gradeButton.disabled = false;
            body.prepend(notice('Review was not saved', 'Your schedule was left on screen so you can retry.', true));
          }
        }, verdict === 'good');
        grading.append(gradeButton);
      }
      panelBody.append(grading);
    }
    panel.append(panelBody);
    body.append(panel);
  };
  draw();
}

function route() {
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/workspace/kms/base') return 'base';
  if (path === '/workspace/kms/recall') return 'recall';
  return null;
}

async function renderCurrent() {
  const current = route();
  if (!current) return;
  if (current === 'base') await renderBase();
  else await renderRecall();
}

function schedule() {
  if (runtime.scheduled) return;
  runtime.scheduled = true;
  queueMicrotask(async () => {
    runtime.scheduled = false;
    await renderCurrent();
  });
}

export function installLiveKms() {
  if (runtime.installed) return;
  runtime.installed = true;
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  schedule();
}
