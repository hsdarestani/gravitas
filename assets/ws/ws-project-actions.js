import * as P from './ws-platform.js?v=20260914-7';

const state = { installed: false, scheduled: false, loading: new Set(), observer: null };
const PROJECT_STATUS = [['intake', 'Intake'], ['active', 'Active'], ['review', 'Review'], ['delivered', 'Delivered'], ['on_hold', 'On hold'], ['closed', 'Closed']];
const PROJECT_VISIBILITY = [['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']];
const PROJECT_CATEGORY = [['internal', 'Internal'], ['client', 'Client'], ['community', 'Community']];
const CONFIDENTIALITY = [['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted'], ['public', 'Public']];
const PRIORITY = [['p0', 'P0 · Critical'], ['p1', 'P1 · High'], ['p2', 'P2 · Normal'], ['p3', 'P3 · Low']];
const TASK_STATUS = [['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done'], ['archived', 'Archived']];
const REQUEST_STATUS = [['draft', 'Draft'], ['open', 'Open'], ['in_progress', 'In progress'], ['review', 'Review'], ['done', 'Done'], ['cancelled', 'Cancelled']];
const MILESTONE_STATUS = TASK_STATUS;
const HEALTH = [['green', 'Green'], ['yellow', 'Yellow'], ['red', 'Red']];
const EXPERIMENT_STATUS = [['planned', 'Planned'], ['running', 'Running'], ['review', 'Under review'], ['complete', 'Complete'], ['abandoned', 'Abandoned']];
const DELIVERABLE_STATUS = [['draft', 'Draft'], ['review', 'Review'], ['approved', 'Approved'], ['delivered', 'Delivered']];

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

function routeInfo() {
  const match = location.pathname.match(/^\/workspace\/research\/projects\/(\d+)(?:\/([a-z-]+))?\/?$/);
  return match ? { projectId: Number(match[1]), tab: match[2] || 'overview' } : null;
}

function go(path) {
  if (path === location.pathname) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  schedule();
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
  if (!['checkbox', 'file'].includes(type)) node.value = value == null ? '' : String(value);
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
  const dismiss = () => { document.removeEventListener('keydown', onKeydown); layer.remove(); };
  const onKeydown = (event) => { if (event.key === 'Escape') dismiss(); };
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
  document.addEventListener('keydown', onKeydown);
  layer.addEventListener('pointerdown', (event) => { if (event.target === layer) dismiss(); });
  if (submit) {
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
  queueMicrotask(() => form.querySelector('input:not([type="hidden"]), select, textarea')?.focus());
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

async function uploadProjectFile(projectId, file, kind, title = '', description = '') {
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
    const links = checkbox('allow_public_links', project.allow_public_links, 'Allow public/share links');
    const applications = checkbox('application_open', project.application_open, 'Applications open');
    grid.append(
      field('Title', input('title', project.title || '', 'text', 'Project title')),
      field('Research question', textarea('research_question', project.research_question || '', 3)),
      field('Description', textarea('description', project.description || '', 4)),
      field('Category', select('category', PROJECT_CATEGORY, project.category || 'internal')),
      field('Status', select('status', PROJECT_STATUS, project.status || 'intake')),
      field('Visibility', select('visibility', PROJECT_VISIBILITY, project.visibility || 'private')),
      field('Confidentiality', select('confidentiality', CONFIDENTIALITY, project.confidentiality || 'internal')),
      field('Client', input('client_name', project.client_name || '', 'text', 'Client / partner')),
      field('Deadline', input('deadline', project.deadline || '', 'date')),
      secure.wrap, downloads.wrap, links.wrap, applications.wrap,
    );
    return { secure: secure.node, downloads: downloads.node, links: links.node, applications: applications.node };
  }, 'Save project', async (fields, data) => {
    const title = String(data.get('title') || '').trim();
    if (!title) throw new Error('Project title is required.');
    await P.call(`/platform/projects/${projectId}/`, { method: 'PATCH', body: {
      title,
      research_question: String(data.get('research_question') || '').trim(),
      description: String(data.get('description') || '').trim(),
      category: data.get('category'), status: data.get('status'), visibility: data.get('visibility'), confidentiality: data.get('confidentiality'),
      client_name: String(data.get('client_name') || '').trim(), deadline: data.get('deadline') || '',
      secure_data_room: fields.secure.checked, allow_downloads: fields.downloads.checked,
      allow_public_links: fields.links.checked, application_open: fields.applications.checked,
    }});
    refreshProject();
  });
}

