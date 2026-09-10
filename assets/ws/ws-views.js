/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  VIEWS
   Home, and the two workspaces. Every number and every row on these screens
   comes from the backend; nothing here invents data when a call fails.

   Each view is an async function that fills a container. They share one
   shape: show skeletons, fetch, then replace. That is why the panes do not
   jump when data lands, and why a failure has somewhere obvious to render.
   ========================================================================== */

import * as P from './ws-platform.js';
import { WORKSPACES, availableWorkspaces } from './ws-nav.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

/* ==========================================================================
   PIECES
   ========================================================================== */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function panel(title, action) {
  const section = el('section', 'v-panel');
  const head = el('div', 'v-panel__head');
  head.append(el('h2', null, title));
  if (action) head.append(action);
  section.append(head);
  const body = el('div', 'v-panel__body');
  section.append(body);
  section.body = body;
  return section;
}

export function linkButton(text, path, go) {
  const button = el('button', 'v-mini-btn', text);
  button.type = 'button';
  button.addEventListener('click', () => go(path));
  return button;
}

/* The counts strip. Figures are set in the mono face, because a row of
   numbers that has to be compared at a glance should share a column width;
   in the proportional face "1" and "8" are different sizes and the eye reads
   the wrong one as smaller. */
export function stats(pairs) {
  const wrap = el('div', 'v-stats');
  for (const [label, value] of pairs) {
    const cell = el('div', 'v-stat');
    cell.append(el('b', 'v-stat__value', value == null ? '0' : String(value)));
    cell.append(el('span', 'v-stat__label', label));
    wrap.append(cell);
  }
  return wrap;
}

export function row({ title, sub, badges, onClick, action }) {
  const node = el(onClick ? 'button' : 'div', 'v-row');
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }

  const main = el('div', 'v-row__main');
  main.append(el('strong', null, title));
  if (sub) main.append(el('small', null, sub));
  if (badges?.length) {
    const strip = el('div', 'v-badges');
    for (const text of badges.filter(Boolean)) strip.append(el('span', 'v-badge', text));
    main.append(strip);
  }
  node.append(main);
  if (action) node.append(action);
  return node;
}

export function empty(title, body) {
  const wrap = el('div', 'ws-empty');
  wrap.append(el('p', 'ws-empty__title', title));
  wrap.append(el('p', 'ws-empty__body', body));
  return wrap;
}

export function skeleton(count, host) {
  const wrap = el('div', 'ws-skel');
  const widths = [72, 54, 88, 61, 79, 48];
  for (let i = 0; i < count; i += 1) {
    const bar = el('i');
    bar.style.width = widths[i % widths.length] + '%';
    wrap.append(bar);
  }
  if (host) { host.innerHTML = ''; host.append(wrap); }
  return wrap;
}

/* A failure says which request failed and offers to run it again. The old
   workspace rendered the raw error string into the page, which told the
   reader "operating_workspace_required" and left them there. */
export function failure(what, err, retry) {
  const wrap = el('div', 'ws-alert');
  wrap.append(el('p', 'ws-alert__title', `Could not load ${what}`));

  const message = err instanceof P.AuthRequired
    ? 'Your session has ended. Sign in again to continue.'
    : 'The server did not answer. Nothing has been changed.';
  wrap.append(el('p', null, message));

  const actions = el('div', 'ws-ai__actions');
  if (err instanceof P.AuthRequired) {
    const signIn = el('a', 'ws-btn ws-btn--solid', 'Sign in');
    signIn.href = '/login';
    actions.append(signIn);
  } else if (retry) {
    const again = el('button', 'ws-btn', 'Try again');
    again.type = 'button';
    again.addEventListener('click', retry);
    actions.append(again);
  }
  wrap.append(actions);
  return wrap;
}

/* Runs a view body and puts any failure where the content would have gone,
   so no view has to repeat the same try/catch. */
