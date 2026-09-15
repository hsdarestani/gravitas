/* ========================================================================== 
   GRAVITAS+ · RESEARCH WORKSPACE ACTIONS

   The Research workspace already has authoritative create/update endpoints for
   projects, resources and mind maps. The legacy research views were originally
   written as read surfaces, which left a handful of perfectly valid empty
   states with no way out. This module closes those UI gaps without creating a
   second data model: every mutation goes through the same production APIs and
   the existing views remain the canonical readers.

   It also repairs two shell regressions that are easiest to express at the
   rendered-workspace boundary:
     - Folder must not render the Editor page tree a second time.
     - An existing note with zero blocks must still open as an editable note.

   The installer is idempotent and survives client-side route redraws.
   ========================================================================== */

import { platform } from './ws-platform.js?v=20260914-7';

const API = '/api';
const DATASET_ACCEPT = '.csv,.tsv,.xlsx,.xls,.json,.jsonl,.zip,.parquet,.xml';
const STATIC_FOLDER_CHILDREN = new Set(['Files & Data Rooms', 'Datasets', 'Mind Maps', 'Shared with me']);

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
}

function cookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

async function csrf() {
  let token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (token) return token;
  const response = await fetch(`${API}/auth/csrf/`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`csrf_http_${response.status}`);
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

async function uploadResource(file, kind, projectId = '') {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  if (projectId) form.append('project_id', projectId);
  else {
    const workspaceId = platform.boot?.workspaces?.research?.id;
    if (workspaceId) form.append('workspace_id', String(workspaceId));
  }

  const response = await fetch(`${API}/platform/files/upload/`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRFToken': await csrf(), Accept: 'application/json' },
    body: form,
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

function statusLine() {
  const line = el('p', 'v-note');
  line.hidden = true;
  return line;
}

function setStatus(line, text, tone = '') {
  line.hidden = !text;
  line.textContent = text;
  if (tone) line.dataset.tone = tone;
  else delete line.dataset.tone;
}

function field(label, control, hint = '') {
  const wrap = el('label', 'fl-field');
  wrap.append(el('span', 'fl-field__label', label), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
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
  for (const [value, label] of options) {
    const option = el('option', '', label);
    option.value = value;
    node.append(option);
  }
  return node;
}

function action(label, handler, solid = false) {
  const button = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  button.type = 'button';
  if (handler) button.addEventListener('click', handler);
  return button;
}

function panel(title, note = '') {
  const box = el('section', 'v-panel fl-panel research-action-panel');
  const head = el('div', 'v-panel__head fl-panel__head');
  const copy = el('div');
  copy.append(el('h2', 'v-panel__title fl-panel__title', title));
  if (note) copy.append(el('p', 'fl-muted', note));
  head.append(copy);
  const body = el('div', 'v-panel__body fl-panel__body');
  box.append(head, body);
  return { box, head, body };
}

function route() {
  return location.pathname.replace(/\/$/, '');
}

function researchActive() {
  return document.getElementById('ws')?.dataset.area === 'research';
}

function pageTitle() {
  return document.querySelector('#ws-view .ws-doc__title')?.textContent?.trim() || '';
}

function appendAfterHeader(node) {
  const doc = document.querySelector('#ws-view .ws-doc');
  const head = doc?.querySelector(':scope > .ws-doc__head');
  if (!doc || !head) return false;
  head.insertAdjacentElement('afterend', node);
  return true;
}

async function projectOptions(selectNode, { includePrivate = true } = {}) {
  selectNode.innerHTML = '';
  if (includePrivate) {
    const own = el('option', '', 'Private research workspace');
    own.value = '';
    selectNode.append(own);
  }
  try {
    const data = await request('/platform/projects/');
    for (const project of data.projects || []) {
      const option = el('option', '', project.title);
      option.value = String(project.id);
      selectNode.append(option);
    }
  } catch {
    if (!selectNode.children.length) {
      const unavailable = el('option', '', 'Projects unavailable');
      unavailable.value = '';
      selectNode.append(unavailable);
    }
  }
}

/* --------------------------------------------------------------------------
   INDEX REPAIR
   Editor owns the page tree. Folder owns storage/data routes. The old nav
   marked both sections as page-tree hosts, so opening both drew the same root
   nodes twice. Keep Folder's real route children and drop only the duplicated
   page branch from the rendered index.
   -------------------------------------------------------------------------- */
function repairResearchIndex() {
  if (!researchActive()) return;
  const tree = document.querySelector('#ws-index-body > .ws-tree');
  if (!tree) return;

  let owner = '';
  for (const child of [...tree.children]) {
    if (child.classList.contains('ws-node')) {
      const depth = child.querySelector(':scope > .ws-node__row')?.style.getPropertyValue('--depth');
      if (depth === '0') owner = child.querySelector(':scope > .ws-node__row .ws-node__label')?.textContent?.trim() || '';
      continue;
    }
    if (!child.classList.contains('ws-node__kids') || owner !== 'Folder') continue;

    for (const row of [...child.children]) {
      if (!row.classList.contains('ws-node')) continue;
      const label = row.querySelector(':scope > .ws-node__row .ws-node__label')?.textContent?.trim() || '';
      if (!STATIC_FOLDER_CHILDREN.has(label)) row.remove();
    }
  }
}

/* --------------------------------------------------------------------------
   EMPTY NOTE REPAIR
   A zero-block page is a valid legacy/server state. The editor previously
   rendered a toolbar and an empty canvas, which looked broken and had no caret.
   Use the editor's own Text action once so the page is saved through its normal
   code path rather than manufacturing state outside the editor.
   -------------------------------------------------------------------------- */
function repairEmptyEditor() {
  if (!route().startsWith('/workspace/page/')) return;
  const canvas = document.querySelector('#ws-view .ws-editor-canvas');
  if (!canvas || canvas.querySelector('.ws-block') || canvas.dataset.seedRequested === '1') return;
  const textButton = [...document.querySelectorAll('#ws-view .ws-editor-tools button')]
    .find((button) => button.textContent.trim() === 'Text');
  if (!textButton) return;
  canvas.dataset.seedRequested = '1';
  textButton.click();
}

/* --------------------------------------------------------------------------
   FILES / DATASETS
   -------------------------------------------------------------------------- */
function resourceKindForRoute() {
  if (route() === '/workspace/research/datasets') return 'dataset';
  if (route() === '/workspace/research/files') return 'file';
  return '';
}

async function enhanceResources() {
  const kind = resourceKindForRoute();
  if (!kind || document.querySelector('[data-research-resource-actions]')) return;
  if (!document.querySelector('#ws-view .ws-doc')) return;

  const bar = el('div', 'v-toolbar research-action-toolbar');
  bar.dataset.researchResourceActions = kind;
  const project = select();
  project.setAttribute('aria-label', 'Project for uploaded resource');
  await projectOptions(project);

  const picker = input('file');
  picker.hidden = true;
  if (kind === 'dataset') picker.accept = DATASET_ACCEPT;
  const upload = action(kind === 'dataset' ? 'Upload dataset' : 'Upload file', () => picker.click(), true);
  const line = statusLine();
  bar.append(project, upload, picker, line);
  if (!appendAfterHeader(bar)) return;

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    upload.disabled = true;
    project.disabled = true;
    setStatus(line, `Uploading ${file.name}…`);
    try {
      await uploadResource(file, kind, project.value);
      setStatus(line, `${file.name} uploaded. Refreshing…`, 'ok');
      window.setTimeout(() => location.reload(), 350);
    } catch (error) {
      const messages = {
        unsupported_dataset_type: `Dataset type not supported. Use ${DATASET_ACCEPT.replaceAll('.', '').replaceAll(',', ', ')}.`,
        file_exists: 'A file with this name already exists in that location.',
        quota_exceeded: 'Your storage quota is full.',
        cloud_unavailable: 'Nextcloud is temporarily unavailable. Nothing was uploaded.',
        permission_denied: 'You do not have permission to upload to that project.',
      };
      setStatus(line, messages[error.message] || 'Upload failed. Nothing was changed.', 'bad');
      upload.disabled = false;
      project.disabled = false;
    }
  });
}

/* --------------------------------------------------------------------------
   PROJECT CREATION
   -------------------------------------------------------------------------- */
async function enhanceProjects() {
  if (route() !== '/workspace/research/projects' || document.querySelector('[data-research-project-actions]')) return;
  if (!document.querySelector('#ws-view .ws-doc')) return;

  const tools = el('div', 'v-toolbar research-action-toolbar');
  tools.dataset.researchProjectActions = '1';
  const create = action('New project', null, true);
  const line = statusLine();
  tools.append(create, line);
  if (!appendAfterHeader(tools)) return;

  let formBox = null;
  create.addEventListener('click', () => {
    if (formBox) {
      formBox.remove();
      formBox = null;
      return;
    }
    const p = panel('Create research project', 'Access is private by default. You can change project policy later from Core Admin.');
    formBox = p.box;
    const title = input('text', 'Project title');
    const question = textarea('Research question', 3);
    const description = textarea('Short project description', 4);
    const category = select([['internal', 'Internal research'], ['client', 'Client / revenue'], ['community', 'Community research']]);
    const visibility = select([['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']]);
    const secureWrap = el('label', 'fl-check');
    const secure = input('checkbox');
    secureWrap.append(secure, el('span', '', 'Secure data room'));
    const submit = action('Create project', null, true);
    submit.type = 'submit';
    const cancel = action('Cancel', () => { formBox?.remove(); formBox = null; });
    const status = statusLine();
    const form = el('form', 'fl-form');
    const grid = el('div', 'fl-form-grid');
    grid.append(field('Title', title), field('Category', category), field('Visibility', visibility));
    form.append(grid, field('Research question', question), field('Description', description), secureWrap);
    const actions = el('div', 'fl-form-actions'); actions.append(submit, cancel);
    form.append(actions, status); p.body.append(form);
    tools.insertAdjacentElement('afterend', formBox);
    title.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim()) { setStatus(status, 'Project title is required.', 'bad'); title.focus(); return; }
      submit.disabled = true;
      setStatus(status, 'Creating project…');
      try {
        await request('/platform/projects/', {
          method: 'POST',
          body: {
            title: title.value.trim(),
            description: description.value.trim(),
            research_question: question.value.trim(),
            category: category.value,
            visibility: visibility.value,
            secure_data_room: secure.checked,
          },
        });
        setStatus(status, 'Project created. Refreshing…', 'ok');
        window.setTimeout(() => location.reload(), 300);
      } catch (error) {
        setStatus(status, error.message === 'title_required' ? 'Project title is required.' : 'Project could not be created.', 'bad');
        submit.disabled = false;
      }
    });
  });
}

