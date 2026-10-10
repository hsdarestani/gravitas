/* ==========================================================================
   GRAVITAS+ RESEARCH WORKSPACE · KMS SURFACES

   The reference artifact is used here as an information architecture, not a
   skin. Every count and row below comes from the platform, Project Cockpit,
   or the Space/Nextcloud API. There is no demo fallback: an unavailable
   service is named as unavailable and a successful mutation is read back.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r2';
import * as C from './ws-charts.js?v=20261011-r2';
import { openNewProject, openNewTask } from './ws-research-create.js?v=20261011-r2';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function shell(host, title, subtitle, actions = []) {
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', title), el('p', 'ws-doc__meta', subtitle));
  doc.append(head);
  if (actions.length) {
    const bar = el('div', 'v-toolbar');
    bar.append(...actions);
    doc.append(bar);
  }
  host.append(doc); return doc;
}

// The two ways into new research work, on every screen that lists it.
const createActions = (go) => [
  button('New project', () => openNewProject({ go }), true),
  button('New task', () => openNewTask({ go })),
];

function notice(title, detail, bad = false) {
  const node = el('div', 'ws-alert');
  // Loading and empty are not failures; only a failure gets the red rule.
  node.dataset.tone = bad ? 'bad' : 'quiet';
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

function dashboardSummary(specs = []) {
  const grid = C.bento();
  grid.append(...C.tileRow(specs.map((spec, index) => C.statTile({ ...spec, featured: index === 0 }))));
  return grid;
}

function dashboardBars(title, note, rows, span = 12) {
  const card = C.card({ title, note, span });
  card.body.append(C.barRows(rows, { scaffold: true }));
  return card.box;
}

export function renderCalendar(host, ctx) {
  const doc = shell(host, 'Calendar', 'Daily research notes and project deadlines on one calendar.');
  const body = el('div', 'rkms-calendar'); doc.append(body);
  let cursor = new Date();
  cursor.setDate(1);
  let payload = null;

  const load = async () => {
    body.innerHTML = '';
    body.append(notice('Loading calendar', 'Reading your journal index and dated Research work…'));
    try {
      const pages = ctx.pages('research');
      if (!payload) payload = await P.researchCalendar();
      const journalDays = new Set(
        pages.filter((page) => page.kind === 'journal' && page.journal_date).map((page) => page.journal_date)
      );
      const events = payload.events || [];
      draw(journalDays, events);
    } catch (error) {
      body.innerHTML = '';
      body.append(notice('Calendar unavailable', 'The Research calendar could not be loaded. No placeholder deadlines were shown.', true));
    }
  };

  const draw = (journalDays, events) => {
    body.innerHTML = '';
    const now = new Date();
    const year = cursor.getFullYear();
    const monthIndex = cursor.getMonth();
    const first = new Date(year, monthIndex, 1);
    const last = new Date(year, monthIndex + 1, 0);

    const todayKey = dayKey(now);
    const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
    const upcomingCount = events.filter((event) => event.due_date && event.due_date >= todayKey).length;
    const monthDeadlineCount = events.filter((event) => String(event.due_date || '').startsWith(monthPrefix)).length;
    body.append(dashboardSummary([
      { value: events.length, label: 'Deadlines', icon: 'target', note: 'Research schedule' },
      { value: upcomingCount, label: 'Upcoming', icon: 'meeting', note: 'From today forward' },
      { value: journalDays.size, label: 'Noted days', icon: 'notes', note: 'Entries with a date' },
      { value: monthDeadlineCount, label: 'This month', icon: 'calendar', note: 'Deadlines in view' },
    ]));

    const month = el('section', 'v-panel wc-card rkms-month');
    const monthHead = el('div', 'v-toolbar');
    const previous = button('←', () => { cursor = new Date(year, monthIndex - 1, 1); draw(journalDays, events); });
    previous.setAttribute('aria-label', 'Previous month');
    const title = el('h2', 'v-panel__title', cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    const next = button('→', () => { cursor = new Date(year, monthIndex + 1, 1); draw(journalDays, events); });
    next.setAttribute('aria-label', 'Next month');
    const todayButton = button('Today', () => {
      cursor = new Date(); cursor.setDate(1); draw(journalDays, events);
    }, true);
    monthHead.append(previous, title, next, todayButton);
    month.append(monthHead);

    const grid = el('div', 'rkms-month__grid');
    for (const label of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', 'rkms-month__dayname', label));
    for (let pad = 0; pad < first.getDay(); pad += 1) grid.append(el('span'));

    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(year, monthIndex, day);
      const key = dayKey(date);
      const cell = button(String(day), async () => {
        if (cell.disabled) return;
        const oldTitle = cell.title;
        cell.disabled = true;
        cell.dataset.loading = '';
        cell.title = journalDays.has(key) ? 'Opening journal entry…' : 'Creating journal entry…';
        try {
          const page = await ctx.openJournal(date);
          if (!page) throw new Error('journal_not_opened');
        } catch {
          cell.disabled = false;
          delete cell.dataset.loading;
          cell.title = oldTitle;
          const prior = body.querySelector('[data-journal-error]');
          if (prior) prior.remove();
          const error = notice('Journal entry unavailable', 'The entry was not opened. Nothing was changed.', true);
          error.dataset.journalError = '';
          body.prepend(error);
        }
      });
      cell.className = 'rkms-month__day';
      if (key === dayKey(now)) cell.dataset.today = '';
      if (journalDays.has(key)) cell.dataset.journal = '';
      if (events.some((event) => event.due_date === key)) cell.dataset.deadline = '';
      cell.title = journalDays.has(key) ? 'Open journal entry' : 'Create journal entry';
      grid.append(cell);
    }
    month.append(grid); body.append(month);

    const toolbar = el('div', 'v-toolbar');
    const upcoming = button('Upcoming', () => drawEvents(false), true);
    const all = button('All deadlines', () => drawEvents(true));
    const count = el('span', 'v-toolbar__count', `${events.length} deadlines`);
    toolbar.append(upcoming, all, count);
    const list = el('div', 'v-panel'); body.append(toolbar, list);

    const drawEvents = (includePast) => {
      list.innerHTML = '';
      upcoming.classList.toggle('ws-btn--solid', !includePast);
      all.classList.toggle('ws-btn--solid', includePast);
      const today = dayKey(new Date());
      const visible = events.filter((event) => includePast || event.due_date >= today);
      if (!visible.length) {
        list.append(notice('No deadlines', 'No dated Research tasks or requests in this view.'));
        return;
      }
      for (const event of visible) {
        const row = el('div', 'v-row rkms-event');
        row.append(el('time', 'rkms-event__date', P.formatDate(event.due_date)));
        const main = el('div', 'v-row__main');
        main.append(el('strong', null, event.title), el('small', null, P.meta([event.project, event.kind, P.label(event.status)])));
        row.append(main); list.append(row);
      }
    };
    drawEvents(false);
  };

  load();
}

export function renderProjects(host, { go }) {
  const doc = shell(host, 'Research Projects', 'Portfolio views built from the same live projects, tasks, links and activity.', createActions(go));
  const body = el('div'); doc.append(body); body.append(notice('Loading projects', 'Reading accessible projects and their cockpits…'));
  projectData().then((records) => {
    body.innerHTML = '';
    const totals = records.reduce((acc, { cockpit }) => {
      acc.tasks += Number(cockpit?.counts?.tasks || 0);
      acc.notes += Number(cockpit?.counts?.notes || 0);
      acc.files += Number(cockpit?.counts?.files || 0) + Number(cockpit?.counts?.datasets || 0);
      acc.links += Number(cockpit?.counts?.connections || 0);
      return acc;
    }, { tasks: 0, notes: 0, files: 0, links: 0 });

    // One bento for the tiles and the activity card, so the space between
    // them is the grid's own gap rather than two grids butted together.
    const summary = dashboardSummary([
      { value: records.length, label: 'Projects', icon: 'projects', note: 'Accessible portfolio' },
      { value: totals.tasks, label: 'Tasks', icon: 'tasks', note: 'Across all projects' },
      { value: totals.notes, label: 'Notes', icon: 'notes', note: 'Project knowledge' },
      { value: totals.links, label: 'Connections', icon: 'link', note: 'Cross-project links' },
    ]);
    summary.append(
      dashboardBars('Research activity', 'Live object counts across the accessible portfolio.', [
        { label: 'Tasks', value: totals.tasks, series: '1' },
        { label: 'Notes', value: totals.notes, series: '2' },
        { label: 'Files & data', value: totals.files, series: '3' },
        { label: 'Links', value: totals.links, series: '4' },
      ], 12),
    );
    body.append(summary);

    const bar = el('div', 'v-toolbar rkms-switcher');
    const content = el('div');
    let active = sessionStorage.getItem('gravitas.research.projectView') || 'cards';
    const views = [
      ['cards', 'Cards'], ['timeline', 'Timeline'], ['table', 'Table'], ['graph', 'Graph'], ['activity', 'Activity'],
    ];
    const buttons = new Map();
    /* The kind of project, read from ?category= so the overview's "Client
       projects" and "Community projects" tiles open the list they count.
       Nothing filtered by it before; the tiles landed on every project. */
    const KINDS = [['', 'All types'], ['internal', 'Internal'], ['client', 'Client'], ['community', 'Community']];
    let kind = new URLSearchParams(location.search).get('category') || '';
    if (!KINDS.some(([key]) => key === kind)) kind = '';
    const kindSelect = el('select', 'v-input');
    kindSelect.setAttribute('aria-label', 'Project type');
    for (const [key, label] of KINDS) kindSelect.append(new Option(label, key, false, key === kind));
    const count = el('span', 'v-toolbar__count');
    const shown = () => records.filter(({ project }) => !kind || project.category === kind);
    const select = (view) => {
      active = view; sessionStorage.setItem('gravitas.research.projectView', view);
      for (const [key, node] of buttons) node.setAttribute('aria-pressed', String(key === view));
      const list = shown();
      count.textContent = kind ? `${list.length} of ${records.length} projects` : `${records.length} projects`;
      drawProjectView(content, list, view, go);
    };
    kindSelect.addEventListener('change', () => { kind = kindSelect.value; select(active); });
    for (const [key, label] of views) {
      const node = button(label, () => select(key), key === active);
      node.setAttribute('aria-pressed', String(key === active)); buttons.set(key, node); bar.append(node);
    }
    bar.append(kindSelect, count);
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
    const allDates = records.flatMap(({ cockpit }) => (cockpit?.tasks || []).flatMap((task) => [task.updated_at, task.due_date]).filter(Boolean)).sort();
    const min = allDates[0] ? new Date(allDates[0]) : new Date();
    const max = allDates.at(-1) ? new Date(allDates.at(-1)) : new Date(min.getTime() + 86400000);
    const span = Math.max(86400000, max - min);
    const timeline = el('div', 'rkms-timeline');
    for (const { project, cockpit } of records) {
      const row = el('div', 'rkms-timeline__row');
      const title = el('button', 'rkms-link', project.title); title.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`)); row.append(title);
      const track = el('div', 'rkms-timeline__track');
      for (const task of cockpit?.tasks || []) if (task.due_date) {
        const start = new Date(task.updated_at || task.due_date);
        const end = new Date(task.due_date);
        const left = Math.max(0, Math.min(100, ((start - min) / span) * 100));
        const right = Math.max(left + 2, Math.min(100, ((end - min) / span) * 100));
        const bar = el('span', 'rkms-timeline__bar');
        bar.style.left = `${left}%`; bar.style.width = `${Math.max(2, right - left)}%`;
        bar.title = `${task.title} · ${P.formatDate(task.due_date)}`; track.append(bar);
      }
      row.append(track); timeline.append(row);
    }
    host.append(timeline); return;
  }
  if (view === 'graph') {
    const graph = el('div', 'rkms-graph');
    for (const { project, cockpit } of records) {
      const cluster = el('section', 'rkms-graph__cluster');
      const root = button(project.title, () => go(`/workspace/research/projects/${project.id}`)); root.className = 'rkms-graph__node'; cluster.append(root);
      const resources = new Map((cockpit?.resources || []).map((item) => [`resource:${item.id}`, item]));
      const shown = new Set();
      for (const link of cockpit?.connections || []) {
        for (const endpoint of [link.source, link.target]) {
          if (!endpoint || endpoint.type !== 'resource') continue;
          const key = `resource:${endpoint.id}`;
          if (shown.has(key)) continue;
          shown.add(key);
          const item = resources.get(key) || endpoint;
          const leaf = el('span', 'rkms-graph__leaf', item.title);
          leaf.dataset.kind = item.kind || 'note'; cluster.append(el('span', 'rkms-graph__edge', link.relation_label || P.label(link.relation)), leaf);
        }
      }
      if (!shown.size) cluster.append(el('span', 'v-note', 'No linked project notes yet.'));
      graph.append(cluster);
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

export function renderFolders(host, { go }) {
  const doc = shell(host, 'Files & Data', 'Your Personal Space plus every project data room, file and dataset you are allowed to access.');
  const body = el('div'); doc.append(body);
  let selectedFolder = null;

  const load = async () => {
    body.innerHTML = ''; body.append(notice('Loading folder tree', 'Reading Space and synchronisation state…'));
    try {
      const [treeData, itemData, noteData, projectData, fileData, datasetData] = await Promise.all([
        P.spaceTree(),
        P.spaceItems(),
        P.spaceNotes(),
        P.projects(),
        P.resources('file'),
        P.resources('dataset'),
      ]);
      body.innerHTML = '';
      const bar = el('div', 'v-toolbar');
      const status = el('span', 'v-note', noteData.cloud_unavailable ? 'Nextcloud currently unavailable' : 'Connected to Space');
      const conflictActions = (error) => {
        const prior = body.querySelector('[data-sync-conflict]');
        if (prior) prior.remove();
        const box = notice(
          'Nextcloud has newer changes',
          `${error.data?.conflicts?.length || 1} path${error.data?.conflicts?.length === 1 ? '' : 's'} changed outside Gravitas. Choose which copy should win.`,
          true,
        );
        box.dataset.syncConflict = '';
        const actions = el('div', 'v-toolbar');
        const keepLocal = button('Keep Gravitas version', async () => {
          keepLocal.disabled = true; useCloud.disabled = true; status.textContent = 'Writing Gravitas versions…';
          try { await P.syncSpace({ force: true, confirmed: true }); await load(); }
          catch { status.textContent = 'Conflict could not be resolved'; keepLocal.disabled = false; useCloud.disabled = false; }
        }, true);
        const useCloud = button('Use Nextcloud version', async () => {
          keepLocal.disabled = true; useCloud.disabled = true; status.textContent = 'Reading Nextcloud versions…';
          try { await P.reconcileSpace(); await load(); }
          catch { status.textContent = 'Conflict could not be resolved'; keepLocal.disabled = false; useCloud.disabled = false; }
        });
        actions.append(keepLocal, useCloud); box.append(actions); bar.after(box);
      };
      const sync = button('Sync now', async () => {
        sync.disabled = true; status.textContent = 'Synchronising…';
        try { await P.syncSpace(); status.textContent = 'Synchronised'; await load(); }
        catch (error) {
          status.textContent = 'Sync stopped — no data was discarded';
          sync.disabled = false;
          if (error.message === 'space_sync_conflict') conflictActions(error);
        }
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
      const projects = projectData.projects || [];
      const files = fileData.items || [];
      const datasets = datasetData.items || [];
      const projectById = new Map(projects.map((project) => [String(project.id), project]));
      // The notes index also annotates managed Space items discovered on disk.
      // Those are already returned by spaceItems(), so keep only note/link rows
      // here to avoid rendering the same synced file twice.
      const notes = (noteData.items || []).filter((item) => item.source !== 'managed');
      body.append(dashboardSummary([
        { value: projects.length, label: 'Data rooms', icon: 'projects', note: 'Accessible projects' },
        { value: files.length, label: 'Files', icon: 'files', note: 'Personal + project' },
        { value: datasets.length, label: 'Datasets', icon: 'files', note: 'Accessible data' },
        { value: folders.length, label: 'Personal folders', icon: 'projects', note: 'Your Space structure' },
      ]));

      const rooms = el('section', 'v-panel');
      const roomsHead = el('div', 'v-panel__head');
      roomsHead.append(el('h2', 'v-panel__title', 'Project data rooms'), el('p', 'v-note', 'Each project opens its own structured GRV Team Folder, never the generic Nextcloud home.'));
      rooms.append(roomsHead);
      if (!projects.length) rooms.append(notice('No accessible projects', 'Project data rooms appear here as soon as you own or join a Research project.'));
      for (const project of projects) {
        const projectFiles = files.filter((item) => String(item.project_id || '') === String(project.id));
        const projectDatasets = datasets.filter((item) => String(item.project_id || '') === String(project.id));
        const line = el('div', 'v-row');
        const main = el('div', 'v-row__main');
        main.append(
          el('strong', null, project.title),
          el('small', null, P.meta([
            P.label(project.visibility),
            `${projectFiles.length} file${projectFiles.length === 1 ? '' : 's'}`,
            `${projectDatasets.length} dataset${projectDatasets.length === 1 ? '' : 's'}`,
          ])),
        );
        const open = button('Open project files', () => go(`/workspace/research/projects/${project.id}/files`));
        open.classList.add('ws-btn--tiny');
        line.append(main, open);
        rooms.append(line);
      }
      body.append(rooms);

      const accessible = [...files, ...datasets];
      const library = el('section', 'v-panel');
      const libraryHead = el('div', 'v-panel__head');
      libraryHead.append(el('h2', 'v-panel__title', 'Accessible files & datasets'), el('p', 'v-note', 'One permission-filtered library across Personal and project storage.'));
      library.append(libraryHead);
      if (!accessible.length) library.append(notice('No files or datasets yet', 'Uploads from Personal Space and accessible projects appear here.'));
      for (const item of accessible.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 200)) {
        const project = item.project_id ? projectById.get(String(item.project_id)) : null;
        const line = el('div', 'v-row');
        const main = el('div', 'v-row__main');
        main.append(
          el('strong', null, item.title || item.original_name || 'Untitled'),
          el('small', null, P.meta([
            project ? project.title : 'Personal',
            P.label(item.kind),
            item.file_size ? P.formatBytes(item.file_size) : '',
            P.formatDate(item.updated_at),
          ])),
        );
        line.append(main);
        if (item.has_download) {
          const download = el('a', 'ws-btn ws-btn--tiny', 'Download');
          download.href = `/api/platform/files/${item.id}/download/`;
          line.append(download);
        }
        library.append(line);
      }
      body.append(library);

      body.append(C.bento([
        dashboardBars('Personal Space', 'Your private filing tree and managed Markdown/index layer.', [
          { label: 'Folders', value: folders.length, series: '1' },
          { label: 'Managed items', value: items.length, series: '2' },
          { label: 'Notes & links', value: notes.length, series: '4' },
        ], 12),
      ]));
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
        if ((item.type || item.kind) === 'note' && item.id) {
          row.tabIndex = 0; row.setAttribute('role', 'link');
          row.addEventListener('click', () => go(`/workspace/page/${item.id}`));
          row.addEventListener('keydown', (event) => { if (event.key === 'Enter') go(`/workspace/page/${item.id}`); });
        }
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

function taskBoard(body, records, go) {
  body.innerHTML = '';
  const states = [['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done']];
  const board = el('div', 'rkms-board');
  for (const [key, label] of states) {
    const lane = el('section', 'rkms-lane');
    const matches = records.filter((row) => (row.task.status || 'draft') === key);
    lane.append(el('h2', 'rkms-lane__title', `${label} · ${matches.length}`));
    for (const { task, project } of matches) {
      const card = el('button', 'rkms-task'); card.type = 'button';
      card.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`));
      card.append(el('strong', null, task.title), el('small', null, P.meta([project.title, task.owner, P.formatDate(task.due_date)])));
      lane.append(card);
    }
    board.append(lane);
  }
  body.append(board);
}