async function guard(host, what, work) {
  try {
    await work();
  } catch (err) {
    host.innerHTML = '';
    host.append(failure(what, err, () => guard(host, what, work)));
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

/* ==========================================================================
   HOME
   Choose a workspace, then what is assigned to you across both.
   ========================================================================== */

/* ==========================================================================
   CORE
   ========================================================================== */

export function renderCoreTasks(host, { go }) {
  const doc = docShell(host, 'Tasks & Execution', 'Daily execution, connected to initiative, milestone, cycle and project.');
  const holder = el('div');
  doc.append(holder);
  skeleton(8, holder);

  return guard(holder, 'Core tasks', async () => {
    const board = await P.dashboard('core');
    holder.innerHTML = '';

    holder.append(stats([
      ['Open tasks', board.counts.tasks],
      ['Initiatives', board.counts.initiatives],
      ['Content', board.counts.content],
      ['Research handoffs', board.counts.research_waiting],
    ]));

    const columns = el('div', 'v-columns');

    const tasks = panel('Current execution', linkButton('Planning', '/workspace/operating', go));
    if (board.tasks.length) {
      for (const task of board.tasks) tasks.body.append(taskRow(task));
    } else {
      tasks.body.append(empty('No current tasks', 'Structured tasks are created in Planning & Projects.'));
    }

    const initiatives = panel('Active initiatives', linkButton('All initiatives', '/workspace/operating/initiatives', go));
    if (board.initiatives.length) {
      for (const item of board.initiatives) {
        initiatives.body.append(row({
          title: item.title,
          sub: P.meta([P.label(item.priority), P.label(item.status), P.label(item.stage)]),
        }));
      }
    } else {
      initiatives.body.append(empty('No active initiatives', 'Initiatives are defined in Planning & Projects.'));
    }

    columns.append(tasks, initiatives);
    holder.append(columns);
  });
}

/* The pipeline is the one genuinely two-dimensional screen in the workspace,
   so it stays a board. Six columns, scrolling sideways as one unit rather
   than each column scrolling on its own. */
const PIPELINE = ['idea', 'research', 'script', 'production', 'edit', 'published'];

function inStage(item, stage) {
  if (stage === 'research') return ['research', 'brief', 'scientific_review'].includes(item.status);
  if (stage === 'production') return ['production', 'qa'].includes(item.status);
  return item.status === stage;
}

export function renderCoreContent(host) {
  const doc = docShell(host, 'Content Pipeline', 'Videos, articles, design and production, and the handoff into research.');
  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  return guard(holder, 'the content pipeline', async () => {
    const data = await P.content();
    holder.innerHTML = '';
    const items = data.items || [];

    if (!items.length) {
      holder.append(empty('The pipeline is empty', 'Content items appear here as the team creates them.'));
      return;
    }

    /* The board scrolls sideways at narrow widths, and a scrollable region
       whose contents are not focusable is unreachable by keyboard. Made a
       labelled, focusable group so arrow keys can pan it. */
    const board = el('div', 'v-board');
    board.tabIndex = 0;
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'Content pipeline, by stage');
    for (const stage of PIPELINE) {
      const matches = items.filter((item) => inStage(item, stage));
      const column = el('section', 'v-column');

      const head = el('div', 'v-column__head');
      head.append(el('strong', null, P.label(stage)));
      head.append(el('span', 'v-column__count', String(matches.length)));
      column.append(head);

      if (!matches.length) {
        // A dashed outline rather than words: six columns each explaining
        // that they are empty is noise, and the shape already says it.
        column.append(el('div', 'v-column__empty'));
      }

      for (const item of matches) {
        const card = el('article', 'v-card');
        card.append(el('h3', null, item.title));
        if (item.description) card.append(el('p', null, item.description.slice(0, 120)));
        const foot = el('div', 'v-card__meta');
        foot.append(el('span', null, P.label(item.kind)));
        if (item.due_date) foot.append(el('span', null, P.formatDate(item.due_date)));
        card.append(foot);
        column.append(card);
      }
      board.append(column);
    }
    holder.append(board);
  });
}

export function renderCorePlanning(host, { go }) {
  const doc = docShell(host, 'Planning & Projects', 'Objectives, initiatives, cycles and the work packages under them.');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return guard(holder, 'planning', async () => {
    const board = await P.operatingDashboard();
    holder.innerHTML = '';

    const counts = board.counts || {};
    holder.append(stats([
      ['Objectives', counts.objectives],
      ['Initiatives', counts.initiatives],
      ['Open tasks', counts.tasks],
      ['Milestones', counts.milestones],
    ]));

    const columns = el('div', 'v-columns');

    const initiatives = panel('Initiatives', linkButton('Open', '/workspace/operating/initiatives', go));
    const list = board.initiatives || [];
    if (list.length) {
      for (const item of list.slice(0, 10)) {
        initiatives.body.append(row({
          title: item.title,
          sub: P.meta([P.label(item.status), P.label(item.stage), P.formatDate(item.due_date)]),
        }));
      }
    } else {
      initiatives.body.append(empty('No initiatives', 'Initiatives group the work behind an objective.'));
    }

    const cycles = panel('Cycles', linkButton('Open', '/workspace/operating/cycles', go));
    const cycleList = board.cycles || [];
    if (cycleList.length) {
      for (const item of cycleList.slice(0, 10)) {
        cycles.body.append(row({
          title: item.title || item.name,
          sub: P.meta([P.formatDate(item.starts_on), P.formatDate(item.ends_on), P.label(item.status)]),
        }));
      }
    } else {
      cycles.body.append(empty('No cycles', 'A cycle is the time box the team plans inside.'));
    }

    columns.append(initiatives, cycles);
    holder.append(columns);
  });
}

export function renderCoreTeam(host) {
  const doc = docShell(host, 'Team & Access', 'Core members, their roles and their storage.');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return guard(holder, 'the team', async () => {
    const data = await P.team();
    holder.innerHTML = '';
    const members = data.members || data.team || [];

    if (!members.length) {
      holder.append(empty('No members listed', 'Core members appear here once they are provisioned.'));
      return;
    }

    const list = panel('Core team');
    for (const member of members) {
      const name = member.name || member.email || 'Member';
      const avatar = el('span', 'v-avatar', name.charAt(0).toUpperCase());
      const node = row({
        title: name,
        sub: P.meta([member.email, P.label(member.role)]),
      });
      node.prepend(avatar);
      list.body.append(node);
    }
    holder.append(list);
  });
}

/* ==========================================================================
   RESEARCH
   ========================================================================== */

export function renderResearchProjects(host, { go }) {
  const doc = docShell(host, 'Research Projects', 'Internal research, revenue projects and community opportunities in one portfolio.');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return guard(holder, 'projects', async () => {
    const data = await P.projects();
    holder.innerHTML = '';
    const all = data.projects || [];

    if (!all.length) {
      holder.append(empty('No projects yet', 'Research projects appear here once created.'));
      return;
    }

    const bar = el('div', 'v-toolbar');
    const search = el('input', 'v-input');
    search.type = 'search';
    search.placeholder = 'Search projects';
    search.setAttribute('aria-label', 'Search projects');

    const kind = el('select', 'v-input');
    kind.setAttribute('aria-label', 'Filter by project type');
    for (const [value, text] of [['', 'All project types'], ['internal', 'Internal'], ['client', 'Client'], ['community', 'Community']]) {
      const option = el('option', null, text);
      option.value = value;
      kind.append(option);
    }

    const count = el('span', 'v-toolbar__count');
    bar.append(search, kind, count);

    const grid = el('div', 'v-grid');

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const k = kind.value;
      const matches = all.filter((p) => {
        if (k && p.category !== k) return false;
        if (!q) return true;
        return [p.title, p.description, p.research_question, p.client_name]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });

      count.textContent = `${matches.length} of ${all.length}`;
      grid.innerHTML = '';
      if (!matches.length) {
        grid.append(empty('Nothing matches', 'Try another search or a different project type.'));
        return;
      }
      for (const project of matches) grid.append(projectCard(project, go));
    };

    search.addEventListener('input', draw);
    kind.addEventListener('change', draw);

    holder.append(bar, grid);
    draw();
  });
}

