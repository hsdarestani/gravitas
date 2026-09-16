import * as P from './ws-platform.js?v=20260914-6';

const TABS = [
  ['overview', 'Overview'],
  ['milestones', 'Milestones'],
  ['tasks', 'Tasks'],
  ['notes', 'Notes'],
  ['sources', 'Sources'],
  ['files', 'Files'],
  ['discussions', 'Discussions'],
  ['experiments', 'Outputs'],
  ['activity', 'Activity'],
];

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const label = (value) => P.label(value || '');
const date = (value) => P.formatDate(value);

function action(text, handler, solid = false, tiny = false) {
  const button = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, text);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function badge(text, tone = '') {
  const node = el('span', 'v-badge fl-badge', text);
  if (tone) node.dataset.tone = tone;
  return node;
}

function section(title, note = '') {
  const box = el('section', 'fl-panel');
  const head = el('div', 'fl-panel__head');
  const text = el('div');
  text.append(el('h2', 'fl-panel__title', title));
  if (note) text.append(el('p', 'fl-muted', note));
  head.append(text);
  const body = el('div', 'fl-panel__body');
  box.append(head, body);
  return { box, body, head };
}

function empty(title, copy) {
  const node = el('div', 'fl-state');
  node.append(el('strong', null, title), el('p', 'fl-muted', copy));
  return node;
}