/* --------------------------------------------------------------------------
   MIND MAPS
   The backend already supports map/node/edge CRUD. Surface the real editor
   instead of leaving an empty list that cannot ever become non-empty.
   -------------------------------------------------------------------------- */
async function enhanceMindMaps() {
  if (route() !== '/workspace/research/mindmaps' || document.querySelector('[data-research-mindmap-actions]')) return;
  if (!document.querySelector('#ws-view .ws-doc')) return;

  const tools = el('div', 'v-toolbar research-action-toolbar');
  tools.dataset.researchMindmapActions = '1';
  const create = action('New mind map', null, true);
  const mapsSelect = select([['', 'Open a mind map…']]);
  mapsSelect.setAttribute('aria-label', 'Open a mind map');
  const open = action('Open editor', null);
  open.disabled = true;
  const line = statusLine();
  tools.append(create, mapsSelect, open, line);
  if (!appendAfterHeader(tools)) return;

  try {
    const data = await request('/platform/mindmaps/');
    for (const map of data.items || data.mindmaps || []) {
      const option = el('option', '', map.title);
      option.value = String(map.id);
      mapsSelect.append(option);
    }
  } catch {
    setStatus(line, 'Mind maps could not be loaded.', 'bad');
  }
  mapsSelect.addEventListener('change', () => { open.disabled = !mapsSelect.value; });

  let createBox = null;
  let editorBox = null;

  create.addEventListener('click', async () => {
    if (createBox) { createBox.remove(); createBox = null; return; }
    const p = panel('New mind map', 'Start with a title; nodes and relationships are added in the editor.');
    createBox = p.box;
    const title = input('text', 'Mind map title');
    const description = textarea('What question or system does this map describe?', 3);
    const project = select();
    await projectOptions(project);
    const submit = action('Create mind map', null, true); submit.type = 'submit';
    const cancel = action('Cancel', () => { createBox?.remove(); createBox = null; });
    const status = statusLine();
    const form = el('form', 'fl-form');
    form.append(field('Title', title), field('Project', project), field('Description', description));
    const actions = el('div', 'fl-form-actions'); actions.append(submit, cancel);
    form.append(actions, status); p.body.append(form);
    tools.insertAdjacentElement('afterend', createBox);
    title.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim()) { setStatus(status, 'Title is required.', 'bad'); return; }
      submit.disabled = true;
      setStatus(status, 'Creating mind map…');
      try {
        const result = await request('/platform/mindmaps/', {
          method: 'POST',
          body: { title: title.value.trim(), description: description.value.trim(), project_id: project.value || null },
        });
        const made = result.item;
        const option = el('option', '', made.title);
        option.value = String(made.id);
        mapsSelect.append(option);
        mapsSelect.value = String(made.id);
        open.disabled = false;
        createBox.remove(); createBox = null;
        await drawMindMapEditor(made.id);
      } catch (error) {
        setStatus(status, error.message === 'permission_denied' ? 'You cannot create a map in that project.' : 'Mind map could not be created.', 'bad');
        submit.disabled = false;
      }
    });
  });

  open.addEventListener('click', () => { if (mapsSelect.value) drawMindMapEditor(mapsSelect.value); });

  async function drawMindMapEditor(id) {
    if (editorBox) editorBox.remove();
    const p = panel('Mind map editor', 'Nodes and edges are saved immediately to this map.');
    editorBox = p.box;
    tools.insertAdjacentElement('afterend', editorBox);
    p.body.append(el('p', 'v-note', 'Loading map…'));

    try {
      const data = await request(`/platform/mindmaps/${id}/`);
      const map = data.item;
      p.body.innerHTML = '';
      const header = el('div', 'fl-stack');
      header.append(el('strong', '', map.title));
      if (map.description) header.append(el('p', 'fl-muted', map.description));
      p.body.append(header);

      const nodePanel = panel('Nodes');
      const nodeForm = el('form', 'fl-inline-form');
      const nodeTitle = input('text', 'Node title');
      const nodeKind = select([['concept', 'Concept'], ['question', 'Question'], ['hypothesis', 'Hypothesis'], ['evidence', 'Evidence'], ['dataset', 'Dataset'], ['result', 'Result']]);
      const addNode = action('Add node', null, true); addNode.type = 'submit';
      const nodeStatus = statusLine();
      nodeForm.append(nodeTitle, nodeKind, addNode); nodePanel.body.append(nodeForm, nodeStatus);
      for (const node of map.nodes || []) nodePanel.body.append(nodeRow(node));
      p.body.append(nodePanel.box);

      const edgePanel = panel('Relationships');
      if ((map.nodes || []).length >= 2) {
        const edgeForm = el('form', 'fl-inline-form');
        const source = select((map.nodes || []).map((node) => [String(node.id), node.title]));
        const target = select((map.nodes || []).map((node) => [String(node.id), node.title]));
        if (target.options.length > 1) target.selectedIndex = 1;
        const relation = input('text', 'related'); relation.value = 'related';
        const addEdge = action('Connect', null, true); addEdge.type = 'submit';
        const edgeStatus = statusLine();
        edgeForm.append(source, target, relation, addEdge); edgePanel.body.append(edgeForm, edgeStatus);
        edgeForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (source.value === target.value) { setStatus(edgeStatus, 'Choose two different nodes.', 'bad'); return; }
          addEdge.disabled = true;
          try {
            await request(`/platform/mindmaps/${id}/`, {
              method: 'POST',
              body: { action: 'edge.create', source_id: Number(source.value), target_id: Number(target.value), relation: relation.value.trim() || 'related' },
            });
            await drawMindMapEditor(id);
          } catch { setStatus(edgeStatus, 'Relationship could not be created.', 'bad'); addEdge.disabled = false; }
        });
      } else {
        edgePanel.body.append(el('p', 'v-note', 'Add at least two nodes to create a relationship.'));
      }
      for (const edge of map.edges || []) {
        const source = (map.nodes || []).find((node) => node.id === edge.source_id);
        const target = (map.nodes || []).find((node) => node.id === edge.target_id);
        const row = el('div', 'v-row v-row--static');
        const main = el('div', 'v-row__main');
        main.append(el('strong', '', `${source?.title || edge.source_id} → ${target?.title || edge.target_id}`), el('small', '', edge.label || edge.relation));
        const remove = action('Remove', async () => {
          remove.disabled = true;
          try {
            await request(`/platform/mindmaps/${id}/`, { method: 'POST', body: { action: 'edge.delete', edge_id: edge.id } });
            await drawMindMapEditor(id);
          } catch { remove.disabled = false; }
        });
        remove.classList.add('ws-btn--tiny');
        const actions = el('div', 'v-row__actions'); actions.append(remove);
        row.append(main, actions); edgePanel.body.append(row);
      }
      p.body.append(edgePanel.box);

      nodeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!nodeTitle.value.trim()) { setStatus(nodeStatus, 'Node title is required.', 'bad'); return; }
        addNode.disabled = true;
        try {
          await request(`/platform/mindmaps/${id}/`, {
            method: 'POST',
            body: { action: 'node.create', title: nodeTitle.value.trim(), kind: nodeKind.value },
          });
          await drawMindMapEditor(id);
        } catch { setStatus(nodeStatus, 'Node could not be created.', 'bad'); addNode.disabled = false; }
      });

      function nodeRow(node) {
        const row = el('div', 'v-row v-row--static');
        const main = el('div', 'v-row__main');
        main.append(el('strong', '', node.title), el('small', '', node.kind || 'concept'));
        const remove = action('Delete', async () => {
          if (!confirm(`Delete “${node.title}” and its connected edges?`)) return;
          remove.disabled = true;
          try {
            await request(`/platform/mindmaps/${id}/`, { method: 'POST', body: { action: 'node.delete', node_id: node.id } });
            await drawMindMapEditor(id);
          } catch { remove.disabled = false; }
        });
        remove.classList.add('ws-btn--tiny');
        const actions = el('div', 'v-row__actions'); actions.append(remove);
        row.append(main, actions);
        return row;
      }
    } catch {
      p.body.innerHTML = '';
      p.body.append(el('p', 'v-note', 'This mind map could not be loaded.'));
    }
  }
}