async function manageAccess(projectId) {
  const current = await P.call(`/platform/share/?type=project&id=${projectId}`);
  modal('Project access', (grid) => {
    grid.append(
      el('p', 'fl-muted', 'Grant, change or revoke direct project access.'),
      field('Email', input('email', '', 'email', 'person@example.com')),
      field('Role', select('role', [['view', 'Viewer'], ['comment', 'Commenter'], ['edit', 'Editor'], ['manage', 'Manager']], 'edit')),
    );
    const grants = el('div', 'fl-panel__body');
    if (!(current.grants || []).length) grants.append(el('p', 'fl-muted', 'No direct grants yet. Project owner access is implicit.'));
    for (const grant of current.grants || []) {
      const row = el('div', 'fl-row');
      const main = el('div', 'fl-row__main');
      main.append(el('strong', '', grant.name || grant.email), el('small', 'fl-muted', `${grant.email} · ${grant.role}`));
      row.append(main);
      if (grant.id) {
        const tools = el('div', 'fl-row__actions');
        tools.append(button('Revoke', async () => {
          if (!window.confirm(`Revoke access for ${grant.email}?`)) return;
          await P.call('/platform/share/', { method: 'POST', body: { type: 'project', id: projectId, action: 'revoke', grant_id: grant.id } });
          document.querySelector('[data-project-action-modal]')?.remove();
          refreshProject();
        }, { tiny: true, danger: true }));
        row.append(tools);
      }
      grants.append(row);
    }
    grid.append(grants);
    return {};
  }, 'Grant access', async (_fields, data) => {
    const email = String(data.get('email') || '').trim();
    if (!email) throw new Error('Email is required.');
    await P.call('/platform/share/', { method: 'POST', body: { type: 'project', id: projectId, action: 'grant', email, role: data.get('role') || 'edit' } });
    refreshProject();
  });
}

function createMilestone(projectId) {
  modal('New milestone', (grid) => {
    grid.append(
      field('Title', input('title', '', 'text', 'Milestone title')),
      field('Due date', input('due_date', '', 'date')),
      field('Status', select('status', MILESTONE_STATUS, 'active')),
      field('Health', select('health', HEALTH, 'green')),
      field('Definition of done', textarea('definition_of_done', '', 4)),
    );
    return {};
  }, 'Create milestone', async (_fields, data) => {
    await P.call(`/platform/projects/${projectId}/milestones/`, { method: 'POST', body: {
      title: String(data.get('title') || '').trim(),
      due_date: data.get('due_date') || '',
      status: data.get('status') || 'active',
      health: data.get('health') || 'green',
      definition_of_done: String(data.get('definition_of_done') || '').trim(),
    }});
    refreshProject();
  });
}

