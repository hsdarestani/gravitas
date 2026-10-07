/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  LIBRARY  (what the reader kept from the site)

   This is the other end of a deliberate funnel. On the public site a visitor
   can keep an article, follow a topic and tick off steps of a learning path
   with no account at all — the shop lets you fill the basket before it asks
   who you are — and the pile lives in their browser until they sign up. At
   that moment `production-bridge.js` POSTs the whole pile to
   /api/reader/library/, and this screen is where it lands.

   WHY IT SITS IN THE KNOWLEDGE WORKSPACE

   Knowledge is the workspace that answers "what do we know", and its index is
   the learning loop: Sources → Knowledge Base → Recall → Skills. Something
   kept from the public site is the step before all of them — material that has
   caught the reader's attention but has not yet been read, distilled or
   scheduled. So Library sits directly above Sources, and its one forward
   action is to promote an item into Sources, which is how the loop starts.

   That promotion is the whole reason this is not just a bookmarks list. A
   bookmark that never becomes anything is a bookmark; a bookmark that becomes
   a source with a question attached is the beginning of reading properly.

   WHY THERE IS NO LOCAL FALLBACK HERE

   `ws-api.js` keeps a localStorage store because a page you are writing must
   never be lost to a failed request. This screen is the opposite case: the
   local store is the *guest's*, the account's copy is the server's, and
   inventing rows here would tell a reader their saved items are safe when
   they are not. When the call fails the screen says which call failed and
   offers to run it again, like every other platform-backed view.

   One narrow exception, and it is a read not a write: the guest store is
   consulted only to report a pile that has not been adopted yet, so a reader
   whose handover failed sees why their library looks empty instead of
   concluding their saves were thrown away.
   ========================================================================== */

import * as P from './ws-platform.js';
import * as K from './ws-kms.js';
import { el, panel, row, stats, empty, failure, skeleton } from './ws-views.js';

/* The guest store, read-only. Same key as the public site's. */
const GUEST_KEY = 'gravitas.reader.v1';
/* The signed-in reader's cache on the public site, which paints the header
   count before the network answers. Written here only to flip `seen`. */
const MIRROR_KEY = 'gravitas.reader.mirror.v1';

const KIND_LABEL = {
  topic: 'Topic',
  dossier: 'Dossier',
  article: 'Essay',
  path: 'Learning path',
  lab: 'Interactive',
  page: 'Page',
};

/* Sources have their own kinds, and a saved public item has to become one of
   them when it is promoted. A topic or a dossier is a body of writing, so it
   arrives as a paper; an interactive is closer to a course than to a talk. */
const SOURCE_KIND = {
  article: 'paper',
  topic: 'paper',
  dossier: 'paper',
  path: 'course',
  lab: 'course',
  page: 'paper',
};

/* The path is written out at both call sites rather than held in a constant:
   scripts/check-api-coverage.mjs reads these files textually, and a route it
   cannot see in a string literal is reported as one no UI calls. */
export async function load() {
  return P.call('/reader/library/');
}

async function remove(relation, itemKey) {
  return P.call('/reader/library/', { method: 'DELETE', body: { relation, item_key: itemKey } });
}

/* Seeing the rows here is what clears the count on the public header. That
   count used to be the size of the whole pile and never went down, and
   readers told us a number that cannot be cleared is just noise. So once the
   screen has drawn, the rows it drew are stamped as seen on the server.

   Only the rows this screen drew, by key: something saved in another tab
   between the GET and this POST has not been looked at yet. A failure is
   silent on purpose — the count simply stays until the next visit, and a
   bookkeeping error is not worth an alert on a screen that otherwise worked.

   The public site's mirror is patched too, so the header is already right on
   the first frame of the next public page, and any public tab still open
   hears the change through the `storage` event. */
async function markSeen(saved, following) {
  const fresh = {
    saved: saved.filter((item) => !item.seen).map((item) => item.item_key),
    following: following.filter((item) => !item.seen).map((item) => item.item_key),
  };
  if (!fresh.saved.length && !fresh.following.length) return;

  try {
    await P.call('/reader/library/', { method: 'POST', body: { seen: fresh } });
  } catch {
    return;
  }

  try {
    const mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null');
    if (!mirror || typeof mirror !== 'object') return;
    for (const bucket of ['saved', 'following']) {
      for (const key of fresh[bucket]) {
        if (mirror[bucket]?.[key]) mirror[bucket][key].seen = true;
      }
    }
    localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror));
  } catch {
    // Blocked storage. The public page corrects itself from the server anyway.
  }
}

function guestPile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return 0;
    return Object.keys(parsed.saved || {}).length + Object.keys(parsed.following || {}).length;
  } catch {
    return 0;
  }
}

function docShell(host, title, subtitle) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', title));
  if (subtitle) head.append(el('p', 'ws-doc__meta', subtitle));
  doc.append(head);
  host.append(doc);
  return doc;
}

