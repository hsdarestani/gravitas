/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  DATA LAYER
   Every network call the workspace makes goes through this file, and every
   one of them can fail without taking the interface down with it.

   Why an adapter rather than fetch() at the call sites. The Django backend
   in backend/core/ implements the space views in space_api.py, but
   backend/core/urls.py never registers a route for them: /api/platform/
   space/tree/ and its siblings answer 404 today. The previous frontend
   called them anyway and rendered a permanent spinner. So the contract
   here is that a view asks for data and always receives data. If the
   endpoint is live it gets the server's; if the endpoint is missing or the
   reader is signed out it gets the local store, and the status bar says
   which, in those words, rather than pretending everything is fine.

   The local store is not a mock hidden behind a flag. It is a real store in
   localStorage: edits made against it persist and survive a reload. When
   the routes are wired up, adopt() lifts the local pages to the server once
   and then gets out of the way.
   ========================================================================== */

import { seed } from './ws-seed.js';

const API = '/api';
/* Bumped to v5 with the three-space page store. A browser holding a v4 store
   has no Core or Knowledge roots in it, and those two trees would open empty
   with no way for the reader to tell whether that is a bug or the truth.
   Starting from the new seed is the honest outcome; the old key is left in
   place rather than deleted, so nothing anybody wrote is destroyed by a
   deployment and it can still be recovered by hand. */
const LS_KEY = 'gravitas.ws.store.v5';
const LS_MODE = 'gravitas.ws.mode';

/* ---- Transport ----------------------------------------------------------
   Django wants the CSRF token on writes. It arrives as a cookie, so it is
   read per request rather than cached: a session refresh rotates it, and a
   cached copy would turn every write after that into a 403. */

function cookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

class Unavailable extends Error {
  constructor(status) {
    super('endpoint_unavailable');
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRFToken'] = cookie('csrftoken');
  }

  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Genuinely offline, or the request never left. Same outcome either way.
    throw new Unavailable(0);
  }

  // 404 is the interesting one: it means this build's backend does not carry
  // the route, which is a deployment fact rather than a bug in the caller.
  if (res.status === 404 || res.status === 501) throw new Unavailable(res.status);
  if (res.status === 401 || res.status === 403) throw new Unavailable(res.status);

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const err = new Error(detail.error || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.status === 204 ? null : res.json();
}

/* ---- Local store --------------------------------------------------------
   Shaped exactly like the server's payloads, so no view ever has to know
   which side its data came from. */

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Private-mode Safari and blocked site data both land here. The store
    // still works for this session; it just will not outlive it.
  }
  return structuredClone(seed);
}

let store = load();
let writeTimer = 0;
let serverNodes = [];
let serverPages = {};

function persist() {
  // Coalesced: typing in the editor calls this on every keystroke, and
  // localStorage writes are synchronous and hit the main thread.
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
    } catch {
      // Quota exceeded or storage denied. The in-memory store is unaffected,
      // so the session continues and only persistence is lost.
    }
  }, 400);
}

/* ---- Mode ---------------------------------------------------------------
   Resolved once at boot by probing a route that exists in every build, then
   the one that does not. The status bar reads this, and it is the only
   place in the app allowed to describe the connection. */

export const state = {
  mode: 'unknown',      // 'server' | 'local'
  reason: '',
  user: null,
};

const listeners = new Set();
export function onModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce() { listeners.forEach((fn) => fn(state)); }

function setMode(mode, reason) {
  if (state.mode === mode && state.reason === reason) return;
  state.mode = mode;
  state.reason = reason;
  try { sessionStorage.setItem(LS_MODE, mode); } catch { /* not essential */ }
  announce();
}

export async function boot() {
  try {
    state.user = await request('/auth/me/');
  } catch {
    state.user = null;
  }

  if (!state.user || state.user.authenticated === false) {
    setMode('local', 'Signed out. Pages are saved in this browser.');
    return state;
  }

  try {
    await request('/platform/pages/');
    setMode('server', 'Connected.');
  } catch (err) {
    setMode('local', err instanceof Unavailable && err.status === 404
      ? 'Page service not deployed on this build. Pages are saved in this browser.'
      : 'Page service unreachable. Pages are saved in this browser.');
  }
  return state;
}

/* Try the server, fall back to the local store, and remember the demotion so
   the next call does not pay for the same round trip again. */
async function withFallback(fn, local) {
  if (state.mode === 'local') return local();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Unavailable) {
      setMode('local', 'Page service stopped responding. Pages are saved in this browser.');
      return local();
    }
    throw err;
  }
}

/* ---- Pages --------------------------------------------------------------
   A page is the unit of the whole workspace: notes, journal days and folder
   pages are all pages, differing only in `kind`. That is what lets one
   editor, one tree and one link graph serve all three. */

