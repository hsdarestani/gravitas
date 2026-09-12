/* ==========================================================================
   GRAVITAS+ RESEARCH WORKSPACE · KMS SURFACES

   The reference artifact is used here as an information architecture, not a
   skin. Every count and row below comes from the platform, Project Cockpit,
   or the Space/Nextcloud API. There is no demo fallback: an unavailable
   service is named as unavailable and a successful mutation is read back.
   ========================================================================== */

import * as P from './ws-platform.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function shell(host, title, subtitle) {
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', title), el('p', 'ws-doc__meta', subtitle));
  doc.append(head); host.append(doc); return doc;
}

function notice(title, detail, bad = false) {
  const node = el('div', 'ws-alert');
  if (bad) node.dataset.tone = 'bad';
  node.append(el('strong', 'ws-alert__title', title), el('p', null, detail));
  return node;
}

function button(label, action, solid = false) {
  const node = el('button', `ws-btn${solid ? ' ws-btn--solid' : ''}`, label);
  node.type = 'button'; node.addEventListener('click', action); return node;
}

const dayKey = (date) => {
  const y = date.getFullYear();
  return `${y}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

async function projectData() {
  const list = await P.projects();
  const projects = list.projects || [];
  const settled = await Promise.allSettled(projects.map((project) => P.projectCockpit(project.id)));
  return projects.map((project, index) => ({
    project,
    cockpit: settled[index].status === 'fulfilled' ? settled[index].value : null,
  }));
}

export function renderCalendar(host, ctx) {
  const doc = shell(host, 'Journal', 'Daily research notes with project deadlines in the same calendar.');
  const body = el('div', 'rkms-calendar'); doc.append(body);
  body.append(notice('Loading calendar', 'Reading live project deadlines…'));

  Promise.all([projectData(), Promise.resolve(ctx.pages('research'))]).then(([rows, pages]) => {
    body.innerHTML = '';
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const journalDays = new Set(pages.filter((page) => page.kind === 'journal').map((page) => page.journal_date));
    const month = el('section', 'v-panel rkms-month');
    month.append(el('h2', 'v-panel__title', now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
    const grid = el('div', 'rkms-month__grid');
    for (const label of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', 'rkms-month__dayname', label));
    for (let pad = 0; pad < first.getDay(); pad += 1) grid.append(el('span'));
    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), day);
      const key = dayKey(date); const cell = button(String(day), () => ctx.openJournal(date));
      cell.className = 'rkms-month__day';
      if (key === dayKey(now)) cell.dataset.today = '';
      if (journalDays.has(key)) cell.dataset.journal = '';
      cell.title = journalDays.has(key) ? 'Open journal entry' : 'Create journal entry';
      grid.append(cell);
    }
    month.append(grid); body.append(month);
    const events = [];
    for (const { project, cockpit } of rows) {
      for (const task of cockpit?.tasks || []) if (task.due_date) events.push({ ...task, project: project.title, kind: 'Task' });
      for (const request of cockpit?.research_requests || []) if (request.due_date) events.push({ ...request, project: project.title, kind: 'Request' });
    }
    events.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const toolbar = el('div', 'v-toolbar');
    const upcoming = button('Upcoming', () => draw(false), true);
    const all = button('All deadlines', () => draw(true));
    toolbar.append(upcoming, all, el('span', 'v-toolbar__count', `${events.length} deadlines`));
    const list = el('div', 'v-panel'); body.append(toolbar, list);
    const draw = (includePast) => {
      list.innerHTML = '';
      const today = dayKey(new Date());
      const visible = events.filter((event) => includePast || event.due_date >= today);
      if (!visible.length) { list.append(notice('No deadlines', 'No dated research tasks or requests in this view.')); return; }
      for (const event of visible) {
        const row = el('div', 'v-row rkms-event');
        row.append(el('time', 'rkms-event__date', P.formatDate(event.due_date)));
        const main = el('div', 'v-row__main');
        main.append(el('strong', null, event.title), el('small', null, P.meta([event.project, event.kind, P.label(event.status)])));
        row.append(main); list.append(row);
      }
    };
    draw(false);
  }).catch(() => { body.innerHTML = ''; body.append(notice('Calendar unavailable', 'The project service did not answer. No placeholder deadlines were shown.', true)); });
}

export function renderProjects(host, { go }) {
  const doc = shell(host, 'Research Projects', 'Portfolio views built from the same live projects, tasks, links and activity.');
  const body = el('div'); doc.append(body); body.append(notice('Loading projects', 'Reading accessible projects and their cockpits…'));
  projectData().then((records) => {
    body.innerHTML = '';
    const bar = el('div', 'v-toolbar rkms-switcher');
    const content = el('div');
    let active = sessionStorage.getItem('gravitas.research.projectView') || 'cards';
    const views = [
      ['cards', 'Cards'], ['timeline', 'Timeline'], ['table', 'Table'], ['graph', 'Graph'], ['activity', 'Activity'],
    ];
    const buttons = new Map();
    const select = (view) => {
      active = view; sessionStorage.setItem('gravitas.research.projectView', view);
      for (const [key, node] of buttons) node.setAttribute('aria-pressed', String(key === view));
      drawProjectView(content, records, view, go);
    };
    for (const [key, label] of views) {
      const node = button(label, () => select(key), key === active);
      node.setAttribute('aria-pressed', String(key === active)); buttons.set(key, node); bar.append(node);
    }
    bar.append(el('span', 'v-toolbar__count', `${records.length} projects`));
    body.append(bar, content); select(active);
  }).catch(() => { body.innerHTML = ''; body.append(notice('Projects unavailable', 'The live project service did not answer.', true)); });
}

function drawProjectView(host, records, view, go) {
  host.innerHTML = '';
  if (!records.length) { host.append(notice('No projects yet', 'Projects appear here once created.')); return; }
  if (view === 'cards') {
    const grid = el('div', 'v-grid');
    for (const { project, cockpit } of records) {
      const card = el('button', 'v-project'); card.type = 'button';
      card.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`));
      card.append(el('span', 'v-badge', P.label(project.category || project.status)), el('strong', 'v-project__title', project.title));
      if (project.research_question || project.description) card.append(el('p', 'v-project__question', project.research_question || project.description));
      card.append(el('small', null, P.meta([
        `${cockpit?.counts?.tasks || 0} tasks`, `${cockpit?.counts?.notes || 0} notes`, `${cockpit?.counts?.connections || 0} links`,
      ])));
      grid.append(card);
    }
    host.append(grid); return;
  }
  if (view === 'table') {
    const table = el('table', 'rkms-table');
    const head = el('tr'); for (const value of ['Project', 'Status', 'Tasks', 'Notes', 'Files', 'Links', 'Updated']) head.append(el('th', null, value));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tbody = el('tbody');
    for (const { project, cockpit } of records) {
      const row = el('tr');
      const title = el('button', 'rkms-link', project.title); title.type = 'button'; title.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`));
      const first = el('td'); first.append(title); row.append(first);
      for (const value of [P.label(project.status), cockpit?.counts?.tasks || 0, cockpit?.counts?.notes || 0, cockpit?.counts?.files || 0, cockpit?.counts?.connections || 0, P.formatDate(project.updated_at)]) row.append(el('td', null, value));
      tbody.append(row);
    }
    table.append(tbody); const wrap = el('div', 'rkms-table-wrap'); wrap.append(table); host.append(wrap); return;
  }
  if (view === 'timeline') {
    const allDates = records.flatMap(({ cockpit }) => (cockpit?.tasks || []).map((task) => task.due_date).filter(Boolean)).sort();
    const min = allDates[0] ? new Date(allDates[0]) : new Date();
    const max = allDates.at(-1) ? new Date(allDates.at(-1)) : new Date(min.getTime() + 86400000);
    const span = Math.max(86400000, max - min);
    const timeline = el('div', 'rkms-timeline');
    for (const { project, cockpit } of records) {
      const row = el('div', 'rkms-timeline__row');
      const title = el('button', 'rkms-link', project.title); title.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`)); row.append(title);
      const track = el('div', 'rkms-timeline__track');
      for (const task of cockpit?.tasks || []) if (task.due_date) {
        const dot = el('span', 'rkms-timeline__dot');
        dot.style.left = `${Math.max(0, Math.min(100, ((new Date(task.due_date) - min) / span) * 100))}%`;
        dot.title = `${task.title} · ${P.formatDate(task.due_date)}`; track.append(dot);
      }
      row.append(track); timeline.append(row);
    }
    host.append(timeline); return;
  }
  if (view === 'graph') {
    const graph = el('div', 'rkms-graph');
    const projects = records.map(({ project }) => project);
    const links = records.flatMap(({ cockpit }) => cockpit?.connections || []);
    const names = new Set(projects.map((p) => p.title));
    for (const project of projects) {
      const node = button(project.title, () => go(`/workspace/research/projects/${project.id}`)); node.className = 'rkms-graph__node'; graph.append(node);
      const related = links.filter((link) => link.source?.title === project.title || link.target?.title === project.title);
      for (const link of related.slice(0, 8)) {
        const other = link.source?.title === project.title ? link.target : link.source;
        if (!other?.title || names.has(other.title)) continue;
        graph.append(el('span', 'rkms-graph__edge', link.relation_label || P.label(link.relation)), el('span', 'rkms-graph__leaf', other.title));
      }
    }
    host.append(graph); return;
  }
  const feed = el('div', 'v-panel');
  const activity = records.flatMap(({ project, cockpit }) => (cockpit?.activity || []).map((event) => ({ event, project })))
    .sort((a, b) => String(b.event.created_at).localeCompare(String(a.event.created_at)));
  if (!activity.length) feed.append(notice('No activity yet', 'Project edits and knowledge changes appear here.'));
  for (const { event, project } of activity.slice(0, 100)) {
    const row = el('div', 'v-row'); const main = el('div', 'v-row__main');
    main.append(el('strong', null, event.detail?.title || P.label(event.action)), el('small', null, P.meta([project.title, event.actor, P.formatDate(event.created_at)])));
    row.append(main); feed.append(row);
  }
  host.append(feed);
}

