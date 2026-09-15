import * as P from './ws-platform.js?v=20260914-7';

const state = { installed: false, scheduled: false, loading: new Set(), observer: null };

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

function routeInfo() {
  const match = location.pathname.match(/^\/workspace\/research\/projects\/(\d+)(?:\/([a-z-]+))?\/?$/);
  if (!match) return null;
  return { projectId: Number(match[1]), tab: match[2] || 'overview' };
}

function button(label, handler, { solid = false, tiny = false, danger = false } = {}) {
  const node = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, label);
  node.type = 'button';
  if (danger) node.dataset.tone = 'bad';
  node.addEventListener('click', handler);
  return node;
}

function input(name, value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.name = name;
  node.type = type;
  if (type !== 'checkbox' && type !== 'file') node.value = value == null ? '' : String(value);
  node.placeholder = placeholder;
  return node;
}

function textarea(name, value = '', rows = 4, placeholder = '') {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.name = name;
  node.rows = rows;
  node.value = value == null ? '' : String(value);
  node.placeholder = placeholder;
  return node;
}

function select(name, options, value = '') {
  const node = el('select', 'v-input fl-input');
  node.name = name;
  for (const [key, title] of options) {
    const option = el('option', '', title);
    option.value = key;
    option.selected = String(key) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function checkbox(name, checked, title) {
  const wrap = el('label', 'fl-check');
  const node = input(name, '', 'checkbox');
  node.checked = !!checked;
  wrap.append(node, el('span', '', title));
  return { wrap, node };
}

function field(title, control, hint = '') {
  const wrap = el('label', 'ws-action-dialog__field');
  wrap.append(el('span', '', title), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
}

function modal(title, build, submitLabel = '', onSubmit = null) {
  document.querySelector('[data-project-action-modal]')?.remove();
  const layer = el('div', 'ws-action-dialog-layer');
  layer.dataset.projectActionModal = '1';
  const dialog = el('section', 'ws-action-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  const form = el('form', 'ws-action-dialog__body');
  const onKeydown = (event) => { if (event.key === 'Escape') dismiss(); };
  const dismiss = () => {
    document.removeEventListener('keydown', onKeydown);
    layer.remove();
  };
  const head = el('div', 'ws-action-dialog__head');
  head.append(el('h2', '', title));
  const close = button('Close', dismiss);
  close.setAttribute('aria-label', 'Close');
  head.append(close);
  const grid = el('div', 'ws-action-dialog__grid');
  const fields = build(grid, form) || {};
  const status = el('p', 'ws-action-dialog__error');
  status.setAttribute('aria-live', 'polite');
  const actions = el('div', 'ws-action-dialog__actions');
  const cancel = button('Cancel', dismiss);
  actions.append(cancel);
  let submit = null;
  if (submitLabel && onSubmit) {
    submit = button(submitLabel, () => {}, { solid: true });
    submit.type = 'submit';
    actions.append(submit);
  }
  form.append(head, grid, status, actions);
  dialog.append(form);
  layer.append(dialog);
  document.body.append(layer);
  layer.addEventListener('pointerdown', (event) => { if (event.target === layer) dismiss(); });
  document.addEventListener('keydown', onKeydown);
  if (submit && onSubmit) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = '';
      submit.disabled = true;
      cancel.disabled = true;
      try {
        await onSubmit(fields, new FormData(form), status);
        dismiss();
      } catch (error) {
        status.textContent = error?.data?.error || error?.message || 'The action could not be completed.';
        submit.disabled = false;
        cancel.disabled = false;
      }
    });
  }
  queueMicrotask(() => form.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus());
  return { layer, form, grid, fields, status };
}

function refreshProject() {
  dispatchEvent(new CustomEvent('ws:navigate'));
  schedule();
}

const canEditProject = (project) => !!project?.permissions?.can_edit;
const canManageProject = (project) => !!project?.permissions?.can_manage;

function cookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

async function csrf() {
  let token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (token) return token;
  await fetch('/api/auth/csrf/', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (!token) throw new Error('csrf_token_missing');
  return token;
}

async function uploadProjectFile(projectId, file, kind = 'file', { title = '', description = '' } = {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('project_id', String(projectId));
  if (title) form.append('title', title);
  if (description) form.append('description', description);
  const response = await fetch('/api/platform/files/upload/', {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': await csrf(), Accept: 'application/json' }, body: form,
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

function editProject(projectId, project) {
  modal('Edit project', (grid) => {
    const secure = checkbox('secure_data_room', project.secure_data_room, 'Secure data room');
    const downloads = checkbox('allow_downloads', project.allow_downloads !== false, 'Allow downloads');
    const publicLinks = checkbox('allow_public_links', project.allow_public_links, 'Allow public/share links');
    const applications = checkbox('application_open', project.application_open, 'Applications open');
    grid.append(
      field('Title', input('title', project.title || '', 'text', 'Project title')),
      field('Research question', textarea('research_question', project.research_question || '', 3, 'Research question')),
      field('Description', textarea('description', project.description || '', 4, 'Project description')),
      field('Category', select('category', [['internal', 'Internal'], ['client', 'Client'], ['community', 'Community']], project.category || 'internal')),
      field('Status', select('status', [['draft', 'Draft'], ['active', 'Active'], ['paused', 'Paused'], ['complete', 'Complete'], ['archived', 'Archived']], project.status || 'active')),
      field('Visibility', select('visibility', [['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']], project.visibility || 'private')),
      field('Confidentiality', select('confidentiality', [['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted']], project.confidentiality || 'internal')),
      field('Client', input('client_name', project.client_name || '', 'text', 'Client / partner')),
      field('Deadline', input('deadline', project.deadline || '', 'date')),
      secure.wrap, downloads.wrap, publicLinks.wrap, applications.wrap,
    );
    return { secure: secure.node, downloads: downloads.node, publicLinks: publicLinks.node, applications: applications.node };
  }, 'Save project', async (fields, data) => {
    const title = String(data.get('title') || '').trim();
    if (!title) throw new Error('Project title is required.');
    await P.call(`/platform/projects/${projectId}/`, { method: 'PATCH', body: {
      title,
      research_question: String(data.get('research_question') || '').trim(),
      description: String(data.get('description') || '').trim(),
      category: data.get('category'), status: data.get('status'), visibility: data.get('visibility'), confidentiality: data.get('confidentiality'),
      client_name: String(data.get('client_name') || '').trim(), deadline: data.get('deadline') || '',
      secure_data_room: fields.secure.checked, allow_downloads: fields.downloads.checked, allow_public_links: fields.publicLinks.checked, application_open: fields.applications.checked,
    }});
    refreshProject();
  });
}

async function manageAccess(projectId) {
  const current = await P.call(`/platform/share/?type=project&id=${projectId}`);
  modal('Project access', (grid) => {
    const email = input('email', '', 'email', 'person@example.com');
    const role = select('role', [['view', 'Viewer'], ['comment', 'Commenter'], ['edit', 'Editor'], ['manage', 'Manager']], 'edit');
    grid.append(el('p', 'fl-muted', 'Grant or update project access by email. Existing direct grants can be revoked below.'), field('Email', email), field('Role', role));
    const list = el('div', 'fl-panel__body');
    const grants = current.grants || [];
    if (!grants.length) list.append(el('p', 'fl-muted', 'No direct grants yet. Project owner access is implicit.'));
    for (const grant of grants) {
      const row = el('div', 'fl-row');
      const main = el('div', 'fl-row__main');
      main.append(el('strong', '', grant.name || grant.email), el('small', 'fl-muted', `${grant.email} · ${grant.role}`));
      const revoke = button('Revoke', async () => {
        revoke.disabled = true;
        try {
          await P.call('/platform/share/', { method: 'DELETE', body: { type: 'project', id: projectId, action: 'revoke', grant_id: grant.id } });
          row.remove();
        } catch (error) {
          revoke.disabled = false;
          throw error;
        }
      }, { tiny: true, danger: true });
      row.append(main, revoke);
      list.append(row);
    }
    grid.append(list);
    return { email, role };
  }, 'Grant access', async (_fields, data) => {
    const email = String(data.get('email') || '').trim();
    if (!email) throw new Error('Email is required.');
    await P.call('/platform/share/', { method: 'POST', body: { type: 'project', id: projectId, action: 'grant', email, role: data.get('role') || 'edit' } });
    refreshProject();
  });
}

function createTask(projectId) {
  modal('New task', (grid) => {
    grid.append(
      field('Title', input('title', '', 'text', 'Task title')),
      field('Due date', input('due_date', '', 'date')),
      field('Priority', select('priority', [['p0', 'P0 · Critical'], ['p1', 'P1 · High'], ['p2', 'P2 · Normal'], ['p3', 'P3 · Low']], 'p2')),
      field('Definition of done', textarea('definition_of_done', '', 3, 'Definition of done')),
      field('Description', textarea('description', '', 3, 'Context')),
    );
    return {};
  }, 'Create task', async (_fields, data) => {
    await P.call(`/platform/projects/${projectId}/tasks/`, { method: 'POST', body: {
      title: String(data.get('title') || '').trim(), due_date: data.get('due_date') || '', priority: data.get('priority') || 'p2',
      definition_of_done: String(data.get('definition_of_done') || '').trim(), description: String(data.get('description') || '').trim(), status: 'active',
    }});
    refreshProject();
  });
}

function editTask(cockpit) {
  const editable = (cockpit.tasks || []).filter((item) => item.can_edit);
  if (!editable.length) return modal('Edit task', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable tasks in this project.')); }, '', null);
  modal('Edit task', (grid) => {
    const task = select('task_id', editable.map((item) => [String(item.id), item.title]), String(editable[0].id));
    const title = input('title', editable[0].title || '', 'text');
    const due = input('due_date', editable[0].due_date || '', 'date');
    const priority = select('priority', [['p0', 'P0 · Critical'], ['p1', 'P1 · High'], ['p2', 'P2 · Normal'], ['p3', 'P3 · Low']], editable[0].priority || 'p2');
    const status = select('status', [['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done'], ['archived', 'Archived']], editable[0].status || 'active');
    const done = textarea('definition_of_done', editable[0].definition_of_done || '', 3);
    const description = textarea('description', editable[0].description || '', 3);
    const blocked = textarea('blocked_reason', editable[0].blocked_reason || '', 2, 'Why is this blocked?');
    const load = () => {
      const selected = editable.find((item) => String(item.id) === task.value) || editable[0];
      title.value = selected.title || ''; due.value = selected.due_date || ''; priority.value = selected.priority || 'p2'; status.value = selected.status || 'active';
      done.value = selected.definition_of_done || ''; description.value = selected.description || ''; blocked.value = selected.blocked_reason || '';
    };
    task.addEventListener('change', load);
    grid.append(field('Task', task), field('Title', title), field('Due date', due), field('Priority', priority), field('Status', status), field('Definition of done', done), field('Description', description), field('Blocked reason', blocked));
    return { task };
  }, 'Save task', async (fields, data) => {
    await P.call(`/platform/tasks/${fields.task.value}/`, { method: 'PATCH', body: {
      title: String(data.get('title') || '').trim(), due_date: data.get('due_date') || '', priority: data.get('priority'), status: data.get('status'),
      definition_of_done: String(data.get('definition_of_done') || '').trim(), description: String(data.get('description') || '').trim(), blocked_reason: String(data.get('blocked_reason') || '').trim(),
    }});
    refreshProject();
  });
}

function editResearchRequest(cockpit) {
  const editable = (cockpit.research_requests || []).filter((item) => item.can_edit);
  if (!editable.length) return modal('Edit request', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable research requests in this project.')); }, '', null);
  modal('Edit research request', (grid) => {
    const request = select('request_id', editable.map((item) => [String(item.id), item.title]), String(editable[0].id));
    const status = select('status', [['open', 'Open'], ['in_progress', 'In progress'], ['review', 'Review'], ['done', 'Done'], ['cancelled', 'Cancelled']], editable[0].status || 'open');
    const priority = select('priority', [['p0', 'P0'], ['p1', 'P1'], ['p2', 'P2'], ['p3', 'P3']], editable[0].priority || 'p2');
    const due = input('due_date', editable[0].due_date || '', 'date');
    const brief = textarea('brief', editable[0].brief || '', 4);
    const output = textarea('output_summary', editable[0].output_summary || '', 4, 'Output summary');
    const load = () => {
      const selected = editable.find((item) => String(item.id) === request.value) || editable[0];
      status.value = selected.status || 'open'; priority.value = selected.priority || 'p2'; due.value = selected.due_date || ''; brief.value = selected.brief || ''; output.value = selected.output_summary || '';
    };
    request.addEventListener('change', load);
    grid.append(field('Request', request), field('Status', status), field('Priority', priority), field('Due date', due), field('Brief', brief), field('Output summary', output));
    return { request };
  }, 'Save request', async (fields, data) => {
    await P.call(`/platform/research-requests/${fields.request.value}/`, { method: 'PATCH', body: {
      status: data.get('status'), priority: data.get('priority'), due_date: data.get('due_date') || '', brief: String(data.get('brief') || ''), output_summary: String(data.get('output_summary') || ''),
    }});
    refreshProject();
  });
}

function createNote(projectId) {
  modal('New project note', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Note title')), field('Body', textarea('body', '', 10, 'Write the note…')), field('Description', textarea('description', '', 3, 'Short description')));
    return {};
  }, 'Create note', async (_fields, data) => {
    await P.call('/platform/resources/', { method: 'POST', body: { kind: 'note', project_id: projectId, title: String(data.get('title') || '').trim(), body: String(data.get('body') || ''), description: String(data.get('description') || '').trim() } });
    refreshProject();
  });
}

function manageResource(cockpit, kinds, title = 'Edit item') {
  const items = (cockpit.resources || []).filter((item) => kinds.includes(item.kind));
  if (!items.length) return modal(title, (grid) => { grid.append(el('p', 'fl-muted', 'There are no items in this view yet.')); }, '', null);
  const details = new Map();
  modal(title, (grid) => {
    const resource = select('resource_id', items.map((item) => [String(item.id), item.title || item.original_name || `Item ${item.id}`]), String(items[0].id));
    const itemTitle = input('title', items[0].title || '', 'text');
    const description = textarea('description', items[0].description || '', 3);
    const body = textarea('body', '', 8, 'Note body');
    const source = input('source_url', items[0].source_url || '', 'url', 'https://…');
    const bodyField = field('Body', body);
    const sourceField = field('Source URL', source);
    const destructive = el('div', 'v-toolbar');
    const remove = button('Delete', async () => {
      if (!window.confirm('Delete this project item?')) return;
      remove.disabled = true;
      try { await P.call(`/platform/resources/${resource.value}/`, { method: 'DELETE' }); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch { remove.disabled = false; }
    }, { danger: true });
    destructive.append(remove);
    const load = async () => {
      const id = resource.value;
      let detail = details.get(id);
      if (!detail) { const result = await P.call(`/platform/resources/${id}/`); detail = result.item || result; details.set(id, detail); }
      itemTitle.value = detail.title || detail.original_name || ''; description.value = detail.description || ''; body.value = detail.body || ''; source.value = detail.source_url || '';
      bodyField.hidden = detail.kind !== 'note'; sourceField.hidden = detail.kind !== 'paper';
    };
    resource.addEventListener('change', () => load().catch(() => {}));
    grid.append(field('Item', resource), field('Title', itemTitle), field('Description', description), bodyField, sourceField, destructive);
    queueMicrotask(() => load().catch(() => {}));
    return { resource, details };
  }, 'Save changes', async (fields, data) => {
    const id = fields.resource.value;
    const result = fields.details.get(id) ? { item: fields.details.get(id) } : await P.call(`/platform/resources/${id}/`);
    const detail = result.item || result;
    const payload = { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim() };
    if (detail.kind === 'note') payload.body = String(data.get('body') || '');
    if (detail.kind === 'paper') payload.source_url = String(data.get('source_url') || '').trim();
    await P.call(`/platform/resources/${id}/`, { method: 'PATCH', body: payload });
    refreshProject();
  });
}

function addPaper(projectId) {
  modal('Add source', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Paper / source title')), field('Source URL', input('source_url', '', 'url', 'https://…')), field('Description', textarea('description', '', 4, 'Citation, notes or evidence context')));
    return {};
  }, 'Add source', async (_fields, data) => {
    await P.call('/platform/resources/', { method: 'POST', body: { kind: 'paper', project_id: projectId, title: String(data.get('title') || '').trim(), source_url: String(data.get('source_url') || '').trim(), description: String(data.get('description') || '').trim() } });
    refreshProject();
  });
}

function uploadFile(projectId, kind = 'file') {
  modal(kind === 'dataset' ? 'Upload dataset' : 'Upload file', (grid) => {
    const file = input('file', '', 'file');
    if (kind === 'dataset') file.accept = '.csv,.tsv,.xlsx,.xls,.json,.jsonl,.zip,.parquet,.xml';
    grid.append(field('File', file), field('Title', input('title', '', 'text', 'Optional display title')), field('Description', textarea('description', '', 3, 'Optional description')));
    return { file };
  }, 'Upload', async (fields, data, status) => {
    const file = fields.file.files?.[0];
    if (!file) throw new Error('Choose a file first.');
    status.textContent = `Uploading ${file.name}…`;
    await uploadProjectFile(projectId, file, kind, { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim() });
    refreshProject();
  });
}

function createMindMap(projectId) {
  modal('New mind map', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Mind map title')), field('Description', textarea('description', '', 3, 'What this map explores')));
    return {};
  }, 'Create map', async (_fields, data) => {
    await P.call('/platform/mindmaps/', { method: 'POST', body: { project_id: projectId, title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim() } });
    refreshProject();
  });
}

function createDiscussion(projectId) {
  modal('New discussion', (grid) => { grid.append(field('Message', textarea('body', '', 7, 'Decision, question or project discussion…'))); return {}; }, 'Post message', async (_fields, data) => {
    await P.createProjectDiscussion(projectId, { body: String(data.get('body') || '').trim() });
    refreshProject();
  });
}

async function manageDiscussions(projectId) {
  const result = await P.projectDiscussions(projectId);
  const editable = (result.messages || []).filter((item) => item.can_edit);
  if (!editable.length) return modal('Manage discussions', (grid) => { grid.append(el('p', 'fl-muted', 'There are no messages you can edit.')); }, '', null);
  modal('Manage discussions', (grid) => {
    const message = select('message_id', editable.map((item) => [String(item.id), `${item.author?.name || 'Message'} · ${(item.body || '').slice(0, 70)}`]), String(editable[0].id));
    const body = textarea('body', editable[0].body || '', 7);
    const resolved = checkbox('resolved', editable[0].resolved, 'Resolved');
    const destructive = el('div', 'v-toolbar');
    const remove = button('Delete message', async () => {
      if (!window.confirm('Delete this discussion message?')) return;
      remove.disabled = true;
      try { await P.deleteProjectDiscussion(projectId, message.value); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch { remove.disabled = false; }
    }, { danger: true });
    destructive.append(remove);
    const load = () => { const selected = editable.find((item) => String(item.id) === message.value) || editable[0]; body.value = selected.body || ''; resolved.node.checked = !!selected.resolved; };
    message.addEventListener('change', load);
    grid.append(field('Message', message), field('Body', body), resolved.wrap, destructive);
    return { message, resolved: resolved.node };
  }, 'Save message', async (fields, data) => {
    await P.updateProjectDiscussion(projectId, fields.message.value, { body: String(data.get('body') || '').trim(), resolved: fields.resolved.checked });
    refreshProject();
  });
}

function createExperiment(projectId) {
  modal('New experiment', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Experiment title')), field('Hypothesis', textarea('hypothesis', '', 3)), field('Protocol', textarea('protocol', '', 5)), field('Status', select('status', [['planned', 'Planned'], ['running', 'Running'], ['review', 'Under review'], ['complete', 'Complete'], ['abandoned', 'Abandoned']], 'planned')));
    return {};
  }, 'Create experiment', async (_fields, data) => {
    await P.createProjectExperiment(projectId, { title: String(data.get('title') || '').trim(), hypothesis: String(data.get('hypothesis') || ''), protocol: String(data.get('protocol') || ''), status: data.get('status') || 'planned' });
    refreshProject();
  });
}

async function editExperiment(projectId) {
  const result = await P.projectExperiments(projectId);
  const editable = (result.experiments || []).filter((item) => item.can_edit);
  if (!editable.length) return modal('Edit experiment', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable experiments yet.')); }, '', null);
  modal('Edit experiment', (grid) => {
    const experiment = select('experiment_id', editable.map((item) => [String(item.id), item.title]), String(editable[0].id));
    const title = input('title', editable[0].title || '', 'text');
    const hypothesis = textarea('hypothesis', editable[0].hypothesis || '', 3);
    const protocol = textarea('protocol', editable[0].protocol || '', 5);
    const resultSummary = textarea('result_summary', editable[0].result_summary || '', 4, 'Result summary');
    const status = select('status', [['planned', 'Planned'], ['running', 'Running'], ['review', 'Under review'], ['complete', 'Complete'], ['abandoned', 'Abandoned']], editable[0].status || 'planned');
    const destructive = el('div', 'v-toolbar');
    const remove = button('Delete experiment', async () => {
      if (!window.confirm('Delete this experiment?')) return;
      remove.disabled = true;
      try { await P.deleteProjectExperiment(projectId, experiment.value); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch { remove.disabled = false; }
    }, { danger: true });
    destructive.append(remove);
    const load = () => { const selected = editable.find((item) => String(item.id) === experiment.value) || editable[0]; title.value = selected.title || ''; hypothesis.value = selected.hypothesis || ''; protocol.value = selected.protocol || ''; resultSummary.value = selected.result_summary || ''; status.value = selected.status || 'planned'; };
    experiment.addEventListener('change', load);
    grid.append(field('Experiment', experiment), field('Title', title), field('Hypothesis', hypothesis), field('Protocol', protocol), field('Result', resultSummary), field('Status', status), destructive);
    return { experiment };
  }, 'Save experiment', async (fields, data) => {
    await P.updateProjectExperiment(projectId, fields.experiment.value, { title: String(data.get('title') || '').trim(), hypothesis: String(data.get('hypothesis') || ''), protocol: String(data.get('protocol') || ''), result_summary: String(data.get('result_summary') || ''), status: data.get('status') });
    refreshProject();
  });
}

function createDeliverable(projectId, cockpit) {
  const resources = [['', 'No linked resource'], ...(cockpit.resources || []).map((item) => [String(item.id), item.title || item.original_name || `Resource ${item.id}`])];
  modal('New deliverable', (grid) => {
    const visible = checkbox('client_visible', false, 'Client visible');
    grid.append(field('Title', input('title', '', 'text', 'Deliverable title')), field('Description', textarea('description', '', 4)), field('Linked resource', select('resource_id', resources, '')), field('Status', select('status', [['draft', 'Draft'], ['review', 'Review'], ['approved', 'Approved'], ['delivered', 'Delivered']], 'draft')), visible.wrap);
    return { visible: visible.node };
  }, 'Create deliverable', async (fields, data) => {
    await P.call(`/platform/projects/${projectId}/deliverables/`, { method: 'POST', body: { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), resource_id: data.get('resource_id') || null, status: data.get('status') || 'draft', client_visible: fields.visible.checked } });
    refreshProject();
  });
}

async function openDataRoom() {
  const data = await P.nextcloud();
  const root = String(data.nextcloud?.url || data.url || '').replace(/\/$/, '');
  if (!root) throw new Error('Nextcloud is not configured.');
  window.open(`${root}/index.php/apps/files/`, '_blank', 'noopener');
}

function actionSet(info, cockpit, project) {
  const canEdit = canEditProject(project);
  const canManage = canManageProject(project);
  const actions = [];
  const add = (label, handler, solid = false) => actions.push(button(label, handler, { solid }));
  if (info.tab === 'overview') {
    if (canManage) add('Edit project', () => editProject(info.projectId, project), true);
    if (canManage) add('Access', () => manageAccess(info.projectId).catch(console.error));
    if (canEdit) add('New task', () => createTask(info.projectId));
    if (canEdit) add('New note', () => createNote(info.projectId));
    if (canEdit) add('Upload', () => uploadFile(info.projectId, 'file'));
  } else if (info.tab === 'milestones') {
    if (P.canOpenCore()) add('Open planning', () => { location.href = '/workspace/operating'; }, true);
  } else if (info.tab === 'tasks') {
    if (canEdit) add('New task', () => createTask(info.projectId), true);
    if ((cockpit.tasks || []).some((item) => item.can_edit)) add('Edit task', () => editTask(cockpit));
    if ((cockpit.research_requests || []).some((item) => item.can_edit)) add('Edit request', () => editResearchRequest(cockpit));
  } else if (info.tab === 'notes') {
    if (canEdit) add('New note', () => createNote(info.projectId), true);
    if ((cockpit.resources || []).some((item) => item.kind === 'note')) add('Edit note', () => manageResource(cockpit, ['note'], 'Edit note'));
  } else if (info.tab === 'sources') {
    if (canEdit) add('Add source', () => addPaper(info.projectId), true);
    if (canEdit) add('Upload dataset', () => uploadFile(info.projectId, 'dataset'));
    if (canEdit) add('New map', () => createMindMap(info.projectId));
    if ((cockpit.resources || []).some((item) => ['paper', 'dataset'].includes(item.kind))) add('Edit source', () => manageResource(cockpit, ['paper', 'dataset'], 'Edit source'));
  } else if (info.tab === 'files') {
    if (canEdit) add('Upload file', () => uploadFile(info.projectId, 'file'), true);
    if ((cockpit.resources || []).some((item) => item.kind === 'file')) add('Edit file', () => manageResource(cockpit, ['file'], 'Edit file'));
    add('Data room', () => openDataRoom().catch((error) => window.alert(error.message)));
  } else if (info.tab === 'discussions') {
    if (canEdit) add('New message', () => createDiscussion(info.projectId), true);
    add('Manage', () => manageDiscussions(info.projectId).catch(console.error));
  } else if (info.tab === 'experiments') {
    if (canEdit) add('New experiment', () => createExperiment(info.projectId), true);
    add('Edit experiment', () => editExperiment(info.projectId).catch(console.error));
    if (canEdit) add('New deliverable', () => createDeliverable(info.projectId, cockpit));
  }
  add('Refresh', refreshProject);
  return actions;
}

async function mountForCurrentRoute() {
  const info = routeInfo();
  if (!info) return;
  const head = document.querySelector('#ws-view .fl-project-head');
  if (!head || head.querySelector('[data-project-actions]')) return;
  const key = `${info.projectId}:${info.tab}`;
  if (state.loading.has(key)) return;
  state.loading.add(key);
  try {
    const cockpit = await P.projectCockpit(info.projectId);
    const current = routeInfo();
    if (!current || current.projectId !== info.projectId || current.tab !== info.tab) return;
    const project = cockpit.project || {};
    const toolbar = el('div', 'v-toolbar fl-project-actionbar');
    toolbar.dataset.projectActions = '1';
    for (const actionNode of actionSet(info, cockpit, project)) toolbar.append(actionNode);
    const tabs = head.querySelector('.fl-tabs');
    if (tabs) head.insertBefore(toolbar, tabs);
    else head.append(toolbar);
    for (const tab of head.querySelectorAll('.fl-tab')) {
      if (tab.textContent.trim() === 'Experiments & Deliverables') tab.textContent = 'Outputs';
    }
  } catch (error) {
    console.error('Research project actions could not load', error);
  } finally {
    state.loading.delete(key);
  }
}

function schedule() {
  if (state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    mountForCurrentRoute().catch((error) => console.error('Research project action mount failed', error));
  });
}

export function installResearchProjectActions() {
  if (state.installed) return;
  state.installed = true;
  addEventListener('popstate', schedule);
  addEventListener('ws:navigate', schedule);
  state.observer = new MutationObserver(schedule);
  const view = document.getElementById('ws-view');
  if (view) state.observer.observe(view, { childList: true, subtree: true });
  schedule();
}