function taskList(body, records, go) {
  body.innerHTML = '';
  if (!records.length) { body.append(notice('No matching tasks', 'Change the search or status filters.')); return; }
  const table = el('table', 'rkms-table');
  const head = el('tr');
  for (const value of ['Priority', 'Task', 'Start', 'Due', 'Project', 'Owner', 'Status']) head.append(el('th', null, value));
  const thead = el('thead'); thead.append(head); table.append(thead);
  const tbody = el('tbody');
  for (const { task, project } of records) {
    const row = el('tr');
    row.tabIndex = 0;
    row.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') go(`/workspace/research/projects/${project.id}`); });
    for (const value of [P.label(task.priority), task.title, P.formatDate(task.start_date), P.formatDate(task.due_date), project.title, task.owner || '—', P.label(task.status)]) {
      row.append(el('td', null, value || '—'));
    }
    tbody.append(row);
  }
  table.append(tbody); const wrap = el('div', 'rkms-table-wrap'); wrap.append(table); body.append(wrap);
}

export function renderTasks(host, { go }) {
  if (new URLSearchParams(location.search).get('show') === 'requests') return renderRequests(host, { go });
  const doc = shell(host, 'Research Tasks', 'One board aggregated from tasks in every accessible research project.', [
    ...createActions(go),
    button('Requests', () => go('/workspace/research/tasks?show=requests')),
  ]);
  const body = el('div'); doc.append(body); body.append(notice('Loading tasks', 'Reading project cockpits…'));
  projectData().then((rows) => {
    body.innerHTML = '';
    const records = rows.flatMap(({ project, cockpit }) => (cockpit?.tasks || []).map((task) => ({ task, project })));
    const statusCounts = {
      draft: records.filter(({ task }) => (task.status || 'draft') === 'draft').length,
      active: records.filter(({ task }) => task.status === 'active').length,
      blocked: records.filter(({ task }) => task.status === 'blocked').length,
      done: records.filter(({ task }) => task.status === 'done').length,
    };
    const summary = dashboardSummary([
      { value: records.filter(({ task }) => !['done', 'archived'].includes(task.status)).length, label: 'Open tasks', icon: 'tasks', note: 'Research execution' },
      { value: statusCounts.active, label: 'Active', icon: 'activity', note: 'In progress' },
      { value: statusCounts.blocked, label: 'Blocked', icon: 'alert', note: 'Needs attention' },
      { value: statusCounts.done, label: 'Done', icon: 'check', note: 'Completed' },
    ]);
    summary.append(
      dashboardBars('Task status', 'Distribution across all accessible research projects.', [
        { label: 'Draft', value: statusCounts.draft, series: '1' },
        { label: 'Active', value: statusCounts.active, series: '2' },
        { label: 'Blocked', value: statusCounts.blocked, series: '5' },
        { label: 'Done', value: statusCounts.done, series: '3' },
      ], 12),
    );
    body.append(summary);
    const bar = el('div', 'v-toolbar');
    const query = el('input', 'v-input'); query.type = 'search'; query.placeholder = 'Search tasks';
    let mode = sessionStorage.getItem('gravitas.research.taskView') || 'board';
    const board = button('Board', () => { mode = 'board'; sessionStorage.setItem('gravitas.research.taskView', mode); draw(); }, true);
    const list = button('List', () => { mode = 'list'; sessionStorage.setItem('gravitas.research.taskView', mode); draw(); });
    const filter = el('select', 'v-input'); filter.setAttribute('aria-label', 'Filter tasks by status');
    for (const [value, label] of [['', 'Open & done'], ['draft', 'Draft'], ['active', 'Active'], ['blocked', 'Blocked'], ['done', 'Done']]) {
      const option = el('option', null, label); option.value = value; filter.append(option);
    }
    const sort = el('select', 'v-input'); sort.setAttribute('aria-label', 'Sort tasks');
    for (const [value, label] of [['due_date', 'Sort: due date'], ['priority', 'Sort: priority'], ['title', 'Sort: task'], ['project', 'Sort: project']]) {
      const option = el('option', null, label); option.value = value; sort.append(option);
    }
    const count = el('span', 'v-toolbar__count'); bar.append(query, board, list, filter, sort, count);
    const content = el('div'); body.append(bar, content);
    const draw = () => {
      const q = query.value.trim().toLowerCase();
      const visible = records.filter(({ task, project }) =>
        (!q || `${task.title} ${task.owner} ${project.title}`.toLowerCase().includes(q))
        && (!filter.value || task.status === filter.value))
        .sort((a, b) => String(sort.value === 'project' ? a.project.title : a.task[sort.value] || '').localeCompare(String(sort.value === 'project' ? b.project.title : b.task[sort.value] || '')));
      board.setAttribute('aria-pressed', String(mode === 'board'));
      list.setAttribute('aria-pressed', String(mode === 'list'));
      count.textContent = `${visible.length} of ${records.length}`;
      if (mode === 'list') taskList(content, visible, go); else taskBoard(content, visible, go);
    };
    query.addEventListener('input', draw); filter.addEventListener('change', draw); sort.addEventListener('change', draw); draw();
  }).catch(() => { body.innerHTML = ''; body.append(notice('Tasks unavailable', 'The project service did not answer. No local task board was created.', true)); });
}