/* --------------------------------------------------------------------------
   RESEARCHER PROFILE
   The previous screen literally said “Add a headline” but offered no edit
   control. Make the promise real.
   -------------------------------------------------------------------------- */
async function enhanceResearcherProfile() {
  if (route() !== '/workspace/people' || document.querySelector('[data-research-profile-actions]')) return;
  if (!document.querySelector('#ws-view .ws-doc')) return;
  const tools = el('div', 'v-toolbar research-action-toolbar');
  tools.dataset.researchProfileActions = '1';
  const edit = action('Edit my profile', null, true);
  const line = statusLine();
  tools.append(edit, line);
  if (!appendAfterHeader(tools)) return;

  let formBox = null;
  edit.addEventListener('click', async () => {
    if (formBox) { formBox.remove(); formBox = null; return; }
    setStatus(line, 'Loading profile…');
    try {
      const data = await request('/platform/researchers/me/');
      setStatus(line, '');
      const current = data.profile || {};
      const p = panel('My researcher profile'); formBox = p.box;
      const headline = input('text', 'Research headline'); headline.value = current.headline || '';
      const institution = input('text', 'Institution'); institution.value = current.institution || '';
      const skills = input('text', 'Skills, comma separated'); skills.value = (current.skills || []).join(', ');
      const bio = textarea('Short bio', 5); bio.value = current.bio || '';
      const publicWrap = el('label', 'fl-check');
      const publicBox = input('checkbox'); publicBox.checked = !!current.is_public;
      publicWrap.append(publicBox, el('span', '', 'Show me in the researcher network'));
      const submit = action('Save profile', null, true); submit.type = 'submit';
      const cancel = action('Cancel', () => { formBox?.remove(); formBox = null; });
      const status = statusLine();
      const form = el('form', 'fl-form');
      form.append(field('Headline', headline), field('Institution', institution), field('Skills', skills), field('Bio', bio), publicWrap);
      const actions = el('div', 'fl-form-actions'); actions.append(submit, cancel); form.append(actions, status); p.body.append(form);
      tools.insertAdjacentElement('afterend', formBox); headline.focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); submit.disabled = true; setStatus(status, 'Saving…');
        try {
          await request('/platform/researchers/me/', {
            method: 'PATCH',
            body: { headline: headline.value.trim(), institution: institution.value.trim(), skills: skills.value.split(',').map((item) => item.trim()).filter(Boolean), bio: bio.value.trim(), is_public: publicBox.checked },
          });
          setStatus(status, 'Profile saved. Refreshing…', 'ok');
          window.setTimeout(() => location.reload(), 300);
        } catch { setStatus(status, 'Profile could not be saved.', 'bad'); submit.disabled = false; }
      });
    } catch {
      setStatus(line, 'Profile could not be loaded.', 'bad');
    }
  });
}

function annotateReadOnlySurfaces() {
  if (route() !== '/workspace/shared') return;
  const empty = document.querySelector('#ws-view .ws-empty__body');
  if (empty && !empty.dataset.readOnlyExplained) {
    empty.dataset.readOnlyExplained = '1';
    empty.textContent = 'This view is read-only by design. Items appear here when another person shares a project, file, note, map or task directly with you.';
  }
}

let scheduled = false;
function reconcile() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    repairResearchIndex();
    repairEmptyEditor();
    enhanceResources();
    enhanceProjects();
    enhanceMindMaps();
    enhanceResearcherProfile();
    annotateReadOnlySurfaces();
  });
}

export function installResearchWorkspaceActions() {
  if (window.__gravitasResearchActionsInstalled) return;
  window.__gravitasResearchActionsInstalled = true;

  const target = document.getElementById('ws');
  if (!target) return;
  const observer = new MutationObserver(reconcile);
  observer.observe(target, { childList: true, subtree: true });
  addEventListener('popstate', reconcile);
  addEventListener('ws:navigate', reconcile);
  reconcile();
}