function projectCard(project, go) {
  const card = el('button', 'v-project');
  card.type = 'button';
  card.addEventListener('click', () => go(`/workspace/research/projects/${project.id}`));

  card.append(el('span', 'v-badge', P.label(project.category)));
  card.append(el('strong', 'v-project__title', project.title));
  if (project.research_question) card.append(el('p', 'v-project__question', project.research_question));
  else if (project.description) card.append(el('p', 'v-project__question', project.description.slice(0, 140)));

  const foot = el('div', 'v-project__meta');
  foot.textContent = P.meta([project.client_name, P.label(project.status), P.formatDate(project.updated_at)]);
  card.append(foot);
  return card;
}

export function renderResearchProject(host, id, { go }) {
  const doc = docShell(host, 'Project', '');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return guard(holder, 'this project', async () => {
    const data = await P.project(id);
    const project = data.project || data;
    doc.querySelector('.ws-doc__title').textContent = project.title;
    doc.querySelector('.ws-doc__meta').textContent =
      P.meta([P.label(project.category), project.client_name, P.label(project.status)]);
    holder.innerHTML = '';

    if (project.research_question) {
      const question = panel('Research question');
      question.body.append(el('p', 'v-prose', project.research_question));
      holder.append(question);
    }
    if (project.description) {
      const about = panel('About');
      about.body.append(el('p', 'v-prose', project.description));
      holder.append(about);
    }

    const members = project.members || project.memberships || [];
    if (members.length) {
      const people = panel('Members');
      for (const member of members) {
        people.body.append(row({ title: member.name || member.user || 'Member', sub: P.label(member.role) }));
      }
      holder.append(people);
    }

    const back = el('button', 'ws-btn', 'All projects');
    back.type = 'button';
    back.addEventListener('click', () => go('/workspace/research/projects'));
    holder.append(back);
  });
}

