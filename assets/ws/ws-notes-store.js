/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  THE NOTES INDEX
   What the rest of the workspace needs to know about notes without opening
   the notebook: which exist in a space, which days have a day note, which
   notes mention a title, and where a note opens.

   It reads the same list the notebook does, /platform/nextcloud/notes/,
   whose plain GET answers from the database without waiting on Nextcloud.
   That list is the truth: a note is a KnowledgeResource mirrored to the
   Nextcloud Notes app.

   This replaces ws-api.js, the page store of the block editor that is gone.
   It kept a second copy of every page through /workspace/pages/, fell back
   to localStorage when that route failed, and opened a signed-out or offline
   workspace on a set of sample pages from ws-seed.js. The calendar, search,
   backlinks and the Knowledge Base all read that copy. They read this now.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r3';

const SPACE_PATH = { core: '/workspace/core/notes', kms: '/workspace/kms/notes', research: '/workspace/research/notes' };
const index = { items: [], loaded: false, loading: null };

const shape = (item) => ({
  id: String(item.id),
  title: String(item.title || '').trim() || 'Untitled',
  content: String(item.content || ''),
  space: item.space || 'research',
  folder: item.folder || '',
  kind: item.kind || 'note',
  journal_date: item.journal_date || null,
  updated: item.updated || '',
  project_title: item.project_title || '',
});

/* Reads the list once; `force` reads it again. A failure leaves an empty
   index rather than throwing into a view: every caller here is a hint (a
   marked day, a search hit), never the notebook itself. */
export function load({ force = false } = {}) {
  if (index.loaded && !force) return Promise.resolve(index.items);
  if (index.loading) return index.loading;
  index.loading = P.call('/platform/nextcloud/notes/')
    .then((data) => {
      index.items = (Array.isArray(data.items) ? data.items : []).map(shape);
      index.loaded = true;
      return index.items;
    })
    .catch(() => {
      index.loaded = true;
      return index.items;
    })
    .finally(() => { index.loading = null; });
  return index.loading;
}

export const loaded = () => index.loaded;
export const all = () => index.items.slice();
export const bySpace = (space) => index.items
  .filter((item) => !space || item.space === space)
  .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
export const find = (id) => index.items.find((item) => item.id === String(id).replace(/^p-/, '')) || null;
export const journalDays = () => index.items.filter((item) => item.kind === 'journal' && item.journal_date).map((item) => item.journal_date);

/* Where a note opens: its space's notebook, with the note selected. */
export function pathFor(note) {
  const base = SPACE_PATH[note?.space] || SPACE_PATH.research;
  return note?.id ? `${base}?note=${encodeURIComponent(note.id)}` : base;
}
export const notebookFor = (space) => SPACE_PATH[space] || SPACE_PATH.research;

/* Title first, then body; the hint is the folder or the start of the body. */
export function search(query, limit = 12) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const item of index.items) {
    const inTitle = item.title.toLowerCase().includes(q);
    const at = inTitle ? -1 : item.content.toLowerCase().indexOf(q);
    if (!inTitle && at < 0) continue;
    const hint = at >= 0
      ? `…${item.content.slice(Math.max(0, at - 30), at + q.length + 40).replace(/\s+/g, ' ').trim()}…`
      : item.folder || item.project_title;
    hits.push({ ...item, hint, rank: inTitle ? 0 : 1 });
  }
  return hits.sort((a, b) => a.rank - b.rank || String(b.updated).localeCompare(String(a.updated))).slice(0, limit);
}

/* Notes that link to a title with [[Title]] or [[Title|label]]. */
export function backlinksTo(title, excludeId = '') {
  const name = String(title || '').trim().toLowerCase();
  if (!name) return [];
  const pattern = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;
  return index.items.filter((item) => {
    if (item.id === String(excludeId)) return false;
    for (const match of item.content.matchAll(pattern)) {
      if (match[1].trim().toLowerCase() === name) return true;
    }
    return false;
  }).map((item) => {
    const at = item.content.toLowerCase().indexOf(`[[${name}`);
    return { ...item, excerpt: at >= 0 ? item.content.slice(Math.max(0, at - 40), at + name.length + 60).replace(/\s+/g, ' ').trim() : '' };
  });
}

/* The notebook tells the index what changed, so a marked day or a search hit
   is right without reading the list again. */
addEventListener('ws:notes-changed', (event) => {
  const changed = event.detail?.item;
  const removed = event.detail?.removed;
  if (removed) index.items = index.items.filter((item) => item.id !== String(removed));
  if (changed?.id != null) {
    const next = shape(changed);
    index.items = [next, ...index.items.filter((item) => item.id !== next.id)];
  }
});
