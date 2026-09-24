/* Gravitas+ Space integration
 *
 * Keeps the relational workspace and Nextcloud filesystem on one contract:
 * - Research projects are filed under an explicit personal Space category.
 * - Every managed Markdown sidecar is visible from Notes.
 * - Project-note annotations are threaded without flattening metadata files
 *   into the native Nextcloud Notes app.
 */

import { observeSurface } from './ws-runtime-performance.js?v=20260920-perf1';

const API = '/api';
const state = { observer: null, timer: null };

function activeRoute() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/workspace/research/projects'
    || path === '/workspace/research/notes'
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

function flatten(nodes, depth = 0, out = []) {
  (nodes || []).forEach((node) => {
    out.push({ ...node, depth });
    flatten(node.children || [], depth + 1, out);
  });
  return out;
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

async function spaceTree() {
  return request('/platform/space/tree/');
}

function fillCategorySelect(node, tree, selected = '') {
  node.innerHTML = '';
  const categories = flatten(tree || []).filter((item) => item.kind === 'category');
  categories.forEach((item) => {
    const option = el('option', '', `${'— '.repeat(Math.max(0, item.depth - 1))}${item.title}`);
    option.value = String(item.id);
    option.dataset.path = item.path || '';
    node.append(option);
  });
  const preferred = categories.find((item) => item.path === 'Space/Research/Projects') || categories[0];
  const value = selected || (preferred ? String(preferred.id) : '');
  if (value) node.value = value;
  return categories;
}

function fillCategoryParentSelect(node, tree) {
  node.innerHTML = '';
  const choices = flatten(tree || []).filter((item) => ['subspace', 'category'].includes(item.kind));
  choices.forEach((item) => {
    const option = el('option', '', `${'— '.repeat(item.depth)}${item.title}`);
    option.value = String(item.id);
    option.dataset.path = item.path || '';
    node.append(option);
  });
  const preferred = choices.find((item) => item.path === 'Space/Research') || choices[0];
  if (preferred) node.value = String(preferred.id);
  return choices;
}

async function enhanceProjectCreate() {
  if (route() !== '/workspace/research/projects') return;
  const doc = document.querySelector('#ws-view .ws-doc');
  const head = doc?.querySelector(':scope > .ws-doc__head');
  if (!doc || !head) return;
  if (doc.querySelector('[data-space-project-actions]')) return;

  // Replace the older project toolbar if it was painted first. This prevents
  // two competing creation flows and keeps Project type distinct from the
  // filesystem Parent category.
  const older = doc.querySelector('[data-research-project-actions]');

  const tools = el('div', 'v-toolbar research-action-toolbar space-project-toolbar');
  tools.dataset.spaceProjectActions = '1';
  const create = action('New project', null, true);
  const line = statusLine();
  tools.append(create);
  // ws-task-deck-fixes.js adds New task on this route. Whichever module paints
  // first, the two buttons share this one row rather than stacking as two.
  const strip = doc.querySelector('[data-research-create-actions]');
  const newTask = strip?.matches('button') ? strip : strip?.querySelector('button');
  if (newTask) {
    newTask.dataset.researchCreateActions = 'true';
    tools.append(newTask);
    if (strip !== newTask) strip.remove();
  }
  older?.remove();
  tools.append(line);
  head.insertAdjacentElement('afterend', tools);

  let formBox = null;
  create.addEventListener('click', async () => {
    if (formBox) {
      formBox.remove();
      formBox = null;
      return;
    }
    create.disabled = true;
    setStatus(line, 'Loading Space categories…');
    let treeData;
    try {
      treeData = await spaceTree();
    } catch (error) {
      setStatus(line, error.message === 'cloud_unavailable'
        ? 'Space is temporarily unavailable in Nextcloud.'
        : 'Space categories could not be loaded.', 'bad');
      create.disabled = false;
      return;
    }
    create.disabled = false;
    setStatus(line, '');

    formBox = el('section', 'v-panel fl-panel space-project-form');
    const panelHead = el('div', 'v-panel__head fl-panel__head');
    const copy = el('div');
    copy.append(el('h2', 'v-panel__title fl-panel__title', 'Create research project'));
    copy.append(el('p', 'fl-muted', 'Choose where the project is filed in your Space. Shared project files continue to use the protected Team Folder.'));
    panelHead.append(copy);
    const body = el('div', 'v-panel__body fl-panel__body');
    const form = el('form', 'fl-form');

    const title = input('text', 'Project title');
    title.required = true;
    const projectType = select([
      ['internal', 'Internal research'],
      ['client', 'Client / revenue'],
      ['community', 'Community research'],
    ]);
    const visibility = select([
      ['private', 'Private'],
      ['invite', 'Invite only'],
      ['community', 'Community'],
      ['public', 'Public'],
    ]);
    const parentCategory = select();
    fillCategorySelect(parentCategory, treeData.tree);
    const question = textarea('Research question', 3);
    const description = textarea('Short project description', 4);
    const clientName = input('text', 'Client name');
    const requesterName = input('text', 'Requester name');
    const requesterEmail = input('email', 'requester@example.com');
    const deadline = input('date');
    const confidentiality = select([
      ['internal', 'Internal'],
      ['restricted', 'Restricted'],
      ['public', 'Public'],
    ]);
    const compensation = input('text', 'Compensation / commercial terms');
    const skills = input('text', 'Python, biology, statistics');

    const flags = el('div', 'space-project-flags');
    const makeCheck = (label, checked = false) => {
      const wrap = el('label', 'fl-check');
      const control = input('checkbox');
      control.checked = checked;
      wrap.append(control, el('span', '', label));
      flags.append(wrap);
      return control;
    };
    const applicationOpen = makeCheck('Applications open');
    const secureRoom = makeCheck('Secure data room');
    const allowLinks = makeCheck('Allow public links');
    const allowDownloads = makeCheck('Allow downloads', true);

    const categoryMaker = el('section', 'space-category-maker');
    const categoryTitle = input('text', 'New category name');
    const categoryParent = select();
    fillCategoryParentSelect(categoryParent, treeData.tree);
    const categoryStatus = statusLine();
    const addCategory = action('Create category', async () => {
      if (!categoryTitle.value.trim()) {
        setStatus(categoryStatus, 'Category name is required.', 'bad');
        categoryTitle.focus();
        return;
      }
      addCategory.disabled = true;
      setStatus(categoryStatus, 'Creating category…');
      const wanted = categoryTitle.value.trim();
      try {
        await request('/platform/space/tree/', {
          method: 'POST',
          body: { title: wanted, kind: 'category', parent_id: categoryParent.value },
        });
      } catch (error) {
        // A cloud failure may happen after the DB node was persisted. Refetch
        // before reporting failure so the user never creates the same category
        // twice just because WebDAV was briefly unavailable.
        if (error.message !== 'cloud_unavailable') {
          setStatus(categoryStatus, error.message.replaceAll('_', ' '), 'bad');
        }
      }
      try {
        treeData = await spaceTree();
        const categories = fillCategorySelect(parentCategory, treeData.tree);
        fillCategoryParentSelect(categoryParent, treeData.tree);
        const created = categories.find((item) => item.title.toLowerCase() === wanted.toLowerCase());
        if (created) {
          parentCategory.value = String(created.id);
          categoryTitle.value = '';
          setStatus(categoryStatus, `Category “${created.title}” is ready.`, 'ok');
        } else {
          setStatus(categoryStatus, 'Category could not be confirmed. Try again when Nextcloud is available.', 'bad');
        }
      } catch {
        setStatus(categoryStatus, 'Category was saved but the Space tree could not be refreshed.', 'bad');
      }
      addCategory.disabled = false;
    });
    const makerHead = el('div', 'space-category-maker__head');
    makerHead.append(el('strong', '', 'Need another parent category?'), el('span', 'fl-muted', 'Create it here without leaving the project form.'));
    const makerGrid = el('div', 'space-category-maker__grid');
    makerGrid.append(field('Name', categoryTitle), field('Inside', categoryParent));
    categoryMaker.append(makerHead, makerGrid, addCategory, categoryStatus);

    const topGrid = el('div', 'fl-form-grid');
    topGrid.append(
      field('Title', title),
      field('Project type', projectType, 'Business/research classification — not the filesystem folder.'),
      field('Visibility', visibility),
      field('Parent category', parentCategory, 'The project .md file and same-name folder are created here.'),
      field('Deadline', deadline),
      field('Confidentiality', confidentiality),
    );
    const peopleGrid = el('div', 'fl-form-grid');
    peopleGrid.append(field('Client', clientName), field('Requester', requesterName), field('Requester email', requesterEmail));
    form.append(topGrid, field('Research question', question), field('Description', description), peopleGrid,
      field('Required skills', skills, 'Comma-separated'), field('Compensation', compensation), flags, categoryMaker);

    const submit = action('Create project', null, true);
    submit.type = 'submit';
    const cancel = action('Cancel', () => { formBox?.remove(); formBox = null; });
    const formStatus = statusLine();
    const actions = el('div', 'fl-form-actions');
    actions.append(submit, cancel);
    form.append(actions, formStatus);
    body.append(form);
    formBox.append(panelHead, body);
    tools.insertAdjacentElement('afterend', formBox);
    title.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim()) {
        setStatus(formStatus, 'Project title is required.', 'bad');
        title.focus();
        return;
      }
      if (!parentCategory.value) {
        setStatus(formStatus, 'Choose or create a parent category first.', 'bad');
        return;
      }
      submit.disabled = true;
      setStatus(formStatus, 'Creating project and filing it in Space…');
      try {
        await request('/platform/projects/', {
          method: 'POST',
          body: {
            title: title.value.trim(),
            category: projectType.value,
            visibility: visibility.value,
            space_category_id: Number(parentCategory.value),
            research_question: question.value.trim(),
            description: description.value.trim(),
            client_name: clientName.value.trim(),
            requester_name: requesterName.value.trim(),
            requester_email: requesterEmail.value.trim(),
            deadline: deadline.value || null,
            confidentiality: confidentiality.value,
            compensation_text: compensation.value.trim(),
            required_skills: skills.value.split(',').map((item) => item.trim()).filter(Boolean),
            application_open: applicationOpen.checked,
            secure_data_room: secureRoom.checked,
            allow_public_links: allowLinks.checked,
            allow_downloads: allowDownloads.checked,
          },
        });
        setStatus(formStatus, 'Project created. Refreshing…', 'ok');
        setTimeout(() => location.reload(), 250);
      } catch (error) {
        const messages = {
          invalid_space_category: 'That parent category is no longer available. Refresh the Space tree.',
          title_required: 'Project title is required.',
          invalid_visibility: 'Choose a valid visibility.',
        };
        setStatus(formStatus, messages[error.message] || error.message.replaceAll('_', ' '), 'bad');
        submit.disabled = false;
      }
    });
  });
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

