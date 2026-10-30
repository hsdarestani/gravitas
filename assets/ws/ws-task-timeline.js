/* Shared task chronology for Core and project command centers. Actual work,
 * planned ranges and deadlines have different meanings and different marks.
 * Missing history stays visible; a due date never masquerades as completion.
 * No per-task requests are made by this view. */
const DAY = 86400000;
const fields = [['created_at', 'Created'], ['started_at', 'Active since'], ['completed_at', 'Completed']];
const node = (tag, cls = '', text = '') => {
  const el = document.createElement(tag); el.className = cls; el.textContent = text; return el;
};
export function dateMillis(value) {
  if (!value) return null;
  const result = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00Z' : value);
  return Number.isFinite(result) ? result : null;
}
function format(value, withTime = false) {
  if (!value || dateMillis(value) === null) return 'Not recorded';
  // Calendar dates have no timezone. Instants are displayed in the reader's.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dateMillis(value)).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
export function timelineModel(tasks, plans = new Map(), now = Date.now()) {
  const rows = tasks.map(task => {
    const plan = plans.get(Number(task.id));
    const created = dateMillis(task.created_at), start = dateMillis(task.started_at);
    const end = dateMillis(task.completed_at), due = dateMillis(task.due_date);
    const open = !['done', 'archived'].includes(task.status);
    return { task, created, start, end, due, plannedStart: dateMillis(plan?.start_date),
      plannedEnd: dateMillis(plan?.end_date), activeEnd: start !== null ? end ?? (open ? now : null) : null };
  });
  const dates = rows.flatMap(row => [row.created, row.start, row.end, row.due, row.plannedStart,
    row.plannedEnd, row.activeEnd]).filter(value => value !== null);
  const lower = dates.length ? Math.min(...dates) : now;
  const upper = dates.length ? Math.max(...dates) : now;
  const origin = Math.floor(lower / DAY) * DAY - DAY;
  const extent = Math.max(origin + DAY * 7, Math.ceil(upper / DAY) * DAY + DAY * 2);
  const position = value => (value - origin) / (extent - origin) * 100;
  rows.sort((a, b) => (a.start ?? a.created ?? a.due ?? Infinity) -
    (b.start ?? b.created ?? b.due ?? Infinity) || a.task.id - b.task.id);
  return { rows, origin, extent, position };
}
function styles() {
  if (document.getElementById('task-chronology-style')) return;
  const sheet = node('style'); sheet.id = 'task-chronology-style';
  sheet.textContent = `
  .task-timeline{overflow-x:auto;border:1px solid var(--g-hairline,#39424d);border-radius:12px;margin:12px 0;max-width:100%;background:var(--ws-panel-bg,transparent)}
  .task-timeline__row{display:grid;grid-template-columns:240px minmax(480px,1fr);min-width:740px;border-bottom:1px solid var(--g-hairline,#39424d)}
  .task-timeline__row:last-child{border-bottom:0}.task-timeline__label{padding:12px;position:sticky;left:0;z-index:2;background:var(--ws-panel-bg,var(--g-surface,#17202b));min-width:0;color:inherit}
  .task-timeline__label button{display:block;text-align:left;font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0;font-weight:600;overflow-wrap:anywhere}
  .task-timeline__label small{display:block;opacity:.68;margin-top:5px;font-size:11px;line-height:1.5}
  .task-timeline__track{position:relative;margin:0 16px;min-height:76px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(20% - 1px),var(--g-hairline,#39424d) 20%)}
  .task-timeline__axis{min-height:38px;background:none}.task-timeline__tick{position:absolute;top:10px;font-size:11px;white-space:nowrap;transform:translateX(-50%);opacity:.7}
  .task-timeline__mark{position:absolute;transform:translateX(-50%);top:33px;width:9px;height:9px;background:#a4afc2;border-radius:50%;z-index:1}
  .task-timeline__mark--due{top:51px;border-radius:1px;background:#e7ae4e;transform:translateX(-50%) rotate(45deg)}
  .task-timeline__mark--done{background:#63c7a4}.task-timeline__bar{position:absolute;top:32px;height:11px;border-radius:5px;min-width:4px;background:#859ff7;opacity:.85}
  .task-timeline__bar--done{background:#63c7a4}.task-timeline__bar--blocked{background:#dc9b64}.task-timeline__bar--plan{top:14px;height:5px;background:#a3aec7;opacity:.45;border:1px dashed currentColor}
  .task-timeline__bar--inferred{background:repeating-linear-gradient(110deg,#859ff7 0,#859ff7 5px,transparent 5px,transparent 8px);border:1px dashed #859ff7}
  .task-timeline__today{position:absolute;top:0;bottom:0;border-left:1px dashed #b9c5e5;opacity:.5;pointer-events:none}
  .task-timeline__unknown{position:absolute;top:29px;left:8px;font-size:11px;opacity:.6}
  .task-timeline__legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;opacity:.75;margin:10px 0}
  .task-dates{border:1px solid var(--g-hairline,#39424d);border-radius:10px;padding:12px;margin:12px 0;min-width:0}.task-dates__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
  .task-dates label,.task-dates__item{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}.task-dates input{width:100%;min-width:0;font:inherit;padding:8px;color:inherit;background:transparent;border:1px solid var(--g-hairline,#596273);border-radius:6px;color-scheme:dark light}.task-dates small{font-size:10px;opacity:.65}.task-dates p{margin:0 0 10px;font-size:12px;opacity:.7}
  @media(max-width:600px){.task-timeline__row{grid-template-columns:185px minmax(440px,1fr);min-width:645px}.task-dates__grid{grid-template-columns:1fr}}
  `;
  document.head.append(sheet);
}
export function renderTaskTimeline(host, tasks, { plans = new Map(), openTask = () => {}, editPlan = null, now = Date.now() } = {}) {
  styles();
  const model = timelineModel(tasks, plans, now);
  const legend = node('p', 'task-timeline__legend', '● Created   ━ Actual work   ● Completed   ◆ Due date   ┄ Planned work');
  const chart = node('div', 'task-timeline'); chart.tabIndex = 0; chart.setAttribute('aria-label', 'Task timeline; scroll horizontally to explore dates');
  const header = node('div', 'task-timeline__row'); header.append(node('strong', 'task-timeline__label', 'Task · actual dates'));
  const axis = node('div', 'task-timeline__track task-timeline__axis');
  for (let index = 0; index <= 5; index++) {
    const tick = node('time', 'task-timeline__tick', format(new Date(model.origin + (model.extent - model.origin) * index / 5).toISOString()));
    tick.style.left = index * 20 + '%'; axis.append(tick);
  }
  header.append(axis); chart.append(header);
  const mark = (track, value, cls, label) => {
    if (value === null) return;
    const dot = node('span', 'task-timeline__mark ' + cls); dot.style.left = model.position(value) + '%';
    dot.title = label; dot.setAttribute('aria-label', label); track.append(dot);
  };
  const bar = (track, start, end, cls, label) => {
    if (start === null || end === null || end < start) return;
    const line = node('span', 'task-timeline__bar ' + cls); line.style.left = model.position(start) + '%';
    line.style.width = Math.max(.4, model.position(end) - model.position(start)) + '%';
    line.title = label; line.setAttribute('aria-label', label); track.append(line);
  };
  for (const row of model.rows) {
    const task = row.task, item = node('div', 'task-timeline__row'), label = node('div', 'task-timeline__label');
    const open = node('button', '', '#' + task.id + ' · ' + task.title); open.type = 'button'; open.onclick = () => openTask(task);
    label.append(open, node('small', '', (typeof task.owner === 'object' ? task.owner?.name : task.owner || '') + ' · ' + String(task.status).replaceAll('_', ' ')),
      node('small', '', fields.map(([key, name]) => name + ': ' + format(task[key])).join(' · ') + ' · Due: ' + format(task.due_date)));
    if (editPlan && task.can_edit) { const plan = node('button', '', plans.has(Number(task.id)) ? 'Edit plan' : 'Plan'); plan.type = 'button'; plan.onclick = () => editPlan(task); label.append(plan); }
    const track = node('div', 'task-timeline__track');
    if (now >= model.origin && now <= model.extent) { const today = node('span', 'task-timeline__today'); today.style.left = model.position(now) + '%'; today.title = 'Today'; track.append(today); }
    bar(track, row.plannedStart, row.plannedEnd === null ? null : row.plannedEnd + DAY, 'task-timeline__bar--plan', 'Planned work');
    const inferred = task.date_provenance?.started_at?.confidence === 'earliest_known';
    bar(track, row.start, row.activeEnd, 'task-timeline__bar--' + task.status + (inferred ? ' task-timeline__bar--inferred' : ''),
      (inferred ? 'Earliest recorded work: ' : 'Active: ') + format(task.started_at, true) + ' → ' + (task.completed_at ? format(task.completed_at, true) : row.activeEnd ? 'ongoing' : 'completion not recorded'));
    mark(track, row.created, '', 'Created: ' + format(task.created_at, true));
    mark(track, row.end, 'task-timeline__mark--done', 'Completed: ' + format(task.completed_at, true));
    mark(track, row.due, 'task-timeline__mark--due', 'Due: ' + format(task.due_date));
    if (row.start === null) track.append(node('span', 'task-timeline__unknown', 'Active date not recorded'));
    item.append(label, track); chart.append(item);
  }
  if (!tasks.length) chart.append(node('p', 'task-timeline__label', 'No tasks match these filters.'));
  host.append(legend, chart);
}
function localInput(value) {
  const ms = dateMillis(value); if (ms === null) return '';
  const date = new Date(ms); return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export function taskDateFields(task, { canEdit = false } = {}) {
  styles();
  const element = node('section', 'task-dates'); element.setAttribute('aria-label', 'Task dates');
  element.append(node('p', '', 'Actual dates · independent of the due date' + (canEdit ? ' · times in your timezone' : '')));
  const grid = node('div', 'task-dates__grid'), controls = new Map(); element.append(grid);
  for (const [key, title] of fields) {
    const label = node(canEdit ? 'label' : 'div', 'task-dates__item', title);
    const source = task.date_provenance?.[key];
    if (canEdit) {
      const input = node('input'); input.type = 'datetime-local'; input.step = '1'; input.name = key; input.required = key === 'created_at';
      input.value = localInput(task[key]); label.append(input);
      controls.set(key, { input, initial: input.value, original: task[key] || null });
    } else { const value = node('time', '', format(task[key], true)); if (task[key]) value.dateTime = task[key]; label.append(value); }
    if (source?.confidence === 'earliest_known') label.append(node('small', '', 'Earliest recorded evidence; exact time unknown'));
    else if (source && !['observed', 'recorded', 'existing'].includes(source.source)) label.append(node('small', '', source.source === 'admin' ? 'Corrected by admin' : 'Recovered from history'));
    grid.append(label);
  }
  return { element,
    values: () => Object.fromEntries([...controls].map(([key, state]) => [key, state.input.value === state.initial ? state.original : state.input.value ? new Date(state.input.value).toISOString() : null])),
    sync: current => { for (const [key, state] of controls) if (state.input.value === state.initial) { state.input.value = localInput(current[key]); state.initial = state.input.value; state.original = current[key] || null; } },
  };
}