/* Requests and handoffs waiting for research, opened from the Core and
   Research dashboards. This was drawn by ws-actionable-ui.js over the task
   board after the board had appeared; it is its own view of Tasks now. */
function renderRequests(host, { go }) {
  const doc = shell(host, 'Research Requests', 'Requests and handoffs waiting for research action.', [
    button('All tasks', () => go('/workspace/research/tasks')),
  ]);
  const body = el('div');
  doc.append(body);
  body.append(notice('Loading requests', 'Reading research requests…'));
  P.researchRequests().then((data) => {
    body.innerHTML = '';
    const requests = data.requests || data.items || [];
    const box = C.card({ title: 'Requests', note: `${requests.length} total` });
    if (!requests.length) box.body.append(C.note('No research requests are waiting.'));
    for (const item of requests) {
      box.body.append(C.listItem({
        title: item.title || 'Untitled request',
        meta: P.meta([P.label(item.status), P.label(item.priority), item.project_title, item.assignee, item.due_date ? P.formatDate(item.due_date) : '']),
        icon: 'inbox',
        onClick: item.project_id ? () => go(`/workspace/research/projects/${item.project_id}`) : null,
      }));
    }
    body.append(C.bento([box.box]));
  }).catch(() => {
    body.innerHTML = '';
    body.append(notice('Requests unavailable', 'Research requests could not be loaded. Nothing was changed.', true));
  });
}