function flatten(nodes, depth = 0, out = []) {
  for (const node of nodes || []) {
    out.push({ ...node, depth });
    flatten(node.children, depth + 1, out);
  }
  return out;
}

export function renderFolders(host) {
  const doc = shell(host, 'Research Folder', 'The live Gravitas Space tree, synchronised with Nextcloud.');
  const body = el('div'); doc.append(body);
  let selectedFolder = null;

  const load = async () => {
    body.innerHTML = ''; body.append(notice('Loading folder tree', 'Reading Space and synchronisation state…'));
    try {
      const [treeData, itemData, noteData] = await Promise.all([P.spaceTree(), P.spaceItems(), P.spaceNotes()]);
      body.innerHTML = '';
      const bar = el('div', 'v-toolbar');
      const status = el('span', 'v-note', noteData.cloud_unavailable ? 'Nextcloud currently unavailable' : 'Connected to Space');
      const sync = button('Sync now', async () => {
        sync.disabled = true; status.textContent = 'Synchronising…';
        try { await P.syncSpace(); status.textContent = 'Synchronised'; await load(); }
        catch { status.textContent = 'Sync failed — no data was discarded'; sync.disabled = false; }
      }, true);
      const add = button('New folder', async () => {
        const title = prompt('Folder name');
        if (!title?.trim()) return;
        add.disabled = true;
        try { await P.createSpaceFolder({ title: title.trim(), parentId: selectedFolder }); await load(); }
        catch { status.textContent = 'Folder was not created'; add.disabled = false; }
      });
      const addItem = button('New item', async () => {
        if (!selectedFolder) { status.textContent = 'Select a folder first'; return; }
        const kind = prompt('Type: subproject, task, subtask, or repository', 'task');
        if (!['subproject', 'task', 'subtask', 'repository'].includes(kind || '')) { status.textContent = 'Choose a supported item type'; return; }
        const title = prompt('Item title'); if (!title?.trim()) return;
        addItem.disabled = true;
        try { await P.createSpaceItem({ kind, title: title.trim(), category_id: selectedFolder }); await load(); }
        catch { status.textContent = 'Item was not created'; addItem.disabled = false; }
      });
      bar.append(sync, add, addItem, status); body.append(bar);

      const panel = el('div', 'v-panel rkms-tree');
      const folders = flatten(treeData.tree || []);
      const items = itemData.items || [];
      // The notes index also annotates managed Space items discovered on disk.
      // Those are already returned by spaceItems(), so keep only note/link rows
      // here to avoid rendering the same synced file twice.
      const notes = (noteData.items || []).filter((item) => item.source !== 'managed');
      if (!folders.length && !items.length && !notes.length) panel.append(notice('Space is empty', 'Create a folder to start the research structure.'));
      for (const folder of folders) {
        const row = el('div', 'rkms-tree__row'); row.style.setProperty('--tree-depth', folder.depth);
        if (folder.id === selectedFolder) row.dataset.selected = '';
        row.append(el('span', 'rkms-tree__glyph', '▾'), el('strong', null, folder.title));
        row.addEventListener('click', () => { selectedFolder = folder.id; load(); });
        const meta = el('span', 'rkms-tree__meta', P.label(folder.sync_state)); row.append(meta);
        const rename = button('Rename', async () => {
          const title = prompt('New folder name', folder.title);
          if (!title?.trim() || title.trim() === folder.title) return;
          rename.disabled = true;
          try { await P.renameSpaceFolder(folder.id, title.trim()); await load(); }
          catch { meta.textContent = 'Rename failed'; rename.disabled = false; }
        });
        rename.addEventListener('click', (event) => event.stopPropagation());
        rename.classList.add('ws-btn--tiny'); row.append(rename); panel.append(row);
      }
      for (const item of [...notes, ...items].sort((a, b) => String(a.path || a.file_path).localeCompare(String(b.path || b.file_path)))) {
        const row = el('div', 'rkms-tree__row rkms-tree__row--file');
        row.append(el('span', 'rkms-tree__glyph', (item.type || item.kind) === 'task' ? '☑' : '·'));
        const main = el('span', 'v-row__main');
        main.append(el('strong', null, item.title || item.path), el('small', null, item.path || item.file_path || ''));
        const state = el('span', 'rkms-tree__meta', P.label(item.sync_state)); row.append(main, state);
        if (item.source === 'managed' || item.file_path) {
          const move = button('Move', async () => {
            const target = prompt(`Destination folder ID:\n${folders.map((folder) => `${folder.id}: ${folder.title}`).join('\n')}`, String(selectedFolder || ''));
            if (!target) return;
            move.disabled = true;
            try { await P.updateSpaceItem(item.id, { category_id: Number(target) }); await load(); }
            catch { state.textContent = 'Move failed'; move.disabled = false; }
          });
          move.classList.add('ws-btn--tiny'); row.append(move);
          const remove = button('Delete', async () => {
            if (!confirm(`Delete “${item.title}”? Its synced file will also be removed.`)) return;
            remove.disabled = true;
            try { await P.deleteSpaceItem(item.id); await load(); }
            catch { state.textContent = 'Delete failed'; remove.disabled = false; }
          });
          remove.classList.add('ws-btn--tiny'); row.append(remove);
        }
        panel.append(row);
      }
      body.append(panel);
    } catch {
      body.innerHTML = ''; body.append(notice('Folder service unavailable', 'The live Space tree could not be read. No local imitation was substituted.', true));
    }
  };
  load();
}

