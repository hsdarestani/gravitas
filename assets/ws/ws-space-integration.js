/* Gravitas+ Space integration
 *
 * Keeps the relational workspace and Nextcloud filesystem on one contract:
 * - Research projects are filed under an explicit personal Space category.
 * - Every managed Markdown sidecar is visible from Notes.
 * - Project-note annotations are threaded without flattening metadata files
 *   into the native Nextcloud Notes app.
 */

import { observeSurface } from './ws-runtime-performance.js?v=20261011-r2';

const API = '/api';
const state = { observer: null, timer: null };

function activeRoute() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/workspace/research/notes'
    || path === '/workspace/core/notes';
}

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
}

function cookie(name) {
  const row = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : '';
}

async function csrf() {
  let token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (token) return token;
  await fetch(`${API}/auth/csrf/`, { credentials: 'same-origin', cache: 'no-store' });
  token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (!token) throw new Error('csrf_token_missing');
  return token;
}

async function request(path, { method = 'GET', body } = {}) {
  const verb = method.toUpperCase();
  const headers = { Accept: 'application/json' };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(verb)) headers['X-CSRFToken'] = await csrf();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: verb,
    credentials: 'same-origin',
    cache: verb === 'GET' ? 'default' : 'no-store',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function action(label, handler, solid = false) {
  const button = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  button.type = 'button';
  if (handler) button.addEventListener('click', handler);
  return button;
}

function input(type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.placeholder = placeholder;
  return node;
}

function textarea(placeholder = '', rows = 4) {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.placeholder = placeholder;
  node.rows = rows;
  return node;
}

function select(options = []) {
  const node = el('select', 'v-input fl-input');
  options.forEach(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    node.append(option);
  });
  return node;
}