const RESOURCE_VIEWS = {
  file:    ['Files & Data Rooms', 'Secure project files, backed by Nextcloud.'],
  dataset: ['Datasets', 'Research data, with project level access.'],
  note:    ['Research Notes', 'Notes attached to projects, and private notes.'],
};

export function renderResources(host, kind) {
  const [title, subtitle] = RESOURCE_VIEWS[kind] || RESOURCE_VIEWS.file;
  const doc = docShell(host, title, subtitle);
  const holder = el('div');
  doc.append(holder);
  skeleton(7, holder);

  return guard(holder, title.toLowerCase(), async () => {
    const data = await P.resources(kind);
    holder.innerHTML = '';
    const items = data.items || [];

    if (!items.length) {
      holder.append(empty(`No ${kind}s yet`, 'Items you create privately or attach to a research project appear here.'));
      return;
    }

    const bar = el('div', 'v-toolbar');
    const search = el('input', 'v-input');
    search.type = 'search';
    search.placeholder = `Search ${title.toLowerCase()}`;
    search.setAttribute('aria-label', `Search ${title}`);
    const count = el('span', 'v-toolbar__count');
    bar.append(search, count);

    const list = panel(title);

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const matches = items.filter((item) => !q || [item.title, item.description, item.original_name]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
      count.textContent = `${matches.length} of ${items.length}`;
      list.body.innerHTML = '';
      if (!matches.length) {
        list.body.append(empty('No matches', 'Try another search.'));
        return;
      }
      for (const item of matches) list.body.append(resourceRow(item));
    };

    search.addEventListener('input', draw);
    holder.append(bar, list);
    draw();
  });
}

export function renderMindMaps(host) {
  const doc = docShell(host, 'Mind Maps', 'Research questions, hypotheses, evidence and datasets, connected.');
  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  return guard(holder, 'mind maps', async () => {
    const data = await P.mindmaps();
    holder.innerHTML = '';
    const maps = data.mindmaps || data.items || [];
    if (!maps.length) {
      holder.append(empty('No mind maps', 'Maps you create or that are shared with you appear here.'));
      return;
    }
    const list = panel('Mind maps');
    for (const map of maps) {
      list.body.append(row({ title: map.title, sub: P.meta([map.project_title, P.formatDate(map.updated_at)]) }));
    }
    holder.append(list);
  });
}