function taskBoard(body, records) {
  body.innerHTML = '';
  const states = [['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done']];
  const board = el('div', 'rkms-board');
  for (const [key, label] of states) {
    const lane = el('section', 'rkms-lane');
    const matches = records.filter((row) => (row.task.status || 'draft') === key);
    lane.append(el('h2', 'rkms-lane__title', `${label} · ${matches.length}`));
    for (const { task, project } of matches) {
      const card = el('article', 'rkms-task');
      card.append(el('strong', null, task.title), el('small', null, P.meta([project.title, task.owner, P.formatDate(task.due_date)])));
      lane.append(card);
    }
    board.append(lane);
  }
  body.append(board);
}

function taskList(body, records) {
  body.innerHTML = '';
  if (!records.length) { body.append(notice('No matching tasks', 'Change the search or status filters.')); return; }
  const table = el('table', 'rkms-table');
  const head = el('tr');
  for (const value of ['Priority', 'Task', 'Start', 'Due', 'Project', 'Owner', 'Status']) head.append(el('th', null, value));
  const thead = el('thead'); thead.append(head); table.append(thead);
  const tbody = el('tbody');
  for (const { task, project } of records) {
    const row = el('tr');
    for (const value of [P.label(task.priority), task.title, P.formatDate(task.start_date), P.formatDate(task.due_date), project.title, task.owner || '—', P.label(task.status)]) {
      row.append(el('td', null, value || '—'));
    }
    tbody.append(row);
  }
  table.append(tbody); const wrap = el('div', 'rkms-table-wrap'); wrap.append(table); body.append(wrap);
}

