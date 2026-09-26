/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  VIEWS
   Home, and the two workspaces. Every number and every row on these screens
   comes from the backend; nothing here invents data when a call fails.

   Each view is an async function that fills a container. They share one
   shape: show skeletons, fetch, then replace. That is why the panes do not
   jump when data lands, and why a failure has somewhere obvious to render.
   ========================================================================== */

import * as P from './ws-platform.js?v=20260926-calendar2';
import { WORKSPACES, availableWorkspaces } from './ws-nav.js?v=20260926-meetings1';

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
  const doc = docShell(host, 'Tasks & Execution', 'Manager-defined execution. Create tasks manually from existing Key Results and optional Milestones.');
  const holder = el('div');
  doc.append(holder);
  skeleton(8, holder);

  const STATUS_COLUMNS = [
    ['draft', 'Backlog'],
    ['active', 'Active'],
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

  const formatActor = (actor) => actor?.name || actor?.email || 'Gravitas+';

  function closeDialog(dialog) {
    dialog?.remove();
  }

  function makeDialog(title) {
    const dialog = el('div', 'task-card-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
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

  function taskCard(task, openCard) {
    const card = el('article', 'task-trello-card');
    card.draggable = true;
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

    const context = el('div', 'task-trello-card__context');
    if (task.trace?.key_result?.title) context.append(el('span', null, task.trace.key_result.title));
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
    card.addEventListener('click', () => { if (!dragging) openCard(task.id); });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCard(task.id);
      }
    });
    return card;
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

  async function openTaskDialog(taskId, state, reloadBoard) {
    const { dialog, body, head } = makeDialog('Loading task…');
    body.append(skeleton(6));

    try {
      const detailData = await P.operatingTaskCard(taskId);
      const task = detailData.task;
      head.querySelector('h2').textContent = task.title;
      body.innerHTML = '';

      const layout = el('div', 'task-card-dialog__grid');
      const main = el('div', 'task-card-dialog__main');
      const side = el('aside', 'task-card-dialog__side');
      layout.append(main, side);
      body.append(layout);

      const form = el('form', 'task-board__form');
      const title = input('text', task.title);
      const description = textarea(task.description, 5);
      const priority = select((detailData.priorities || state.priorities).map((item) => [item.value, item.label]), task.priority);
      const status = select((detailData.statuses || state.statuses).map((item) => [item.value, item.label]), task.status);
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
      const dependency = select(
        [['', 'No dependency'], ...state.tasks.filter((row) => row.id !== task.id).map((row) => [row.id, row.title])],
        task.dependency_id,
      );
      const due = input('date', task.due_date || '');
      const done = textarea(task.definition_of_done, 4);
      const blocked = textarea(task.blocked_reason, 3);

      const two = el('div', 'task-board__two');
      two.append(field('Priority', priority), field('Status', status), field('Owner', owner), field('Due date', due));
      const calendarField = el('div', 'task-board__field task-board__calendar-field');
      calendarField.append(el('span', 'task-board__label', 'Google Calendar'));
      const calendarActions = el('div', 'task-card-dialog__actions task-board__calendar-actions');
      const calendarAction = makeButton('Add task to Google Calendar', () => {});
      const calendarNote = el('small', 'fl-muted');
      const openCalendar = el('a', 'ws-btn ws-btn--tiny', 'Open Calendar');
      openCalendar.target = '_blank';
      openCalendar.rel = 'noopener';
      openCalendar.hidden = true;
      calendarActions.append(calendarAction, openCalendar);
      calendarField.append(calendarActions, calendarNote);

      let taskCalendarState = null;
      const setTaskCalendarUi = () => {
        openCalendar.hidden = true;
        openCalendar.removeAttribute('href');
        if (!taskCalendarState?.connected) {
          calendarAction.textContent = 'Connect Google Calendar';
          calendarNote.textContent = 'Connect your Google account once, then add this task to your own calendar.';
          calendarAction.disabled = false;
          return;
        }
        calendarAction.textContent = taskCalendarState.event
          ? 'Sync task with Google Calendar'
          : 'Add task to Google Calendar';
        calendarNote.textContent = taskCalendarState.google_email
          ? `Connected as ${taskCalendarState.google_email}`
          : 'Google Calendar connected';
        calendarAction.disabled = false;
        if (taskCalendarState.event?.html_link) {
          openCalendar.href = taskCalendarState.event.html_link;
          openCalendar.hidden = false;
        }
      };

      const refreshTaskCalendarState = async () => {
        taskCalendarState = await P.googleCalendarTaskStatus(task.id);
        setTaskCalendarUi();
      };

      calendarAction.addEventListener('click', async () => {
        calendarAction.disabled = true;
        calendarNote.textContent = 'Checking Google Calendar…';
        try {
          taskCalendarState = await P.googleCalendarTaskStatus(task.id);
          if (!taskCalendarState.connected) {
            const next = `${location.pathname}?calendar_task=${encodeURIComponent(task.id)}`;
            location.href = `/api/calendar/google/connect/?next=${encodeURIComponent(next)}`;
            return;
          }
          calendarNote.textContent = taskCalendarState.event ? 'Syncing task…' : 'Adding task…';
          const result = await P.syncOperatingTaskToGoogle(task.id);
          taskCalendarState.event = result.event;
          setTaskCalendarUi();
        } catch (error) {
          const code = error?.data?.error || error?.message || '';
          calendarNote.textContent = code === 'calendar_reconnect_required'
            ? 'Google Calendar access expired. Connect again.'
            : code === 'calendar_permission_denied'
              ? 'Google Calendar permission was not granted.'
              : code || 'Google Calendar sync failed.';
          calendarAction.disabled = false;
        }
      });

      refreshTaskCalendarState().catch((error) => {
        taskCalendarState = null;
        calendarNote.textContent = error?.data?.error || 'Calendar status unavailable.';
        setTaskCalendarUi();
      });

      const links = el('div', 'task-board__two');
      links.append(
        field('Key result', keyResult), field('Milestone', milestone),
        field('Work package', workPackage),
        field('Research project', project),
        field('Dependency', dependency),
      );

      const trace = el('div', 'task-card-dialog__trace');
      trace.append(
        el('span', 'v-badge', task.trace?.objective?.title || 'Objective'),
        el('span', 'v-badge', task.trace?.key_result?.title || 'Key result'),
        task.milestone_title ? el('span', 'v-badge', task.milestone_title) : el('span'),
      );

      const actions = el('div', 'task-card-dialog__actions');
      const save = makeButton('Save changes', () => {}, true);
      save.type = 'submit';
      const remove = makeButton('Delete task', async () => {
        if (!confirm(`Delete “${task.title}”?`)) return;
        remove.disabled = true;
        try {
          await P.deleteOperatingTaskCard(task.id);
          closeDialog(dialog);
          await reloadBoard();
        } catch (error) {
          remove.disabled = false;
          alert(error?.message || 'Task could not be deleted.');
        }
      });
      actions.append(save, remove);
      const note = el('p', 'v-note');

      form.append(
        field('Title', title),
        field('Description', description),
        two,
        links,
        calendarField,
        field('Definition of done', done),
        field('Blocked reason', blocked),
        trace,
        actions,
        note,
      );

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        note.textContent = 'Saving…';
        const payload = {
          title: title.value.trim(),
          description: description.value.trim(),
          priority: priority.value,
          status: status.value,
          owner_id: Number(owner.value),
          key_result_id: Number(keyResult.value),
          milestone_id: milestone.value ? Number(milestone.value) : null,
          work_package_id: workPackage.value ? Number(workPackage.value) : null,
          project_id: project.value ? Number(project.value) : null,
          dependency_id: dependency.value ? Number(dependency.value) : null,
          due_date: due.value || null,
          definition_of_done: done.value.trim(),
          blocked_reason: blocked.value.trim(),
        };
        try {
          const result = await P.updateOperatingTaskCard(task.id, payload);
          note.textContent = 'Saved.';
          head.querySelector('h2').textContent = result.task.title;
          await reloadBoard({ keepDialog: true });
        } catch (error) {
          note.textContent = error?.data?.error || error?.message || 'Save failed.';
        } finally {
          save.disabled = false;
        }
      });
      main.append(form);

      const checklistPanel = panel('Checklist');
      main.append(checklistPanel);

      const loadChecklist = async () => {
        checklistPanel.body.innerHTML = '';
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
          checklistPanel.body.append(el('p', 'fl-muted', error?.message || 'Checklist unavailable.'));
        }
      };

      const commentsPanel = panel('Comments');
      const attachmentsPanel = panel('Attachments');
      const historyPanel = panel('Activity');
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
              el('small', 'fl-muted', P.formatDate(comment.created_at)),
            );
            commentsPanel.body.append(item);
          }
          if (!(data.comments || []).length) commentsPanel.body.append(el('p', 'fl-muted', 'No comments yet.'));

          const commentForm = el('form', 'task-board__form');
          const comment = textarea('', 3);
          comment.placeholder = 'Add a comment…';
          const send = makeButton('Comment', () => {}, true);
          send.type = 'submit';
          const commentNote = el('p', 'v-note');
          commentForm.append(comment, send, commentNote);
          commentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!comment.value.trim()) return;
            send.disabled = true;
            try {
              await P.addOperatingTaskComment(task.id, comment.value.trim());
              comment.value = '';
              await loadComments();
              await reloadBoard({ keepDialog: true });
            } catch (error) {
              commentNote.textContent = error?.message || 'Comment failed.';
              send.disabled = false;
            }
          });
          commentsPanel.body.append(commentForm);
        } catch (error) {
          commentsPanel.body.append(el('p', 'fl-muted', error?.message || 'Comments unavailable.'));
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
          if (!(data.attachments || []).length) attachmentsPanel.body.append(el('p', 'fl-muted', 'No attachments yet.'));

          const uploadForm = el('form', 'task-board__form');
          const file = input('file');
          const uploadButton = makeButton('Upload · max 10 MB', () => {}, true);
          uploadButton.type = 'submit';
          const uploadNote = el('p', 'v-note');
          uploadForm.append(file, uploadButton, uploadNote);
          uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const chosen = file.files?.[0];
            if (!chosen) return;
            if (chosen.size > 10 * 1024 * 1024) {
              uploadNote.textContent = 'Maximum attachment size is 10 MB.';
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
            }
          });
          attachmentsPanel.body.append(uploadForm);
        } catch (error) {
          attachmentsPanel.body.append(el('p', 'fl-muted', error?.message || 'Attachments unavailable.'));
        }
      };

      const loadHistory = async () => {
        historyPanel.body.innerHTML = '';
        try {
          const data = await P.operatingTaskHistory(task.id);
          for (const event of data.events || []) {
            historyPanel.body.append(row({
              title: P.label(event.action.replace(/^task\./, '')),
              sub: P.meta([formatActor(event.actor), P.formatDate(event.created_at)]),
            }));
          }
          if (!(data.events || []).length) historyPanel.body.append(el('p', 'fl-muted', 'No board activity logged yet.'));
        } catch (error) {
          historyPanel.body.append(el('p', 'fl-muted', error?.message || 'Activity unavailable.'));
        }
      };

      await Promise.all([loadChecklist(), loadComments(), loadAttachments(), loadHistory()]);
    } catch (error) {
      body.innerHTML = '';
      body.append(failure('task card', error, () => {
        closeDialog(dialog);
        openTaskDialog(taskId, state, reloadBoard);
      }));
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
    two.append(field('Owner', owner), field('Key result', keyResult), field('Priority', priority), field('Status', status), field('Due date', due));
    form.append(field('Title', title), field('Description', description), two, field('Definition of done', done), create, note);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim() || !owner.value || !keyResult.value || !done.value.trim()) {
        note.textContent = 'Title, owner, key result and definition of done are required.';
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
          key_result_id: Number(keyResult.value),
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

  return guard(holder, 'Core tasks', async () => {
    let state = null;
    let filters = { q: '', owner: '', priority: '' };
    let deepLinkedTaskOpened = false;

    const load = async ({ keepDialog = false } = {}) => {
      const data = await P.operatingTaskBoard();
      state = data;
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
          document.createTextNode(' Start clean and create only the tasks you want to run against the current KRs.'),
        );
        holder.append(note);
      }

      const toolbar = el('div', 'v-toolbar task-board__toolbar');
      const search = input('search', filters.q);
      search.placeholder = 'Search tasks, owner, KR, milestone or project';
      search.setAttribute('aria-label', 'Search tasks');
      const ownerFilter = select([['', 'All owners'], ...(data.members || []).map((member) => [member.id, member.name || member.email])], filters.owner);
      const priorityFilter = select([['', 'All priorities'], ...(data.priorities || []).map((item) => [item.value, item.label])], filters.priority);
      const count = el('span', 'v-toolbar__count');
      const add = makeButton('New task from KR', () => openCreateDialog(state, load), true);
      if (!data.can_edit) {
        add.disabled = true;
      }
      toolbar.append(search, ownerFilter, priorityFilter, count, add);
      holder.append(toolbar);

      const board = el('div', 'task-trello-board');
      board.tabIndex = 0;
      board.setAttribute('role', 'group');
      board.setAttribute('aria-label', 'Core task board by status');
      holder.append(board);

      const draw = () => {
        filters = { q: search.value.trim(), owner: ownerFilter.value, priority: priorityFilter.value };
        const q = filters.q.toLowerCase();
        const visible = data.tasks.filter((task) => {
          if (filters.owner && String(task.owner?.id) !== filters.owner) return false;
          if (filters.priority && task.priority !== filters.priority) return false;
          if (q && !taskSearchText(task).includes(q)) return false;
          return true;
        });
        count.textContent = `${visible.length} of ${data.tasks.length}`;
        board.innerHTML = '';

        for (const [statusValue, statusLabel] of STATUS_COLUMNS) {
          const column = el('section', 'task-trello-column');
          column.dataset.status = statusValue;
          const matches = visible.filter((task) => task.status === statusValue)
            .sort((a, b) => (a.board_order || 0) - (b.board_order || 0) || a.id - b.id);
          const head = el('div', 'task-trello-column__head');
          head.append(el('strong', null, statusLabel), el('span', 'v-column__count', String(matches.length)));
          const body = el('div', 'task-trello-column__body');
          body.dataset.status = statusValue;
          if (!matches.length) body.append(el('div', 'v-column__empty task-trello-column__empty'));
          for (const task of matches) body.append(taskCard(task, (id) => openTaskDialog(id, state, load)));

          body.addEventListener('dragover', (event) => {
            if (!data.can_edit) return;
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
            if (!data.can_edit) return;
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
      };

      search.addEventListener('input', draw);
      ownerFilter.addEventListener('change', draw);
      priorityFilter.addEventListener('change', draw);
      draw();

      if (!deepLinkedTaskOpened) {
        deepLinkedTaskOpened = true;
        const params = new URLSearchParams(location.search);
        const taskToOpen = Number(params.get('calendar_task') || 0);
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
  const doc = docShell(host, 'Planning', 'A simple manager view of Objectives, Key Results and Milestones.');
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  const miniButton = (labelText, handler, solid = false) => {
    const button = el('button', solid ? 'ws-btn ws-btn--solid ws-btn--tiny' : 'ws-btn ws-btn--tiny', labelText);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  };

  const actionStrip = (...nodes) => {
    const strip = el('div', 'v-row__actions');
    strip.append(...nodes.filter(Boolean));
    return strip;
  };

  const progressBar = (value) => {
    const wrap = el('div', 'okr-progress');
    const bar = el('i');
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    bar.style.width = safe + '%';
    wrap.append(bar);
    wrap.title = safe + '%';
    return wrap;
  };

  const currentUserId = () => P.platform?.user?.user?.id || null;

  return guard(holder, 'planning', async () => {
    const board = await P.operatingDashboard();
    holder.innerHTML = '';

    const planning = board.planning || { objectives: [], key_results: [], milestones: [], counts: {} };
    const counts = planning.counts || {};
    holder.append(stats([
      ['Objectives', counts.objectives || 0],
      ['Key Results', counts.key_results || 0],
      ['Open milestones', counts.milestones_open || 0],
      ['Open tasks', board.counts?.tasks || 0],
    ]));

    const toolbar = el('div', 'v-toolbar');
    const addObjective = miniButton('New objective', async () => {
      const title = prompt('Objective title:');
      if (!title?.trim()) return;
      const dueDate = prompt('Due date (YYYY-MM-DD, optional):', '');
      const ownerId = currentUserId() || board.members?.[0]?.id;
      if (!ownerId) return alert('No Core owner is available.');
      try {
        await P.createOperatingObjective({
          title: title.trim(),
          owner_id: ownerId,
          due_date: dueDate?.trim() || null,
          status: 'active',
          health: 'green',
        });
        renderCorePlanning(host, { go });
      } catch (error) {
        alert(error?.data?.error || error?.message || 'Objective could not be created.');
      }
    }, true);
    const openTasks = miniButton('Open task board', () => go('/workspace/core/tasks'));
    toolbar.append(addObjective, openTasks);
    holder.append(toolbar);

    const objectivePanel = panel('OKRs');
    for (const objective of planning.objectives || []) {
      const objectiveBox = el('section', 'v-panel okr-objective');
      const head = el('div', 'v-panel__head');
      const heading = el('div');
      heading.append(
        el('h3', null, objective.title),
        el('small', 'fl-muted', P.meta([
          objective.owner?.name || objective.owner?.email,
          P.formatDate(objective.due_date),
          P.label(objective.health),
          P.label(objective.status),
        ])),
      );
      if (objective.progress != null) heading.append(progressBar(objective.progress));

      const editObjective = miniButton('Edit', async () => {
        const title = prompt('Objective title:', objective.title);
        if (title == null || !title.trim()) return;
        const dueDate = prompt('Due date (YYYY-MM-DD, optional):', objective.due_date || '');
        const health = prompt('Health: green / yellow / red', objective.health || 'green');
        try {
          await P.updateOperatingObjective(objective.id, {
            title: title.trim(),
            due_date: dueDate?.trim() || null,
            health: health?.trim() || objective.health,
          });
          renderCorePlanning(host, { go });
        } catch (error) {
          alert(error?.data?.error || error?.message || 'Objective could not be updated.');
        }
      });

      const addKr = miniButton('Add KR', async () => {
        const title = prompt('Key Result:');
        if (!title?.trim()) return;
        const metric = prompt('Metric name (optional):', '');
        const target = prompt('Target value (optional):', '');
        const dueDate = prompt('Due date (YYYY-MM-DD, optional):', objective.due_date || '');
        try {
          await P.createOperatingKeyResult({
            objective_id: objective.id,
            owner_id: objective.owner?.id || currentUserId(),
            title: title.trim(),
            metric_name: metric?.trim() || '',
            baseline_value: 0,
            current_value: 0,
            target_value: target?.trim() === '' ? null : target,
            due_date: dueDate?.trim() || null,
            status: 'active',
            health: 'green',
          });
          renderCorePlanning(host, { go });
        } catch (error) {
          alert(error?.data?.error || error?.message || 'Key Result could not be created.');
        }
      }, true);
      head.append(heading, actionStrip(editObjective, addKr));
      objectiveBox.append(head);

      const body = el('div', 'v-panel__body');
      const keyResults = objective.key_results || [];
      for (const kr of keyResults) {
        const metric = kr.target_value != null
          ? (kr.current_value ?? '—') + ' / ' + kr.target_value + (kr.unit ? ' ' + kr.unit : '')
          : (kr.current_value ?? kr.metric_name ?? '');
        const update = miniButton('Update', async () => {
          const current = prompt('Current value:', kr.current_value ?? '');
          if (current == null) return;
          const health = prompt('Health: green / yellow / red', kr.health || 'green');
          try {
            await P.updateOperatingKeyResult(kr.id, {
              current_value: current.trim() === '' ? null : current,
              health: health?.trim() || kr.health,
            });
            renderCorePlanning(host, { go });
          } catch (error) {
            alert(error?.data?.error || error?.message || 'Key Result could not be updated.');
          }
        });
        const addMilestone = miniButton('Add milestone', async () => {
          const title = prompt('Milestone title:');
          if (!title?.trim()) return;
          const dueDate = prompt('Due date (YYYY-MM-DD):', kr.due_date || objective.due_date || '');
          if (!dueDate?.trim()) return;
          try {
            await P.createOperatingMilestone({
              key_result_id: kr.id,
              owner_id: kr.owner?.id || objective.owner?.id || currentUserId(),
              title: title.trim(),
              due_date: dueDate.trim(),
              health: 'green',
              status: 'active',
            });
            renderCorePlanning(host, { go });
          } catch (error) {
            alert(error?.data?.error || error?.message || 'Milestone could not be created.');
          }
        }, true);
        const krRow = row({
          title: kr.title,
          sub: P.meta([
            metric,
            kr.progress == null ? '' : kr.progress + '%',
            kr.owner?.name || kr.owner?.email,
            P.formatDate(kr.due_date),
          ]),
          badges: [P.label(kr.health), P.label(kr.status)],
          action: actionStrip(update, addMilestone),
        });
        if (kr.progress != null) krRow.querySelector('.v-row__main')?.append(progressBar(kr.progress));
        body.append(krRow);
      }
      if (!keyResults.length) body.append(empty('No Key Results', 'Add the first measurable result for this objective.'));
      objectiveBox.append(body);
      objectivePanel.body.append(objectiveBox);
    }
    if (!(planning.objectives || []).length) {
      objectivePanel.body.append(empty('No active OKRs', 'Create an Objective, then add measurable Key Results.'));
    }
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
  newNote.addEventListener('click', async () => {
    if (newNote.disabled) return;
    newNote.disabled = true;
    newNote.textContent = 'Creating…';
    status.hidden = false;
    status.dataset.tone = '';
    status.textContent = 'Creating the note and syncing its file…';
    try {
      const made = await ctx.newNote({ space: 'research' });
      if (!made) throw new Error('note_not_created');
    } catch {
      newNote.disabled = false;
      newNote.textContent = 'New note';
      status.dataset.tone = 'bad';
      status.textContent = 'The note was not created. Nothing was changed.';
    }
  });

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
