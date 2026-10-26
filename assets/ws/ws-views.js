/* ==========================================================================
   GRAVIQUEST WORKSPACE  ·  VIEWS
   Home, and the two workspaces. Every number and every row on these screens
   comes from the backend; nothing here invents data when a call fails.

   Each view is an async function that fills a container. They share one
   shape: show skeletons, fetch, then replace. That is why the panes do not
   jump when data lands, and why a failure has somewhere obvious to render.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261016-task1&patch=20261026canonsave1';
import { WORKSPACES, availableWorkspaces } from './ws-nav.js?v=20261016-task1';
import { uploadToolbar, mindmapToolbar, profileToolbar } from './ws-research-tools.js?v=20261016-task1';
import { deckPanel } from './ws-deck-sync.js?v=20261016-task1';

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
  const section = el('section', 'v-panel wc-card');
  section.dataset.span = '12';
  const head = el('div', 'v-panel__head wc-card__head');
  head.append(el('h2', 'wc-card__title', title));
  if (action) head.append(action);
  section.append(head);
  const body = el('div', 'v-panel__body wc-card__body');
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
  const wrap = el('div', 'v-stats wc-tiles');
  for (const [label, value] of pairs) {
    const cell = el('div', 'v-stat wc-tile');
    const head = el('div', 'wc-tile__head');
    head.append(el('span', 'v-stat__label wc-tile__label', label));
    cell.append(head);
    cell.append(el('b', 'v-stat__value wc-tile__value', value == null ? '0' : String(value)));
    wrap.append(cell);
  }
  return wrap;
}

export function row({ title, sub, badges, onClick, action }) {
  const node = el(onClick ? 'button' : 'div', `v-row wc-item${onClick ? ' wc-item--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }

  const main = el('div', 'v-row__main wc-item__main');
  main.append(el('strong', 'wc-item__title', title));
  if (sub) main.append(el('small', 'wc-item__meta', sub));
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
// Historic source imports can contain a missing, malformed or legacy-shaped
// `records` field. Treat the optional provenance as optional UI data rather
// than failing the whole task editor after the task detail API succeeded.
export function taskSourceRecords(metadata) {
  const records = metadata && typeof metadata === 'object' ? metadata.records : null;
  return Array.isArray(records)
    ? records.filter((record) => record && typeof record === 'object' && !Array.isArray(record))
    : [];
}

// Every task editor can be opened without fetching the complete Core board.
// Prefer explicit detail choices, then cached board choices, then the known
// public enum labels. Missing optional metadata must not hide a saved task.
export function taskCardOptions(detailValues, boardValues, fallbackRows) {
  if (Array.isArray(detailValues) && detailValues.length) return detailValues;
  if (Array.isArray(boardValues) && boardValues.length) return boardValues;
  return fallbackRows.map(([value, label]) => ({ value, label }));
}

export function failure(what, err, retry) {
  const wrap = el('div', 'ws-alert');
  wrap.append(el('p', 'ws-alert__title', `Could not load ${what}`));

  const status = Number(err?.status || 0);
  const message = err instanceof P.AuthRequired
    ? 'Your session has ended. Sign in again to continue.'
    : status === 403 ? 'You do not have permission to open this item.'
    : status === 404 ? 'This item is no longer available or you do not have access.'
    : [502, 503, 504].includes(status) ? 'The service is temporarily unavailable. Please try again.'
    : status >= 500 ? 'The server could not complete this request. Please try again.'
    : status >= 400 ? 'This request could not be completed. No changes were saved.'
    : 'The request could not be completed. Check the connection and try again.';
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

/* One task card as a dialog over whatever screen is open. It reuses the board's
   dialog through renderCoreTasks rather than a copy of it, on a host that is
   never attached, so there is one task card in the workspace, not two. */
export function openCoreTask(taskId, { go, onTaskChange } = {}) {
  return renderCoreTasks(document.createElement('div'), { go, openTaskId: taskId, onTaskChange });
}