function field(label, control, hint = '') {
  const wrap = el('label', 'fl-field');
  wrap.append(el('span', 'fl-field__label', label), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
}

function route() {
  return location.pathname.replace(/\/$/, '');
}

function statusLine() {
  const node = el('p', 'v-note space-status');
  node.hidden = true;
  return node;
}

function setStatus(node, text, tone = '') {
  node.hidden = !text;
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function folderUrl(filesUrl, path) {
  try {
    const url = new URL(filesUrl, location.origin);
    const parts = String(path || '').split('/');
    if (parts.at(-1)?.toLowerCase().endsWith('.md')) parts.pop();
    const dir = parts.length ? `/${parts.join('/')}` : '/Space';
    url.searchParams.set('dir', dir);
    return url.toString();
  } catch {
    return filesUrl || '';
  }
}

function markdownRow(item, filesUrl, openAnnotations) {
  const row = el('div', 'space-md-row');
  const copy = el('div', 'space-md-row__copy');
  const title = el('strong', '', item.title || item.path || 'Markdown');
  const meta = el('div', 'space-md-row__meta');
  const tag = el('span', 'v-badge', item.tag || (item.type ? `@${item.type}` : '@markdown'));
  const path = el('code', '', item.path || '');
  const status = el('span', 'space-md-state', item.sync_state || 'unknown');
  status.dataset.state = item.sync_state || 'unknown';
  meta.append(tag, path, status);
  copy.append(title, meta);
  const tools = el('div', 'space-md-row__actions');
  if (filesUrl) tools.append(action('Open folder', () => window.open(folderUrl(filesUrl, item.path), '_blank', 'noopener,noreferrer')));
  if (item.type === 'note' && item.source === 'note' && item.id) {
    tools.append(action('Annotations', () => openAnnotations(item)));
  }
  row.append(copy, tools);
  return row;
}

async function openAnnotationDrawer(item) {
  document.querySelector('[data-space-annotation-drawer]')?.remove();
  const drawer = el('aside', 'space-annotation-drawer');
  drawer.dataset.spaceAnnotationDrawer = '1';
  drawer.setAttribute('role', 'complementary');
  drawer.setAttribute('aria-label', `Annotations for ${item.title || 'note'}`);
  const head = el('div', 'space-annotation-drawer__head');
  const copy = el('div');
  copy.append(el('span', 'fl-eyebrow', 'ANNOTATIONS'), el('h2', '', item.title || 'Note'));
  const close = action('Close', () => drawer.remove());
  head.append(copy, close);
  const body = el('div', 'space-annotation-drawer__body');
  drawer.append(head, body);
  document.body.append(drawer);

  const render = async () => {
    body.innerHTML = '';
    let data;
    try {
      data = await request(`/platform/annotations/?resource_id=${encodeURIComponent(item.id)}`);
    } catch (error) {
      const empty = el('div', 'fl-state');
      if (error.status === 404) {
        empty.append(el('strong', '', 'This note is not linked to a Research project yet.'));
        empty.append(el('p', 'fl-muted', 'Annotations inherit the project collaboration boundary, so a private standalone note has no shared annotation thread.'));
      } else {
        empty.append(el('strong', '', 'Annotations could not be loaded.'));
        empty.append(el('p', 'fl-muted', error.message.replaceAll('_', ' ')));
      }
      body.append(empty);
      return;
    }

    const form = el('form', 'space-annotation-form');
    const quote = input('text', 'Optional quoted text / anchor');
    const comment = textarea('Add an annotation…', 3);
    const submit = action('Add annotation', null, true);
    submit.type = 'submit';
    const formStatus = statusLine();
    form.append(field('Anchor', quote, 'Highlight ranges can be added later without changing this thread model.'), field('Comment', comment), submit, formStatus);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!comment.value.trim()) return;
      submit.disabled = true;
      try {
        await request('/platform/annotations/', {
          method: 'POST',
          body: {
            resource_id: Number(item.id),
            body: comment.value.trim(),
            anchor: quote.value.trim() ? { quote: quote.value.trim() } : {},
          },
        });
        await render();
      } catch (error) {
        setStatus(formStatus, error.message.replaceAll('_', ' '), 'bad');
        submit.disabled = false;
      }
    });
    body.append(form);

    const all = data.annotations || [];
    const roots = all.filter((annotation) => !annotation.parent_id);
    const list = el('div', 'space-annotation-list');
    if (!roots.length) {
      list.append(el('p', 'fl-muted', 'No annotations yet.'));
    }
    roots.forEach((root) => {
      const card = el('article', 'space-annotation');
      if (root.resolved) card.dataset.resolved = '1';
      const cardHead = el('div', 'space-annotation__head');
      cardHead.append(el('strong', '', root.author), el('span', 'fl-muted', root.resolved ? 'Resolved' : new Date(root.created_at).toLocaleString()));
      const anchor = root.anchor?.quote ? el('blockquote', 'space-annotation__anchor', root.anchor.quote) : null;
      const text = el('p', '', root.body);
      const tools = el('div', 'space-annotation__tools');
      const reply = action('Reply', () => {
        if (card.querySelector('[data-reply-form]')) return;
        const replyForm = el('form', 'space-annotation-reply');
        replyForm.dataset.replyForm = '1';
        const replyBody = textarea('Reply…', 2);
        const send = action('Send', null, true); send.type = 'submit';
        replyForm.append(replyBody, send);
        replyForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!replyBody.value.trim()) return;
          send.disabled = true;
          try {
            await request('/platform/annotations/', {
              method: 'POST',
              body: { resource_id: Number(item.id), parent_id: root.id, body: replyBody.value.trim() },
            });
            await render();
          } catch {
            send.disabled = false;
          }
        });
        card.append(replyForm);
        replyBody.focus();
      });
      tools.append(reply);
      if (root.can_edit) {
        tools.append(action(root.resolved ? 'Reopen' : 'Resolve', async () => {
          await request(`/platform/annotations/${root.id}/`, { method: 'PATCH', body: { resolved: !root.resolved } });
          await render();
        }));
        tools.append(action('Delete', async () => {
          await request(`/platform/annotations/${root.id}/`, { method: 'DELETE' });
          await render();
        }));
      }
      card.append(cardHead);
      if (anchor) card.append(anchor);
      card.append(text, tools);
      all.filter((child) => child.parent_id === root.id).forEach((child) => {
        const childRow = el('div', 'space-annotation__reply');
        childRow.append(el('strong', '', child.author), el('span', '', child.body));
        card.append(childRow);
      });
      list.append(card);
    });
    body.append(list);
  };
  await render();
}

/* The index used to be inserted under the Notes page head on every visit, a
   long panel above the notes that walked Nextcloud (?remote=1) before
   anything else on the page settled. Notes is now a notebook, and the index
   is one of its views: the notebook draws an empty [data-space-index-slot]
   when the reader opens it and announces that with ws:space-index. Nothing is
   fetched until then. */
