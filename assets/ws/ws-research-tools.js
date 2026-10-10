/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  RESEARCH · TOOLBARS
   The upload bar on Files and Datasets, the bar above Mind maps, and
   "Edit my profile" on Researchers. ws-research-actions.js used to paste
   these under each screen's head after it had drawn; the screens now insert
   them. Markup and wording are unchanged; a finished save redraws the
   screen instead of reloading the whole workspace.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r4';

const DATASET_ACCEPT = '.csv,.tsv,.xlsx,.xls,.json,.jsonl,.zip,.parquet,.xml';

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
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

async function projectOptions(selectNode, { includePrivate = true } = {}) {
  selectNode.innerHTML = '';
  if (includePrivate) {
    const own = el('option', '', 'Private research workspace');
    own.value = '';
    selectNode.append(own);
  }
  try {
    const data = await P.call('/platform/projects/');
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

export async function uploadToolbar(head, kind, { onUploaded } = {}) {

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
  head.insertAdjacentElement('afterend', bar);

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    upload.disabled = true;
    project.disabled = true;
    setStatus(line, `Uploading ${file.name}…`);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      if (project.value) form.append('project_id', project.value);
      else if (P.platform.boot?.workspaces?.research?.id) form.append('workspace_id', String(P.platform.boot.workspaces.research.id));
      await P.upload('/platform/files/upload/', form);
      setStatus(line, `${file.name} uploaded. Refreshing…`, 'ok');
      window.setTimeout(() => onUploaded?.(), 350);
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

export async function mindmapToolbar(head) {

  const tools = el('div', 'v-toolbar research-action-toolbar');
  tools.dataset.researchMindmapActions = '1';
  const create = action('New mind map', null, true);
  const mapsSelect = select([['', 'Open a mind map…']]);
  mapsSelect.setAttribute('aria-label', 'Open a mind map');
  const open = action('Open editor', null);
  open.disabled = true;
  const line = statusLine();
  tools.append(create, mapsSelect, open, line);
  head.insertAdjacentElement('afterend', tools);

  try {
    const data = await P.call('/platform/mindmaps/');
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
        const result = await P.call('/platform/mindmaps/', {
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
      const data = await P.call(`/platform/mindmaps/${id}/`);
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
            await P.call(`/platform/mindmaps/${id}/`, {
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
            await P.call(`/platform/mindmaps/${id}/`, { method: 'POST', body: { action: 'edge.delete', edge_id: edge.id } });
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
          await P.call(`/platform/mindmaps/${id}/`, {
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
            await P.call(`/platform/mindmaps/${id}/`, { method: 'POST', body: { action: 'node.delete', node_id: node.id } });
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

export async function profileToolbar(head, { onSaved } = {}) {
  const tools = el('div', 'v-toolbar research-action-toolbar');
  tools.dataset.researchProfileActions = '1';
  const edit = action('Edit my profile', null, true);
  const line = statusLine();
  tools.append(edit, line);
  head.insertAdjacentElement('afterend', tools);

  let formBox = null;
  edit.addEventListener('click', async () => {
    if (formBox) { formBox.remove(); formBox = null; return; }
    setStatus(line, 'Loading profile…');
    try {
      const data = await P.call('/platform/researchers/me/');
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
          await P.call('/platform/researchers/me/', {
            method: 'PATCH',
            body: { headline: headline.value.trim(), institution: institution.value.trim(), skills: skills.value.split(',').map((item) => item.trim()).filter(Boolean), bio: bio.value.trim(), is_public: publicBox.checked },
          });
          setStatus(status, 'Profile saved. Refreshing…', 'ok');
          window.setTimeout(() => onSaved?.(), 300);
        } catch { setStatus(status, 'Profile could not be saved.', 'bad'); submit.disabled = false; }
      });
    } catch {
      setStatus(line, 'Profile could not be loaded.', 'bad');
    }
  });
}