export function renderShared(host) {
  const doc = docShell(host, 'Shared with me', 'Projects, files, notes, maps and tasks shared directly with your account.');
  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  return guard(holder, 'shared items', async () => {
    const data = await P.sharedWithMe();
    holder.innerHTML = '';
    const items = data.items || [];
    if (!items.length) {
      holder.append(empty('Nothing shared yet', 'Items shared directly with your account appear here.'));
      return;
    }
    const list = panel('Shared items');
    for (const item of items) {
      list.body.append(row({
        title: item.title,
        sub: P.meta([P.label(item.type), P.label(item.role), item.granted_by ? `Shared by ${item.granted_by}` : '']),
      }));
    }
    holder.append(list);
  });
}

export function renderPeople(host) {
  const doc = docShell(host, 'Researchers', 'Researcher profiles and the collaboration network.');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return guard(holder, 'researchers', async () => {
    const [network, mine] = await Promise.all([P.researchers(), P.myProfile()]);
    holder.innerHTML = '';

    const columns = el('div', 'v-columns');

    const list = panel('Research network');
    const people = network.researchers || [];
    if (people.length) {
      for (const person of people) {
        const avatar = el('span', 'v-avatar', (person.name || 'R').charAt(0).toUpperCase());
        const node = row({
          title: person.name,
          sub: P.meta([person.headline || person.bio, person.institution]),
          badges: (person.skills || []).slice(0, 6),
        });
        node.prepend(avatar);
        list.body.append(node);
      }
    } else {
      list.body.append(empty('No public profiles', 'Researchers can choose to publish their profile.'));
    }

    const profile = mine.profile || {};
    const self = panel('My profile');
    self.body.append(el('strong', null, profile.headline || 'Add a headline'));
    self.body.append(el('p', 'v-prose', profile.bio || 'Describe your research background and interests.'));
    if ((profile.skills || []).length) {
      const strip = el('div', 'v-badges');
      for (const skill of profile.skills) strip.append(el('span', 'v-badge', skill));
      self.body.append(strip);
    }
    self.body.append(el('small', null, profile.is_public
      ? 'Visible in the research network.'
      : 'Private. Only you can see this profile.'));

    columns.append(list, self);
    holder.append(columns);
  });
}

export function renderCommunity(host) {
  const doc = docShell(host, 'Research Opportunities', 'Open community projects looking for collaborators.');
  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  return guard(holder, 'opportunities', async () => {
    const data = await P.call('/platform/community/projects/');
    holder.innerHTML = '';
    const items = data.projects || data.items || [];
    if (!items.length) {
      holder.append(empty('No open opportunities', 'Community projects open to collaborators appear here.'));
      return;
    }
    const grid = el('div', 'v-grid');
    for (const item of items) {
      const card = el('div', 'v-project');
      card.append(el('span', 'v-badge', 'Community'));
      card.append(el('strong', 'v-project__title', item.title));
      if (item.research_question || item.description) {
        card.append(el('p', 'v-project__question', item.research_question || item.description.slice(0, 140)));
      }
      grid.append(card);
    }
    holder.append(grid);
  });
}

export function renderCollaboration(host) {
  const doc = docShell(host, 'Collaboration', 'Nextcloud apps, shared storage and the people you work with.');
  const holder = el('div');
  doc.append(holder);
  skeleton(4, holder);

  return guard(holder, 'collaboration', async () => {
    const status = await P.nextcloud();
    holder.innerHTML = '';

    const box = panel('Connected storage');
    box.body.append(row({
      title: status.connected ? 'Nextcloud connected' : 'Nextcloud not connected',
      sub: status.url || 'Per user identity, project level access control.',
    }));
    if (status.quota || status.used) {
      box.body.append(row({ title: 'Storage', sub: P.meta([status.used, status.quota]) }));
    }
    holder.append(box);

    if (!status.connected) {
      holder.append(empty('Storage is not linked yet',
        'Files and data rooms need a connected Nextcloud account. An administrator sets this up once for the workspace.'));
    }
  });
}