function row({ title, meta = '', body = '', badges = [], actions = [], onClick = null }) {
  const node = el(onClick ? 'button' : 'div', `fl-row${onClick ? ' fl-row--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  const main = el('div', 'fl-row__main');
  main.append(el('strong', null, title || 'Untitled'));
  if (meta) main.append(el('small', 'fl-muted', meta));
  if (body) main.append(el('p', 'fl-row__body', body));
  if (badges.length) {
    const strip = el('div', 'fl-badges');
    badges.filter(Boolean).forEach((item) => strip.append(badge(item)));
    main.append(strip);
  }
  node.append(main);
  if (actions.length) {
    const tools = el('div', 'fl-row__actions');
    actions.forEach((item) => tools.append(item));
    node.append(tools);
  }
  return node;
}

function metric(value, title, note = '') {
  const node = el('div', 'fl-metric');
  node.append(el('strong', 'fl-metric__value', String(value ?? 0)), el('span', 'fl-metric__title', title));
  if (note) node.append(el('small', 'fl-muted', note));
  return node;
}

function projectShell(host, project, projectId, tab, go) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc fl-project-doc');
  const head = el('header', 'ws-doc__head fl-project-head');
  const top = el('div', 'fl-project-head__top');
  const text = el('div');
  text.append(el('span', 'fl-eyebrow', 'RESEARCH PROJECT'), el('h1', 'ws-doc__title', project.title));
  text.append(el('p', 'ws-doc__meta', P.meta([label(project.category), project.client_name, label(project.status), label(project.visibility)])));
  const tags = el('div', 'fl-badges');
  if (project.secure_data_room) tags.append(badge('Secure data room'));
  if (project.permissions?.role) tags.append(badge(label(project.permissions.role)));
  top.append(text, tags);
  head.append(top);

  const tabs = el('nav', 'fl-tabs');
  tabs.setAttribute('aria-label', 'Project views');
  for (const [key, title] of TABS) {
    const button = el('button', 'fl-tab', title);
    button.type = 'button';
    button.setAttribute('aria-current', key === tab ? 'page' : 'false');
    button.addEventListener('click', () => go(key === 'overview'
      ? `/workspace/research/projects/${projectId}`
      : `/workspace/research/projects/${projectId}/${key}`));
    tabs.append(button);
  }
  head.append(tabs);
  doc.append(head);
  host.append(doc);
  return doc;
}

function loading(host) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc');
  const grid = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 8; i += 1) grid.append(el('div', 'fl-skeleton'));
  doc.append(grid);
  host.append(doc);
}

function failure(host, projectId, tab, go, error) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc');
  const state = empty('Project view could not be loaded', error?.message || 'The server did not return a usable response.');
  state.append(action('Retry', () => renderResearchProject(host, projectId, tab, { go }), true));
  doc.append(state);
  host.append(doc);
}

function attention(cockpit) {
  const a = cockpit.attention || {};
  const values = [
    [a.overdue_tasks, 'Overdue tasks'],
    [a.overdue_requests, 'Overdue requests'],
    [a.blocked_tasks, 'Blocked tasks'],
    [a.open_requests, 'Open research requests'],
  ];
  const box = section('Attention');
  const metrics = el('div', 'fl-metrics fl-metrics--compact');
  values.forEach(([value, title]) => metrics.append(metric(value || 0, title)));
  box.body.append(metrics);
  return box.box;
}

function overviewView(doc, cockpit) {
  const project = cockpit.project;
  const counts = cockpit.counts || {};
  const metrics = el('div', 'fl-metrics');
  metrics.append(
    metric(counts.tasks, 'Tasks'),
    metric(counts.notes, 'Notes'),
    metric((counts.files || 0) + (counts.datasets || 0), 'Files & datasets'),
    metric(counts.deliverables, 'Deliverables'),
    metric(counts.members, 'Members'),
    metric(counts.connections, 'Connections'),
  );
  doc.append(metrics);

  if (project.research_question) {
    const question = section('Research question');
    question.body.append(el('p', 'fl-prose fl-prose--lead', project.research_question));
    doc.append(question.box);
  }
  doc.append(attention(cockpit));

  const cols = el('div', 'fl-columns');
  const about = section('About');
  about.body.append(el('p', 'fl-prose', project.description || 'No project description yet.'));
  about.body.append(row({
    title: 'Project policy',
    meta: P.meta([label(project.confidentiality), project.deadline ? `Due ${date(project.deadline)}` : '', project.budget ? `${project.budget} ${project.currency}` : '']),
    badges: [project.allow_downloads === false ? 'Downloads restricted' : '', project.application_open ? 'Applications open' : ''],
  }));

  const members = section('Members');
  if (!cockpit.members.length) members.body.append(empty('No additional members', 'Only the project owner currently has access.'));
  for (const member of cockpit.members) members.body.append(row({ title: member.name, meta: member.email, badges: [label(member.role)] }));
  cols.append(about.box, members.box);
  doc.append(cols);

  const connections = section('Knowledge graph', 'Explicit relationships between the project, evidence, deliverables, tasks and research requests.');
  if (!cockpit.connections.length) connections.body.append(empty('No explicit connections yet', 'Relationships created between project objects appear here.'));
  for (const item of cockpit.connections.slice(0, 12)) {
    connections.body.append(row({
      title: `${item.source.title} → ${item.target.title}`,
      meta: item.relation_label,
    }));
  }
  doc.append(connections.box);
}

function milestonesView(doc, milestones) {
  const box = section('Milestones', 'Project milestones share the canonical Core operating plan and remain actionable inside Research.');
  if (!milestones.length) box.body.append(empty('No milestones linked', 'Create a milestone here or link one from Core planning.'));
  for (const item of milestones) {
    box.body.append(row({
      title: item.title,
      meta: P.meta([item.owner, item.due_date ? `Due ${date(item.due_date)}` : '', label(item.status), label(item.health)]),
      body: item.definition_of_done,
      badges: [item.cycle, item.initiative],
    }));
  }
  doc.append(box.box);
}

function tasksView(doc, cockpit) {
  const box = section('Tasks', 'Project-linked execution remains one object whether it is viewed from Core or Research.');
  if (!cockpit.tasks.length) box.body.append(empty('No project tasks', 'Tasks linked to this project appear here.'));
  for (const item of cockpit.tasks) {
    box.body.append(row({
      title: item.title,
      meta: P.meta([item.owner, item.due_date ? `Due ${date(item.due_date)}` : '', label(item.priority)]),
      body: item.description,
      badges: [label(item.status), item.initiative],
    }));
  }
  doc.append(box.box);

  const requests = section('Research requests', 'Requests handed into this project from content or Core execution.');
  if (!cockpit.research_requests.length) requests.body.append(empty('No research requests', 'Cross-layer requests linked to this project appear here.'));
  for (const item of cockpit.research_requests) requests.body.append(row({
    title: item.title,
    meta: P.meta([label(item.status), label(item.priority), item.due_date ? `Due ${date(item.due_date)}` : '']),
    body: item.brief,
  }));
  doc.append(requests.box);
}

function resourcesByKind(resources, kinds) {
  return resources.filter((item) => kinds.includes(item.kind));
}

function resourceRow(item) {
  const actions = [];
  if (item.has_download) {
    const download = el('a', 'ws-btn ws-btn--tiny', 'Download');
    download.href = `/api/platform/files/${item.id}/download/`;
    actions.push(download);
  }
  if (item.source_url) {
    const source = el('a', 'ws-btn ws-btn--tiny', 'Source');
    source.href = item.source_url;
    source.target = '_blank';
    source.rel = 'noopener';
    actions.push(source);
  }
  return row({
    title: item.title || item.original_name,
    meta: P.meta([item.owner, item.collection_name, item.file_size ? P.formatBytes(item.file_size) : '', date(item.updated_at)]),
    body: item.description,
    badges: [label(item.kind), label(item.role)],
    actions,
  });
}

function notesView(doc, cockpit) {
  const items = resourcesByKind(cockpit.resources, ['note']);
  const box = section('Project notes');
  if (!items.length) box.body.append(empty('No project notes', 'Research notes explicitly attached to this project appear here.'));
  items.forEach((item) => box.body.append(resourceRow(item)));
  doc.append(box.box);
}

function sourcesView(doc, cockpit) {
  const items = resourcesByKind(cockpit.resources, ['paper', 'dataset']);
  const box = section('Sources & evidence', 'Papers and datasets attached to this project.');
  if (!items.length) box.body.append(empty('No sources yet', 'Attach papers or datasets to establish the project evidence base.'));
  items.forEach((item) => box.body.append(resourceRow(item)));
  doc.append(box.box);

  const maps = section('Mind maps');
  if (!cockpit.mindmaps.length) maps.body.append(empty('No mind maps', 'Concept maps attached to this project appear here.'));
  for (const map of cockpit.mindmaps) maps.body.append(row({ title: map.title, meta: `${map.node_count} nodes · ${map.edge_count} edges`, body: map.description }));
  doc.append(maps.box);
}

function filesView(doc, cockpit) {
  const items = resourcesByKind(cockpit.resources, ['file']);
  const box = section('Files & secure data room', 'Project files are backed by Nextcloud and remain inside the project ACL.');
  if (!items.length) box.body.append(empty('No files yet', 'Files attached to this project appear here.'));
  items.forEach((item) => box.body.append(resourceRow(item)));
  doc.append(box.box);
}

function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.value = value || '';
  node.placeholder = placeholder;
  return node;
}

function textarea(value = '', rows = 4, placeholder = '') {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.rows = rows;
  node.value = value || '';
  node.placeholder = placeholder;
  return node;
}

function select(options, value) {
  const node = el('select', 'v-input fl-input');
  for (const [key, text] of options) {
    const option = el('option', null, text);
    option.value = key;
    option.selected = key === value;
    node.append(option);
  }
  return node;
}

function discussionView(doc, projectId, messages, project, rerender) {
  const box = section('Private discussion', 'Messages inherit this project’s ACL. They are not public-site comments.');
  const roots = messages.filter((item) => !item.parent_id);
  if (!roots.length) box.body.append(empty('No discussion yet', 'Start a project-scoped thread for decisions and questions that belong with the research.'));

  const byParent = new Map();
  for (const message of messages) {
    if (!message.parent_id) continue;
    const list = byParent.get(message.parent_id) || [];
    list.push(message);
    byParent.set(message.parent_id, list);
  }

  const drawMessage = (message, depth = 0) => {
    const node = el('article', 'fl-message');
    node.style.setProperty('--message-depth', String(depth));
    const head = el('div', 'fl-message__head');
    head.append(el('strong', null, message.author.name), el('span', 'fl-muted', date(message.created_at)));
    if (message.resolved) head.append(badge('Resolved'));
    node.append(head, el('p', 'fl-prose', message.body));
    const tools = el('div', 'fl-row__actions');
    if (project.permissions?.can_edit) {
      const reply = action('Reply', () => {
        if (node.querySelector('.fl-reply-form')) return;
        const form = el('form', 'fl-inline-form fl-reply-form');
        const body = textarea('', 2, 'Write a reply');
        const submit = action('Post', () => {}, true, true); submit.type = 'submit';
        form.append(body, submit);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          submit.disabled = true;
          try { await P.createProjectDiscussion(projectId, { body: body.value, parent_id: message.id }); await rerender(); }
          catch { submit.disabled = false; }
        });
        node.append(form);
      }, false, true);
      tools.append(reply);
    }
    if (message.can_edit) {
      tools.append(action(message.resolved ? 'Reopen' : 'Resolve', async () => {
        await P.updateProjectDiscussion(projectId, message.id, { resolved: !message.resolved });
        await rerender();
      }, false, true));
    }
    node.append(tools);
    for (const reply of byParent.get(message.id) || []) node.append(drawMessage(reply, depth + 1));
    return node;
  };
  roots.forEach((message) => box.body.append(drawMessage(message)));

  if (project.permissions?.can_edit) {
    const form = el('form', 'fl-form fl-discussion-compose');
    const body = textarea('', 4, 'Start a project discussion');
    const status = el('p', 'fl-muted');
    const submit = action('Post message', () => {}, true); submit.type = 'submit';
    form.append(body, submit, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Posting…';
      try { await P.createProjectDiscussion(projectId, { body: body.value }); await rerender(); }
      catch (error) { status.textContent = error?.message || 'Message could not be posted.'; submit.disabled = false; }
    });
    box.body.append(form);
  }
  doc.append(box.box);
}

function experimentsView(doc, projectId, experiments, cockpit, rerender) {
  const box = section('Experiments', 'Hypotheses, protocols and result summaries live as structured project records. Data stays in project files/datasets.');
  if (!experiments.length) box.body.append(empty('No experiments yet', 'Create an experiment record when a hypothesis becomes a protocol to run.'));
  for (const item of experiments) {
    const details = el('details', 'fl-experiment');
    const summary = el('summary', 'fl-experiment__summary');
    summary.append(el('strong', null, item.title), badge(label(item.status)));
    details.append(summary);
    const body = el('div', 'fl-experiment__body');
    if (item.hypothesis) body.append(el('h4', null, 'Hypothesis'), el('p', 'fl-prose', item.hypothesis));
    if (item.protocol) body.append(el('h4', null, 'Protocol'), el('p', 'fl-prose', item.protocol));
    if (item.result_summary) body.append(el('h4', null, 'Result'), el('p', 'fl-prose', item.result_summary));
    body.append(el('small', 'fl-muted', P.meta([item.owner.name, item.started_at ? `Started ${date(item.started_at)}` : '', item.completed_at ? `Completed ${date(item.completed_at)}` : ''])));
    details.append(body);
    box.body.append(details);
  }

  if (cockpit.project.permissions?.can_edit) {
    const form = el('form', 'fl-form fl-experiment-form');
    const title = input('', 'text', 'Experiment title');
    const hypothesis = textarea('', 3, 'Hypothesis');
    const protocol = textarea('', 4, 'Protocol');
    const state = select([['planned', 'Planned'], ['running', 'Running'], ['review', 'Under review'], ['complete', 'Complete'], ['abandoned', 'Abandoned']], 'planned');
    const status = el('p', 'fl-muted');
    const submit = action('Create experiment', () => {}, true); submit.type = 'submit';
    form.append(title, hypothesis, protocol, state, submit, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Creating…';
      try {
        await P.createProjectExperiment(projectId, { title: title.value, hypothesis: hypothesis.value, protocol: protocol.value, status: state.value });
        await rerender();
      } catch (error) { status.textContent = error?.message || 'Experiment could not be created.'; submit.disabled = false; }
    });
    box.body.append(form);
  }
  doc.append(box.box);

  const deliverables = section('Deliverables');
  if (!cockpit.deliverables.length) deliverables.body.append(empty('No deliverables yet', 'Reviewed research outputs attached to this project appear here.'));
  for (const item of cockpit.deliverables) deliverables.body.append(row({
    title: item.title,
    meta: P.meta([label(item.status), item.client_visible ? 'Client visible' : 'Internal', date(item.updated_at)]),
    body: item.description,
  }));
  doc.append(deliverables.box);
}

function activityView(doc, cockpit) {
  const box = section('Project activity', 'Audit and knowledge events scoped to this project.');
  if (!cockpit.activity.length) box.body.append(empty('No activity yet', 'Project changes and knowledge activity appear here.'));
  for (const item of cockpit.activity) {
    const detail = item.detail || {};
    box.body.append(row({
      title: label(item.action),
      meta: P.meta([item.actor, date(item.created_at), label(item.source)]),
      body: Object.keys(detail).length ? Object.entries(detail).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') : '',
      badges: [item.object_type ? `${item.object_type} ${item.object_id}` : ''],
    }));
  }
  doc.append(box.box);
}

export async function renderResearchProject(host, projectId, tab = 'overview', { go }) {
  loading(host);
  try {
    const needs = [P.projectCockpit(projectId)];
    if (tab === 'milestones') needs.push(P.projectMilestones(projectId));
    if (tab === 'discussions') needs.push(P.projectDiscussions(projectId));
    if (tab === 'experiments') needs.push(P.projectExperiments(projectId));
    const results = await Promise.all(needs);
    const cockpit = results[0];
    const project = cockpit.project;
    const doc = projectShell(host, project, projectId, tab, go);
    const rerender = () => renderResearchProject(host, projectId, tab, { go });

    if (tab === 'overview') overviewView(doc, cockpit);
    else if (tab === 'milestones') milestonesView(doc, results[1].milestones || []);
    else if (tab === 'tasks') tasksView(doc, cockpit);
    else if (tab === 'notes') notesView(doc, cockpit);
    else if (tab === 'sources') sourcesView(doc, cockpit);
    else if (tab === 'files') filesView(doc, cockpit);
    else if (tab === 'discussions') discussionView(doc, projectId, results[1].messages || [], project, rerender);
    else if (tab === 'experiments') experimentsView(doc, projectId, results[1].experiments || [], cockpit, rerender);
    else if (tab === 'activity') activityView(doc, cockpit);
    else overviewView(doc, cockpit);
  } catch (error) {
    failure(host, projectId, tab, go, error);
  }
}

export { TABS as PROJECT_TABS };