export function renderTasks(host) {
  const doc = shell(host, 'Research Tasks', 'One board aggregated from tasks in every accessible research project.');
  const body = el('div'); doc.append(body); body.append(notice('Loading tasks', 'Reading project cockpits…'));
  projectData().then((rows) => {
    const records = rows.flatMap(({ project, cockpit }) => (cockpit?.tasks || []).map((task) => ({ task, project })));
    const bar = el('div', 'v-toolbar');
    const query = el('input', 'v-input'); query.type = 'search'; query.placeholder = 'Search tasks';
    let mode = sessionStorage.getItem('gravitas.research.taskView') || 'board';
    const board = button('Board', () => { mode = 'board'; sessionStorage.setItem('gravitas.research.taskView', mode); draw(); }, true);
    const list = button('List', () => { mode = 'list'; sessionStorage.setItem('gravitas.research.taskView', mode); draw(); });
    const filter = el('select', 'v-input'); filter.setAttribute('aria-label', 'Filter tasks by status');
    for (const [value, label] of [['', 'Open & done'], ['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done']]) {
      const option = el('option', null, label); option.value = value; filter.append(option);
    }
    const count = el('span', 'v-toolbar__count'); bar.append(query, board, list, filter, count);
    const content = el('div'); body.innerHTML = ''; body.append(bar, content);
    const draw = () => {
      const q = query.value.trim().toLowerCase();
      const visible = records.filter(({ task, project }) =>
        (!q || `${task.title} ${task.owner} ${project.title}`.toLowerCase().includes(q))
        && (!filter.value || task.status === filter.value));
      board.setAttribute('aria-pressed', String(mode === 'board'));
      list.setAttribute('aria-pressed', String(mode === 'list'));
      count.textContent = `${visible.length} of ${records.length}`;
      if (mode === 'list') taskList(content, visible); else taskBoard(content, visible);
    };
    query.addEventListener('input', draw); filter.addEventListener('change', draw); draw();
  }).catch(() => { body.innerHTML = ''; body.append(notice('Tasks unavailable', 'The project service did not answer. No local task board was created.', true)); });
}