async function enhanceMarkdownIndex() {
  if (!['/workspace/research/notes', '/workspace/core/notes'].includes(route())) return;
  const doc = document.querySelector('#ws-view .nc-notes');
  const head = doc?.querySelector(':scope > .ws-doc__head');
  if (!doc || !head || doc.querySelector('[data-space-markdown-index]')) return;

  const panel = el('section', 'fl-panel space-md-index');
  panel.dataset.spaceMarkdownIndex = '1';
  const panelHead = el('div', 'fl-panel__head space-md-index__head');
  const copy = el('div');
  copy.append(el('h2', 'fl-panel__title', 'Markdown index'));
  copy.append(el('p', 'fl-muted', 'All managed @space, @category, @project, @task, @note and repository Markdown sidecars. Structural metadata stays in Files; @note remains editable in native Notes.'));
  const tools = el('div', 'space-md-index__tools');
  const refresh = action('Refresh', () => { panel.remove(); schedule(); });
  tools.append(refresh);
  panelHead.append(copy, tools);
  const body = el('div', 'fl-panel__body');
  body.append(el('p', 'fl-muted', 'Loading Space index…'));
  panel.append(panelHead, body);
  head.insertAdjacentElement('afterend', panel);

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
    await enhanceProjectCreate();
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
  schedule();
}