async function editMilestone(projectId) {
  const result = await P.projectMilestones(projectId);
  const items = (result.milestones || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Edit milestone', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable milestones in this project.')); });
  modal('Edit milestone', (grid) => {
    const picker = select('milestone_id', items.map((item) => [String(item.id), item.title]), String(items[0].id));
    const title = input('title');
    const due = input('due_date', '', 'date');
    const status = select('status', MILESTONE_STATUS, 'active');
    const health = select('health', HEALTH, 'green');
    const done = textarea('definition_of_done', '', 4);
    const load = () => {
      const item = items.find((row) => String(row.id) === picker.value) || items[0];
      title.value = item.title || ''; due.value = item.due_date || ''; status.value = item.status || 'active'; health.value = item.health || 'green'; done.value = item.definition_of_done || '';
    };
    const remove = button('Delete milestone', async () => {
      if (!window.confirm('Delete this milestone?')) return;
      remove.disabled = true;
      try {
        await P.call(`/platform/projects/${projectId}/milestones/${picker.value}/`, { method: 'DELETE' });
        document.querySelector('[data-project-action-modal]')?.remove();
        refreshProject();
      } catch (error) {
        remove.disabled = false;
        window.alert(error?.data?.error || error.message || 'Delete failed.');
      }
    }, { danger: true });
    picker.addEventListener('change', load); load();
    const destructive = el('div', 'v-toolbar'); destructive.append(remove);
    grid.append(field('Milestone', picker), field('Title', title), field('Due date', due), field('Status', status), field('Health', health), field('Definition of done', done), destructive);
    return { picker };
  }, 'Save milestone', async (fields, data) => {
    await P.call(`/platform/projects/${projectId}/milestones/${fields.picker.value}/`, { method: 'PATCH', body: {
      title: String(data.get('title') || '').trim(), due_date: data.get('due_date') || '', status: data.get('status'), health: data.get('health'), definition_of_done: String(data.get('definition_of_done') || '').trim(),
    }});
    refreshProject();
  });
}

function createTask(projectId) {
  modal('New task', (grid) => {
    grid.append(
      field('Title', input('title', '', 'text', 'Task title')),
      field('Due date', input('due_date', '', 'date')),
      field('Priority', select('priority', PRIORITY, 'p2')),
      field('Definition of done', textarea('definition_of_done', '', 3)),
      field('Description', textarea('description', '', 3)),
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
  const items = (cockpit.tasks || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Edit task', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable tasks in this project.')); });
  modal('Edit task', (grid) => {
    const picker = select('task_id', items.map((item) => [String(item.id), item.title]), String(items[0].id));
    const title = input('title'); const due = input('due_date', '', 'date'); const priority = select('priority', PRIORITY, 'p2'); const status = select('status', TASK_STATUS, 'active');
    const done = textarea('definition_of_done', '', 3); const description = textarea('description', '', 3); const blocked = textarea('blocked_reason', '', 2, 'Why is this blocked?');
    const load = () => {
      const item = items.find((row) => String(row.id) === picker.value) || items[0];
      title.value = item.title || ''; due.value = item.due_date || ''; priority.value = item.priority || 'p2'; status.value = item.status || 'active'; done.value = item.definition_of_done || ''; description.value = item.description || ''; blocked.value = item.blocked_reason || '';
    };
    picker.addEventListener('change', load); load();
    grid.append(field('Task', picker), field('Title', title), field('Due date', due), field('Priority', priority), field('Status', status), field('Definition of done', done), field('Description', description), field('Blocked reason', blocked));
    return { picker };
  }, 'Save task', async (fields, data) => {
    await P.call(`/platform/tasks/${fields.picker.value}/`, { method: 'PATCH', body: {
      title: String(data.get('title') || '').trim(), due_date: data.get('due_date') || '', priority: data.get('priority'), status: data.get('status'),
      definition_of_done: String(data.get('definition_of_done') || '').trim(), description: String(data.get('description') || '').trim(), blocked_reason: String(data.get('blocked_reason') || '').trim(),
    }});
    refreshProject();
  });
}

function editResearchRequest(cockpit) {
  const items = (cockpit.research_requests || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Edit request', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable research requests in this project.')); });
  modal('Edit research request', (grid) => {
    const picker = select('request_id', items.map((item) => [String(item.id), item.title]), String(items[0].id));
    const status = select('status', REQUEST_STATUS, items[0].status || 'open'); const priority = select('priority', PRIORITY, items[0].priority || 'p2'); const due = input('due_date', '', 'date'); const brief = textarea('brief', '', 4); const output = textarea('output_summary', '', 4);
    const load = () => {
      const item = items.find((row) => String(row.id) === picker.value) || items[0];
      status.value = item.status || 'open'; priority.value = item.priority || 'p2'; due.value = item.due_date || ''; brief.value = item.brief || ''; output.value = item.output_summary || '';
    };
    picker.addEventListener('change', load); load();
    grid.append(field('Request', picker), field('Status', status), field('Priority', priority), field('Due date', due), field('Brief', brief), field('Output summary', output));
    return { picker };
  }, 'Save request', async (fields, data) => {
    await P.call(`/platform/research-requests/${fields.picker.value}/`, { method: 'PATCH', body: { status: data.get('status'), priority: data.get('priority'), due_date: data.get('due_date') || '', brief: String(data.get('brief') || ''), output_summary: String(data.get('output_summary') || '') } });
    refreshProject();
  });
}