/* ==========================================================================
   NOTES
   The research knowledge base: pages you write, and files you attach.

   Two stores sit behind this one screen, and the difference is visible
   rather than hidden. Notes are pages, and they follow whatever ws-api.js
   resolved at boot: the server if the page endpoints are deployed, this
   browser if they are not. Files go to Nextcloud through
   /api/platform/files/upload/, which is registered and works today, so an
   attachment is on the account the moment the upload returns. Saying so is
   the point: somebody writing for an hour deserves to know which of those
   two things is holding their work.
   ========================================================================== */

export function renderNotes(host, ctx) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');

  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Notes'));
  head.append(el('p', 'ws-doc__meta', 'Pages you write, and the files attached to them.'));
  doc.append(head);

  /* ---- Actions ---------------------------------------------------------- */
  const bar = el('div', 'v-toolbar');

  const newNote = el('button', 'ws-btn ws-btn--solid', 'New note');
  newNote.type = 'button';
  newNote.addEventListener('click', () => ctx.newNote({ space: 'research' }));

  const picker = el('input');
  picker.type = 'file';
  picker.hidden = true;

  const addFile = el('button', 'ws-btn', 'Add a file');
  addFile.type = 'button';
  addFile.addEventListener('click', () => picker.click());

  const status = el('p', 'v-note');
  status.hidden = true;

  bar.append(newNote, addFile);
  doc.append(bar, picker, status);

  /* The upload is multipart, not JSON, so it does not go through the shared
     call() helper: that one sets a JSON content type, and setting any
     content type by hand on a FormData body strips the multipart boundary
     the server needs to parse it. */
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;

    status.hidden = false;
    status.dataset.tone = '';
    status.textContent = `Uploading ${file.name}…`;

    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'file');

    try {
      const res = await fetch('/api/platform/files/upload/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': readCookie('csrftoken') },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);

      status.textContent = `${file.name} is on your Nextcloud storage.`;
      status.dataset.tone = 'ok';
      loadFiles();
    } catch (err) {
      status.dataset.tone = 'bad';
      status.textContent = UPLOAD_MESSAGES[err.message]
        || 'That file was not uploaded. Nothing was changed.';
    }
  });

  /* ---- Notes ------------------------------------------------------------ */
  const notes = panel('Your notes');
  const pages = ctx.pages('research');

  if (!pages.length) {
    notes.body.append(empty('No notes yet', 'Press New note, or Control N anywhere in the workspace.'));
  } else {
    for (const page of pages) {
      notes.body.append(row({
        title: page.title,
        sub: `${ctx.pathOf(page.id)} · ${ctx.when(page.updated)}`,
        onClick: () => ctx.go(`/workspace/page/${page.id}`),
      }));
    }
  }
  doc.append(notes);

  /* Where the notes are actually being kept. Stated plainly rather than
     buried in the status bar, because on a deployment without the page
     endpoints this is the single most important thing on the screen. */
  const where = el('p', 'v-note');
  where.dataset.tone = ctx.pagesOnServer() ? 'ok' : 'warn';
  where.textContent = ctx.pagesOnServer()
    ? 'Notes are saved to your account.'
    : 'Notes are saved in this browser. The page service is not deployed on this build, so they are not on your account yet and will not follow you to another machine.';
  notes.body.append(where);

  /* ---- Files ------------------------------------------------------------ */
  const files = panel('Files');
  files.body.append(skeleton(3));
  doc.append(files);

  const loadFiles = async () => {
    try {
      const data = await P.resources('file');
      files.body.innerHTML = '';
      const items = data.items || [];
      if (!items.length) {
        files.body.append(empty('No files', 'Add a file and it is stored on your Nextcloud account, with project level access.'));
        return;
      }
      for (const item of items) {
        files.body.append(row({
          title: item.title || item.original_name,
          sub: P.meta([item.project_title, P.formatDate(item.updated_at || item.created_at)]),
        }));
      }
    } catch (err) {
      files.body.innerHTML = '';
      files.body.append(failure('your files', err, loadFiles));
    }
  };
  loadFiles();

  host.append(doc);
}