export function tree() {
  return withFallback(
    async () => {
      const data = await request('/platform/pages/');
      serverNodes = data.nodes || [];
      serverPages = Object.fromEntries((data.pages || []).map((page) => [String(page.id), page]));
      return structuredClone(serverNodes);
    },
    () => structuredClone(store.nodes)
  );
}

export function page(id) {
  return withFallback(
    async () => {
      const data = await request(`/platform/pages/${encodeURIComponent(id)}/`);
      serverPages[String(id)] = data.page;
      return data.page;
    },
    () => {
      const found = store.pages[id];
      return found ? structuredClone(found) : null;
    }
  );
}

export function savePage(id, patch) {
  return withFallback(
    async () => {
      const data = await request(`/platform/pages/${encodeURIComponent(id)}/`, { method: 'PATCH', body: patch });
      serverPages[String(id)] = data.page;
      const node = serverNodes.find((item) => String(item.id) === String(id));
      if (node) Object.assign(node, { title: data.page.title, parent: data.page.parent });
      return data.page;
    },
    () => {
      const target = store.pages[id];
      if (!target) throw new Error('page_not_found');
      Object.assign(target, patch, { updated: new Date().toISOString() });
      persist();
      return structuredClone(target);
    }
  );
}

export function createPage({ title, parent = null, kind = 'note', space = null, journal_date = null }) {
  return withFallback(
    async () => {
      const data = await request('/platform/pages/', { method: 'POST', body: { title, parent, kind, space, journal_date } });
      const made = data.page;
      serverPages[String(made.id)] = made;
      serverNodes.push({ id: made.id, title: made.title, kind: made.kind, parent: made.parent, space: made.space, phantom: false });
      return made;
    },
    () => {
      const id = 'p-' + Math.random().toString(36).slice(2, 9);
      const now = new Date().toISOString();
      store.pages[id] = {
        id, title, kind, parent,
        blocks: [{ id: 'b-' + Math.random().toString(36).slice(2, 9), type: 'p', text: '' }],
        created: now, updated: now, journal_date,
      };
      // Only a root carries `space`; everything else inherits it through its
      // parent. See spaceOfNode below and the note on the seed's roots.
      const node = { id, title, kind, parent, phantom: false };
      if (!parent && space) node.space = space;
      store.nodes.push(node);
      persist();
      return structuredClone(store.pages[id]);
    }
  );
}

/* Which workspace a page belongs to. Walks to the root and reads the space
   declared there, because only roots declare one: a page dragged into
   another branch changes workspace by the move itself, with no second field
   to keep in step.

   Anything whose root says nothing is research. That is the space the
   product had before it had three, so every page written under the old
   model, and every node a server without the field returns, lands where its
   author left it rather than in a new section they have never seen.

   The guard on depth is not defensive decoration. Parent pointers arrive
   from the server, and one cycle in that data would otherwise hang the tab
   inside a render. */
export function spaceOfNode(nodes, id) {
  let current = nodes.find((node) => node.id === id);
  for (let hops = 0; current && hops < 64; hops += 1) {
    if (current.space) return current.space;
    if (!current.parent) break;
    current = nodes.find((node) => node.id === current.parent);
  }
  return 'research';
}

/* A phantom is a page somebody has linked to but not written. It is real
   enough to appear in the tree in italics and to be opened; the first save
   is what turns it into a file. Resolving the name here rather than at each
   link keeps one definition of "does this page exist". */
export function resolveLink(title) {
  const key = title.trim().toLowerCase();
  const nodes = state.mode === 'server' ? serverNodes : store.nodes;
  const node = nodes.find((n) => n.title.trim().toLowerCase() === key);
  return node ? { id: node.id, phantom: !!node.phantom } : { id: null, phantom: true };
}

/* ---- Tasks -------------------------------------------------------------
   There is no local task store, deliberately. Tasks are Core objects that
   the server owns (see ws-platform.js). A browser-local task list would
   render identically to the real one and disagree with it the moment two
   people looked at the same board, which is the worst kind of wrong.
   -------------------------------------------------------------------- */

/* ---- Backlinks ----------------------------------------------------------
   Derived, never stored. A stored backlink table is a second source of
   truth that drifts the moment somebody edits a page outside the app. */

export function backlinks(id) {
  return withFallback(
    async () => (await request(`/platform/links/?target=${encodeURIComponent(id)}`)).results || [],
    () => {
      const target = store.pages[id];
      if (!target) return [];
      const name = target.title.trim().toLowerCase();
      const out = [];
      for (const p of Object.values(store.pages)) {
        if (p.id === id) continue;
        for (const block of p.blocks) {
          const text = block.text || '';
          if (text.toLowerCase().includes(`[[${name}]]`)) {
            out.push({ id: p.id, title: p.title, excerpt: text.slice(0, 140) });
            break;
          }
        }
      }
      return out;
    }
  );
}