export function renderSearch(host, ctx) {
  const doc = shell(host, 'Search', 'Search accessible research projects, notes, datasets and attachments.');
  const form = el('form', 'v-toolbar rkms-search');
  const query = el('input', 'v-input');
  query.type = 'search';
  query.name = 'q';
  query.placeholder = 'Search research';
  query.setAttribute('aria-label', 'Search research');
  const submit = button('Search', () => {}, true);
  submit.type = 'submit';
  const count = el('span', 'v-toolbar__count', 'Enter a search term');
  form.append(query, submit, count);
  const results = el('div');
  doc.append(form, results);

  const openResult = (item) => {
    if (item.project_id) ctx.go(`/workspace/research/projects/${item.project_id}`);
    else if (item.kind === 'dataset') ctx.go('/workspace/research/datasets');
    else if (item.kind === 'file') ctx.go('/workspace/research/files');
    else ctx.go('/workspace/research/editor');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const term = query.value.trim();
    if (!term) {
      count.textContent = 'Enter a search term';
      results.innerHTML = '';
      query.focus();
      return;
    }

    submit.disabled = true;
    query.disabled = true;
    count.textContent = 'Searching…';
    results.innerHTML = '';
    results.append(notice('Searching research', 'Reading only projects and resources you can access…'));

    try {
      const [resourceData, projectList] = await Promise.all([P.searchResources(term), P.projects()]);
      const needle = term.toLowerCase();
      const resources = resourceData.items || [];
      const projects = (projectList.projects || []).filter((project) =>
        [project.title, project.description, project.research_question, project.client_name]
          .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
      const pages = ctx.pages('research').filter((page) =>
        [page.title, page.content].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));

      results.innerHTML = '';
      const total = projects.length + resources.length + pages.length;
      count.textContent = `${total} result${total === 1 ? '' : 's'}`;
      if (!total) {
        results.append(notice('Nothing matched', 'Try a title, phrase, filename or project name.'));
        return;
      }

      if (projects.length) {
        const panel = el('section', 'v-panel');
        panel.append(el('h2', 'v-panel__title', `Projects · ${projects.length}`));
        for (const project of projects) {
          const item = el('button', 'v-row'); item.type = 'button';
          item.addEventListener('click', () => ctx.go(`/workspace/research/projects/${project.id}`));
          const main = el('span', 'v-row__main');
          main.append(el('strong', null, project.title), el('small', null, P.meta([P.label(project.status), project.description])));
          item.append(main); panel.append(item);
        }
        results.append(panel);
      }

      if (pages.length) {
        const panel = el('section', 'v-panel');
        panel.append(el('h2', 'v-panel__title', `Workspace notes · ${pages.length}`));
        for (const page of pages) {
          const item = el('button', 'v-row'); item.type = 'button';
          item.addEventListener('click', () => ctx.go(ctx.notePath(page)));
          const main = el('span', 'v-row__main');
          main.append(el('strong', null, page.title), el('small', null, ctx.pathOf(page.id)));
          item.append(main); panel.append(item);
        }
        results.append(panel);
      }

      if (resources.length) {
        const panel = el('section', 'v-panel');
        panel.append(el('h2', 'v-panel__title', `Files and knowledge · ${resources.length}`));
        for (const resource of resources) {
          const item = el('button', 'v-row'); item.type = 'button';
          item.addEventListener('click', () => openResult(resource));
          const main = el('span', 'v-row__main');
          main.append(el('strong', null, resource.title || resource.original_name || 'Untitled'));
          main.append(el('small', null, P.meta([P.label(resource.kind), resource.description, P.formatDate(resource.updated_at)])));
          item.append(main); panel.append(item);
        }
        results.append(panel);
      }
    } catch {
      results.innerHTML = '';
      results.append(notice('Search unavailable', 'The research service did not answer. No local or unfiltered results were substituted.', true));
      count.textContent = 'Search failed';
    } finally {
      submit.disabled = false;
      query.disabled = false;
      query.focus();
    }
  });

  query.focus();
}