/* ==========================================================================
   CORE · NOTES
   The team's own writing, which Core had nowhere to put. Meeting notes were
   going into the research tree next to dossier briefs, or into a chat
   thread, which is the same as nowhere.

   Three roots, and the split between them is the point of the screen: a
   meeting produces a Meeting note, a meeting that settles something
   produces a Decision, and a decision that has to bind future work becomes
   a Standard. That is also the order of value — a decision nobody can find
   six months later was not really made — so the screen names it rather than
   leaving people to invent a filing scheme each.
   ========================================================================== */

const CORE_ROOTS = [
  ['c-meetings',  'Meeting',  'What was discussed, and what was carried.'],
  ['c-decisions', 'Decision', 'What was settled, and the reasoning somebody will want in six months.'],
  ['c-standards', 'Standard', 'A rule that binds future work. The draft a blueprint gets cut from.'],
];

export function renderCoreNotes(host, ctx) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  host.append(doc);

  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Notes'));
  head.append(el('p', 'ws-doc__meta', 'What the team writes while running the company: meetings, decisions and the standards they harden into.'));
  doc.append(head);

  const bar = el('div', 'v-toolbar');
  for (const [root, label, hint] of CORE_ROOTS) {
    const button = el('button', root === 'c-meetings' ? 'ws-btn ws-btn--solid' : 'ws-btn', `New ${label.toLowerCase()}`);
    button.type = 'button';
    button.title = hint;
    button.addEventListener('click', () => ctx.newNote({
      space: 'core',
      parent: root,
      title: `Untitled ${label.toLowerCase()}`,
    }));
    bar.append(button);
  }
  doc.append(bar);

  const pages = ctx.pages('core');

  if (!pages.length) {
    doc.append(empty(
      'Nothing written yet',
      'Start with the meeting you are in. A note written during it is worth three written afterwards.',
    ));
    return;
  }

  /* Grouped by root rather than sorted by date. A flat "recently edited"
     list is the right shape for a person's own notes and the wrong shape
     for a team's, where the question is almost always "what did we decide
     about X" and almost never "what did I touch on Tuesday". */
  for (const [root, label] of CORE_ROOTS) {
    const mine = pages.filter((page) => ctx.pathOf(page.id).startsWith(rootTitle(root)));
    if (!mine.length) continue;

    const box = panel(`${label}s`);
    for (const page of mine) {
      box.body.append(row({
        title: page.title,
        sub: ctx.when(page.updated),
        onClick: () => ctx.go(`/workspace/page/${page.id}`),
      }));
    }
    doc.append(box);
  }

  const loose = pages.filter((page) => !CORE_ROOTS.some(([root]) => ctx.pathOf(page.id).startsWith(rootTitle(root))));
  if (loose.length) {
    const box = panel('Elsewhere in Core');
    for (const page of loose) {
      box.body.append(row({
        title: page.title,
        sub: `${ctx.pathOf(page.id)} · ${ctx.when(page.updated)}`,
        onClick: () => ctx.go(`/workspace/page/${page.id}`),
      }));
    }
    doc.append(box);
  }

  const where = el('p', 'v-note');
  where.dataset.tone = ctx.pagesOnServer() ? 'ok' : 'warn';
  where.textContent = ctx.pagesOnServer()
    ? 'Core notes are saved to your account and visible to the core team.'
    : 'The page service is not deployed on this build, so these are saved in this browser only. Nobody else on the team can see them yet.';
  doc.append(where);
}

/* The breadcrumb path is built from titles, not ids, so grouping compares
   titles. Kept in one place so a renamed root needs one edit rather than
   three string literals scattered through the screen. */
const ROOT_TITLES = { 'c-meetings': 'Meetings', 'c-decisions': 'Decisions', 'c-standards': 'Standards' };
const rootTitle = (id) => ROOT_TITLES[id] || '';

function readCookie(name) {
  const hit = document.cookie.split('; ').find((r) => r.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

const UPLOAD_MESSAGES = {
  file_required: 'No file was selected.',
  file_size_invalid: 'That file is larger than this workspace accepts.',
  unsupported_dataset_type: 'That file type is not accepted here.',
  permission_denied: 'You do not have permission to add files there.',
  authentication_required: 'Your session has ended. Sign in again.',
};