async function enhanceMarkdownIndex() {
  if (!['/workspace/research/notes', '/workspace/core/notes'].includes(route())) return;
  const doc = document.querySelector('#ws-view .nc-notes');
  const slot = doc?.querySelector('[data-space-index-slot]');
  if (!slot || slot.querySelector('[data-space-markdown-index]')) return;

  const panel = el('section', 'fl-panel space-md-index');
  panel.dataset.spaceMarkdownIndex = '1';
  const panelHead = el('div', 'fl-panel__head space-md-index__head');
  const copy = el('div');
  copy.append(el('h2', 'fl-panel__title', 'Markdown files'));
  copy.append(el('p', 'fl-muted', 'Managed @space, @category, @project, @task, @note and repository sidecars.'));
  const tools = el('div', 'space-md-index__tools');
  const refresh = action('Refresh', () => { panel.remove(); schedule(); });
  tools.append(refresh);
  panelHead.append(copy, tools);
  const body = el('div', 'fl-panel__body');
  body.append(el('p', 'fl-muted', 'Loading Space index…'));
  panel.append(panelHead, body);
  slot.append(panel);

  let data;
  let nextcloud;
  try {
    [data, nextcloud] = await Promise.all([
      request('/platform/space/notes/?remote=1'),
      request('/platform/nextcloud/').catch(() => null),
    ]);
  } catch (error) {
    body.innerHTML = '';
    body.append(el('p', 'fl-muted', error.message.replaceAll('_', ' ')));
    return;
  }

  body.innerHTML = '';
  const controls = el('div', 'space-md-controls');
  const search = input('search', 'Search title, path or @type');
  const type = select([['', 'All types']]);
  const types = [...new Set((data.items || []).map((item) => item.type).filter(Boolean))].sort();
  types.forEach((value) => {
    const option = el('option', '', `@${value}`);
    option.value = value;
    type.append(option);
  });
  const syncState = statusLine();
  const sync = action('Sync Space', async () => {
    sync.disabled = true;
    setStatus(syncState, 'Syncing safe local changes…');
    try {
      const result = await request('/platform/space/sync/', { method: 'POST', body: {} });
      setStatus(syncState, result.conflicts?.length ? `${result.conflicts.length} conflicts need review.` : 'Space synchronized.', result.conflicts?.length ? 'bad' : 'ok');
      setTimeout(() => { panel.remove(); schedule(); }, 500);
    } catch (error) {
      setStatus(syncState, error.status === 409 ? 'A Nextcloud edit conflicts with Gravitas; nothing was overwritten.' : error.message.replaceAll('_', ' '), 'bad');
      sync.disabled = false;
    }
  });
  let reconcileArmed = false;
  const reconcile = action('Review Nextcloud changes', async () => {
    if (!reconcileArmed) {
      reconcileArmed = true;
      reconcile.textContent = 'Confirm reconcile';
      setStatus(syncState, 'Confirm to import/reconcile tagged Nextcloud Markdown changes into Gravitas.');
      setTimeout(() => {
        reconcileArmed = false;
        reconcile.textContent = 'Review Nextcloud changes';
      }, 6000);
      return;
    }
    reconcile.disabled = true;
    try {
      const result = await request('/platform/space/reconcile/', { method: 'POST', body: { confirmed: true } });
      setStatus(syncState, `Reconciled ${result.updated?.length || 0} updated and ${result.imported?.length || 0} imported items.`, 'ok');
      setTimeout(() => { panel.remove(); schedule(); }, 600);
    } catch (error) {
      setStatus(syncState, error.message.replaceAll('_', ' '), 'bad');
      reconcile.disabled = false;
    }
  });
  controls.append(search, type, sync, reconcile, syncState);
  body.append(controls);
  if (data.cloud_unavailable) body.append(el('p', 'ws-alert', 'Nextcloud is temporarily unavailable; showing the database index without remote discovery.'));
  const list = el('div', 'space-md-list');
  body.append(list);

  const renderRows = () => {
    const query = search.value.trim().toLowerCase();
    const wantedType = type.value;
    const items = (data.items || []).filter((item) => {
      if (wantedType && item.type !== wantedType) return false;
      if (!query) return true;
      return `${item.title || ''} ${item.path || ''} ${item.tag || ''}`.toLowerCase().includes(query);
    });
    list.innerHTML = '';
    if (!items.length) {
      list.append(el('p', 'fl-muted', 'No matching Markdown files.'));
      return;
    }
    items.forEach((item) => list.append(markdownRow(item, nextcloud?.nextcloud?.files_url, openAnnotationDrawer)));
  };
  search.addEventListener('input', renderRows);
  type.addEventListener('change', renderRows);
  renderRows();
}

async function enhance() {
  try {
    await enhanceMarkdownIndex();
  } catch (error) {
    console.warn('Space workspace enhancement skipped', error);
  }
}

function schedule() {
  if (!activeRoute()) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(enhance, 30);
}

export function installSpaceWorkspaceIntegration() {
  if (state.observer) return;
  state.observer = observeSurface({
    target: document.getElementById('ws-view') || document.body,
    active: activeRoute,
    callback: schedule,
    // The renderer swaps the top-level document. Watching every nested edit
    // caused Space enhancement work to run while typing in Notes.
    subtree: false,
  });
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  addEventListener('ws:space-index', schedule);
  schedule();
}