/* ---- Search -------------------------------------------------------------
   Title matches first and always: when somebody types a page name they mean
   that page, and burying it under a body match that happens to score higher
   is the single most annoying thing a search box can do. */

export function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const titles = [];
  const bodies = [];

  const pages = state.mode === 'server' ? Object.values(serverPages) : Object.values(store.pages);
  for (const p of pages) {
    const title = p.title.toLowerCase();
    if (title.includes(q)) {
      titles.push({ id: p.id, title: p.title, kind: p.kind, hint: 'page' });
      continue;
    }
    const hit = p.blocks.find((b) => (b.text || '').toLowerCase().includes(q));
    if (hit) {
      bodies.push({ id: p.id, title: p.title, kind: p.kind, hint: excerpt(hit.text, q) });
    }
  }

  titles.sort((a, b) => a.title.length - b.title.length);   // shortest = closest
  return [...titles, ...bodies].slice(0, 40);
}

function excerpt(text, q) {
  const at = text.toLowerCase().indexOf(q);
  const from = Math.max(0, at - 24);
  return (from > 0 ? '…' : '') + text.slice(from, from + 68).trim() + '…';
}

/* ---- Journal ------------------------------------------------------------
   One page per day, created on first write rather than in advance, so an
   untouched month leaves no empty pages behind. */

export function journalId(date) {
  return 'journal-' + date.toISOString().slice(0, 10);
}

export function journalDays() {
  const pages = state.mode === 'server' ? Object.values(serverPages) : Object.values(store.pages);
  return pages.filter((page) => page.kind === 'journal' && page.journal_date).map((page) => page.journal_date);
}

export async function openJournal(date) {
  const dateKey = date.toISOString().slice(0, 10);
  if (state.mode === 'server') {
    const existing = Object.values(serverPages).find((item) => item.kind === 'journal' && item.journal_date === dateKey);
    if (existing) return page(existing.id);
    return createPage({
      title: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      parent: null, kind: 'journal', space: 'research', journal_date: dateKey,
    });
  }
  const id = journalId(date);
  const existing = await page(id);
  if (existing) return existing;

  const title = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
  const now = new Date().toISOString();
  store.pages[id] = {
    id, title, kind: 'journal', parent: 'journal',
    blocks: [{ id: 'b-' + Math.random().toString(36).slice(2, 9), type: 'p', text: '' }],
    created: now, updated: now, journal_date: dateKey,
  };
  store.nodes.push({ id, title, kind: 'journal', parent: 'journal', phantom: false });
  persist();
  return structuredClone(store.pages[id]);
}

/* ---- Assistant ----------------------------------------------------------
   The real endpoint is /api/platform/ai/providers/, which reports which
   providers the deployment has configured. When none are, the panel says
   so and offers what it can genuinely do offline: search across pages and
   collect what it found. It never invents an answer, because a knowledge
   base whose assistant makes things up is worse than one without an
   assistant. */

export async function assistantProviders() {
  try {
    const data = await request('/platform/ai/providers/');
    return data.providers || [];
  } catch {
    return [];
  }
}

export async function ask(question) {
  const providers = await assistantProviders();

  if (providers.length) {
    try {
      return await request('/platform/ai/ask/', { method: 'POST', body: { question } });
    } catch {
      // Fall through to the local answer rather than showing a dead end.
    }
  }

  const hits = search(question);
  return {
    grounded: false,
    answer: hits.length
      ? `No language model is configured on this deployment, so this is a search rather than an answer. ${hits.length === 1 ? 'One page mentions' : hits.length + ' pages mention'} that.`
      : 'No language model is configured on this deployment, and no page mentions that.',
    sources: hits.slice(0, 6).map((h) => ({ id: h.id, title: h.title })),
  };
}

/* ---- Adoption -----------------------------------------------------------
   Called once if the server routes appear while local pages exist. Kept
   explicit and manual: silently pushing a browser's worth of pages into
   somebody's account is not a decision this file should make on its own. */

export async function adopt() {
  if (state.mode !== 'server') throw new Error('not_connected');
  const created = [];
  for (const p of Object.values(store.pages)) {
    const made = await request('/platform/pages/', {
      method: 'POST',
      body: {
        title: p.title, kind: p.kind, blocks: p.blocks,
        parent: p.parent, space: p.space, journal_date: p.journal_date,
      },
    });
    created.push((made.page || made).id);
  }
  return created;
}

export function localPageCount() {
  return Object.keys(store.pages).length;
}
