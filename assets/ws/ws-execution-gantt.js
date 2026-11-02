/* One scroll surface owns the date ruler, task labels, bars and connections.
 * Sticky cells stay in that surface; virtual rows use a fixed height and an
 * overscan window. There is no scroll mirroring and no task-by-day DOM grid.
 * Calendar coordinates use the workspace zone; metric durations stay UTC. */
export const DAY = 86400000, ROW = 44;
export const element = (tag, cls = '', text = '') => {
  const n = document.createElement(tag); n.className = cls; n.textContent = text; return n;
};
export const button = (text, action, cls = 'ei-button') => {
  const n = element('button', cls, text); n.type = 'button'; n.onclick = action; return n;
};
export function calendarTime(value, zone = 'UTC') {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value + 'T00:00:00Z');
  const date = new Date(value); if (!Number.isFinite(+date)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}
export function hierarchyRows(tasks, collapsed = new Set()) {
  const byId = new Map(tasks.map(t => [t.id, t])), children = new Map(), roots = [];
  for (const task of tasks) {
    if (byId.has(task.parent_id) && task.parent_id !== task.id) {
      if (!children.has(task.parent_id)) children.set(task.parent_id, []);
      children.get(task.parent_id).push(task);
    } else roots.push(task);
  }
  const rows = [], seen = new Set();
  const visit = (task, depth) => {
    if (seen.has(task.id)) return;
    seen.add(task.id); const nested = children.get(task.id) || [];
    rows.push({ task, depth, hasChildren: nested.length > 0 });
    if (!collapsed.has(task.id)) for (const child of nested) visit(child, depth + 1);
  };
  for (const task of roots) visit(task, 0);
  // Corrupt historical parent cycles are visible as roots, never a hang.
  for (const task of tasks) if (!seen.has(task.id) && !byId.has(task.parent_id)) visit(task, 0);
  return rows;
}
export function virtualWindow(scroll, height, count) {
  const first = Math.max(0, Math.floor(scroll / ROW) - 7);
  return { first, end: Math.min(count, first + Math.ceil(height / ROW) + 15) };
}
function dayLabel(ms, mode) {
  const d = new Date(ms);
  if (mode === 'quarterly') return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + d.getUTCFullYear();
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', ...(mode === 'monthly' ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' }) });
}
export function renderExecutionGantt(host, tasks, milestones, options = {}) {
  const { onSelect = () => {}, onMilestone = () => {}, timeZone = 'UTC', now = Date.now(), state = {} } = options;
  const collapsed = state.collapsed ||= new Set();
  let rows = hierarchyRows(tasks, collapsed), selected = state.selected || null;
  let zoom = state.zoom || 'weekly', scale = 12, origin, extent, width, pending = 0, destroyed = false;
  let dependencies = state.dependencies ?? false, showMilestones = state.showMilestones ?? true;
  const shell = element('section', 'ei-gantt-shell');
  const controls = element('div', 'ei-controls');
  const chart = element('div', 'ei-chart'); chart.tabIndex = 0; chart.setAttribute('role', 'treegrid'); chart.setAttribute('aria-label', 'Execution timeline. Arrow keys move between tasks; Enter opens insights.');
  const canvas = element('div', 'ei-canvas'), header = element('div', 'ei-header'), body = element('div', 'ei-body');
  const label = element('div', 'ei-corner', 'TASK / EXECUTION STATE');
  const ruler = element('div', 'ei-ruler'); header.append(label, ruler);
  canvas.append(header, body); chart.append(canvas); shell.append(controls, chart); host.append(shell);
  const zoomInput = element('select'); zoomInput.setAttribute('aria-label', 'Timeline zoom');
  for (const [value, text] of [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly']]) {
    const opt = element('option', '', text); opt.value = value; zoomInput.append(opt);
  }
  zoomInput.value = zoom;
  const timezoneLabel = element('span', 'ei-muted', timeZone + ' · calendar dates');
  const tickStart = () => Math.floor(origin / DAY) * DAY;
  const x = value => (calendarTime(value, timeZone) - origin) / DAY * scale;
  const tickX = value => (value - origin) / DAY * scale;
  const bounds = (source, includeMilestones = true) => {
    const values = source.flatMap(t => [t.created_at, t.started_at, t.completed_at, t.due_date,
      t.execution?.plan?.start_date, t.execution?.plan?.end_date,
      ...(t.execution?.segments || []).flatMap(s => [s.start, s.end])]);
    if (includeMilestones) values.push(...milestones.map(m => m.due_date));
    const dates = values.map(v => calendarTime(v, timeZone)).filter(v => v !== null);
    const min = dates.length ? Math.min(...dates) : calendarTime(new Date(now).toISOString(), timeZone);
    const max = dates.length ? Math.max(...dates) : min + 7 * DAY;
    return [Math.floor(min / DAY) * DAY - DAY, Math.max(min + 7 * DAY, Math.ceil(max / DAY) * DAY + 2 * DAY)];
  };
  [origin, extent] = bounds(tasks);
  const position = (el, start, end, cls, text) => {
    if (!start || !end) return;
    const left = x(start), right = x(end); if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) return;
    const bar = element('span', 'ei-segment ' + cls); bar.style.left = left + 'px'; bar.style.width = Math.max(3, right - left) + 'px';
    bar.title = text; bar.setAttribute('aria-label', text); el.append(bar);
  };
  function drawAxis() {
    ruler.replaceChildren(); ruler.style.width = width + 'px';
    const first = tickStart();
    let ticks = [];
    if (zoom === 'daily' || zoom === 'weekly') {
      const step = zoom === 'daily' ? 1 : 7;
      let at = first;
      if (zoom === 'weekly') at += ((8 - new Date(at).getUTCDay()) % 7) * DAY;
      for (; at <= extent; at += step * DAY) ticks.push(at);
    } else {
      const date = new Date(first); date.setUTCDate(1);
      if (zoom === 'quarterly') date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
      while (+date <= extent) { if (+date >= origin) ticks.push(+date); date.setUTCMonth(date.getUTCMonth() + (zoom === 'quarterly' ? 3 : 1)); }
    }
    // Fit-all can span years: skip labels below the readable pixel spacing.
    let last = -Infinity;
    for (const at of ticks) {
      const left = tickX(at); if (left - last < 58) continue; last = left;
      const tick = element('time', 'ei-tick', dayLabel(at, zoom)); tick.style.left = left + 'px'; tick.dateTime = new Date(at).toISOString().slice(0, 10); ruler.append(tick);
    }
    const context = element('span', 'ei-ruler-context', dayLabel(origin, 'monthly') + ' — ' + dayLabel(extent, 'monthly'));
    ruler.append(context);
    if (showMilestones) for (const milestone of milestones) {
      if (!milestone.due_date) continue;
      const marker = button('◆ ' + milestone.title, () => onMilestone(milestone), 'ei-milestone-marker');
      marker.style.left = x(milestone.due_date) + 'px'; marker.title = milestone.title + ' · ' + milestone.due_date + ' · ' + milestone.delivery_status;
      ruler.append(marker);
    }
  }
  function drawRows() {
    if (destroyed) return;
    body.replaceChildren(); body.style.height = rows.length * ROW + 'px';
    chart.setAttribute('aria-rowcount', rows.length + 1);
    const window = virtualWindow(Math.max(0, chart.scrollTop - header.offsetHeight), chart.clientHeight || 520, rows.length);
    for (let index = window.first; index < window.end; index++) {
      const { task, depth, hasChildren } = rows[index], a = task.execution || {};
      const row = element('div', 'ei-row' + (task.id === selected ? ' is-selected' : '') + (task.status === 'done' ? ' is-done' : ''));
      row.id = 'ei-row-' + task.id; row.style.top = index * ROW + 'px'; row.setAttribute('role', 'row'); row.setAttribute('aria-rowindex', index + 2); row.setAttribute('aria-level', depth + 1);
      row.setAttribute('aria-selected', String(task.id === selected));
      const identity = element('div', 'ei-identity'); identity.setAttribute('role', 'rowheader'); identity.style.paddingLeft = Math.min(6, depth) * 16 + 6 + 'px';
      if (hasChildren) {
        const expand = button(collapsed.has(task.id) ? '▸' : '▾', () => {
          if (collapsed.has(task.id)) collapsed.delete(task.id); else collapsed.add(task.id);
          rows = hierarchyRows(tasks, collapsed); drawRows();
        }, 'ei-expand'); expand.setAttribute('aria-expanded', String(!collapsed.has(task.id))); expand.setAttribute('aria-label', 'Expand or collapse ' + task.title); identity.append(expand);
        row.setAttribute('aria-expanded', String(!collapsed.has(task.id)));
      } else identity.append(element('span', 'ei-indent'));
      const name = button(task.title, () => select(task), 'ei-task-name'); name.title = '#' + task.id + ' · ' + task.title;
      const meta = element('small', '', '#' + task.id + ' · ' + task.status.replaceAll('_', ' ') + (a.stalled ? ' · inactive' : '') + (a.rollup ? ` · ${a.rollup.completed}/${a.rollup.leaf_count} subtasks` : ''));
      const names = element('div', 'ei-names'); names.append(name, meta); identity.append(names);
      const track = element('div', 'ei-track'); track.setAttribute('role', 'gridcell'); track.style.width = width + 'px';
      if (a.plan) position(track, a.plan.start_date, a.plan.end_date, 'ei-segment--plan', 'Planned: ' + a.plan.start_date + ' → ' + a.plan.end_date);
      const segments = a.segments || [];
      for (const segment of segments) position(track, segment.start, segment.end, 'ei-segment--' + segment.state,
        segment.state + ': ' + segment.start + ' → ' + segment.end + ' · recorded calendar state, not labor');
      if (!segments.length) track.append(element('span', 'ei-no-history', 'State history not recorded'));
      if (a.completed_at) {
        const mark = element('span', 'ei-completed-mark', a.completion_estimated ? '≈✓' : '✓'); mark.style.left = x(a.completed_at) + 'px'; mark.title = (a.completion_estimated ? 'Estimated completion: ' : 'Completed: ') + a.completed_at; track.append(mark);
      }
      if (task.due_date) {
        const due = element('span', 'ei-due-mark', '◇'); due.style.left = x(task.due_date) + 'px'; due.title = 'Due: ' + task.due_date; track.append(due);
      }
      track.onclick = () => select(task);
      row.append(identity, track); body.append(row);
    }
    const today = element('span', 'ei-today'); today.style.left = `calc(var(--ei-label-width) + ${tickX(Math.floor(calendarTime(new Date(now).toISOString(), timeZone) / DAY) * DAY)}px)`; today.setAttribute('aria-label', 'Today in ' + timeZone); body.append(today);
    if (showMilestones) for (const milestone of milestones) if (milestone.due_date) {
      const line = element('span', 'ei-milestone-line'); line.style.left = `calc(var(--ei-label-width) + ${x(milestone.due_date)}px)`; body.append(line);
    }
    drawDependencies(window);
  }
  function drawDependencies(window) {
    if (!dependencies && selected == null) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('ei-dependencies'); svg.style.left = 'var(--ei-label-width)'; svg.setAttribute('width', width); svg.setAttribute('height', rows.length * ROW);
    const indices = new Map(rows.map((r, i) => [r.task.id, i]));
    let count = 0;
    for (const { task } of rows.slice(window.first, window.end)) {
      const sourceIndex = indices.get(task.dependency_id), targetIndex = indices.get(task.id);
      if (sourceIndex == null || (!dependencies && task.id !== selected && task.dependency_id !== selected) || count++ > 200) continue;
      const source = rows[sourceIndex].task;
      const from = source.execution?.completed_at || source.due_date || source.started_at || source.created_at;
      const to = task.started_at || task.execution?.plan?.start_date || task.created_at;
      if (!from || !to) continue;
      const sx = x(from), tx = x(to), sy = sourceIndex * ROW + 26, ty = targetIndex * ROW + 26;
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', `M${sx},${sy} H${Math.max(sx, tx) + 12} V${ty} H${tx} m6,-4 l-6,4 l6,4`);
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `Finish-to-start: #${source.id} → #${task.id}`; path.append(title); svg.append(path);
    }
    body.append(svg);
  }
  function select(task) { selected = task.id; state.selected = selected; chart.setAttribute('aria-activedescendant', 'ei-row-' + task.id); drawRows(); onSelect(task); }
  function layout(fit = state.fit || false, selectedOnly = state.fitSelection || false) {
    state.fit = fit; state.fitSelection = selectedOnly;
    if (selectedOnly && selected) [origin, extent] = bounds(tasks.filter(t => t.id === selected), false);
    else if (fit) [origin, extent] = bounds(tasks);
    const labelWidth = parseFloat(getComputedStyle(chart).getPropertyValue('--ei-label-width')) || 260;
    scale = fit ? Math.max(.1, (chart.clientWidth - labelWidth - 24) / ((extent - origin) / DAY)) : { daily: 48, weekly: 14, monthly: 5, quarterly: 1.8 }[zoom];
    width = Math.max(chart.clientWidth - labelWidth, (extent - origin) / DAY * scale);
    canvas.style.width = `calc(var(--ei-label-width) + ${width}px)`;
    const step = Math.max(1, Math.ceil(48 / scale)); body.style.setProperty('--ei-grid-step', scale * step + 'px');
    drawAxis(); drawRows();
    if (fit) chart.scrollLeft = 0;
  }
  controls.append(button('Today', () => {
    const today = calendarTime(new Date(now).toISOString(), timeZone);
    origin = Math.min(origin, today - 7 * DAY); extent = Math.max(extent, today + 7 * DAY); layout(false, false);
    chart.scrollLeft = Math.max(0, tickX(today) - (chart.clientWidth - 260) / 2);
  }), button('Fit all', () => layout(true)), button('Fit selection', () => layout(true, true)), zoomInput,
  button('Expand all', () => { collapsed.clear(); rows = hierarchyRows(tasks, collapsed); drawRows(); }),
  button('Collapse all', () => { tasks.forEach(t => collapsed.add(t.id)); rows = hierarchyRows(tasks, collapsed); drawRows(); }));
  for (const [text, checked, apply] of [['Dependencies', dependencies, v => { dependencies = state.dependencies = v; drawRows(); }], ['Milestone lines', showMilestones, v => { showMilestones = state.showMilestones = v; drawAxis(); drawRows(); }]]) {
    const lab = element('label', 'ei-check'), input = element('input'); input.type = 'checkbox'; input.checked = checked; input.onchange = () => apply(input.checked); lab.append(input, document.createTextNode(text)); controls.append(lab);
  }
  controls.append(timezoneLabel);
  zoomInput.onchange = () => { zoom = state.zoom = zoomInput.value; layout(false, false); };
  chart.onscroll = () => { state.scrollTop = chart.scrollTop; state.scrollLeft = chart.scrollLeft; if (!pending) pending = requestAnimationFrame(() => { pending = 0; drawRows(); }); };
  chart.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) || event.target !== chart || !rows.length) return;
    event.preventDefault();
    const current = Math.max(0, rows.findIndex(r => r.task.id === selected));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
    selected = state.selected = rows[index].task.id;
    chart.scrollTop = index * ROW; chart.setAttribute('aria-activedescendant', 'ei-row-' + selected); drawRows();
    if (event.key === 'Enter') onSelect(rows[index].task);
  };
  const observer = new ResizeObserver(() => { if (!destroyed) layout(); }); observer.observe(chart);
  layout(); chart.scrollTop = state.scrollTop || 0; chart.scrollLeft = state.scrollLeft || 0;
  return { select, destroy() { destroyed = true; observer.disconnect(); if (pending) cancelAnimationFrame(pending); } };
}