function miniButton(label, onClick) {
  const button = el('button', 'v-mini-btn', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function openLink(url) {
  const link = el('a', 'v-mini-btn', 'Read');
  link.href = url;
  return link;
}

/* ==========================================================================
   THE SCREEN
   ========================================================================== */

export function renderLibrary(host, ctx) {
  const doc = docShell(
    host,
    'Library',
    'What you kept from the public site, including anything you saved before this account existed.',
  );

  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  const draw = async () => {
    let data;
    try {
      data = await load();
    } catch (err) {
      holder.innerHTML = '';
      holder.append(failure('your library', err, draw));
      return;
    }

    const saved = data.saved || [];
    const following = data.following || [];
    const paths = (data.paths || []).filter((path) => path.done?.length);

    holder.innerHTML = '';
    holder.append(stats([
      ['Saved', saved.length],
      ['Topics followed', following.length],
      ['Paths started', paths.length],
      ['Finished', paths.filter((path) => path.completed).length],
    ]));

    /* A pile still sitting in the browser means the handover has not run or
       did not finish. Say so with the number in it: "6 items" is actionable,
       "some items" is a shrug. */
    const waiting = guestPile();
    if (waiting) {
      const note = el('div', 'ws-alert');
      note.append(el('p', 'ws-alert__title',
        `${waiting} ${waiting === 1 ? 'item' : 'items'} kept in this browser are not in your account yet`));
      note.append(el('p', null,
        'They move across on the next public page you open while signed in. Nothing is lost in the meantime.'));
      holder.append(note);
    }

    if (!saved.length && !following.length && !paths.length) {
      holder.append(empty(
        'Nothing kept yet',
        'The bookmark on any topic, dossier, essay, learning path or interactive on the public site lands here. ' +
        'It works without an account too — this is where it arrives once you have one.',
      ));
      const browse = el('a', 'ws-btn ws-btn--solid', 'Open the public archive');
      browse.href = '/topics.html';
      holder.append(browse);
      return;
    }

    if (saved.length) {
      const box = panel(`Saved · ${saved.length}`);
      for (const item of saved) box.body.append(savedRow(item, ctx, draw));
      holder.append(box);
    }

    if (following.length) {
      const box = panel(`Following · ${following.length}`);
      box.body.append(el('p', 'ws-doc__meta',
        'Topics you asked for more of. New dossiers and essays under them are what the Gravitas+ newsletter leads with.'));
      for (const item of following) box.body.append(followRow(item, draw));
      holder.append(box);
    }

    if (paths.length) {
      const box = panel(`Paths in progress · ${paths.length}`);
      for (const path of paths) box.body.append(pathRow(path, draw));
      holder.append(box);
    }

    markSeen(saved, following);
  };

  draw();
}

/* A saved item's forward action is to become a source, because that is the
   only move that makes keeping it worth anything. The question field is left
   for the reader to fill in on the Sources screen: a source with no question
   is a source you will skim, and this screen has no honest guess at what the
   reader wanted from it. */
function savedRow(item, ctx, redraw) {
  const actions = el('div', 'v-row__actions');
  actions.append(openLink(item.url || `/${item.item_key}.html`));

  if (item.kind === 'path') {
    actions.append(miniButton('Open in Paths', () => ctx.go('/workspace/kms/paths')));
  } else {
    actions.append(miniButton('Add to Sources', () => {
      K.addSource({
        title: item.title,
        author: 'Gravitas+',
        kind: SOURCE_KIND[item.kind] || 'paper',
        question: '',
      });
      ctx.go('/workspace/kms/sources');
    }));
  }

  actions.append(miniButton('Remove', async () => {
    await remove('saved', item.item_key);
    redraw();
  }));

  return row({
    title: item.title,
    sub: item.summary || '',
    badges: [
      item.seen ? null : 'New',
      KIND_LABEL[item.kind] || item.kind,
      item.meta?.detail,
      item.saved_at ? `Saved ${P.formatDate(item.saved_at)}` : null,
    ].filter(Boolean),
    action: actions,
  });
}

function followRow(item, redraw) {
  const actions = el('div', 'v-row__actions');
  actions.append(openLink(item.url || `/${item.item_key}.html`));
  actions.append(miniButton('Stop following', async () => {
    await remove('following', item.item_key);
    redraw();
  }));

  return row({
    title: item.title,
    sub: item.summary || '',
    badges: [
      item.seen ? null : 'New',
      KIND_LABEL[item.kind] || item.kind,
      item.saved_at ? `Following since ${P.formatDate(item.saved_at)}` : null,
    ].filter(Boolean),
    action: actions,
  });
}

/* Steps done out of steps total, and the bar. A percentage is shown here
   because it changes what to do next — which path is nearly finished is the
   one worth an hour tonight — and not as a score. */
function pathRow(path, redraw) {
  const total = path.total || path.done.length;
  const percent = total ? Math.round((path.done.length / total) * 100) : 0;

  const main = el('div', 'v-row__main');
  main.append(el('strong', null, path.title || path.item_key));
  main.append(el('small', null,
    `${path.done.length} of ${total} steps done · ${percent}%${path.completed ? ' · finished' : ''}`));

  const meter = el('div', 'v-meter');
  if (path.completed) meter.dataset.tone = 'positive';
  const fill = el('i');
  fill.style.width = `${Math.max(2, percent)}%`;
  meter.append(fill);
  main.append(meter);

  const actions = el('div', 'v-row__actions');
  actions.append(openLink(path.url || `/${path.item_key}.html`));
  actions.append(miniButton('Forget progress', async () => {
    await remove('path', path.item_key);
    redraw();
  }));

  const node = el('div', 'v-row v-row--static');
  node.append(main, actions);
  return node;
}