function createNote(projectId) {
  modal('New project note', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Note title')), field('Body', textarea('body', '', 10, 'Write the note…')), field('Description', textarea('description', '', 3)));
    return {};
  }, 'Create note', async (_fields, data) => {
    await P.call('/platform/resources/', { method: 'POST', body: { kind: 'note', project_id: projectId, title: String(data.get('title') || '').trim(), body: String(data.get('body') || ''), description: String(data.get('description') || '').trim() } });
    refreshProject();
  });
}

function manageResource(cockpit, kinds, title) {
  const items = (cockpit.resources || []).filter((item) => kinds.includes(item.kind) && item.can_edit);
  if (!items.length) return modal(title, (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable items in this view.')); });
  const cache = new Map();
  modal(title, (grid) => {
    const picker = select('resource_id', items.map((item) => [String(item.id), item.title || item.original_name || `Item ${item.id}`]), String(items[0].id));
    const itemTitle = input('title'); const description = textarea('description', '', 3); const body = textarea('body', '', 8); const source = input('source_url', '', 'url', 'https://…');
    const bodyField = field('Body', body); const sourceField = field('Source URL', source);
    const remove = button('Delete', async () => {
      if (!window.confirm('Delete this project item?')) return;
      remove.disabled = true;
      try { await P.call(`/platform/resources/${picker.value}/`, { method: 'DELETE' }); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch (error) { remove.disabled = false; window.alert(error?.data?.error || error.message || 'Delete failed.'); }
    }, { danger: true });
    const load = async () => {
      let item = cache.get(picker.value);
      if (!item) { const result = await P.call(`/platform/resources/${picker.value}/`); item = result.item || result; cache.set(picker.value, item); }
      itemTitle.value = item.title || item.original_name || ''; description.value = item.description || ''; body.value = item.body || ''; source.value = item.source_url || '';
      bodyField.hidden = item.kind !== 'note'; sourceField.hidden = item.kind !== 'paper';
    };
    picker.addEventListener('change', () => load().catch(() => {}));
    const destructive = el('div', 'v-toolbar'); destructive.append(remove);
    grid.append(field('Item', picker), field('Title', itemTitle), field('Description', description), bodyField, sourceField, destructive);
    queueMicrotask(() => load().catch(() => {}));
    return { picker, cache };
  }, 'Save changes', async (fields, data) => {
    let item = fields.cache.get(fields.picker.value);
    if (!item) { const result = await P.call(`/platform/resources/${fields.picker.value}/`); item = result.item || result; }
    const body = { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim() };
    if (item.kind === 'note') body.body = String(data.get('body') || '');
    if (item.kind === 'paper') body.source_url = String(data.get('source_url') || '').trim();
    await P.call(`/platform/resources/${fields.picker.value}/`, { method: 'PATCH', body });
    refreshProject();
  });
}

function addSource(projectId) {
  modal('Add source', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Paper / source title')), field('Source URL', input('source_url', '', 'url', 'https://…')), field('Description', textarea('description', '', 4)));
    return {};
  }, 'Add source', async (_fields, data) => {
    await P.call('/platform/resources/', { method: 'POST', body: { kind: 'paper', project_id: projectId, title: String(data.get('title') || '').trim(), source_url: String(data.get('source_url') || '').trim(), description: String(data.get('description') || '').trim() } });
    refreshProject();
  });
}

function uploadFile(projectId, kind) {
  modal(kind === 'dataset' ? 'Upload dataset' : 'Upload file', (grid) => {
    const picker = input('file', '', 'file');
    if (kind === 'dataset') picker.accept = '.csv,.tsv,.xlsx,.xls,.json,.jsonl,.zip,.parquet,.xml';
    grid.append(field('File', picker), field('Title', input('title', '', 'text', 'Optional display title')), field('Description', textarea('description', '', 3)));
    return { picker };
  }, 'Upload', async (fields, data, status) => {
    const file = fields.picker.files?.[0];
    if (!file) throw new Error('Choose a file first.');
    status.textContent = `Uploading ${file.name}…`;
    await uploadProjectFile(projectId, file, kind, String(data.get('title') || '').trim(), String(data.get('description') || '').trim());
    refreshProject();
  });
}

function createMindMap(projectId) {
  modal('New mind map', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Mind map title')), field('Description', textarea('description', '', 3)));
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
  const items = (result.messages || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Manage discussions', (grid) => { grid.append(el('p', 'fl-muted', 'There are no messages you can edit.')); });
  modal('Manage discussions', (grid) => {
    const picker = select('message_id', items.map((item) => [String(item.id), `${item.author?.name || 'Message'} · ${(item.body || '').slice(0, 70)}`]), String(items[0].id));
    const body = textarea('body', '', 7); const resolved = checkbox('resolved', false, 'Resolved');
    const remove = button('Delete message', async () => {
      if (!window.confirm('Delete this discussion message?')) return;
      remove.disabled = true;
      try { await P.deleteProjectDiscussion(projectId, picker.value); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch (error) { remove.disabled = false; window.alert(error?.data?.error || error.message || 'Delete failed.'); }
    }, { danger: true });
    const load = () => { const item = items.find((row) => String(row.id) === picker.value) || items[0]; body.value = item.body || ''; resolved.node.checked = !!item.resolved; };
    picker.addEventListener('change', load); load();
    const destructive = el('div', 'v-toolbar'); destructive.append(remove);
    grid.append(field('Message', picker), field('Body', body), resolved.wrap, destructive);
    return { picker, resolved: resolved.node };
  }, 'Save message', async (fields, data) => {
    await P.updateProjectDiscussion(projectId, fields.picker.value, { body: String(data.get('body') || '').trim(), resolved: fields.resolved.checked });
    refreshProject();
  });
}

function createExperiment(projectId) {
  modal('New experiment', (grid) => {
    grid.append(field('Title', input('title', '', 'text', 'Experiment title')), field('Hypothesis', textarea('hypothesis', '', 3)), field('Protocol', textarea('protocol', '', 5)), field('Status', select('status', EXPERIMENT_STATUS, 'planned')));
    return {};
  }, 'Create experiment', async (_fields, data) => {
    await P.createProjectExperiment(projectId, { title: String(data.get('title') || '').trim(), hypothesis: String(data.get('hypothesis') || ''), protocol: String(data.get('protocol') || ''), status: data.get('status') || 'planned' });
    refreshProject();
  });
}

async function editExperiment(projectId) {
  const result = await P.projectExperiments(projectId);
  const items = (result.experiments || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Edit experiment', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable experiments yet.')); });
  modal('Edit experiment', (grid) => {
    const picker = select('experiment_id', items.map((item) => [String(item.id), item.title]), String(items[0].id));
    const title = input('title'); const hypothesis = textarea('hypothesis', '', 3); const protocol = textarea('protocol', '', 5); const resultSummary = textarea('result_summary', '', 4); const status = select('status', EXPERIMENT_STATUS, 'planned');
    const remove = button('Delete experiment', async () => {
      if (!window.confirm('Delete this experiment?')) return;
      remove.disabled = true;
      try { await P.deleteProjectExperiment(projectId, picker.value); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch (error) { remove.disabled = false; window.alert(error?.data?.error || error.message || 'Delete failed.'); }
    }, { danger: true });
    const load = () => { const item = items.find((row) => String(row.id) === picker.value) || items[0]; title.value = item.title || ''; hypothesis.value = item.hypothesis || ''; protocol.value = item.protocol || ''; resultSummary.value = item.result_summary || ''; status.value = item.status || 'planned'; };
    picker.addEventListener('change', load); load();
    const destructive = el('div', 'v-toolbar'); destructive.append(remove);
    grid.append(field('Experiment', picker), field('Title', title), field('Hypothesis', hypothesis), field('Protocol', protocol), field('Result', resultSummary), field('Status', status), destructive);
    return { picker };
  }, 'Save experiment', async (fields, data) => {
    await P.updateProjectExperiment(projectId, fields.picker.value, { title: String(data.get('title') || '').trim(), hypothesis: String(data.get('hypothesis') || ''), protocol: String(data.get('protocol') || ''), result_summary: String(data.get('result_summary') || ''), status: data.get('status') });
    refreshProject();
  });
}

function deliverableResources(cockpit) {
  return [['', 'No linked resource'], ...(cockpit.resources || []).filter((item) => item.can_edit || item.can_manage).map((item) => [String(item.id), item.title || item.original_name || `Resource ${item.id}`])];
}

function createDeliverable(projectId, cockpit) {
  modal('New deliverable', (grid) => {
    const visible = checkbox('client_visible', false, 'Client visible');
    grid.append(field('Title', input('title', '', 'text', 'Deliverable title')), field('Description', textarea('description', '', 4)), field('Linked resource', select('resource_id', deliverableResources(cockpit), '')), field('Status', select('status', DELIVERABLE_STATUS, 'draft')), visible.wrap);
    return { visible: visible.node };
  }, 'Create deliverable', async (fields, data) => {
    await P.call(`/platform/projects/${projectId}/deliverables/`, { method: 'POST', body: { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), resource_id: data.get('resource_id') || null, status: data.get('status') || 'draft', client_visible: fields.visible.checked } });
    refreshProject();
  });
}

function editDeliverable(projectId, cockpit) {
  const items = (cockpit.deliverables || []).filter((item) => item.can_edit);
  if (!items.length) return modal('Edit deliverable', (grid) => { grid.append(el('p', 'fl-muted', 'There are no editable deliverables yet.')); });
  modal('Edit deliverable', (grid) => {
    const picker = select('deliverable_id', items.map((item) => [String(item.id), item.title]), String(items[0].id));
    const title = input('title'); const description = textarea('description', '', 4); const resource = select('resource_id', deliverableResources(cockpit), ''); const status = select('status', DELIVERABLE_STATUS, 'draft'); const visible = checkbox('client_visible', false, 'Client visible');
    const load = () => {
      const item = items.find((row) => String(row.id) === picker.value) || items[0];
      title.value = item.title || ''; description.value = item.description || ''; resource.value = item.resource_id ? String(item.resource_id) : ''; status.value = item.status || 'draft'; visible.node.checked = !!item.client_visible;
    };
    const remove = button('Delete deliverable', async () => {
      if (!window.confirm('Delete this deliverable?')) return;
      remove.disabled = true;
      try { await P.call(`/platform/projects/${projectId}/deliverables/${picker.value}/`, { method: 'DELETE' }); document.querySelector('[data-project-action-modal]')?.remove(); refreshProject(); }
      catch (error) { remove.disabled = false; window.alert(error?.data?.error || error.message || 'Delete failed.'); }
    }, { danger: true });
    picker.addEventListener('change', load); load();
    const destructive = el('div', 'v-toolbar'); destructive.append(remove);
    grid.append(field('Deliverable', picker), field('Title', title), field('Description', description), field('Linked resource', resource), field('Status', status), visible.wrap, destructive);
    return { picker, visible: visible.node };
  }, 'Save deliverable', async (fields, data) => {
    await P.call(`/platform/projects/${projectId}/deliverables/${fields.picker.value}/`, { method: 'PATCH', body: { title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), resource_id: data.get('resource_id') || null, status: data.get('status') || 'draft', client_visible: fields.visible.checked } });
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

  if (canManage) add('Edit project', () => editProject(info.projectId, project), info.tab === 'overview');
  if (canManage) add('Access', () => manageAccess(info.projectId).catch(console.error));

  if (info.tab === 'overview') {
    if (canEdit) add('New task', () => createTask(info.projectId));
    if (canEdit) add('New note', () => createNote(info.projectId));
    if (canEdit) add('Upload', () => uploadFile(info.projectId, 'file'));
  } else if (info.tab === 'milestones') {
    if (canEdit) add('New milestone', () => createMilestone(info.projectId), true);
    if (canEdit) add('Edit milestone', () => editMilestone(info.projectId).catch(console.error));
    if (P.canOpenCore()) add('Open planning', () => go('/workspace/operating'));
  } else if (info.tab === 'tasks') {
    if (canEdit) add('New task', () => createTask(info.projectId), true);
    if ((cockpit.tasks || []).some((item) => item.can_edit)) add('Edit task', () => editTask(cockpit));
    if ((cockpit.research_requests || []).some((item) => item.can_edit)) add('Edit request', () => editResearchRequest(cockpit));
  } else if (info.tab === 'notes') {
    if (canEdit) add('New note', () => createNote(info.projectId), true);
    if ((cockpit.resources || []).some((item) => item.kind === 'note' && item.can_edit)) add('Edit note', () => manageResource(cockpit, ['note'], 'Edit note'));
  } else if (info.tab === 'sources') {
    if (canEdit) add('Add source', () => addSource(info.projectId), true);
    if (canEdit) add('Upload dataset', () => uploadFile(info.projectId, 'dataset'));
    if (canEdit) add('New map', () => createMindMap(info.projectId));
    if ((cockpit.resources || []).some((item) => ['paper', 'dataset'].includes(item.kind) && item.can_edit)) add('Edit source', () => manageResource(cockpit, ['paper', 'dataset'], 'Edit source'));
  } else if (info.tab === 'files') {
    if (canEdit) add('Upload file', () => uploadFile(info.projectId, 'file'), true);
    if ((cockpit.resources || []).some((item) => item.kind === 'file' && item.can_edit)) add('Edit file', () => manageResource(cockpit, ['file'], 'Edit file'));
    add('Data room', () => openDataRoom().catch((error) => window.alert(error.message)));
  } else if (info.tab === 'discussions') {
    if (canEdit) add('New message', () => createDiscussion(info.projectId), true);
    if (canEdit) add('Manage', () => manageDiscussions(info.projectId).catch(console.error));
  } else if (info.tab === 'experiments') {
    if (canEdit) add('New experiment', () => createExperiment(info.projectId), true);
    if (canEdit) add('Edit experiment', () => editExperiment(info.projectId).catch(console.error));
    if (canEdit) add('New deliverable', () => createDeliverable(info.projectId, cockpit));
    if ((cockpit.deliverables || []).some((item) => item.can_edit)) add('Edit deliverable', () => editDeliverable(info.projectId, cockpit));
  }
  add('Refresh', refreshProject);
  return actions;
}

function activateNode(node, handler) {
  if (!node || node.dataset.projectActionBound) return;
  node.dataset.projectActionBound = '1';
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.style.cursor = 'pointer';
  node.addEventListener('click', handler);
  node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handler(); } });
}

function wireOverviewMetrics(info, cockpit, project) {
  if (info.tab !== 'overview') return;
  const doc = document.querySelector('#ws-view .fl-project-doc');
  if (!doc) return;
  const topMetrics = [...doc.querySelectorAll(':scope > .fl-metrics > .fl-metric')];
  const destinations = ['tasks', 'notes', 'files', 'experiments'];
  destinations.forEach((tab, index) => activateNode(topMetrics[index], () => go(`/workspace/research/projects/${info.projectId}/${tab}`)));
  if (topMetrics[4] && canManageProject(project)) activateNode(topMetrics[4], () => manageAccess(info.projectId).catch(console.error));
  if (topMetrics[5]) activateNode(topMetrics[5], () => [...doc.querySelectorAll('.fl-panel__title')].find((node) => node.textContent.trim() === 'Knowledge graph')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  for (const item of doc.querySelectorAll('.fl-metrics--compact .fl-metric')) activateNode(item, () => go(`/workspace/research/projects/${info.projectId}/tasks`));
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
    if (tabs) head.insertBefore(toolbar, tabs); else head.append(toolbar);
    wireOverviewMetrics(info, cockpit, project);
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