export function renderCoreTasks(host, { go, openTaskId = null, onTaskChange = null }) {
  const doc = docShell(host, 'Tasks & Execution', 'Manager-defined execution. Create tasks manually from existing Key Results and optional Milestones.');
  // ws.css styles this board's compact tiles through this attribute.
  doc.dataset.coreTasksNative = 'true';
  const head = doc.querySelector(':scope > .ws-doc__head');
  head.classList.add('task-board__head');
  // The Deck row belongs to the board on screen, not to the copy openCoreTask
  // draws off-screen to reuse the task dialog.
  if (host.isConnected) head.after(deckPanel({ go, onPulled: () => renderCoreTasks(host, { go, openTaskId, onTaskChange }) }));
  const holder = el('div');
  doc.append(holder);
  skeleton(8, holder);

  const PRIORITY_COLUMNS = [
    ['p0', 'P0 · Critical'],
    ['p1', 'P1 · High'],
    ['p2', 'P2 · Normal'],
    ['p3', 'P3 · Low'],
  ];

  const STATUS_COLUMNS = [
    ['draft', 'Backlog'],
    ['active', 'Active'],
    ['ready', 'Ready'],
    ['waiting', 'Waiting on owner'],
    ['needs_review', 'Needs review'],
    ['retest', 'Acceptance retest'],
    ['blocked', 'Blocked'],
    ['done', 'Done'],
    ['archived', 'Archived'],
  ];

  const makeButton = (label, handler, solid = false) => {
    const node = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  const input = (type = 'text', value = '') => {
    const node = el('input', 'v-input task-board__input');
    node.type = type;
    node.value = value == null ? '' : value;
    return node;
  };

  const textarea = (value = '', rows = 4) => {
    const node = el('textarea', 'v-input task-board__textarea');
    node.rows = rows;
    node.value = value || '';
    return node;
  };

  const select = (rows, current = '') => {
    const node = el('select', 'v-input task-board__input');
    for (const [value, labelText] of rows) {
      const option = el('option', null, labelText);
      option.value = value == null ? '' : String(value);
      node.append(option);
    }
    node.value = current == null ? '' : String(current);
    return node;
  };

  const field = (labelText, control, help = '') => {
    const wrap = el('label', 'task-board__field');
    wrap.append(el('span', 'task-board__label', labelText), control);
    if (help) wrap.append(el('small', 'fl-muted', help));
    return wrap;
  };

  const formatActor = (actor) => actor?.name || actor?.email || 'GraviQuest';

  function closeDialog(dialog) {
    if (dialog?.dataset.taskId && location.pathname === '/workspace/core/tasks') {
      const url = new URL(location.href);
      if (url.searchParams.get('task') === dialog.dataset.taskId) {
        url.searchParams.delete('task');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
    }
    if (dialog?._onEscape) document.removeEventListener('keydown', dialog._onEscape, true);
    const previousFocus = dialog?._previousFocus;
    dialog?.remove();
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function taskMutationFeedback(message, error = false) {
    const toast = el('div', 'v-note', message);
    toast.setAttribute('role', error ? 'alert' : 'status');
    toast.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:22px', 'z-index:10010',
      'max-width:360px', 'padding:12px 16px', 'border-radius:12px',
      'background:var(--surface, #0a2331)', 'color:var(--text, #f1f8fc)',
      'box-shadow:0 6px 28px #0008', 'border:1px solid #608097',
    ].join(';');
    document.body.append(toast);
    return {
      show(value, failed = false) {
        toast.textContent = value;
        toast.setAttribute('role', failed ? 'alert' : 'status');
        window.setTimeout(() => toast.remove(), failed ? 9000 : 2700);
      },
    };
  }

  function makeDialog(title) {
    const dialog = el('div', 'task-card-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    dialog._previousFocus = document.activeElement;
    dialog._onEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape dismisses the @ suggestions before it can dismiss the task.
      const focused = document.activeElement;
      if (focused?.getAttribute('aria-expanded') === 'true' &&
          focused?.getAttribute('aria-controls')?.startsWith('task-mentions-')) return;
      // Project action modals are allowed to close themselves first.
      if (document.querySelector('[data-project-action-modal]')) return;
      const openDialogs = document.querySelectorAll('.task-card-dialog');
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      event.preventDefault();
      event.stopPropagation();
      closeDialog(dialog);
    };
    document.addEventListener('keydown', dialog._onEscape, true);
    const frame = el('div', 'task-card-dialog__frame');
    const head = el('header', 'task-card-dialog__head');
    head.append(el('h2', null, title));
    const close = makeButton('Close', () => closeDialog(dialog));
    head.append(close);
    const body = el('div', 'task-card-dialog__body');
    frame.append(head, body);
    dialog.append(frame);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    document.body.append(dialog);
    window.requestAnimationFrame(() => dialog.focus());
    return { dialog, body, head };
  }

  function optionRows(items, emptyLabel, titleKey = 'title') {
    return [['', emptyLabel], ...(items || []).map((item) => [item.id, item[titleKey] || item.name || item.email])];
  }

  function taskSearchText(task) {
    return [
      task.title, task.description, task.owner?.name, task.owner?.email,
      task.trace?.objective?.title, task.trace?.key_result?.title,
      task.milestone_title, task.work_package_title,
      task.project_title, task.priority, task.status,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function taskCard(task, openCard, { draggable = true } = {}) {
    const card = el('article', 'task-trello-card');
    card.draggable = draggable;
    card.dataset.taskId = task.id;
    card.dataset.status = task.status;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open task: ${task.title}`);

    const top = el('div', 'task-trello-card__top');
    const priority = el('span', 'v-badge task-trello-card__priority', P.label(task.priority));
    priority.dataset.priority = task.priority;
    top.append(priority);
    if (task.due_date) {
      const due = el('time', 'task-trello-card__due', P.formatDate(task.due_date));
      due.dateTime = task.due_date;
      top.append(due);
    }
    card.append(top, el('h3', null, task.title));

    if (task.description) {
      card.append(el('p', 'task-trello-card__description', task.description.slice(0, 145)));
    }

    const hierarchy = el('div', 'task-trello-card__hierarchy');
    if (task.trace?.objective?.title) {
      const objective = el('div', 'task-trello-card__path');
      objective.append(el('small', null, 'Objective'), el('strong', null, task.trace.objective.title));
      hierarchy.append(objective);
    }
    if (task.trace?.key_result?.title) {
      const kr = el('div', 'task-trello-card__path task-trello-card__path--kr');
      kr.append(el('small', null, 'KR'), el('strong', null, task.trace.key_result.title));
      hierarchy.append(kr);
    }
    card.append(hierarchy);

    const context = el('div', 'task-trello-card__context');
    if (task.milestone_title) context.append(el('span', null, task.milestone_title));
    if (task.project_title) context.append(el('span', null, task.project_title));
    card.append(context);

    const foot = el('div', 'task-trello-card__foot');
    const owner = el('span', 'task-trello-card__owner', (task.owner?.name || task.owner?.email || '?').slice(0, 1).toUpperCase());
    owner.title = task.owner?.name || task.owner?.email || 'Owner';
    foot.append(owner);
    const counts = el('span', 'task-trello-card__counts');
    if (task.checklist_count) {
      counts.append(el(
        'span',
        'task-trello-card__checklist-count',
        `Checklist ${task.checklist_completed_count || 0}/${task.checklist_count}`,
      ));
    }
    if (task.comment_count) counts.append(el('span', null, `💬 ${task.comment_count}`));
    if (task.attachment_count) counts.append(el('span', null, `📎 ${task.attachment_count}`));
    foot.append(counts);
    card.append(foot);

    let dragging = false;
    if (draggable) {
      card.addEventListener('dragstart', (event) => {
        dragging = true;
        card.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(task.id));
      });
      card.addEventListener('dragend', () => {
        window.setTimeout(() => { dragging = false; }, 0);
        card.classList.remove('is-dragging');
      });
    }
    card.addEventListener('click', () => { if (!dragging) openCard(task.id); });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCard(task.id);
      }
    });
    return card;
  }

  function taskHierarchy(tasks) {
    const objectives = new Map();
    for (const task of tasks) {
      const objective = task.trace?.objective || { id: 'none', title: 'No objective' };
      const kr = task.trace?.key_result || { id: 'none', title: 'No key result' };
      const objectiveKey = String(objective.id || objective.title || 'none');
      if (!objectives.has(objectiveKey)) objectives.set(objectiveKey, { ...objective, key_results: new Map() });
      const objectiveNode = objectives.get(objectiveKey);
      const krKey = String(kr.id || kr.title || 'none');
      if (!objectiveNode.key_results.has(krKey)) objectiveNode.key_results.set(krKey, { ...kr, tasks: [] });
      objectiveNode.key_results.get(krKey).tasks.push(task);
    }
    return [...objectives.values()].map((objective) => ({
      ...objective,
      key_results: [...objective.key_results.values()],
    }));
  }

  /* The tree reads as a table grouped by Objective and KR: one row per task,
     with status, priority, owner and due date in fixed columns so the eye can
     run down any one of them. It used to be bullet points with all four
     packed into one grey line under each title, which made "who is late" a
     reading exercise. Each group carries done-of-total, a count of rows the
     payload holds rather than a percentage it does not. */
  const TREE_TONES = { blocked: 'critical', waiting: 'caution', needs_review: 'caution', retest: 'caution', active: 'accent', ready: 'accent', done: 'positive', archived: 'muted', draft: 'muted' };
  const treeCollapsed = new Set();

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function treeProgress(tasks) {
    const done = tasks.filter((task) => task.status === 'done').length;
    const wrap = el('span', 'task-tree__progress');
    const bar = el('span', 'task-tree__bar');
    bar.style.setProperty('--done', tasks.length ? String(done / tasks.length) : '0');
    wrap.append(bar, el('span', 'task-tree__ratio', `${done}/${tasks.length} done`));
    return wrap;
  }

  // A head opens its Objective or KR card, unless the group is the
  // "No objective" bucket, which has no card to open.
  function hierarchyHead(node, kind, id, titleText, openHierarchy) {
    if (!id || String(id) === 'none') return;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `Open ${kind === 'kr' ? 'key result' : 'objective'}: ${titleText}`);
    node.addEventListener('click', () => openHierarchy(kind, id));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openHierarchy(kind, id);
      }
    });
  }

  function renderTaskTree(host, tasks, openCard, openHierarchy) {
    const tree = el('div', 'task-tree');
    const hierarchy = taskHierarchy(tasks);
    const today = localToday();
    if (hierarchy.length) {
      const columns = el('div', 'task-tree__columns');
      columns.setAttribute('aria-hidden', 'true');
      for (const text of ['Task', 'Status', 'Priority', 'Owner', 'Due']) columns.append(el('span', null, text));
      tree.append(columns);
    }
    for (const objective of hierarchy) {
      const objectiveKey = String(objective.id || objective.title || 'none');
      const objectiveTitle = objective.title || 'Untitled objective';
      const objectiveNode = el('section', 'task-tree__objective');
      const allTasks = objective.key_results.flatMap((kr) => kr.tasks);

      const toggle = el('button', 'task-tree__toggle');
      toggle.type = 'button';
      toggle.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const paintCollapsed = () => {
        const shut = treeCollapsed.has(objectiveKey);
        objectiveNode.toggleAttribute('data-collapsed', shut);
        toggle.setAttribute('aria-expanded', String(!shut));
        toggle.setAttribute('aria-label', `${shut ? 'Expand' : 'Collapse'} ${objectiveTitle}`);
      };
      toggle.addEventListener('click', () => {
        if (treeCollapsed.has(objectiveKey)) treeCollapsed.delete(objectiveKey);
        else treeCollapsed.add(objectiveKey);
        paintCollapsed();
      });

      const objectiveHead = el('div', 'task-tree__objective-head');
      hierarchyHead(objectiveHead, 'objective', objective.id, objectiveTitle, openHierarchy);
      objectiveHead.append(el('span', 'task-tree__type', 'Objective'), el('h3', null, objectiveTitle));
      const krCount = objective.key_results.length;
      const objectiveMeta = el('div', 'task-tree__objective-meta');
      objectiveMeta.append(
        el('span', 'task-tree__counts', `${krCount} KR${krCount === 1 ? '' : 's'} · ${allTasks.length} task${allTasks.length === 1 ? '' : 's'}`),
        treeProgress(allTasks),
      );
      const bar = el('div', 'task-tree__objective-bar');
      bar.append(toggle, objectiveHead, objectiveMeta);
      objectiveNode.append(bar);
      paintCollapsed();

      const krList = el('div', 'task-tree__kr-list');
      for (const kr of objective.key_results) {
        const krNode = el('section', 'task-tree__kr');
        const krHead = el('div', 'task-tree__kr-head');
        const krTitle = kr.title || 'Untitled key result';
        hierarchyHead(krHead, 'kr', kr.id, krTitle, openHierarchy);
        krHead.append(
          el('span', 'task-tree__type task-tree__type--kr', 'KR'),
          el('strong', null, krTitle),
          treeProgress(kr.tasks),
        );
        krNode.append(krHead);

        const taskHost = el('div', 'task-tree__tasks');
        const byId = new Map(kr.tasks.map((task) => [String(task.id), task]));
        const children = new Map();
        for (const task of kr.tasks) {
          const parentId = task.parent_id && byId.has(String(task.parent_id)) ? String(task.parent_id) : '';
          if (!children.has(parentId)) children.set(parentId, []);
          children.get(parentId).push(task);
        }
        const visited = new Set();
        const appendTask = (task, depth = 0) => {
          if (visited.has(task.id)) return;
          visited.add(task.id);
          const row = el('button', 'task-tree__task');
          row.type = 'button';
          row.style.setProperty('--task-depth', String(depth));
          row.dataset.depth = String(depth);
          row.dataset.status = task.status;
          row.dataset.tone = TREE_TONES[task.status] || '';
          const name = el('span', 'task-tree__name');
          name.append(el('span', 'task-tree__dot'), el('span', 'task-tree__title', task.title));
          if (depth) row.title = 'Subtask of the task above';
          const priority = el('span', 'task-tree__priority', String(task.priority || '').toUpperCase());
          priority.dataset.priority = task.priority || '';
          const ownerName = task.owner?.name || task.owner?.email || '';
          const owner = el('span', 'task-tree__owner');
          if (ownerName) {
            const initials = ownerName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
            owner.append(el('span', 'task-tree__avatar', initials), el('span', 'task-tree__owner-name', ownerName));
          } else {
            owner.append(el('span', 'task-tree__none', 'Unassigned'));
          }
          const due = el('span', 'task-tree__due', P.formatDate(task.due_date) || '—');
          if (task.due_date && task.due_date < today && !['done', 'archived'].includes(task.status)) due.dataset.overdue = '';
          row.append(name, el('span', 'task-tree__state', P.label(task.status)), priority, owner, due);
          row.addEventListener('click', () => openCard(task.id));
          taskHost.append(row);
          for (const child of children.get(String(task.id)) || []) appendTask(child, depth + 1);
        };
        for (const root of children.get('') || []) appendTask(root, 0);
        for (const task of kr.tasks) appendTask(task, 0);
        krNode.append(taskHost);
        krList.append(krNode);
      }
      objectiveNode.append(krList);
      tree.append(objectiveNode);
    }
    if (!hierarchy.length) tree.append(el('p', 'v-note', 'No tasks match these filters.'));
    host.append(tree);
  }

  function renderTaskGraph(host, tasks, openCard, openHierarchy) {
    const hierarchy = taskHierarchy(tasks);
    if (!hierarchy.length) {
      host.append(el('p', 'v-note', 'No tasks match these filters.'));
      return;
    }

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'task-graph');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Graph of objectives, key results and tasks');
    const xObjective = 20;
    const xKr = 350;
    const xTask = 710;
    const objectiveW = 250;
    const krW = 280;
    const taskW = 330;
    const h = 58;
    const gap = 18;
    let y = 28;
    const objectiveRows = [];

    for (const objective of hierarchy) {
      const krRows = [];
      for (const kr of objective.key_results) {
        const taskRows = [];
        for (const task of kr.tasks) {
          taskRows.push({ task, y });
          y += h + gap;
        }
        if (!taskRows.length) {
          taskRows.push({ task: null, y });
          y += h + gap;
        }
        const krY = taskRows.reduce((sum, row) => sum + row.y, 0) / taskRows.length;
        krRows.push({ kr, y: krY, taskRows });
      }
      const objectiveY = krRows.reduce((sum, row) => sum + row.y, 0) / Math.max(1, krRows.length);
      objectiveRows.push({ objective, y: objectiveY, krRows });
      y += 22;
    }

    const width = 1080;
    const height = Math.max(360, y + 20);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const path = (x1, y1, x2, y2, cls = '') => {
      const p = document.createElementNS(ns, 'path');
      const mid = (x1 + x2) / 2;
      p.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      p.setAttribute('class', 'task-graph__edge ' + cls);
      svg.append(p);
    };

    const node = ({ x, y: top, width: nodeW, label, title, kind, status = '', taskId = null, hierarchyKind = '', hierarchyId = null, meta = '' }) => {
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('class', `task-graph__node task-graph__node--${kind}`);
      if (status) group.dataset.status = status;
      const activate = taskId
        ? () => openCard(taskId)
        : hierarchyKind && hierarchyId && String(hierarchyId) !== 'none'
          ? () => openHierarchy(hierarchyKind, hierarchyId)
          : null;
      if (activate) {
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.style.cursor = 'pointer';
        group.addEventListener('click', activate);
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        });
      }
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(top));
      rect.setAttribute('width', String(nodeW));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '12');
      const small = document.createElementNS(ns, 'text');
      small.setAttribute('x', String(x + 14));
      small.setAttribute('y', String(top + 18));
      small.setAttribute('class', 'task-graph__label');
      small.textContent = label;
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(x + 14));
      text.setAttribute('y', String(top + 38));
      text.setAttribute('class', 'task-graph__title');
      text.textContent = String(title || '').length > 38 ? String(title).slice(0, 35) + '…' : title;
      group.append(rect, small, text);
      if (meta) {
        const metaText = document.createElementNS(ns, 'text');
        metaText.setAttribute('x', String(x + nodeW - 14));
        metaText.setAttribute('y', String(top + 18));
        metaText.setAttribute('text-anchor', 'end');
        metaText.setAttribute('class', 'task-graph__meta');
        metaText.textContent = meta;
        group.append(metaText);
      }
      const full = document.createElementNS(ns, 'title');
      full.textContent = String(title || '');
      group.append(full);
      svg.append(group);
    };

    for (const objectiveRow of objectiveRows) {
      node({
        x: xObjective, y: objectiveRow.y, width: objectiveW,
        label: 'OBJECTIVE', title: objectiveRow.objective.title, kind: 'objective',
        hierarchyKind: 'objective', hierarchyId: objectiveRow.objective.id,
        meta: String(objectiveRow.krRows.length) + ' KR',
      });
      for (const krRow of objectiveRow.krRows) {
        path(xObjective + objectiveW, objectiveRow.y + h / 2, xKr, krRow.y + h / 2, 'is-objective');
        node({
          x: xKr, y: krRow.y, width: krW,
          label: 'KEY RESULT', title: krRow.kr.title, kind: 'kr',
          hierarchyKind: 'kr', hierarchyId: krRow.kr.id,
          meta: String(krRow.kr.tasks.length) + ' tasks',
        });
        for (const taskRow of krRow.taskRows) {
          if (!taskRow.task) continue;
          path(xKr + krW, krRow.y + h / 2, xTask, taskRow.y + h / 2, 'is-task');
          node({
            x: xTask, y: taskRow.y, width: taskW,
            label: P.label(taskRow.task.status).toUpperCase(),
            title: taskRow.task.title,
            kind: 'task',
            status: taskRow.task.status,
            taskId: taskRow.task.id,
            meta: taskRow.task.owner?.name || taskRow.task.owner?.email || '',
          });
        }
      }
    }

    const wrap = el('div', 'task-graph-wrap');
    wrap.append(svg);
    host.append(wrap);
  }

  async function openTaskHierarchyDialog(kind, id, state, reloadBoard) {
    const isObjective = kind === 'objective';
    const { dialog, body, head } = makeDialog(isObjective ? 'Loading objective…' : 'Loading key result…');
    body.append(skeleton(5));

    try {
      const dashboard = await P.operatingDashboard();
      const planning = dashboard.planning || {};
      const objectives = planning.objectives || [];
      let objective = null;
      let keyResult = null;

      if (isObjective) {
        objective = objectives.find((item) => String(item.id) === String(id)) || null;
      } else {
        for (const item of objectives) {
          const match = (item.key_results || []).find((row) => String(row.id) === String(id));
          if (match) {
            objective = item;
            keyResult = match;
            break;
          }
        }
        if (!keyResult) {
          keyResult = (planning.key_results || state.key_results || []).find((row) => String(row.id) === String(id)) || null;
          if (keyResult?.objective_id) {
            objective = objectives.find((item) => String(item.id) === String(keyResult.objective_id)) || null;
          }
        }
      }

      const entity = isObjective ? objective : keyResult;
      if (!entity) throw new Error(isObjective ? 'Objective not found.' : 'Key Result not found.');

      head.querySelector('h2').textContent = entity.title || (isObjective ? 'Objective' : 'Key Result');
      const planningButton = makeButton('Open planning', () => {
        closeDialog(dialog);
        go('/workspace/core/planning');
      });
      head.insertBefore(planningButton, head.querySelector('button'));

      body.innerHTML = '';
      const shell = el('div', 'task-hierarchy-dialog');
      const eyebrow = el('div', 'task-hierarchy-dialog__eyebrow');
      eyebrow.append(el('span', 'v-badge', isObjective ? 'Objective' : 'Key Result'));
      if (entity.health) eyebrow.append(el('span', 'v-badge', P.label(entity.health)));
      if (entity.status) eyebrow.append(el('span', 'v-badge', P.label(entity.status)));
      const hero = el('section', 'task-hierarchy-dialog__hero');
      hero.append(eyebrow);
      if (!isObjective && objective) {
        const parent = el('button', 'task-hierarchy-dialog__parent', objective.title || 'Objective');
        parent.type = 'button';
        parent.addEventListener('click', () => {
          closeDialog(dialog);
          openTaskHierarchyDialog('objective', objective.id, state, reloadBoard);
        });
        hero.append(parent);
      }

      const details = el('div', 'task-hierarchy-dialog__details');
      const detailRows = [
        ['Owner', entity.owner?.name || entity.owner?.email || '—'],
        ['Due', P.formatDate(entity.due_date) || '—'],
        ['Progress', entity.progress == null ? '—' : `${entity.progress}%`],
      ];
      if (!isObjective) {
        const current = entity.current_value ?? '—';
        const target = entity.target_value ?? '—';
        const metric = entity.metric_name || entity.unit || '';
        detailRows.push(['Metric', metric ? `${current} / ${target} ${entity.unit || ''}`.trim() : `${current} / ${target}`]);
      }
      for (const [labelText, value] of detailRows) {
        const item = el('div', 'task-hierarchy-dialog__detail');
        item.append(el('small', null, labelText), el('strong', null, String(value || '—')));
        details.append(item);
      }
      hero.append(details);

      if (entity.progress != null) {
        const progress = el('div', 'task-hierarchy-dialog__progress');
        const fill = el('i');
        fill.style.width = `${Math.max(0, Math.min(100, Number(entity.progress) || 0))}%`;
        progress.append(fill);
        hero.append(progress);
      }
      shell.append(hero);

      const linkedTasks = (state.tasks || []).filter((task) => {
        if (isObjective) return String(task.trace?.objective?.id) === String(entity.id);
        return String(task.trace?.key_result?.id) === String(entity.id);
      });

      if (isObjective) {
        const krPanel = el('section', 'task-hierarchy-dialog__section');
        krPanel.append(el('h3', null, 'Key Results'));
        const krList = el('div', 'task-hierarchy-dialog__list');
        for (const kr of entity.key_results || []) {
          const item = el('button', 'task-hierarchy-dialog__item');
          item.type = 'button';
          item.append(
            el('span', null, kr.title || 'Untitled key result'),
            el('small', 'fl-muted', P.meta([
              kr.progress == null ? '' : `${kr.progress}%`,
              kr.owner?.name || kr.owner?.email,
              P.formatDate(kr.due_date),
            ])),
          );
          item.addEventListener('click', () => {
            closeDialog(dialog);
            openTaskHierarchyDialog('kr', kr.id, state, reloadBoard);
          });
          krList.append(item);
        }
        if (!(entity.key_results || []).length) krList.append(el('p', 'v-note', 'No Key Results under this objective.'));
        krPanel.append(krList);
        shell.append(krPanel);
      }

      const taskPanel = el('section', 'task-hierarchy-dialog__section');
      taskPanel.append(el('h3', null, `Tasks · ${linkedTasks.length}`));
      const taskList = el('div', 'task-hierarchy-dialog__list');
      for (const task of linkedTasks) {
        const item = el('button', 'task-hierarchy-dialog__item');
        item.type = 'button';
        item.dataset.status = task.status;
        item.append(
          el('span', null, task.title),
          el('small', 'fl-muted', P.meta([
            P.label(task.status),
            P.label(task.priority),
            task.owner?.name || task.owner?.email,
            P.formatDate(task.due_date),
          ])),
        );
        item.addEventListener('click', () => {
          closeDialog(dialog);
          openTaskDialog(task.id, state, reloadBoard);
        });
        taskList.append(item);
      }
      if (!linkedTasks.length) taskList.append(el('p', 'v-note', 'No tasks linked here yet.'));
      taskPanel.append(taskList);
      shell.append(taskPanel);
      body.append(shell);
    } catch (error) {
      body.innerHTML = '';
      body.append(el('p', 'v-note', error?.message || 'This planning item could not be opened.'));
    }
  }

  function getDropBefore(container, y) {
    const cards = [...container.querySelectorAll('.task-trello-card:not(.is-dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, element: card };
    }
    return closest.element;
  }

  /* `state` is the board payload, or a function that fetches it when the card
     is opened from outside the board. The frame goes up before anything is
     awaited and both requests run side by side: a click that shows nothing for
     a second gets clicked again, and each of those clicks used to become its
     own dialog. A second click on a task whose card is already up focuses it. */
  async function openTaskDialog(taskId, state, reloadBoard, { forceEditor = false } = {}) {
    const existing = document.querySelector(`.task-card-dialog[data-task-id="${taskId}"]`);
    if (existing) {
      existing.focus();
      return;
    }
    const { dialog, body, head } = makeDialog('Loading task…');
    dialog.dataset.taskId = String(taskId);
    if (location.pathname === '/workspace/core/tasks') {
      const url = new URL(location.href);
      url.searchParams.set('task', String(taskId));
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    body.append(skeleton(6));
    let detailForFallback = null;
    let previewLoaded = false;
    let editorFailed = false;
    const mobileReader = window.matchMedia?.('(max-width: 800px)')?.matches && !forceEditor;
    const showTaskPreview = ({ task: summary, events = [], hierarchy = {} }) => {
      if (!dialog.isConnected || !summary || (detailForFallback && !editorFailed)) return;
      previewLoaded = true;
      detailForFallback = summary;
      head.querySelector('h2').textContent = summary.title || 'Task';
      const status = el('p', 'fl-muted',
        `Status: ${P.label(summary.status || 'unknown')} · Owner: ${summary.owner?.name || 'Unknown'}`);
      const description = el('p', null, summary.description || 'No description.');
      const activity = el('section', 'task-card-dialog__message');
      activity.append(el('strong', null, 'Activity'), el('p', 'fl-muted', 'Loading report history…'));
      const note = el('p', 'fl-muted', editorFailed
        ? 'The editor could not load. The task and saved reports remain available below.'
        : mobileReader ? 'Task report and status' : 'Loading full editor…');
      const lineage = el('nav', 'task-family__path');
      lineage.setAttribute('aria-label', 'Task folder path');
      const gotoTask = id => {
        closeDialog(dialog);
        openTaskDialog(id, state, reloadBoard);
      };
      const gotoPlanning = (kind, id) => {
        closeDialog(dialog);
        const index = typeof state === 'function' ? state() : Promise.resolve(state);
        Promise.resolve(index).then(data => openTaskHierarchyDialog(kind, id, data || {}, reloadBoard))
          .catch(() => {});
      };
      const steps = [];
      if (summary.objective?.id) steps.push({
        title: summary.objective.title, kind: 'objective',
        action: () => gotoPlanning('objective', summary.objective.id),
      });
      if (summary.key_result?.id) steps.push({
        title: summary.key_result.title, kind: 'kr',
        action: () => gotoPlanning('key_result', summary.key_result.id),
      });
      for (const parent of hierarchy.ancestors || [])
        steps.push({ title: parent.title, kind: 'parent', action: () => gotoTask(parent.id) });
      const selected = [steps.find(s => s.kind === 'objective'),
        steps.find(s => s.kind === 'kr'),
        [...steps].reverse().find(s => s.kind === 'parent')].filter(Boolean);
      const omitted = steps.filter(s => !selected.includes(s));
      if (omitted.length) {
        const extra = el('details', 'task-family__overflow');
        extra.append(el('summary', null, '…'));
        const menu = el('div', 'task-family__overflow-menu');
        for (const step of omitted) {
          const btn = makeButton(step.title, step.action);
          btn.className = 'task-family__crumb';
          btn.title = step.title;
          menu.append(btn);
        }
        extra.append(menu);
        lineage.append(extra);
      }
      selected.forEach((step, index) => {
        if (index) lineage.append(el('span', 'task-family__separator', '›'));
        const btn = makeButton(step.title, step.action);
        btn.className = 'task-family__crumb';
        btn.title = step.title;
        lineage.append(btn);
      });
      if (!selected.length) lineage.append(el('span', 'task-family__crumb', 'Task'));
      const goal = el('section', 'task-family__mobile-goal');
      goal.append(el('strong', null, 'Expected outcome'),
        el('p', null, summary.definition_of_done || 'Not defined'));
      const subtaskBox = el('section', 'task-family__mobile-children');
      subtaskBox.append(el('strong', null, 'Subtasks'));
      for (const child of hierarchy.children || []) {
        const open = makeButton(child.title + ' · ' + P.label(child.status), () => gotoTask(child.id));
        open.classList.add('task-family__child');
        subtaskBox.append(open);
      }
      if (!(hierarchy.children || []).length) subtaskBox.append(el('p', 'fl-muted', 'No subtasks yet.'));
      body.replaceChildren(lineage, status, goal, description, subtaskBox, activity, note);
      const showEvents = (items) => {
        activity.replaceChildren(el('strong', null, 'Activity'));
        for (const event of (items || []).slice(0, 20)) {
          const item = el('article', 'task-card-dialog__message');
          item.append(el('strong', null,
            event.action === 'task.daily_report' ? 'Pulsar · confirmed daily report' : P.label(event.action)),
            el('small', 'fl-muted', P.formatDate(event.created_at)));
          if (event.action === 'task.daily_report') {
            const report = event.report || {};
            const detail = event.detail || {};
            if (detail.progress) item.append(el('p', null, `Progress: ${detail.progress}`));
            if (detail.deliverable) item.append(el('p', null, `Deliverable: ${detail.deliverable}`));
            if (detail.next_action) item.append(el('p', null, `Next: ${detail.next_action}`));
            if (report.original_text) item.append(el('p', null, report.original_text));
          }
          activity.append(item);
        }
        if (!(items || []).length) activity.append(el('p', 'fl-muted', 'No activity yet.'));
      };
      showEvents(events);
      if (mobileReader) {
        const edit = makeButton('Edit task', () => {
          closeDialog(dialog);
          openTaskDialog(taskId, state, reloadBoard, { forceEditor: true });
        });
        body.append(edit);
      }
    };

    try {
      // Detail is the only blocking request. The dependency index can include
      // thousands of tasks; waiting for it used to keep the entire card blank.
      const stateLoader = typeof state === 'function' ? state : null;
      // A direct link used to show only "Loading task…" until all editor
      // dropdowns came back. Show task identity/status from a small, indexed
      // single-task read without blocking the full editable form.
      
      const previewRequest = mobileReader ? P.operatingTaskPreview(taskId).then(showTaskPreview)
        .catch((error) => {
          if (mobileReader && dialog.isConnected) {
            body.replaceChildren(failure('task card', error, () => {
              closeDialog(dialog);
              openTaskDialog(taskId, state, reloadBoard);
            }));
          }
        }) : Promise.resolve();
      if (mobileReader) {
        // Mobile opens read-first: status + Pulsar history share a single API
        // round trip. The full editor and all its selectable catalogs are only
        // fetched when the user explicitly taps Edit task.
        await previewRequest;
        return;
      }
      const detailData = await P.operatingTaskCard(taskId);
      const boardState = stateLoader ? { tasks: [] } : (state || { tasks: [] });
      state = { ...detailData, ...boardState, tasks: boardState.tasks || [] };
      const task = detailData.task;
      detailForFallback = task;
      head.querySelector('h2').textContent = 'Task #' + task.id;
      const closeButton = head.querySelector('button');
      closeButton.textContent = '×';
      closeButton.setAttribute('aria-label', 'Close task');
      closeButton.title = 'Close task';
      const moreMenu = el('details', 'task-card-dialog__more');
      const moreTrigger = el('summary', null, 'More');
      moreTrigger.setAttribute('aria-label', 'More task actions');
      const moreItems = el('div', 'task-card-dialog__more-items');
      moreMenu.append(moreTrigger, moreItems);
      head.insertBefore(moreMenu, closeButton);
      const family = detailData.hierarchy || { ancestors: [], children: [], parent_candidates: [] };
      const navTask = (id) => {
        closeDialog(dialog);
        openTaskDialog(id, stateLoader || state, reloadBoard);
      };
      const navPlan = async (kind, id) => {
        closeDialog(dialog);
        const index = stateLoader ? await stateLoader().catch(() => state) : state;
        openTaskHierarchyDialog(kind, id, index, reloadBoard);
      };
      const familyPath = el('nav', 'task-family__path');
      familyPath.setAttribute('aria-label', 'Task location');
      const pathSteps = [];
      const addPath = (title, action, kind) => pathSteps.push({ title, action, kind });
      if (task.trace?.objective?.id) addPath(task.trace.objective.title || 'Objective',
        () => navPlan('objective', task.trace.objective.id), 'objective');
      if (task.trace?.key_result?.id) addPath(task.trace.key_result.title || 'KR',
        () => navPlan('key_result', task.trace.key_result.id), 'kr');
      if (task.project_id && task.project_title && go)
        addPath(task.project_title, () => {
          closeDialog(dialog);
          go('/workspace/research/projects/' + task.project_id + '/tasks');
        }, 'project');
      for (const ancestor of family.ancestors || [])
        addPath(ancestor.title, () => navTask(ancestor.id), 'parent');
      const primary = [
        pathSteps.find(step => step.kind === 'objective'),
        pathSteps.find(step => step.kind === 'kr'),
        [...pathSteps].reverse().find(step => step.kind === 'parent'),
      ].filter(Boolean);
      if (!primary.length && pathSteps.length) primary.push(pathSteps[pathSteps.length - 1]);
      const overflowSteps = pathSteps.filter(step => !primary.includes(step));
      const appendPathLink = (host, step) => {
        const btn = makeButton(step.title, step.action);
        btn.className = 'task-family__crumb';
        btn.title = step.title;
        host.append(btn);
      };
      if (overflowSteps.length) {
        const overflow = el('details', 'task-family__overflow');
        overflow.append(el('summary', null, '…'));
        const items = el('div', 'task-family__overflow-menu');
        for (const step of overflowSteps) appendPathLink(items, step);
        overflow.append(items);
        familyPath.append(overflow);
      }
      primary.forEach((step, index) => {
        if (index) familyPath.append(el('span', 'task-family__separator', '›'));
        appendPathLink(familyPath, step);
      });
      if (!pathSteps.length) familyPath.append(el('span', 'task-family__crumb', 'Task'));
      const linkTask = makeButton('Copy link', async () => {
        const url = new URL(`/workspace/core/tasks?task=${encodeURIComponent(task.id)}`, location.origin);
        try { await navigator.clipboard.writeText(url.href); linkTask.textContent = 'Link copied'; }
        catch { linkTask.textContent = 'Copy unavailable'; }
      });
      const refTask = makeButton('Copy reference', async () => {
        const title = String(task.title || 'Task').replace(/[|\]]/g, '');
        try { await navigator.clipboard.writeText(`[[task:${task.id}|${title}]]`); refTask.textContent = 'Reference copied'; }
        catch { refTask.textContent = 'Copy unavailable'; }
      });
      moreItems.append(linkTask);
      const advancedActions = el('details', 'task-card-dialog__advanced-actions');
      advancedActions.append(el('summary', null, 'Advanced actions'));
      const advancedActionItems = el('div', 'task-card-dialog__advanced-action-items');
      advancedActionItems.append(refTask);
      advancedActions.append(advancedActionItems);
      moreItems.append(advancedActions);
      // A project task is the SAME OperatingTask in Core and Research.
      // Open its existing planning views; never create a second task copy.
      if (task.project_id && go && (detailData.projects || boardState.projects || [])
          .some((row) => String(row.id) === String(task.project_id))) {
        const planning = makeButton('Open project planning', () => {
          closeDialog(dialog);
          go(`/workspace/research/projects/${task.project_id}/management?task=${task.id}`);
        });
        moreItems.append(planning);
      }
      if (detailData.can_delete) {
        const remove = makeButton('Delete task', async () => {
          if (!confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
          remove.disabled = true;
          // Remove the visible card immediately. Only commit "Deleted" after
          // the server confirms; a rejection restores the exact previous card.
          const undo = reloadBoard?.applyMutation?.({ type: 'delete', id: task.id });
          closeDialog(dialog);
          const feedback = taskMutationFeedback('Deleting task…', true);
          try {
            await P.deleteOperatingTaskCard(task.id);
            feedback.show('Task deleted.');
            if (!reloadBoard?.applyMutation) {
              void Promise.resolve().then(() => reloadBoard?.({ keepDialog: true }))
                .catch(error => console.warn('Background task list refresh failed', error));
            }
          } catch (error) {
            undo?.();
            feedback.show('Delete failed. The task was restored.', true);
            // Keep the original unsaved fields safe: reopen from the server.
            if (!document.querySelector(`.task-card-dialog[data-task-id="${task.id}"]`)) {
              void openTaskDialog(task.id, state, reloadBoard);
            }
            console.error('Task delete failed', error);
          }
        });
        remove.classList.add('ws-btn--danger');
        remove.title = 'Permanently delete this task';
        moreItems.append(remove);
      } else {
        const unavailable = el('p', 'fl-muted', 'Only a Core administrator or this task’s owner can delete it.');
        unavailable.setAttribute('role', 'note');
        moreItems.append(unavailable);
      }
      body.innerHTML = '';

      const layout = el('div', 'task-card-dialog__grid');
      const main = el('div', 'task-card-dialog__main');
      const side = el('aside', 'task-card-dialog__side');
      layout.append(main, side);
      body.append(layout);

      const form = el('form', 'task-board__form');
      const title = input('text', task.title);
      title.setAttribute('aria-label', 'Task title');
      const description = textarea(task.description, 5);
      const priorityChoices = taskCardOptions(detailData.priorities, state.priorities, PRIORITY_COLUMNS);
      const statusChoices = taskCardOptions(detailData.statuses, state.statuses, STATUS_COLUMNS);
      const priority = select(priorityChoices.map((item) => [item.value, item.label]), task.priority);
      const status = select(statusChoices.map((item) => [item.value, item.label]), task.status);
      const owner = select(optionRows(detailData.members || state.members, 'Choose owner', 'name'), task.owner?.id);
      const keyResult = select(
        [['', 'Choose key result'], ...(detailData.key_results || state.key_results || []).map((item) => [
          item.id,
          (item.objective_title ? item.objective_title + ' · ' : '') + item.title,
        ])],
        task.trace?.key_result?.id || '',
      );
      const milestone = select(
        [['', 'No milestone'], ...(detailData.milestones || state.milestones || []).map((item) => [
          item.id,
          (item.key_result_title ? item.key_result_title + ' · ' : '') + item.title,
        ])],
        task.milestone_id,
      );
      const workPackage = select(optionRows(detailData.work_packages || state.work_packages, 'No work package'), task.work_package_id);
      const project = select(optionRows(detailData.projects || state.projects, 'No Research project'), task.project_id);
      const initialDependencies = state.tasks.filter((row) => row.id !== task.id);
      if (task.dependency_id && !initialDependencies.some((row) => String(row.id) === String(task.dependency_id))) {
        initialDependencies.push({ id: task.dependency_id, title: task.dependency_title || 'Current dependency' });
      }
      const dependency = select(
        [['', 'No dependency'], ...initialDependencies.map((row) => [row.id, row.title])],
        task.dependency_id,
      );
      // The dependency index can be thousands of rows; do not request it
      // for every modal opening. Fetch only if the user edits relations.
      let dependencyIndexRequested = false;
      const loadDependencyIndex = () => {
        if (!stateLoader || dependencyIndexRequested) return;
        dependencyIndexRequested = true;
        Promise.resolve().then(stateLoader).then((response) => {
          if (!dialog.isConnected) return;
          const chosen = dependency.value || '';
          const rows = (response?.tasks || []).filter((row) => row.id !== task.id);
          if (chosen && !rows.some((row) => String(row.id) === String(chosen))) {
            rows.push({ id: chosen, title: task.dependency_title || 'Current dependency' });
          }
          state.tasks = rows;
          const updated = select([['', 'No dependency'], ...rows.map((row) => [row.id, row.title])], chosen);
          dependency.replaceChildren(...updated.children);
          dependency.value = chosen;
        }).catch(() => { dependencyIndexRequested = false; });
      };
      dependency.addEventListener('focus', loadDependencyIndex);
      const due = input('date', task.due_date || '');
      const done = textarea(task.definition_of_done, 2);
      done.setAttribute('aria-label', 'Expected outcome / Definition of done');
      const blocked = textarea(task.blocked_reason, 3);
      const parent = select(
        [['', 'No parent task'], ...(family.parent_candidates || []).map(row => [row.id, row.title])],
        task.parent_id || '',
      );

      // Never rewrite a task's stored links simply because an archived or
      // access-filtered related record is absent from the edit dropdown.
      // A field is sent only after the user explicitly changes that control.
      const relationControls = {
        key_result_id: keyResult, milestone_id: milestone,
        work_package_id: workPackage, project_id: project,
        parent_id: parent, dependency_id: dependency,
      };
      const changedRelations = new Set();
      for (const [name, control] of Object.entries(relationControls))
        control.addEventListener('change', () => changedRelations.add(name));
      keyResult.addEventListener('change', () => {
        const target = String(keyResult.value || '');
        const matches = (rows, value) => rows.some(row =>
          String(row.id) === String(value) && String(row.key_result_id) === target);
        if (milestone.value && !matches(detailData.milestones || [], milestone.value)) {
          milestone.value = '';
          changedRelations.add('milestone_id');
        }
        if (workPackage.value && !matches(detailData.work_packages || [], workPackage.value)) {
          workPackage.value = '';
          changedRelations.add('work_package_id');
        }
      });

      const two = el('div', 'task-board__two');
      two.append(field('Priority', priority), field('Status', status), field('Owner', owner), field('Due date', due));
      const calendarAction = makeButton('Google Tasks', async () => {
        if (calendarAction.dataset.openUrl) {
          window.open(calendarAction.dataset.openUrl, '_blank', 'noopener,noreferrer');
          moreMenu.open = false;
          return;
        }
        calendarAction.disabled = true;
        calendarNote.textContent = 'Checking Google Tasks…';
        try {
          const state = await P.googleCalendarTaskStatus(task.id);
          if (!state.connected) {
            const next = `${location.pathname}?calendar_task=${encodeURIComponent(task.id)}`;
            location.href = `/api/calendar/google/connect/?next=${encodeURIComponent(next)}`;
            return;
          }
          const result = await P.syncOperatingTaskToGoogle(task.id);
          const destination = result.google_task?.calendar_url || state.calendar_url ||
            'https://calendar.google.com/calendar/u/0/r/tasks';
          calendarAction.dataset.openUrl = destination;
          calendarAction.textContent = 'Open Google Tasks';
          calendarNote.textContent = 'Synced';
        } catch (error) {
          const code = error?.data?.error || error?.message || '';
          const friendly = {
            calendar_reconnect_required: 'Reconnect Google to continue.',
            google_tasks_permission_required: 'Google Tasks permission needed. Reconnect Google.',
            google_tasks_api_disabled: 'Google Tasks API is disabled.',
            calendar_permission_denied: 'Google denied permission. Reconnect and retry.',
          };
          calendarNote.textContent = friendly[code] || code || 'Could not sync Google Tasks.';
          if (error?.data?.setup_url && code === 'google_tasks_api_disabled') {
            const link = el('a', '', 'Enable Google Tasks API');
            link.href = error.data.setup_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            calendarNote.append(' ', link);
          }
        } finally { calendarAction.disabled = false; }
      });
      const calendarNote = el('small', 'fl-muted task-card-dialog__calendar-note');
      moreItems.append(calendarAction, calendarNote);

      const sourceHistory = el('details', 'task-card-dialog__source-history');
      const sourceRecords = taskSourceRecords(task.source_metadata);
      if (sourceRecords.length) {
        sourceHistory.append(el('summary', null, 'Imported source records (' + sourceRecords.length + ')'));
        sourceHistory.append(el('p', 'v-note', 'Imported activity is not an accepted deliverable or a due date.'));
        sourceRecords.forEach((record) => {
          const entry = el('div', 'v-note');
          entry.append(el('strong', '', record.title || task.title));
          entry.append(el('p', '', `Reported status: ${record.original_status || 'Not recorded'} · Activity: ${record.activity_date_raw || 'Not recorded'}`));
          if (record.parent_title) entry.append(el('p', '', `Historical parent: ${record.parent_title}`));
          try {
            const reference = new URL(record.source_reference);
            if (reference.protocol === 'https:' && reference.hostname === 'docs.google.com') {
              const anchor = el('a', '', 'Open historical Google Docs record');
              anchor.href = reference.href;
              anchor.target = '_blank';
              anchor.rel = 'noopener noreferrer';
              entry.append(anchor);
            }
          } catch (_) { /* Retain source text when no navigable reference exists. */ }
          sourceHistory.append(entry);
        });
      }

      const actions = el('div', 'task-card-dialog__actions');
      const save = makeButton('Save changes', () => {}, true);
      save.type = 'submit';
      actions.append(save);
      const note = el('p', 'v-note');

      const titleField = field('Task', title);
      titleField.classList.add('task-card-dialog__title-field');
      const goalField = field('Outcome', done);
      const descriptionBlock = el('details', 'task-family__details');
      descriptionBlock.append(
        el('summary', null, 'Notes and blockers'),
        field('Description', description),
        field('Blocked reason', blocked),
      );
      if (description.value.trim() || blocked.value.trim()) descriptionBlock.open = false;
      const relatedBlock = el('details', 'task-family__details');
      relatedBlock.append(el('summary', null, 'More details'));
      const placement = el('details', 'task-family__relation-group');
      placement.append(el('summary', null, 'Placement'));
      const placementFields = el('div', 'task-board__two');
      placementFields.append(field('Key result', keyResult),
        field('Research project', project), field('Parent task', parent));
      placement.append(placementFields);
      const scheduling = el('details', 'task-family__relation-group');
      scheduling.append(el('summary', null, 'Milestones & dependencies'));
      const schedulingFields = el('div', 'task-board__two');
      schedulingFields.append(field('Milestone', milestone),
        field('Work package', workPackage), field('Dependency', dependency));
      scheduling.append(schedulingFields);
      relatedBlock.append(placement, scheduling);
      relatedBlock.addEventListener('toggle', () => {
        if (relatedBlock.open) loadDependencyIndex();
      });
      // Links are first-class task resources (not uploads or imported source records).
      const resourceSection = el('section', 'task-card-dialog__resources');
      const resourceHeader = el('div', 'task-card-dialog__resource-head');
      const resourceTitle = el('strong', null, 'Links');
      const addResource = makeButton('+ Add link', () => {
        resourceEditor.hidden = !resourceEditor.hidden;
        if (!resourceEditor.hidden) resourceUrl.focus();
      });
      addResource.type = 'button';
      addResource.classList.add('task-card-dialog__resource-add');
      addResource.hidden = detailData.can_edit === false;
      resourceHeader.append(resourceTitle, addResource);
      const resourceList = el('div', 'task-card-dialog__resource-list');
      const resourceEditor = el('div', 'task-card-dialog__resource-editor');
      resourceEditor.hidden = true;
      const resourceUrl = input('url');
      resourceUrl.placeholder = 'Paste Google Docs or any link…';
      resourceUrl.setAttribute('aria-label', 'Link URL');
      resourceUrl.maxLength = 2000;
      const resourceName = input('text');
      resourceName.placeholder = 'Name (optional)';
      resourceName.setAttribute('aria-label', 'Link name');
      resourceName.maxLength = 200;
      const saveResource = makeButton('Add', async () => {
        let safeUrl = resourceUrl.value.trim();
        try {
          const parsed = new URL(safeUrl);
          if (!['https:', 'http:'].includes(parsed.protocol) ||
              parsed.username || parsed.password) throw Error('Invalid link');
        } catch {
          resourceNote.textContent = 'Paste a valid https:// or http:// link.';
          return;
        }
        saveResource.disabled = true;
        resourceNote.textContent = 'Saving…';
        try {
          await P.call(`/operating/tasks/${task.id}/external-links/`, { method: 'POST', body: { title: resourceName.value.trim(), url: safeUrl } });
          resourceUrl.value = '';
          resourceName.value = '';
          resourceEditor.hidden = true;
          await loadExternalLinks();
          resourceNote.textContent = '';
        } catch (error) {
          resourceNote.textContent = error?.data?.error || error?.message || 'Could not save link.';
        } finally {
          saveResource.disabled = false;
        }
      });
      saveResource.type = 'button';
      resourceUrl.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); saveResource.click(); }
      });
      resourceName.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); saveResource.click(); }
      });
      resourceEditor.append(resourceUrl, resourceName, saveResource);
      const resourceNote = el('p', 'v-note');
      resourceSection.append(resourceHeader, resourceList, resourceEditor, resourceNote);

      const loadExternalLinks = async () => {
        try {
          const data = await P.call(`/operating/tasks/${task.id}/external-links/`);
          resourceList.replaceChildren();
          for (const link of data.links || []) {
            const line = el('div', 'task-card-dialog__resource-row');
            const anchor = el('a', 'task-card-dialog__resource-url');
            let parsed;
            try {
              parsed = new URL(link.url);
              if (!['https:', 'http:'].includes(parsed.protocol)) continue;
            } catch { continue; }
            anchor.href = parsed.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = link.title || parsed.hostname;
            anchor.title = link.url;
            anchor.append(el('span', 'task-card-dialog__resource-external', '↗'));
            line.append(anchor);
            if (detailData.can_edit !== false && Number(link.origin_task_id) === Number(task.id)) {
              const remove = makeButton('×', async () => {
                if (!confirm('Remove this link from the task?')) return;
                remove.disabled = true;
                try {
                  await P.call(`/operating/tasks/${task.id}/external-links/`, { method: 'DELETE', body: { link_id: link.id } });
                  await loadExternalLinks();
                } catch (error) {
                  resourceNote.textContent = error?.data?.error || error?.message || 'Could not remove link.';
                  remove.disabled = false;
                }
              });
              remove.type = 'button';
              remove.classList.add('task-card-dialog__resource-remove');
              remove.setAttribute('aria-label', 'Remove ' + (link.title || parsed.hostname));
              line.append(remove);
            }
            resourceList.append(line);
          }
        } catch (error) {
          resourceNote.textContent = error?.data?.error || error?.message || 'Links could not be loaded.';
        }
      };

      if (task.canonical_sync === 'pending') {
        note.textContent = 'Saved in GraviQuest. Nextcloud synchronization pending.';
      } else if (task.canonical_sync === 'conflict') {
        note.textContent = 'Saved in GraviQuest, but the Nextcloud file changed. Sync needs conflict review.';
        note.setAttribute('role', 'alert');
      }
      form.append(
        familyPath,
        titleField,
        goalField,
        two,
        resourceSection,
        descriptionBlock,
        relatedBlock,
        actions,
        note,
      );

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        note.textContent = 'Saving…';
        note.setAttribute('role', 'status');
        const payload = {
          title: title.value.trim(),
          description: description.value.trim(),
          priority: priority.value,
          status: status.value,
          owner_id: Number(owner.value),
          due_date: due.value || null,
          definition_of_done: done.value.trim(),
          blocked_reason: blocked.value.trim(),
        };
        for (const [name, control] of Object.entries(relationControls)) {
          if (changedRelations.has(name))
            payload[name] = control.value ? Number(control.value) : null;
        }
        // Update the existing card locally: no full task-board fetch and
        // redraw round trip is needed just to reflect one field change.
        const selectedOwner = (detailData.members || state.members || []).find(
          row => Number(row.id) === payload.owner_id);
        const patch = {
          ...payload,
          ...(selectedOwner ? { owner: selectedOwner } : {}),
        };
        const undo = reloadBoard?.applyMutation?.({ type: 'update', id: task.id, patch });
        try {
          const result = await P.updateOperatingTaskCard(task.id, payload);
          note.textContent = result.canonical_sync === 'pending'
            ? 'Saved on server. Nextcloud synchronization queued.'
            : 'Saved.';
          title.value = result.task.title;
          Object.assign(task, result.task);
          head.querySelector('h2').textContent = 'Task #' + task.id;
          // Other views have no local Core task board; update them in the
          // background, never block this confirmed save on a full refresh.
          if (!reloadBoard?.applyMutation) {
            void Promise.resolve().then(() => reloadBoard?.({ keepDialog: true }))
              .catch(error => console.warn('Background task refresh failed', error));
          }
        } catch (error) {
          undo?.();
          if (error?.code === 'request_timeout') {
            note.textContent = 'Checking whether your change was saved…';
            try {
              const confirmed = await P.operatingTaskCard(task.id);
              const savedTask = confirmed.task || {};
              const fields = ['title', 'description', 'priority', 'status', 'due_date', 'definition_of_done', 'blocked_reason'];
              const matches = fields.every((key) => (savedTask[key] ?? null) === (payload[key] ?? null))
                && Number(savedTask.owner?.id) === payload.owner_id;
              if (matches) {
                note.textContent = 'Saved. The confirmation response was delayed.';
              } else {
                note.textContent = 'The save could not be confirmed. Refresh the task before retrying.';
              }
            } catch (_) {
              note.textContent = 'The save response timed out. Refresh this task to verify before retrying.';
            }
          } else {
            note.textContent = error?.data?.error || error?.message || 'Save failed.';
          }
        } finally {
          save.disabled = false;
        }
      });
      main.append(form);
      const subtasksPanel = panel('Subtasks');
      const subtasks = el('div', 'task-family__children');
      const descendants = family.children || [];
      if (descendants.length) {
        const progress = el('p', 'task-family__progress',
          descendants.filter(row => row.status === 'done').length + '/' +
          descendants.length + ' subtasks done');
        subtasks.append(progress);
        for (const child of descendants) {
          const row = makeButton(child.title, () => navTask(child.id));
          row.classList.add('task-family__child');
          row.prepend(el('span', 'task-family__child-state', P.label(child.status)));
          row.append(el('span', 'task-family__child-goal',
            (child.definition_of_done || '').slice(0, 90)));
          subtasks.append(row);
        }
        if (family.children_truncated)
          subtasks.append(el('p', 'v-note', 'More subtasks exist. Open the Task Tree to navigate the full hierarchy.'));
      }
      if (detailData.can_edit !== false) {
        const createChild = el('form', 'task-family__new');
        const childTitle = input('text');
        childTitle.required = true;
        childTitle.maxLength = 240;
        childTitle.placeholder = 'New subtask title';
        const childOutcome = textarea('', 2);
        childOutcome.required = true;
        childOutcome.placeholder = 'What must be delivered?';
        const childSubmit = makeButton('Create', () => {}, true);
        childSubmit.type = 'submit';
        const childError = el('p', 'v-note');
        createChild.append(childTitle, childOutcome, childSubmit, childError);
        createChild.addEventListener('submit', async event => {
          event.preventDefault();
          const name = childTitle.value.trim(), outcome = childOutcome.value.trim();
          if (!name || !outcome) { childError.textContent = 'A title and expected outcome are required.'; return; }
          childSubmit.disabled = true;
          childError.textContent = 'Creating subtask…';
          try {
            const created = await P.createOperatingTask({
              title: name,
              definition_of_done: outcome,
              parent_id: task.id,
              priority: task.priority,
              owner_id: task.owner?.id,
              project_id: task.project_id,
              key_result_id: task.trace?.key_result?.id || null,
              due_date: task.due_date,
              status: 'active',
            });
            await reloadBoard({ keepDialog: true });
            navTask(created.task.id);
          } catch (error) {
            childError.textContent = error?.data?.error || error?.message || 'Could not create a subtask.';
            childSubmit.disabled = false;
          }
        });
        const createDisclosure = el('details', 'task-family__create');
        createDisclosure.append(el('summary', null, '+ Add subtask'), createChild);
        subtasks.append(createDisclosure);
      }
      subtasksPanel.body.append(subtasks);
      main.append(subtasksPanel);

      const checklistPanel = el('details', 'task-card-dialog__fold');
      checklistPanel.append(el('summary', null, 'Checklist'));
      checklistPanel.body = el('div', 'task-card-dialog__fold-body');
      checklistPanel.append(checklistPanel.body);
      const optionalTools = el('section', 'task-card-dialog__optional-tools');
      optionalTools.hidden = true;
      optionalTools.append(checklistPanel);
      main.append(optionalTools);
      let checklistLoaded = false;

      const loadChecklist = async () => {
        checklistLoaded = true;
        checklistPanel.body.replaceChildren();
        try {
          const data = await P.operatingTaskChecklist(task.id);
          const items = data.items || [];
          const completed = items.filter((item) => item.is_completed).length;

          const summary = el('div', 'task-checklist__summary');
          summary.append(
            el('strong', null, items.length ? `${completed}/${items.length} complete` : 'No checklist items yet'),
            items.length ? el('span', 'fl-muted', `${Math.round((completed / items.length) * 100)}%`) : el('span'),
          );
          checklistPanel.body.append(summary);

          const list = el('div', 'task-checklist__list');
          for (const item of items) {
            const line = el('div', 'task-checklist__item');
            if (item.is_completed) line.classList.add('is-complete');

            const checkbox = input('checkbox');
            checkbox.checked = !!item.is_completed;
            checkbox.setAttribute('aria-label', `Mark “${item.title}” complete`);

            const itemTitle = input('text', item.title);
            itemTitle.classList.add('task-checklist__title');
            itemTitle.setAttribute('aria-label', 'Checklist item');

            const removeItem = makeButton('Delete', async () => {
              removeItem.disabled = true;
              try {
                await P.deleteOperatingTaskChecklistItem(task.id, item.id);
                await loadChecklist();
                await reloadBoard({ keepDialog: true });
              } catch (error) {
                removeItem.disabled = false;
                alert(error?.data?.error || error?.message || 'Checklist item could not be deleted.');
              }
            });
            removeItem.classList.add('ws-btn--tiny');

            checkbox.addEventListener('change', async () => {
              checkbox.disabled = true;
              itemTitle.disabled = true;
              removeItem.disabled = true;
              try {
                await P.updateOperatingTaskChecklistItem(task.id, item.id, {
                  is_completed: checkbox.checked,
                });
                await loadChecklist();
                await reloadBoard({ keepDialog: true });
              } catch (error) {
                checkbox.checked = !checkbox.checked;
                checkbox.disabled = false;
                itemTitle.disabled = false;
                removeItem.disabled = false;
                alert(error?.data?.error || error?.message || 'Checklist state could not be saved.');
              }
            });

            itemTitle.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                itemTitle.blur();
              }
            });
            itemTitle.addEventListener('change', async () => {
              const nextTitle = itemTitle.value.trim();
              if (!nextTitle) {
                itemTitle.value = item.title;
                return;
              }
              if (nextTitle === item.title) return;
              itemTitle.disabled = true;
              try {
                await P.updateOperatingTaskChecklistItem(task.id, item.id, { title: nextTitle });
                await loadChecklist();
                await reloadBoard({ keepDialog: true });
              } catch (error) {
                itemTitle.value = item.title;
                itemTitle.disabled = false;
                alert(error?.data?.error || error?.message || 'Checklist item could not be saved.');
              }
            });

            line.append(checkbox, itemTitle, removeItem);
            list.append(line);
          }
          checklistPanel.body.append(list);

          const addForm = el('form', 'task-checklist__add');
          const newItem = input('text');
          newItem.placeholder = 'Add a checklist item…';
          newItem.maxLength = 500;
          const addButton = makeButton('Add item', () => {}, true);
          addButton.type = 'submit';
          const addNote = el('p', 'v-note');
          addForm.append(newItem, addButton, addNote);
          addForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const itemTitle = newItem.value.trim();
            if (!itemTitle) return;
            addButton.disabled = true;
            newItem.disabled = true;
            addNote.textContent = 'Adding…';
            try {
              await P.addOperatingTaskChecklistItem(task.id, itemTitle);
              newItem.value = '';
              await loadChecklist();
              await reloadBoard({ keepDialog: true });
            } catch (error) {
              addNote.textContent = error?.data?.error || error?.message || 'Checklist item could not be added.';
              addButton.disabled = false;
              newItem.disabled = false;
            }
          });
          checklistPanel.body.append(addForm);
        } catch (error) {
          checklistPanel.body.replaceChildren(el('p', 'fl-muted', error?.message || 'Checklist unavailable.'), makeButton('Retry checklist', () => { loadChecklist(); }));
        }
      };

      const checklistAction = makeButton('Checklist', () => {
        optionalTools.hidden = !optionalTools.hidden;
        checklistPanel.open = !optionalTools.hidden;
        if (!optionalTools.hidden) {
          moreMenu.open = false;
          if (!checklistLoaded) loadChecklist();
          optionalTools.scrollIntoView({ block: 'nearest' });
        }
      });
      advancedActionItems.prepend(checklistAction);
      const commentsPanel = panel('Comments');
      const attachmentsPanel = panel('Attachments');
      const historyPanel = el('details', 'task-card-dialog__history');
      historyPanel.append(el('summary', null, 'Activity'));
      historyPanel.body = el('div', 'task-card-dialog__history-body');
      historyPanel.append(historyPanel.body);
      commentsPanel.body.append(el('p', 'fl-muted', 'Loading comments…'));
      attachmentsPanel.body.append(el('p', 'fl-muted', 'Loading attachments…'));
      historyPanel.body.append(el('p', 'fl-muted', 'Loading activity…'));
      commentsPanel.classList.add('task-card-dialog__side-section');
      attachmentsPanel.classList.add('task-card-dialog__side-section');
      side.append(commentsPanel, attachmentsPanel, historyPanel);

      const loadComments = async () => {
        commentsPanel.body.innerHTML = '';
        try {
          const data = await P.operatingTaskComments(task.id);
          for (const comment of data.comments || []) {
            const item = el('article', 'task-card-dialog__message');
            item.append(
              el('strong', null, formatActor(comment.author)),
              el('p', null, comment.body),
            );
            if ((comment.mentions || []).length) {
              const mentions = el('div', 'task-comment__mentions');
              for (const person of comment.mentions) {
                mentions.append(el('span', 'v-badge task-comment__mention', '@' + (person.name || person.email)));
              }
              item.append(mentions);
            }
            item.append(el('small', 'fl-muted', P.formatDate(comment.created_at)));
            commentsPanel.body.append(item);
          }
          // An empty comment thread needs no placeholder above the composer.

          const commentForm = el('form', 'task-board__form task-comment__form');
          const comment = textarea('', 3);
          comment.placeholder = 'Comment… @ to mention';
          comment.rows = 2;
          const members = (detailData.members || state.members || []).filter(
            (member) => String(member.id) !== String(P.platform?.user?.user?.id || ''),
          );
          const selectedMentions = new Map();
          const memberLabel = member => member.name || member.email || 'Teammate';
          const mentionSuggestions = el('div', 'task-comment__suggestions');
          mentionSuggestions.id = 'task-mentions-' + task.id;
          mentionSuggestions.setAttribute('role', 'listbox');
          mentionSuggestions.setAttribute('aria-label', 'Mention a teammate');
          mentionSuggestions.hidden = true;
          comment.setAttribute('aria-controls', mentionSuggestions.id);
          comment.setAttribute('aria-autocomplete', 'list');
          let suggestionMembers = [];
          let activeMentionIndex = 0;

          // A selected @name is the only mention sent to the server. Removing
          // the token also removes its user ID, preventing stale notifications.
          const syncMentionIds = () => {
            for (const [id, member] of selectedMentions) {
              if (!comment.value.includes('@' + memberLabel(member)))
                selectedMentions.delete(id);
            }
          };
          const mentionAtCursor = () => {
            const cursor = comment.selectionStart ?? comment.value.length;
            const before = comment.value.slice(0, cursor);
            const match = before.match(/(?:^|\s)@([^\s@\n]*)$/);
            if (!match) return null;
            return { cursor, start: before.lastIndexOf('@'), query: match[1].toLowerCase() };
          };
          const hideSuggestions = () => {
            mentionSuggestions.hidden = true;
            suggestionMembers = [];
            comment.setAttribute('aria-expanded', 'false');
            comment.removeAttribute('aria-activedescendant');
          };
          const pickMention = member => {
            const token = mentionAtCursor();
            if (!token) return;
            const display = memberLabel(member);
            comment.value = comment.value.slice(0, token.start) + '@' + display + ' ' +
              comment.value.slice(token.cursor);
            selectedMentions.set(String(member.id), member);
            const nextCursor = token.start + display.length + 2;
            hideSuggestions();
            comment.focus();
            comment.setSelectionRange(nextCursor, nextCursor);
          };
          const highlightMention = () => {
            for (const [index, option] of [...mentionSuggestions.children].entries()) {
              const active = index === activeMentionIndex;
              option.setAttribute('aria-selected', String(active));
              if (active) {
                comment.setAttribute('aria-activedescendant', option.id);
                option.scrollIntoView({ block: 'nearest' });
              }
            }
          };
          const drawMentionSuggestions = () => {
            syncMentionIds();
            const token = mentionAtCursor();
            if (!token) { hideSuggestions(); return; }
            suggestionMembers = members.filter(member =>
              (memberLabel(member) + ' ' + (member.email || '')).toLowerCase().includes(token.query)
            ).slice(0, 6);
            if (!suggestionMembers.length) { hideSuggestions(); return; }
            mentionSuggestions.replaceChildren();
            activeMentionIndex = 0;
            for (const [index, member] of suggestionMembers.entries()) {
              const option = el('button', 'task-comment__person', memberLabel(member));
              option.type = 'button';
              option.id = mentionSuggestions.id + '-' + index;
              option.setAttribute('role', 'option');
              option.addEventListener('mousedown', event => event.preventDefault());
              option.addEventListener('click', () => pickMention(member));
              mentionSuggestions.append(option);
            }
            mentionSuggestions.hidden = false;
            comment.setAttribute('aria-expanded', 'true');
            highlightMention();
          };
          comment.addEventListener('input', drawMentionSuggestions);
          comment.addEventListener('click', drawMentionSuggestions);
          comment.addEventListener('keydown', event => {
            if (mentionSuggestions.hidden) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              hideSuggestions();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              activeMentionIndex = (activeMentionIndex + (event.key === 'ArrowDown' ? 1 : -1) +
                suggestionMembers.length) % suggestionMembers.length;
              highlightMention();
            } else if (event.key === 'Enter' && suggestionMembers.length) {
              event.preventDefault();
              pickMention(suggestionMembers[activeMentionIndex]);
            }
          });
          const send = makeButton('Comment', () => {}, true);
          send.type = 'submit';
          const commentNote = el('p', 'v-note');
          const composerActions = el('div', 'task-comment__composer-actions');
          composerActions.append(send);
          commentForm.append(
            comment,
            mentionSuggestions,
            composerActions,
            commentNote,
          );
          commentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!comment.value.trim()) return;
            send.disabled = true;
            try {
              syncMentionIds();
              const mentionUserIds = [...selectedMentions.keys()].map((value) => Number(value)).filter(Boolean);
              const result = await P.addOperatingTaskComment(task.id, comment.value.trim(), mentionUserIds);
              // The POST returns the saved comment. Render it immediately,
              // without waiting for another GET and a full project reload.
              const saved = result.comment;
              if (saved) {
                const item = el('article', 'task-card-dialog__message');
                item.append(el('strong', null, formatActor(saved.author)), el('p', null, saved.body));
                if ((saved.mentions || []).length) {
                  const mentions = el('div', 'task-comment__mentions');
                  for (const person of saved.mentions) {
                    mentions.append(el('span', 'v-badge task-comment__mention', '@' + (person.name || person.email)));
                  }
                  item.append(mentions);
                }
                item.append(el('small', 'fl-muted', P.formatDate(saved.created_at)));
                commentsPanel.body.insertBefore(item, commentForm);
              }
              comment.value = '';
              selectedMentions.clear();
              hideSuggestions();
              commentNote.textContent = '';
              send.disabled = false;
            } catch (error) {
              commentNote.textContent = error?.message || 'Comment failed.';
              send.disabled = false;
            }
          });
          commentsPanel.body.append(commentForm);
        } catch (error) {
          commentsPanel.body.replaceChildren(el('p', 'fl-muted', error?.message || 'Comments unavailable.'), makeButton('Retry comments', () => { loadComments(); }));
        }
      };

      const loadAttachments = async () => {
        attachmentsPanel.body.innerHTML = '';
        try {
          const data = await P.operatingTaskAttachments(task.id);
          for (const attachment of data.attachments || []) {
            const line = el('div', 'task-card-dialog__attachment');
            const meta = el('div');
            meta.append(
              el('strong', null, attachment.name),
              el('small', 'fl-muted', P.meta([P.formatBytes(attachment.size), formatActor(attachment.uploader)])),
            );
            const buttons = el('div', 'task-card-dialog__actions');
            const download = el('a', 'ws-btn ws-btn--tiny', 'Download');
            download.href = attachment.download_url;
            const del = makeButton('Delete', async () => {
              if (!confirm(`Delete attachment “${attachment.name}”?`)) return;
              del.disabled = true;
              try {
                await P.deleteOperatingTaskAttachment(task.id, attachment.id);
                await loadAttachments();
                await reloadBoard({ keepDialog: true });
              } catch { del.disabled = false; }
            });
            del.classList.add('ws-btn--tiny');
            buttons.append(download, del);
            line.append(meta, buttons);
            attachmentsPanel.body.append(line);
          }
          // Empty attachments show only the add control.

          const file = input('file');
          file.hidden = true;
          file.setAttribute('aria-label', 'Choose attachment');
          const uploadButton = makeButton('+ Attach file', () => file.click());
          uploadButton.type = 'button';
          uploadButton.title = 'Maximum 10 MB per file';
          uploadButton.classList.add('task-card-dialog__attach-action');
          const uploadNote = el('p', 'v-note');
          file.addEventListener('change', async () => {
            const chosen = file.files?.[0];
            if (!chosen) return;
            if (chosen.size > 10 * 1024 * 1024) {
              uploadNote.textContent = 'Maximum attachment size is 10 MB.';
              file.value = '';
              return;
            }
            uploadButton.disabled = true;
            uploadNote.textContent = 'Uploading…';
            try {
              await P.uploadOperatingTaskAttachment(task.id, chosen);
              file.value = '';
              await loadAttachments();
              await reloadBoard({ keepDialog: true });
            } catch (error) {
              uploadNote.textContent = error?.data?.error || error?.message || 'Upload failed.';
              uploadButton.disabled = false;
              file.value = '';
            }
          });
          attachmentsPanel.body.append(file, uploadButton, uploadNote);
        } catch (error) {
          attachmentsPanel.body.replaceChildren(el('p', 'fl-muted', error?.message || 'Attachments unavailable.'), makeButton('Retry attachments', () => { loadAttachments(); }));
        }
      };

      const loadHistory = async () => {
        historyPanel.body.replaceChildren(el('p', 'fl-muted', 'Loading activity…'));
        try {
          const data = await P.operatingTaskHistory(task.id);
          historyPanel.body.replaceChildren();
          if (sourceRecords.length) historyPanel.body.append(sourceHistory);
          for (const event of data.events || []) {
            const isReport = event.action === 'task.daily_report';
            const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
            const item = el('article', 'task-card-dialog__message');
            item.append(
              el('strong', null, isReport ? 'Pulsar · confirmed daily report' : P.label(event.action.replace(/^task\./, ''))),
              el('small', 'fl-muted', P.meta([formatActor(event.actor), P.formatDate(event.created_at)])),
            );
            if (isReport) {
              const fields = [
                ['Progress', detail.progress],
                ['Status', detail.status],
                ['Deliverable', detail.deliverable],
                ['Next step', detail.next_action],
                ['Blocker', detail.blocker],
              ];
              for (const [name, value] of fields) {
                if (value && String(value).trim() && String(value).trim().toLowerCase() !== 'none') {
                  item.append(el('p', null, `${name}: ${value}`));
                }
              }
              if (detail.artifact_url) {
                try {
                  const url = new URL(detail.artifact_url);
                  if (['https:', 'http:'].includes(url.protocol)) {
                    const link = el('a', 'ws-btn ws-btn--tiny', 'View delivered file ↗');
                    link.href = url.href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    item.append(link);
                  }
                } catch { /* Malformed artifact URLs remain plain report data. */ }
              }
              if (event.report?.original_text) {
                const evidence = el('details', 'task-card-dialog__report');
                evidence.append(el('summary', null, 'Original Telegram message'),
                  el('p', null, event.report.original_text));
                if (event.report.unmatched_work) {
                  evidence.append(el('p', 'fl-muted',
                    `Unmatched work (no additional task change): ${event.report.unmatched_work}`));
                }
                item.append(evidence);
              }
            }
            historyPanel.body.append(item);
          }
          if (!(data.events || []).length) historyPanel.body.append(el('p', 'fl-muted', 'No board activity logged yet.'));
        } catch (error) {
          historyPanel.body.replaceChildren();
          // An unavailable audit feed must not hide the persisted imported
          // provenance attached to this task.
          if (sourceRecords.length) historyPanel.body.append(sourceHistory);
          historyPanel.body.append(
            el('p', 'fl-muted', error?.message || 'Activity unavailable.'),
            makeButton('Retry activity', () => { loadHistory(); }),
          );
        }
      };

      // Optional side panels must never keep the editor's open promise pending.
      // Activity is often the heaviest request; load only after expansion.
      let activityRequested = false;
      historyPanel.addEventListener('toggle', () => {
        if (historyPanel.open && !activityRequested) {
          activityRequested = true;
          void loadHistory();
        }
      });
      // Comments are immediately visible. Files and links are lower down the
      // card: fetch them when the corresponding section comes into view instead
      // of opening three extra connections for every task click.
      void loadComments();
      const observeOptionalSection = (element, loadOptional) => {
        let requested = false;
        const start = () => {
          if (requested || !dialog.isConnected) return;
          requested = true;
          void loadOptional();
        };
        element.addEventListener('focusin', start, { once: true });
        element.addEventListener('pointerdown', start, { once: true });
        if (typeof IntersectionObserver === 'function') {
          const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
              observer.disconnect();
              start();
            }
          }, { root: dialog.querySelector('.task-card-dialog__frame'), rootMargin: '80px' });
          observer.observe(element);
        } else {
          // Older browsers still get functioning links/attachments.
          start();
        }
      };
      observeOptionalSection(resourceSection, loadExternalLinks);
      observeOptionalSection(attachmentsPanel.box || attachmentsPanel, loadAttachments);
    } catch (error) {
      editorFailed = true;
      if (previewLoaded) {
        const alert = el('div', 'ws-alert');
        alert.append(
          el('strong', null, 'Full editor unavailable'),
          el('p', null, error?.message || 'Could not load the editor.'),
          makeButton('Retry full editor', () => {
            closeDialog(dialog);
            openTaskDialog(taskId, state, reloadBoard);
          }),
        );
        body.prepend(alert);
        return;
      }
      body.innerHTML = '';
      if (detailForFallback && typeof detailForFallback === 'object') {
        // The backend returned the task. A problem in an optional editor
        // component must never make the authorized task itself disappear.
        console.error('Research/Core task-card renderer failed', error);
        const basic = el('section', 'task-card-dialog__main');
        basic.append(
          el('p', 'ws-alert__title', 'Some task details could not be displayed'),
          el('p', 'fl-muted', 'The saved task is available below. The editor did not finish loading; no changes were made.'),
          el('h3', '', detailForFallback.title || 'Task'),
          el('p', '', detailForFallback.description || 'No description.'),
          el('p', 'fl-muted', 'Status: ' + P.label(detailForFallback.status || 'unknown')),
          el('p', '', 'Definition of done: ' + (detailForFallback.definition_of_done || 'Not set')),
        );
        basic.append(makeButton('Try again', () => {
          closeDialog(dialog);
          openTaskDialog(taskId, () => P.operatingTaskDependencies(), reloadBoard);
        }));
        body.append(basic);
      } else {
        body.append(failure('task card', error, () => {
          closeDialog(dialog);
          openTaskDialog(taskId, () => P.operatingTaskDependencies(), reloadBoard);
        }));
      }
    }
  }

  async function openCreateDialog(state, reloadBoard) {
    const { dialog, body } = makeDialog('New task');
    const form = el('form', 'task-board__form');
    const title = input('text');
    title.placeholder = 'Task title';
    const description = textarea('', 4);
    const owner = select(optionRows(state.members, 'Choose owner', 'name'), state.members?.[0]?.id || '');
    const keyResult = select([
      ['', 'Choose key result'],
      ...(state.key_results || []).map((item) => [
        item.id,
        (item.objective_title ? item.objective_title + ' · ' : '') + item.title,
      ]),
    ]);
    const priority = select((state.priorities || []).map((item) => [item.value, item.label]), 'p2');
    const status = select((state.statuses || []).map((item) => [item.value, item.label]), 'draft');
    const due = input('date');
    const done = textarea('', 3);
    done.placeholder = 'What has to be true for this task to be done?';
    const note = el('p', 'v-note');
    const create = makeButton('Create task', () => {}, true);
    create.type = 'submit';

    const two = el('div', 'task-board__two');
    two.append(field('Owner', owner), field('Key result (optional)', keyResult), field('Priority', priority), field('Status', status), field('Due date', due));
    form.append(field('Title', title), field('Description', description), two, field('Definition of done', done), create, note);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim() || !owner.value || !done.value.trim()) {
        note.textContent = 'Title, owner and definition of done are required.';
        return;
      }
      if (!due.value) {
        note.textContent = 'Choose a due date.';
        return;
      }
      create.disabled = true;
      note.textContent = 'Creating…';
      try {
        const result = await P.createOperatingTask({
          title: title.value.trim(),
          description: description.value.trim(),
          owner_id: Number(owner.value),
          ...(keyResult.value ? { key_result_id: Number(keyResult.value) } : {}),
          priority: priority.value,
          status: status.value,
          due_date: due.value,
          definition_of_done: done.value.trim(),
        });
        closeDialog(dialog);
        await reloadBoard();
        if (result.task?.id) openTaskDialog(result.task.id, state, reloadBoard);
      } catch (error) {
        note.textContent = error?.data?.error || error?.message || 'Task could not be created.';
        create.disabled = false;
      }
    });
    body.append(form);
  }

  /* A direct task from the dock, Projects or a notification already fetches
     its metadata in task_board_detail. Fetch only the tiny dependency index
     instead of loading all card bodies, comments and board counts. */
  if (openTaskId) {
    return openTaskDialog(openTaskId, () => P.operatingTaskDependencies(), async () => { await onTaskChange?.(); });
  }

  return guard(holder, 'Core tasks', async () => {
    let state = null;
    // The board opens on the reader's own work as cards; owner stays null
    // until the member list arrives, so a reader who is not a member of this
    // workspace falls back to everyone rather than to an empty board.
    let filters = { q: '', owner: null, priority: '', sort: 'manual', view: 'board' };
    let deepLinkedTaskOpened = false;
    let applyLocalMutation = null;
    // Deep-link cards are independent of the full, potentially large board.
    // Open the requested card immediately instead of waiting for board GET,
    // filters, Nextcloud Deck widgets and all board rendering to finish.
    const deepLinkParams = new URLSearchParams(location.search);
    const deepLinkTaskId = Number(deepLinkParams.get('task') || deepLinkParams.get('calendar_task') || 0);
    if (Number.isSafeInteger(deepLinkTaskId) && deepLinkTaskId > 0) {
      deepLinkedTaskOpened = true;
      // Start the card's detail GET *before* the large board GET starts.
      // Its refresh callback runs only after the board loader is initialized.
      const linkedBoardRefresh = (options = {}) => load({ ...options, keepDialog: true });
      linkedBoardRefresh.applyMutation = mutation => applyLocalMutation?.(mutation);
      void openTaskDialog(deepLinkTaskId, () => P.operatingTaskDependencies(),
        linkedBoardRefresh)
        .catch(error => console.error('Could not open linked task', error));
    }

    const load = async ({ keepDialog = false } = {}) => {
      const data = await P.operatingTaskBoard();
      state = data;
      if (filters.owner === null) {
        const me = P.platform.user?.user || P.platform.user;
        const mine = me?.id != null && (data.members || []).some((member) => String(member.id) === String(me.id));
        filters.owner = mine ? String(me.id) : '';
      }
      holder._taskBoardResizeObserver?.disconnect?.();
      holder.innerHTML = '';

      const openTasks = data.tasks.filter((task) => !['done', 'archived'].includes(task.status)).length;
      holder.append(stats([
        ['Open tasks', openTasks],
        ['Backlog', data.tasks.filter((task) => task.status === 'draft').length],
        ['Blocked', data.tasks.filter((task) => task.status === 'blocked').length],
        ['Done', data.tasks.filter((task) => task.status === 'done').length],
      ]));

      if (!data.tasks.length) {
        const note = el('div', 'v-note');
        note.append(
          el('strong', null, 'No tasks yet.'),
          document.createTextNode(' Start clean and create tasks independently or connect them to a Key Result or project later.'),
        );
        holder.append(note);
      }

      const toolbar = el('div', 'v-toolbar task-board__toolbar');
      const search = input('search', filters.q);
      search.placeholder = 'Search tasks, owner, KR, milestone or project';
      search.setAttribute('aria-label', 'Search tasks');
      const ownerFilter = select([['', 'All owners'], ...(data.members || []).map((member) => [member.id, member.name || member.email])], filters.owner);
      const priorityFilter = select([['', 'All priorities'], ...(data.priorities || []).map((item) => [item.value, item.label])], filters.priority);
      const sortFilter = select([
        ['manual', 'Manual order'],
        ['due_asc', 'Due date · soonest'],
        ['due_desc', 'Due date · latest'],
        ['created_desc', 'Created · newest'],
        ['created_asc', 'Created · oldest'],
      ], filters.sort);
      sortFilter.setAttribute('aria-label', 'Sort tasks');
      // Three views are a choice the reader switches between, not a filter,
      // so they read as a segmented control. It keeps a select's contract —
      // `.value` and a `change` event — so draw() reads it like the others.
      const viewFilter = el('div', 'task-view-switch');
      viewFilter.setAttribute('role', 'group');
      viewFilter.setAttribute('aria-label', 'Task view');
      viewFilter.value = filters.view || 'board';
      for (const [value, text] of [['tree', 'Tree'], ['board', 'Board'], ['week', 'Week'], ['timeline', 'Timeline'], ['graph', 'Graph']]) {
        const option = el('button', 'task-view-switch__option', text);
        option.type = 'button';
        option.dataset.view = value;
        option.setAttribute('aria-pressed', String(viewFilter.value === value));
        option.addEventListener('click', () => {
          if (viewFilter.value === value) return;
          viewFilter.value = value;
          for (const other of viewFilter.children) other.setAttribute('aria-pressed', String(other.dataset.view === value));
          viewFilter.dispatchEvent(new Event('change'));
        });
        viewFilter.append(option);
      }
      const count = el('span', 'v-toolbar__count');
      ownerFilter.setAttribute('aria-label', 'Filter by owner');
      priorityFilter.setAttribute('aria-label', 'Filter by priority');
      toolbar.append(viewFilter, search, ownerFilter, priorityFilter, sortFilter, count);

      /* Creating a task is the page's one primary action, so it sits in the
         page head beside the title, where every other workspace screen keeps
         its primary action, rather than at the tail of the filter row where
         it wrapped onto a line of its own. Notifications are not repeated
         here: the dock already carries them on every screen. */
      head.querySelector('.task-board__new')?.remove();
      const add = makeButton('New task', () => openCreateDialog(state, load), true);
      add.classList.add('task-board__new');
      add.title = 'Create a task; linking to a Key Result is optional';
      add.disabled = !data.can_edit;
      head.append(add);

      const topScroll = el('div', 'task-board__top-scroll');
      topScroll.setAttribute('aria-label', 'Horizontal task board scroll');
      const topScrollTrack = el('div', 'task-board__top-scroll-track');
      topScroll.append(topScrollTrack);

      const stickyControls = el('div', 'task-board__sticky-controls');
      stickyControls.append(toolbar, topScroll);
      holder.append(stickyControls);

      const board = el('div', 'task-board__surface');
      board.tabIndex = 0;
      board.setAttribute('role', 'group');
      board.setAttribute('aria-label', 'Core tasks');
      holder.append(board);

      const syncTopScroll = () => {
        topScrollTrack.style.width = `${Math.max(board.scrollWidth, board.clientWidth)}px`;
        topScroll.hidden = filters.view !== 'board' || board.scrollWidth <= board.clientWidth + 1;
        if (topScroll.scrollLeft !== board.scrollLeft) topScroll.scrollLeft = board.scrollLeft;
      };
      topScroll.addEventListener('scroll', () => {
        if (board.scrollLeft !== topScroll.scrollLeft) board.scrollLeft = topScroll.scrollLeft;
      }, { passive: true });
      board.addEventListener('scroll', () => {
        if (topScroll.scrollLeft !== board.scrollLeft) topScroll.scrollLeft = board.scrollLeft;
      }, { passive: true });
      if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(syncTopScroll);
        resizeObserver.observe(board);
        holder._taskBoardResizeObserver = resizeObserver;
      }

      const draw = () => {
        filters = {
          q: search.value.trim(),
          owner: ownerFilter.value,
          priority: priorityFilter.value,
          sort: sortFilter.value,
          view: viewFilter.value,
        };
        const q = filters.q.toLowerCase();
        const visible = data.tasks.filter((task) => {
          if (filters.owner && String(task.owner?.id) !== filters.owner) return false;
          if (filters.priority && task.priority !== filters.priority) return false;
          if (q && !taskSearchText(task).includes(q)) return false;
          return true;
        });
        count.textContent = `${visible.length} of ${data.tasks.length}`;
        board.innerHTML = '';
        holder.querySelector('.task-board-view-note')?.remove();
        board.className = filters.view === 'board'
          ? 'task-board__surface task-trello-board'
          : filters.view === 'graph'
            ? 'task-board__surface task-board__surface--graph'
            : 'task-board__surface task-board__surface--tree';

        const openCard = (id) => openTaskDialog(id, state, load);
        const openHierarchy = (kind, id) => openTaskHierarchyDialog(kind, id, state, load);
        if (filters.view === 'tree') {
          renderTaskTree(board, visible, openCard, openHierarchy);
          syncTopScroll();
          return;
        }
        if (filters.view === 'graph') {
          renderTaskGraph(board, visible, openCard, openHierarchy);
          syncTopScroll();
          return;
        }
        if (filters.view === 'week' || filters.view === 'timeline') {
          const dueTasks = [...visible].sort((left, right) =>
            String(left.due_date || '9999').localeCompare(String(right.due_date || '9999'))
            || left.id - right.id);
          const localIso = date => [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
          ].join('-');
          const buckets = [];
          if (filters.view === 'week') {
            const first = new Date();
            first.setHours(12, 0, 0, 0);
            first.setDate(first.getDate() - (first.getDay() + 6) % 7);
            for (let day = 0; day < 7; day += 1) {
              const date = new Date(first);
              date.setDate(first.getDate() + day);
              const key = localIso(date);
              buckets.push({
                key, label: date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
                tasks: dueTasks.filter(task => task.due_date === key),
              });
            }
            const thisWeek = new Set(buckets.map(bucket => bucket.key));
            buckets.unshift({
              key: 'overdue', label: 'Earlier deadlines',
              tasks: dueTasks.filter(task => task.due_date && task.due_date < buckets[0].key),
            });
            buckets.push({
              key: 'outside', label: 'Later or unscheduled',
              tasks: dueTasks.filter(task => !task.due_date || (!thisWeek.has(task.due_date) && task.due_date >= buckets[1].key)),
            });
          } else {
            const byDate = new Map();
            for (const task of dueTasks) {
              const key = task.due_date || 'undated';
              if (!byDate.has(key)) byDate.set(key, []);
              byDate.get(key).push(task);
            }
            for (const [key, tasks] of byDate) {
              buckets.push({ key, label: key === 'undated' ? 'Without due date' : key, tasks });
            }
          }
          board.className = filters.view === 'week'
            ? 'task-board__surface task-trello-board' : 'task-board__surface task-board__surface--tree';
          for (const bucket of buckets) {
            const column = el('section', 'task-trello-column');
            const header = el('div', 'task-trello-column__head');
            header.append(el('strong', null, bucket.label), el('span', 'v-column__count', String(bucket.tasks.length)));
            const items = el('div', 'task-trello-column__body');
            if (!bucket.tasks.length) items.append(el('p', 'fl-muted', 'No tasks'));
            for (const task of bucket.tasks) items.append(taskCard(task, openCard, { draggable: false }));
            column.append(header, items);
            board.append(column);
          }
          const note = el('p', 'fl-muted task-board-view-note', 'These Core views group the same tasks by due date. Project-specific Gantt start/end plans remain in the linked project Command center.');
          holder.insertBefore(note, board);
          window.requestAnimationFrame(syncTopScroll);
          return;
        }

        for (const [statusValue, statusLabel] of STATUS_COLUMNS) {
          const column = el('section', 'task-trello-column');
          column.dataset.status = statusValue;
          const matches = visible.filter((task) => task.status === statusValue)
            .sort((a, b) => {
              if (filters.sort === 'due_asc' || filters.sort === 'due_desc') {
                const aMissing = !a.due_date;
                const bMissing = !b.due_date;
                if (aMissing !== bMissing) return aMissing ? 1 : -1;
                const diff = String(a.due_date || '').localeCompare(String(b.due_date || ''));
                if (diff) return filters.sort === 'due_desc' ? -diff : diff;
              } else if (filters.sort === 'created_desc' || filters.sort === 'created_asc') {
                const diff = String(a.created_at || '').localeCompare(String(b.created_at || ''));
                if (diff) return filters.sort === 'created_desc' ? -diff : diff;
              }
              return (a.board_order || 0) - (b.board_order || 0) || a.id - b.id;
            });
          const head = el('div', 'task-trello-column__head');
          head.append(el('strong', null, statusLabel), el('span', 'v-column__count', String(matches.length)));
          const body = el('div', 'task-trello-column__body');
          body.dataset.status = statusValue;
          if (!matches.length) body.append(el('div', 'v-column__empty task-trello-column__empty'));
          for (const task of matches) body.append(taskCard(task, (id) => openTaskDialog(id, state, load), { draggable: data.can_edit && filters.sort === 'manual' }));

          body.addEventListener('dragover', (event) => {
            if (!data.can_edit || filters.sort !== 'manual') return;
            event.preventDefault();
            body.classList.add('is-over');
            const id = Number(event.dataTransfer.getData('text/plain'));
            const dragged = board.querySelector(`.task-trello-card[data-task-id="${id}"]`);
            if (!dragged) return;
            const before = getDropBefore(body, event.clientY);
            if (before) body.insertBefore(dragged, before);
            else body.append(dragged);
          });
          body.addEventListener('dragleave', (event) => {
            if (!body.contains(event.relatedTarget)) body.classList.remove('is-over');
          });
          body.addEventListener('drop', async (event) => {
            if (!data.can_edit || filters.sort !== 'manual') return;
            event.preventDefault();
            body.classList.remove('is-over');
            const taskId = Number(event.dataTransfer.getData('text/plain'));
            if (!taskId) return;
            const orderedIds = [...body.querySelectorAll('.task-trello-card')].map((node) => Number(node.dataset.taskId));
            try {
              await P.moveOperatingTask(taskId, statusValue, orderedIds);
              await load();
            } catch (error) {
              alert(error?.data?.error || error?.message || 'Task could not be moved.');
              await load();
            }
          });
          column.append(head, body);
          board.append(column);
        }
        window.requestAnimationFrame(syncTopScroll);
      };

      // Building nine columns and hundreds of cards on each keystroke makes
      // the search field look frozen. Coalesce rapid typing into one redraw.
      let searchTimer = null;
      search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchTimer = null;
          if (toolbar.isConnected) draw();
        }, 120);
      });
      ownerFilter.addEventListener('change', draw);
      priorityFilter.addEventListener('change', draw);
      sortFilter.addEventListener('change', draw);
      viewFilter.addEventListener('change', draw);
      draw();

      // The board data/renderer are already in memory. Apply one task's
      // change instantly and return an undo function if the API rejects it.
      const updateCounters = () => {
        const counters = holder.querySelectorAll('.v-stat__value');
        const tasks = data.tasks;
        [tasks.filter(t => !['done', 'archived'].includes(t.status)).length,
         tasks.filter(t => t.status === 'draft').length,
         tasks.filter(t => t.status === 'blocked').length,
         tasks.filter(t => t.status === 'done').length]
          .forEach((value, i) => { if (counters[i]) counters[i].textContent = String(value); });
      };
      applyLocalMutation = ({ type, id, patch = {} }) => {
        const index = data.tasks.findIndex(task => Number(task.id) === Number(id));
        if (index < 0) return null;
        const previous = data.tasks[index];
        if (type === 'delete') data.tasks.splice(index, 1);
        else if (type === 'update') data.tasks[index] = { ...previous, ...patch };
        else return null;
        updateCounters();
        draw();
        return () => {
          // Do not overwrite a newer board snapshot if navigation occurred.
          if (state !== data) return;
          if (type === 'delete' && !data.tasks.some(task => Number(task.id) === Number(id))) {
            data.tasks.splice(Math.min(index, data.tasks.length), 0, previous);
          } else if (type === 'update') {
            const current = data.tasks.findIndex(task => Number(task.id) === Number(id));
            if (current >= 0) data.tasks[current] = previous;
          }
          updateCounters();
          draw();
        };
      };
      load.applyMutation = mutation => applyLocalMutation?.(mutation);

      if (!deepLinkedTaskOpened) {
        deepLinkedTaskOpened = true;
        const params = new URLSearchParams(location.search);
        const taskToOpen = Number(params.get('task') || params.get('calendar_task') || 0);
        if (taskToOpen && data.tasks.some((row) => row.id === taskToOpen)) {
          window.setTimeout(() => openTaskDialog(taskToOpen, state, load), 0);
        }
        if (params.has('calendar_task') || params.has('calendar_connected') || params.has('calendar_error')) {
          params.delete('calendar_task');
          params.delete('calendar_connected');
          params.delete('calendar_error');
          const query = params.toString();
          history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
        }
      }
    };

    await load();
  });
}

export function renderCorePlanning(host, { go, showArchived = false }) {
  const doc = docShell(host, 'Planning', 'Objectives, measurable Key Results, linked work and schedule.');
  const holder = el('div', 'planning-compact');
  doc.append(holder);
  skeleton(4, holder);

  // Scope these layout rules to Planning: on mobile the four counters must
  // remain compact rather than becoming four full-height single-column cards.
  if (!document.getElementById('planning-compact-styles')) {
    const style = el('style');
    style.id = 'planning-compact-styles';
    style.textContent = '.planning-compact .v-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.planning-compact .v-stat{min-width:0;min-height:88px;padding:14px}.planning-compact .v-stat__value{font-size:clamp(22px,5vw,32px);line-height:1.15}.planning-compact .v-panel__head{flex-wrap:wrap;gap:12px}.planning-compact .v-row__actions{display:flex;gap:6px;flex-wrap:wrap}.planning-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.planning-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px;padding:14px;margin:10px 0;border:1px solid var(--fl-border,var(--line,#445));border-radius:12px}.planning-field{display:grid;gap:4px;min-width:0;font-size:13px}.planning-field input,.planning-field select,.planning-field textarea{width:100%;min-width:0;min-height:38px;padding:8px;border:1px solid var(--fl-border,var(--line,#445));border-radius:8px;background:var(--ws-bg,var(--fl-surface,#061d2a));color:inherit;font:inherit}.planning-field textarea{min-height:72px}.planning-form__actions{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.planning-form__error{font-size:13px;color:var(--danger,#ff9b96)}.planning-meta{font-size:12px;opacity:.84;line-height:1.5}.planning-objective-title{overflow-wrap:anywhere}@media(max-width:500px){.planning-compact .okr-objective{padding:0}.planning-compact .v-panel__body{padding:12px}.planning-compact .v-panel__head{padding:12px}.planning-compact .v-row{gap:10px}}';
    document.head.append(style);
  }

  const miniButton = (labelText, handler, solid = false) => {
    const button = el('button', solid ? 'ws-btn ws-btn--solid ws-btn--tiny' : 'ws-btn ws-btn--tiny', labelText);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  };
  const actionStrip = (...nodes) => {
    const strip = el('div', 'planning-actions');
    strip.append(...nodes.filter(Boolean));
    return strip;
  };
  const progressBar = value => {
    const wrap = el('div', 'okr-progress');
    const bar = el('i');
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    bar.style.width = safe + '%';
    wrap.append(bar);
    wrap.title = 'Actual ' + safe + '%';
    return wrap;
  };
  const currentUserId = () => P.platform?.user?.user?.id || null;
  const healthOptions = [['green','Green'],['yellow','Yellow'],['red','Red']];
  const statusOptions = [['draft','Draft'],['active','Active'],['ready','Ready'],['waiting','Waiting'],['needs_review','Needs review'],['retest','Retest'],['blocked','Blocked'],['done','Done'],['archived','Archived']];
  const taskCaption = row => {
    const t = row.tasks || {};
    return (t.total || 0) + ' tasks · ' + (t.open || 0) + ' open · ' + (t.done || 0) + ' done' + (t.overdue ? ' · ' + t.overdue + ' overdue (oldest ' + (t.oldest_overdue_days || 0) + 'd)' : '');
  };
  const scheduleCaption = item => {
    if (item.schedule === 'behind') return 'Behind ≈ ' + Math.abs(item.estimated_days_offset || 0) + 'd · ' + Math.abs(item.variance_points || 0) + ' points';
    if (item.schedule === 'ahead') return 'Ahead ≈ ' + Math.abs(item.estimated_days_offset || 0) + 'd · +' + item.variance_points + ' points';
    if (item.schedule === 'on_track') return 'On track · ' + item.variance_points + ' points';
    if (item.schedule === 'unmeasured') return 'Progress not measurable' + (item.tasks?.oldest_overdue_days ? ' · oldest task ' + item.tasks.oldest_overdue_days + 'd overdue' : '');
    if (item.schedule === 'invalid_dates') return 'Check start and due dates';
    return 'Schedule not set';
  };
  const progressCaption = item => item.progress == null
    ? 'No measured progress' : 'Actual ' + item.progress + '% · Planned ' + (item.expected_progress == null ? '—' : item.expected_progress + '%');

  // A real inline form (including native date and numeric validation) avoids
  // prompt stacks and makes editing practical on Android and other mobiles.
  const showForm = (slot, fields, save, afterCancel) => {
    slot.replaceChildren();
    const form = el('form', 'planning-form');
    const controls = {};
    for (const field of fields) {
      const label = el('label', 'planning-field');
      label.append(el('span', null, field.label));
      const input = el(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
      if (input.tagName === 'INPUT') input.type = field.type || 'text';
      if (field.required) input.required = true;
      if (field.step) input.step = field.step;
      if (field.options) {
        for (const [value, text] of field.options) {
          const option = el('option', null, text);
          option.value = String(value);
          input.append(option);
        }
      }
      input.value = field.value == null ? '' : String(field.value);
      controls[field.name] = input;
      label.append(input);
      form.append(label);
    }
    const buttons = el('div', 'planning-form__actions');
    const submit = el('button', 'ws-btn ws-btn--solid ws-btn--tiny', 'Save');
    submit.type = 'submit';
    const cancel = miniButton('Cancel', () => {
      slot.replaceChildren();
      afterCancel?.();
    });
    const errorMessage = el('span', 'planning-form__error');
    errorMessage.setAttribute('role', 'alert');
    buttons.append(submit, cancel, errorMessage);
    form.append(buttons);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = {};
      for (const field of fields) {
        const raw = controls[field.name].value.trim();
        values[field.name] = (!raw && ['date','number'].includes(field.type)) ? null : raw;
      }
      submit.disabled = true;
      errorMessage.textContent = '';
      try {
        await save(values);
      } catch (error) {
        errorMessage.textContent = error?.data?.error || error?.message || 'Could not save. Please try again.';
        submit.disabled = false;
      }
    });
    slot.append(form);
    controls[fields[0]?.name]?.focus();
  };
  const objectiveFields = obj => [
    {name:'title',label:'Objective',value:obj?.title || '',required:true},
    {name:'description',label:'Description',type:'textarea',value:obj?.description || ''},
    {name:'quarter',label:'Period',value:obj?.quarter || ''},
    {name:'start_date',label:'Start date',type:'date',value:obj?.start_date || ''},
    {name:'due_date',label:'Due date',type:'date',value:obj?.due_date || ''},
    {name:'health',label:'Health',type:'select',options:healthOptions,value:obj?.health || 'green'},
    {name:'status',label:'Status',type:'select',options:statusOptions,value:obj?.status || 'active'},
  ];
  const krFields = (kr, objectives) => [
    {name:'title',label:'Key Result',value:kr?.title || '',required:true},
    {name:'objective_id',label:'Under objective',type:'select',options:objectives.map(o => [o.id,o.title]),value:kr?.objective_id || objectives[0]?.id},
    {name:'metric_name',label:'Metric',value:kr?.metric_name || ''},
    {name:'unit',label:'Unit',value:kr?.unit || ''},
    {name:'baseline_value',label:'Baseline',type:'number',step:'any',value:kr?.baseline_value ?? '0'},
    {name:'target_value',label:'Target',type:'number',step:'any',value:kr?.target_value},
    {name:'current_value',label:'Current',type:'number',step:'any',value:kr?.current_value},
    {name:'due_date',label:'Due date',type:'date',value:kr?.due_date || ''},
    {name:'health',label:'Health',type:'select',options:healthOptions,value:kr?.health || 'green'},
    {name:'status',label:'Status',type:'select',options:statusOptions,value:kr?.status || 'active'},
  ];

  return guard(holder, 'planning', async () => {
    const board = await P.operatingDashboard();
    holder.replaceChildren();
    const planning = board.planning || { objectives: [], key_results: [], milestones: [], counts: {} };
    const counts = planning.counts || {};
    const objectives = (planning.objectives || []).filter(obj => showArchived || obj.status !== 'archived');
    const refresh = () => renderCorePlanning(host, { go, showArchived });
    holder.append(stats([
      ['Objectives', counts.objectives || 0],
      ['Key Results', counts.key_results || 0],
      ['Open milestones', counts.milestones_open || 0],
      ['Open tasks', board.counts?.tasks || 0],
    ]));
    const toolbar = el('div', 'v-toolbar');
    const createSlot = el('div');
    toolbar.append(
      miniButton('New objective', () => showForm(createSlot, objectiveFields(), values => P.createOperatingObjective({
        ...values, owner_id: currentUserId() || board.members?.[0]?.id,
      }).then(refresh)), true),
      miniButton('Open task board', () => go('/workspace/core/tasks')),
      miniButton(showArchived ? 'Hide archived' : 'Show archived (' + (counts.archived_objectives || 0) + ')',
        () => renderCorePlanning(host, { go, showArchived: !showArchived })),
    );
    holder.append(toolbar, createSlot);
    if (counts.unlinked_tasks) holder.append(el('p', 'planning-meta', counts.unlinked_tasks + ' tasks have no KR link and cannot be included in these totals.'));

    const moveOrder = (items, index, direction, update) => async () => {
      const sibling = items[index + direction];
      if (!sibling) return;
      // Gapped integer positions permit one safe PATCH without a multi-request
      // swap. Existing positions were backfilled in increments of 100.
      const order = Math.max(0, Math.min(1000000000, Number(sibling.sort_order) + (direction < 0 ? -1 : 1)));
      try { await update(items[index].id, { sort_order: order }); refresh(); }
      catch (error) { alert(error?.data?.error || error?.message || 'Could not reorder.'); }
    };

    const objectivePanel = panel('OKRs');
    for (const [objectiveIndex, objective] of objectives.entries()) {
      const objectiveBox = el('section', 'v-panel okr-objective');
      const head = el('div', 'v-panel__head');
      const heading = el('div');
      heading.append(
        el('h3', 'planning-objective-title', objective.title),
        el('small', 'fl-muted', P.meta([
          objective.owner?.name || objective.owner?.email,
          P.formatDate(objective.due_date),
          P.label(objective.health), P.label(objective.status),
        ])),
        el('div', 'planning-meta', taskCaption(objective) + ' · ' + progressCaption(objective)),
        el('div', 'planning-meta', scheduleCaption(objective)),
      );
      if (objective.progress != null) heading.append(progressBar(objective.progress));
      const editor = el('div');
      const edit = miniButton('Edit', () => showForm(editor, objectiveFields(objective), values => P.updateOperatingObjective(objective.id, values).then(refresh)));
      const addKr = miniButton('Add KR', () => showForm(editor, krFields({objective_id:objective.id}, objectives), values => P.createOperatingKeyResult({
        ...values, owner_id: objective.owner?.id || currentUserId(),
      }).then(refresh)), true);
      const archiveOrDelete = miniButton(objective.status === 'archived' ? 'Restore' :
        ((objective.key_result_count || objective.key_results?.length) ? 'Archive' : 'Delete'), async () => {
        const containsKrs = !!(objective.key_result_count || objective.key_results?.length);
        if (objective.status === 'archived') {
          try { await P.updateOperatingObjective(objective.id, { status: 'active' }); refresh(); }
          catch (error) { alert(error?.data?.error || error?.message || 'Could not restore Objective.'); }
          return;
        }
        if (!confirm(containsKrs ? 'Archive this Objective? Existing KRs, tasks and history remain unchanged.' :
          'Delete this empty Objective permanently?')) return;
        try {
          if (containsKrs) await P.updateOperatingObjective(objective.id, { status: 'archived' });
          else await P.deleteOperatingObjective(objective.id);
          refresh();
        } catch (error) { alert(error?.data?.error || error?.message || 'Operation failed.'); }
      });
      head.append(heading, actionStrip(
        miniButton('↑', moveOrder(objectives, objectiveIndex, -1, P.updateOperatingObjective)),
        miniButton('↓', moveOrder(objectives, objectiveIndex, 1, P.updateOperatingObjective)),
        edit, addKr, archiveOrDelete,
      ));
      objectiveBox.append(head, editor);
      const body = el('div', 'v-panel__body');
      const keyResults = (objective.key_results || []).filter(kr => showArchived || kr.status !== 'archived');
      for (const [krIndex, kr] of keyResults.entries()) {
        const krEditor = el('div');
        const editKr = miniButton('Edit', () => showForm(krEditor, krFields(kr, objectives), values => P.updateOperatingKeyResult(kr.id, {
          ...values, objective_id: Number(values.objective_id),
        }).then(refresh)));
        const archiveKr = miniButton(kr.status === 'archived' ? 'Restore' :
          ((kr.tasks?.total || 0) ? 'Archive' : 'Delete'), async () => {
          if (kr.status === 'archived') {
            try { await P.updateOperatingKeyResult(kr.id, { status: 'active' }); refresh(); }
            catch (error) { alert(error?.data?.error || error?.message || 'Could not restore Key Result.'); }
            return;
          }
          if (!confirm((kr.tasks?.total || 0) ? 'Archive this KR? All linked tasks and history stay intact.' :
            'Delete this KR? It must have no linked initiatives or tasks.')) return;
          try {
            if (kr.tasks?.total) await P.updateOperatingKeyResult(kr.id, {status:'archived'});
            else await P.deleteOperatingKeyResult(kr.id);
            refresh();
          } catch (error) {
            if (error?.status === 409 && confirm('This KR still has linked work. Archive it instead?')) {
              try { await P.updateOperatingKeyResult(kr.id, {status:'archived'}); refresh(); }
              catch (next) { alert(next?.message || 'Could not archive.'); }
            } else alert(error?.data?.error || error?.message || 'Could not delete KR.');
          }
        });
        const addMilestone = miniButton('Add milestone', async () => {
          const title = prompt('Milestone title:');
          if (!title?.trim()) return;
          const dueDate = prompt('Due date (YYYY-MM-DD):', kr.due_date || objective.due_date || '');
          if (!dueDate?.trim()) return;
          try {
            await P.createOperatingMilestone({
              key_result_id: kr.id, owner_id: kr.owner?.id || objective.owner?.id || currentUserId(),
              title: title.trim(), due_date: dueDate.trim(), health: 'green', status: 'active',
            });
            refresh();
          } catch (error) { alert(error?.data?.error || error?.message || 'Milestone could not be created.'); }
        }, true);
        const krRow = row({
          title: kr.title,
          sub: P.meta([kr.owner?.name || kr.owner?.email, P.formatDate(kr.due_date), taskCaption(kr)]),
          badges: [P.label(kr.health), P.label(kr.status), scheduleCaption(kr)],
          action: actionStrip(
            miniButton('↑', moveOrder(keyResults, krIndex, -1, P.updateOperatingKeyResult)),
            miniButton('↓', moveOrder(keyResults, krIndex, 1, P.updateOperatingKeyResult)),
            editKr, addMilestone, archiveKr,
          ),
        });
        const main = krRow.querySelector('.v-row__main');
        if (main) {
          main.append(el('div', 'planning-meta', progressCaption(kr)));
          if (kr.progress != null) main.append(progressBar(kr.progress));
        }
        body.append(krRow, krEditor);
      }
      if (!keyResults.length) body.append(empty('No Key Results', 'Add the first measurable result for this objective.'));
      objectiveBox.append(body);
      objectivePanel.body.append(objectiveBox);
    }
    if (!objectives.length) objectivePanel.body.append(empty('No active OKRs', 'Create an Objective, then add measurable Key Results.'));
    holder.append(objectivePanel);

    const milestonePanel = panel('Milestones');
    const milestones = planning.milestones || [];
    for (const milestone of milestones) {
      const done = milestone.status === 'done';
      const markDone = done ? null : miniButton('Mark done', async () => {
        try {
          await P.updateOperatingMilestone(milestone.id, { status: 'done', health: 'green' });
          renderCorePlanning(host, { go });
        } catch (error) {
          alert(error?.data?.error || error?.message || 'Milestone could not be updated.');
        }
      }, true);
      const edit = miniButton('Edit', async () => {
        const title = prompt('Milestone title:', milestone.title);
        if (title == null || !title.trim()) return;
        const dueDate = prompt('Due date (YYYY-MM-DD, optional):', milestone.due_date || '');
        const health = prompt('Health: green / yellow / red', milestone.health || 'green');
        try {
          await P.updateOperatingMilestone(milestone.id, {
            title: title.trim(),
            due_date: dueDate?.trim() || null,
            health: health?.trim() || milestone.health,
          });
          renderCorePlanning(host, { go });
        } catch (error) {
          alert(error?.data?.error || error?.message || 'Milestone could not be updated.');
        }
      });
      milestonePanel.body.append(row({
        title: milestone.title,
        sub: P.meta([
          milestone.objective_title,
          milestone.key_result_title,
          milestone.owner?.name || milestone.owner?.email,
          P.formatDate(milestone.due_date),
        ]),
        badges: [P.label(milestone.health), P.label(milestone.status)],
        action: actionStrip(edit, markDone),
      }));
    }
    if (!milestones.length) {
      milestonePanel.body.append(empty('No milestones', 'Add milestones directly under a Key Result.'));
    }
    holder.append(milestonePanel);
  });
}

/* ==========================================================================
   RESEARCH
   ========================================================================== */

const RESOURCE_VIEWS = {
  file:    ['Files & Data Rooms', 'Secure project files, backed by Nextcloud.'],
  dataset: ['Datasets', 'Research data, with project-level access.'],
  note:    ['Research Notes', 'Notes attached to projects, and private notes.'],
};

function resourceRow(item) {
  const node = el('div', 'v-row v-row--static');
  const main = el('div', 'v-row__main');
  main.append(el('strong', null, item.title || item.original_name || 'Untitled'));
  main.append(el('small', null, P.meta([
    item.project_title, item.collection_name, P.formatBytes(item.file_size), P.formatDate(item.updated_at),
  ])));
  node.append(main);
  if (item.has_download) {
    const actions = el('div', 'v-row__actions');
    const download = el('a', 'ws-btn ws-btn--tiny', 'Download');
    download.href = `/api/platform/files/${item.id}/download/`;
    const open = el('button', 'ws-btn ws-btn--tiny', 'Open with…'); open.type = 'button';
    open.addEventListener('click', () => window.open(download.href, '_blank', 'noopener'));
    actions.append(download, open); node.append(actions);
  }
  return node;
}

export function renderResources(host, kind) {
  const [title, subtitle] = RESOURCE_VIEWS[kind] || RESOURCE_VIEWS.file;
  const doc = docShell(host, title, subtitle);
  uploadToolbar(doc.querySelector(':scope > .ws-doc__head'), kind, { onUploaded: () => renderResources(host, kind) });
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
  mindmapToolbar(doc.querySelector(':scope > .ws-doc__head'));
  const holder = el('div');
  doc.append(holder);
  skeleton(5, holder);

  const button = (label, handler, solid = false) => {
    const node = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
    node.type = 'button'; node.addEventListener('click', handler); return node;
  };

  const drawEditor = async (id) => {
    holder.innerHTML = '<div class="ws-skel"><i></i><i></i><i></i></div>';
    try {
      const data = await P.mindmap(id);
      const map = data.item;
      holder.innerHTML = '';
      const back = button('Back to maps', drawList);
      holder.append(back);

      const meta = panel(map.title);
      const title = el('input', 'v-input'); title.value = map.title || '';
      const description = el('textarea', 'v-input'); description.rows = 3; description.value = map.description || '';
      const save = button('Save map', async () => {
        save.disabled = true;
        try { await P.updateMindmap(id, {title:title.value.trim(), description:description.value.trim()}); save.textContent = 'Saved'; }
        finally { save.disabled = false; }
      }, true);
      meta.body.append(title, description, save);
      holder.append(meta);

      const nodes = panel('Nodes');
      const redrawNodes = async () => drawEditor(id);
      for (const node of map.nodes || []) {
        const actions = el('div', 'v-row__actions');
        const edit = button('Edit', () => {
          actions.innerHTML = '';
          const t = el('input', 'v-input'); t.value = node.title || '';
          const b = el('textarea', 'v-input'); b.rows = 3; b.value = node.body || '';
          const saveNode = button('Save', async () => {
            await P.mindmapAction(id, {action:'node.update', node_id:node.id, title:t.value.trim(), body:b.value.trim()});
            await redrawNodes();
          }, true);
          const remove = button('Delete', async () => {
            if (!confirm(`Delete “${node.title}”?`)) return;
            await P.mindmapAction(id, {action:'node.delete', node_id:node.id});
            await redrawNodes();
          });
          actions.append(t,b,saveNode,remove);
        });
        actions.append(edit);
        nodes.body.append(row({
          title: node.title,
          sub: node.body || P.label(node.kind),
          badges: [P.label(node.kind)],
          action: actions,
        }));
      }
      const addForm = el('form', 'fl-form');
      const newTitle = el('input', 'v-input'); newTitle.placeholder = 'New node';
      const newBody = el('textarea', 'v-input'); newBody.rows = 2; newBody.placeholder = 'Note or evidence';
      const add = button('Add node', () => {}, true); add.type = 'submit';
      addForm.append(newTitle,newBody,add);
      addForm.addEventListener('submit', async (event) => {
        event.preventDefault(); if (!newTitle.value.trim()) return;
        add.disabled = true;
        await P.mindmapAction(id, {action:'node.create', title:newTitle.value.trim(), body:newBody.value.trim(), kind:'concept'});
        await redrawNodes();
      });
      nodes.body.append(addForm);
      holder.append(nodes);

      const edges = panel('Connections');
      for (const edge of map.edges || []) {
        const source = (map.nodes || []).find((n) => n.id === edge.source_id);
        const target = (map.nodes || []).find((n) => n.id === edge.target_id);
        const remove = button('Remove', async () => {
          await P.mindmapAction(id, {action:'edge.delete', edge_id:edge.id});
          await redrawNodes();
        });
        edges.body.append(row({
          title: `${source?.title || edge.source_id} → ${target?.title || edge.target_id}`,
          sub: edge.label || P.label(edge.relation),
          action: remove,
        }));
      }
      if ((map.nodes || []).length >= 2) {
        const form = el('form', 'fl-form');
        const from = el('select', 'v-input');
        const to = el('select', 'v-input');
        for (const node of map.nodes) {
          const a = el('option', null, node.title); a.value = node.id; from.append(a);
          const b = el('option', null, node.title); b.value = node.id; to.append(b);
        }
        if (to.options[1]) to.selectedIndex = 1;
        const labelInput = el('input', 'v-input'); labelInput.placeholder = 'Relationship label';
        const connect = button('Connect nodes', () => {}, true); connect.type = 'submit';
        form.append(from,to,labelInput,connect);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (from.value === to.value) return;
          connect.disabled = true;
          await P.mindmapAction(id, {action:'edge.create', source_id:Number(from.value), target_id:Number(to.value), relation:'related', label:labelInput.value.trim()});
          await redrawNodes();
        });
        edges.body.append(form);
      }
      holder.append(edges);
    } catch (error) {
      holder.innerHTML = '';
      holder.append(failure('mind map', error, () => drawEditor(id)));
    }
  };

  const drawList = async () => {
    holder.innerHTML = '<div class="ws-skel"><i></i><i></i><i></i></div>';
    try {
      const data = await P.mindmaps();
      holder.innerHTML = '';
      const create = panel('New mind map');
      const form = el('form', 'fl-form');
      const title = el('input', 'v-input'); title.placeholder = 'Mind map title';
      const description = el('textarea', 'v-input'); description.rows = 2; description.placeholder = 'Question or purpose';
      const add = button('Create map', () => {}, true); add.type = 'submit';
      form.append(title,description,add); create.body.append(form); holder.append(create);
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); if (!title.value.trim()) return;
        add.disabled = true;
        const created = await P.createMindmap({title:title.value.trim(), description:description.value.trim()});
        await drawEditor(created.item.id);
      });

      const maps = data.mindmaps || data.items || [];
      const list = panel('Mind maps');
      if (!maps.length) list.body.append(empty('No mind maps', 'Create one above.'));
      for (const map of maps) {
        list.body.append(row({
          title: map.title,
          sub: P.meta([map.project_title, P.formatDate(map.updated_at)]),
          onClick: () => drawEditor(map.id),
        }));
      }
      holder.append(list);
    } catch (error) {
      holder.innerHTML = '';
      holder.append(failure('mind maps', error, drawList));
    }
  };

  drawList();
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
      holder.append(empty('Nothing shared yet', 'This view is read-only by design. Items appear here when another person shares a project, file, note, map or task directly with you.'));
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
  profileToolbar(doc.querySelector(':scope > .ws-doc__head'), { onSaved: () => renderPeople(host) });
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
      sub: status.url || 'Per user identity, project-level access control.',
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
