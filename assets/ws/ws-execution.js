/* Timeline and Bottleneck Analysis share this one server snapshot and filter
 * state. Drill-down never navigates away; writes use the existing task and
 * milestone APIs, retaining conflict checks and the canonical sync outbox. */
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';
import { renderExecutionGantt, element as el, button, hierarchyRows } from './ws-execution-gantt.js?v=20261016-task1&patch=20261102execution1';

const DAY = 86400;
export function duration(value) {
  if (value == null) return 'Not recorded';
  if (value < 60) return '<1 min';
  if (value < 3600) return Math.round(value / 60) + ' min';
  if (value < DAY) return (value / 3600).toFixed(1) + ' h';
  return (value / DAY).toFixed(1) + ' d';
}
const done = task => ['done', 'archived'].includes(task.status);
const field = (title, input) => { const label = el('label', '', title); label.append(input); return label; };
function selectControl(label, values, value = '') {
  const input = el('select'); input.setAttribute('aria-label', label);
  for (const [id, title] of values) { const opt = el('option', '', title); opt.value = id; input.append(opt); }
  input.value = value; return input;
}
function loadStyle() {
  if (document.getElementById('execution-intelligence-style')) return;
  const sheet = el('link'); sheet.rel = 'stylesheet'; sheet.href = '/assets/ws/ws-execution.css?v=20261016-task1&patch=20261102execution1'; sheet.id = 'execution-intelligence-style'; document.head.append(sheet);
}
export function mountExecution(host, initialTasks, { openTask = () => {}, editPlan = null, projectId = null, mode = 'timeline', state = {} } = {}) {
  loadStyle(); host._execution?.destroy();
  let alive = true, generation = 0, chart = null, drawer = null, previousFocus = null, snapshot = null;
  const mobileMode = matchMedia('(max-width:600px)');
  const onMobileChange = () => { if (snapshot) paint(); };
  mobileMode.addEventListener('change', onMobileChange);
  const allowed = new Set(initialTasks.map(task => Number(task.id)));
  const root = el('section', 'ei'); host.replaceChildren(root);
  root.append(el('p', 'ei-notice', 'Loading recorded execution history and milestones…'));
  const endpoint = projectId ? `/platform/projects/${projectId}/execution/` : '/operating/execution/';
  const params = new URLSearchParams(location.search);
  const filter = state.filters ||= Object.fromEntries(['q', 'project', 'owner', 'status', 'priority', 'milestone', 'from', 'to', 'metric'].map(key => [key, params.get('ei_' + key) || '']));
  if (state.completed == null) state.completed = params.get('ei_completed') !== '0';
  function remember() {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(filter)) { if (value) url.searchParams.set('ei_' + key, value); else url.searchParams.delete('ei_' + key); }
    if (!state.completed) url.searchParams.set('ei_completed', '0'); else url.searchParams.delete('ei_completed');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  function closeDrawer(restore = true) {
    drawer?.remove(); drawer = null;
    if (restore && previousFocus?.isConnected) previousFocus.focus();
  }
  function panel(title) {
    previousFocus = drawer ? previousFocus : document.activeElement;
    closeDrawer(false); drawer = el('aside', 'ei-drawer'); drawer.tabIndex = -1; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', title);
    const head = el('div', 'ei-drawer-head'); head.append(el('h3', '', title), button('Close', () => closeDrawer())); drawer.append(head);
    drawer.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } };
    root.append(drawer); drawer.focus(); return drawer;
  }
  const date = value => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00Z' : value).toLocaleString(undefined, {
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : snapshot.config.timezone,
    year: 'numeric', month: 'short', day: 'numeric', ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : { hour: '2-digit', minute: '2-digit' }),
  }) : 'Not recorded';
  const factDate = (task, key, fallback = null) => {
    const provenance = task.date_provenance?.[key];
    const value = task[key] || fallback;
    if (!value) return 'Not recorded';
    return (['inferred', 'earliest_known'].includes(provenance?.confidence) ? '≈ ' : '') + date(provenance?.precision === 'day' ? value.slice(0, 10) : value);
  };
  function values(container, items) {
    const list = el('dl');
    for (const [title, value] of items) { const entry = el('div'); entry.append(el('dt', '', title), el('dd', '', String(value ?? 'Not recorded'))); list.append(entry); }
    container.append(list);
  }
  const taskById = id => snapshot.tasks.find(t => t.id === Number(id));
  async function saveTask(task, payload, status, saved) {
    saved.disabled = true; status.textContent = 'Saving to server…';
    const url = projectId ? `/platform/projects/${projectId}/tasks/${task.id}/` : `/operating/task-board/${task.id}/`;
    try {
      const result = await P.call(url, { method: 'PATCH', body: { ...payload, expected_updated_at: task.updated_at } });
      if (!result.task?.updated_at) throw new Error('Missing server save confirmation.');
      status.textContent = 'Saved on server.';
      const refreshed = await refresh();
      if (alive && refreshed) showTask(taskById(task.id));
      else status.textContent = 'Saved on server. Analytics refresh failed; use Refresh history.';
    } catch (error) { status.textContent = error.data?.error === 'task_changed_elsewhere' ? 'Changed elsewhere. Refresh and review before saving; your draft is retained.' : 'Save failed: ' + error.message; }
    finally { saved.disabled = false; }
  }
  function showTask(task) {
    if (!task) return;
    state.selected = task.id;
    const container = panel('#' + task.id + ' · ' + task.title), a = task.execution;
    container.append(el('p', '', task.description || 'No description recorded.'));
    values(container, [['Canonical status', task.status], ['Owner', task.owner?.name], ['Priority', task.priority],
      ['Project', task.project_title || 'Unassigned'], ['Parent', task.parent_id ? '#' + task.parent_id : 'None recorded'],
      ['Created', factDate(task, 'created_at')], ['First active', a.first_active_at ? date(a.first_active_at) : factDate(task, 'started_at')], ['Last human activity', date(a.last_human_activity)],
      ['Completed', factDate(task, 'completed_at', a.completed_at)], ['Due date', factDate(task, 'due_date')],
      ['Planned start', date(a.plan?.start_date)], ['Planned finish', date(a.plan?.end_date)]]);
    container.append(el('h4', '', 'Time analytics'));
    values(container, [['Lead time' + (done(task) ? '' : ' · elapsed'), (a.lead_estimated ? '≈ ' : '') + duration(done(task) ? a.lead_seconds : a.elapsed_lead_seconds)],
      ['Cycle time' + (done(task) ? '' : ' · elapsed'), duration(done(task) ? a.cycle_seconds : a.elapsed_cycle_seconds)],
      ['Active state · calendar', duration(a.active_seconds)], ['Recorded work', a.work_seconds == null ? 'Unavailable' : duration(a.work_seconds)],
      ['Waiting state', duration(a.waiting_seconds)], ['Blocked state', duration(a.blocked_seconds)],
      ['Inactivity · calendar', duration(a.inactivity_seconds)], ['Schedule variance', a.schedule_variance_days == null ? 'No deadline' : a.schedule_variance_days + ' calendar days' + (!done(task) ? ' elapsed' : '')],
      ['Reopens recorded', a.reopen_count], ['First human action', duration(a.time_to_first_action_seconds)],
      ['Historical state coverage', a.history_coverage == null ? 'Unknown' : Math.round(a.history_coverage * 100) + '%'], ['History quality', a.history_quality.replaceAll('_', ' ')]]);
    container.append(el('p', 'ei-notice', 'Active-state duration is elapsed calendar time in a status. It is not labor time. Unknown intervals are excluded. ' + (a.forecast ? 'Forecast: ' + date(a.forecast) + ' · limited confidence. ' : '') + a.forecast_explanation));
    if (a.diagnostics.length || a.source_issues.length) {
      container.append(el('h4', '', 'Diagnostics'));
      const list = el('ul'); for (const message of [...a.diagnostics, ...a.source_issues]) list.append(el('li', '', message)); container.append(list);
    }
    container.append(el('h4', '', 'Related work · finish-to-start dependencies'));
    for (const [label, ids] of [['Predecessor', task.dependency_id ? [task.dependency_id] : []], ['Blocking / successors', snapshot.tasks.filter(t => t.dependency_id === task.id).map(t => t.id)], ['Subtasks', snapshot.tasks.filter(t => t.parent_id === task.id).map(t => t.id)]]) {
      const line = el('p', '', label + ': ');
      if (!ids.length) line.append(document.createTextNode('None recorded'));
      for (const id of ids) { const related = taskById(id); if (related) line.append(button('#' + id + ' ' + related.title, () => showTask(related))); }
      container.append(line);
    }
    for (const id of a.milestone_ids) { const milestone = snapshot.milestones.find(m => m.id === id); if (milestone) container.append(button('◆ ' + milestone.title, () => showMilestone(milestone))); }
    const score = el('details'); score.append(el('summary', '', 'Bottleneck score: ' + a.bottleneck_score + ' / 100'));
    values(score, Object.entries(a.bottleneck_components)); score.append(el('p', '', 'Blocked 25, inactivity 20, deadline 20, downstream 15, milestone impact 10, priority 10 maximum points. Missing evidence contributes zero.')); container.append(score);
    container.append(el('h4', '', 'Activity history'));
    const history = el('div');
    renderHistory(history, a); container.append(history);
    if (a.event_count > a.events.length) container.append(button('Load recorded history', async event => {
      event.currentTarget.disabled = true;
      try { const result = await P.call(endpoint + '?task_id=' + task.id); const current = result.tasks.find(t => t.id === task.id); if (container.isConnected && current) renderHistory(history, current.execution); }
      catch (error) { history.append(el('p', 'ei-status', error.message)); }
      finally { if (event.currentTarget) event.currentTarget.disabled = false; }
    }));
    if (task.can_edit) {
      const form = el('form', 'ei-form');
      const status = selectControl('Task status', ['draft', 'active', 'ready', 'waiting', 'needs_review', 'retest', 'blocked', 'done', 'archived'].map(x => [x, x.replaceAll('_', ' ')]), task.status);
      const reason = el('textarea'); reason.value = task.blocked_reason || '';
      const predecessor = selectControl('Predecessor', [['', 'None'], ...snapshot.tasks.filter(t => t.id !== task.id && !a.downstream_ids.includes(t.id)).map(t => [t.id, '#' + t.id + ' ' + t.title])], task.dependency_id || '');
      const milestone = selectControl('Linked milestone', [['', 'None'], ...snapshot.milestones.map(m => [m.id, m.title])], task.milestone_id || '');
      const due = el('input'); due.type = 'date'; due.value = task.due_date || '';
      const weight = el('input'); weight.type = 'number'; weight.min = '1'; weight.max = '100000'; weight.value = task.execution_weight || ''; weight.placeholder = 'Default: 1 per leaf task';
      form.append(field('Status', status), field('Blocker reason', reason), field('Predecessor', predecessor), field('Milestone', milestone), field('Due date', due));
      form.append(field('Milestone weight', weight));
      const feedback = el('p', 'ei-status'); feedback.setAttribute('role', 'status');
      const save = button('Save changes', () => {}); save.type = 'submit';
      form.onsubmit = event => { event.preventDefault(); const payload = { status: status.value, blocked_reason: reason.value, due_date: due.value || null };
        if (predecessor.value !== String(task.dependency_id || '')) payload.dependency_id = predecessor.value ? Number(predecessor.value) : null;
        if (milestone.value !== String(task.milestone_id || '')) payload.milestone_id = milestone.value ? Number(milestone.value) : null;
        payload.execution_weight = weight.value ? Number(weight.value) : null;
        void saveTask(task, payload, feedback, save);
      };
      form.append(save, feedback); container.append(el('h4', '', 'Manage task'), form);
      const planning = el('form', 'ei-form'), start = el('input'), finish = el('input'), estimate = el('input');
      start.type = finish.type = 'date'; start.required = finish.required = true; start.value = a.plan?.start_date || ''; finish.value = a.plan?.end_date || task.due_date || '';
      estimate.type = 'number'; estimate.min = '0'; estimate.max = '525600'; estimate.value = a.plan?.estimated_minutes || 0;
      const planStatus = el('p', 'ei-status'), planSave = button('Save planned schedule', () => {}); planSave.type = 'submit';
      planning.append(field('Planned start', start), field('Planned finish', finish), field('Estimated work · minutes', estimate), planSave, planStatus);
      planning.onsubmit = async event => { event.preventDefault(); planSave.disabled = true; planStatus.textContent = 'Saving plan…';
        const path = task.project_id ? `/platform/projects/${task.project_id}/schedules/` : '/operating/execution/schedules/';
        try { await P.call(path, { method: 'POST', body: { task_id: task.id, start_date: start.value, end_date: finish.value, estimated_minutes: Number(estimate.value), expected_updated_at: a.plan?.updated_at || null } }); await refresh(); showTask(taskById(task.id)); }
        catch (error) { planStatus.textContent = error.message; } finally { planSave.disabled = false; }
      };
      container.append(el('h4', '', 'Planned schedule'), planning);
    }
    container.append(button('Open full task editor', () => { closeDrawer(); openTask(task); }));
  }
  function renderHistory(container, analytics) {
    container.replaceChildren();
    if (!analytics.events.length) container.append(el('p', '', 'No audit events recorded.'));
    for (const event of [...analytics.events].reverse()) {
      const row = el('div', 'ei-event'); row.append(el('time', '', date(event.created_at)), el('div', '', event.action.replaceAll('_', ' ') + ' · ' + event.source));
      const changes = event.changes || event.detail?.changes || {};
      row.append(el('small', '', Object.entries(changes).map(([key, value]) => key + ': ' + String(value?.from ?? 'None') + ' → ' + String(value?.to ?? 'None')).join('\n'))); container.append(row);
    }
    if (analytics.event_count > analytics.events.length) container.append(el('p', 'ei-notice', `Showing the latest ${analytics.events.length} of ${analytics.event_count} recorded events.`));
  }
  function showMilestone(milestone) {
    const container = panel('◆ ' + milestone.title);
    container.append(el('p', '', milestone.description || 'No definition of done recorded.'));
    values(container, [['Delivery status', milestone.delivery_status.replaceAll('_', ' ')], ['Owner', milestone.owner?.name],
      ['Target date', date(milestone.due_date)], ['Actual completion', date(milestone.completed_at)],
      ['Weighted progress', milestone.progress == null ? 'No linked tasks' : Math.round(milestone.progress * 100) + '%'], ['Forecast', milestone.forecast ? date(milestone.forecast) + ' · limited confidence' : 'Unavailable']]);
    container.append(el('p', '', milestone.weight_basis + ' ' + milestone.forecast_explanation));
    container.append(button('Highlight linked tasks', () => { filter.milestone = String(milestone.id); remember(); closeDrawer(); build(); }));
    container.append(el('h4', '', 'Unfinished work and risk factors'));
    if (!milestone.unfinished_ids.length) container.append(el('p', '', milestone.task_ids.length ? 'No unfinished linked leaf tasks.' : 'No task associations recorded.'));
    for (const id of milestone.unfinished_ids) {
      const task = taskById(id); if (!task) continue;
      const factor = milestone.risk_factors.find(f => f.task_id === id);
      container.append(button('#' + id + ' ' + task.title, () => showTask(task)), el('p', 'ei-muted', factor?.reasons.join(' · ') || task.status));
    }
    if (milestone.can_edit) milestoneForm(container, milestone);
  }
  function milestoneForm(container, milestone = null, keyResults = []) {
    const form = el('form', 'ei-form'), title = el('input'), target = el('input'); title.value = milestone?.title || ''; title.required = true; target.type = 'date'; target.value = milestone?.due_date || '';
    const status = selectControl('Milestone status', [['active', 'Planned / active'], ['done', 'Completed'], ['blocked', 'Blocked']], milestone?.status || 'active');
    const kr = selectControl('Key Result', keyResults.map(k => [k.id, k.title]));
    form.append(field('Title', title), field('Target date', target), field('Status', status));
    if (!milestone && !projectId) form.append(field('Existing Key Result', kr));
    const feedback = el('p', 'ei-status'), save = button('Save milestone', () => {}); save.type = 'submit';
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true; feedback.textContent = 'Saving to server…';
      const url = projectId ? `/platform/projects/${projectId}/milestones/${milestone ? milestone.id + '/' : ''}` : `/operating/milestones/${milestone ? milestone.id + '/' : ''}`;
      const payload = { title: title.value, due_date: target.value || null, status: status.value };
      if (milestone) payload.expected_updated_at = milestone.updated_at;
      else if (!projectId) { payload.key_result_id = Number(kr.value); payload.owner_id = (P.platform.user?.user || P.platform.user)?.id; }
      try { const result = await P.call(url, { method: milestone ? 'PATCH' : 'POST', body: payload });
        if (!result.milestone?.id) throw new Error('Missing milestone save confirmation.');
        await refresh(); const saved = snapshot.milestones.find(m => m.id === result.milestone.id); if (saved) showMilestone(saved);
      } catch (error) { feedback.textContent = 'Save failed: ' + error.message; }
      finally { save.disabled = false; }
    };
    form.append(save, feedback); container.append(form);
  }
  function showCalendar() {
    const container = panel('Execution calendar'), form = el('form', 'ei-form');
    const zone = el('input'); zone.value = snapshot.config.timezone;
    const threshold = el('input'); threshold.type = 'number'; threshold.min = 1; threshold.max = 90; threshold.value = snapshot.config.inactivity_business_days;
    const days = selectControl('Business week', [['0,1,2,3,4', 'Monday – Friday'], ['5,6,0,1,2', 'Saturday – Wednesday'], ['6,0,1,2,3', 'Sunday – Thursday'], ['0,1,2,3,4,5,6', 'Every day']], snapshot.config.business_weekdays.join(','));
    if (!days.value) { const custom = el('option', '', 'Current custom weekdays'); custom.value = snapshot.config.business_weekdays.join(','); days.append(custom); days.value = custom.value; }
    form.append(field('Timezone · IANA name', zone), field('Inactivity threshold · business days', threshold), field('Business week', days));
    const feedback = el('p', 'ei-status'), save = button('Save calendar', () => {}); save.type = 'submit';
    form.onsubmit = async event => { event.preventDefault(); save.disabled = true;
      try { await P.call('/operating/execution/settings/', { method: 'PATCH', body: { timezone: zone.value, inactivity_business_days: Number(threshold.value), business_weekdays: days.value.split(',').map(Number), expected_updated_at: snapshot.config.updated_at } }); closeDrawer(); await refresh(); }
      catch (error) { feedback.textContent = error.message; } finally { save.disabled = false; }
    };
    container.append(el('p', '', 'Changes are audited. Calendar durations and business-day inactivity are separate. Holidays are not configured.'), form); form.append(save, feedback);
  }
  let content, metrics;
  function filteredTasks() {
    let rows = snapshot.tasks.filter(t => allowed.has(t.id));
    const milestone = snapshot.milestones.find(m => String(m.id) === filter.milestone);
    const risk = new Set(snapshot.milestones.filter(m => ['at_risk', 'delayed'].includes(m.delivery_status)).flatMap(m => m.task_ids));
    return rows.filter(t => {
      const a = t.execution;
      if (!state.completed && done(t) || filter.project && String(t.project_id || '') !== filter.project || filter.owner && String(t.owner?.id) !== filter.owner || filter.status && t.status !== filter.status || filter.priority && t.priority !== filter.priority) return false;
      if (filter.q && !('#' + t.id + ' ' + t.title).toLowerCase().includes(filter.q.toLowerCase())) return false;
      if (milestone && !milestone.task_ids.includes(t.id)) return false;
      if (filter.from && String(a.completed_at || snapshot.as_of).slice(0, 10) < filter.from || filter.to && String(t.created_at || '').slice(0, 10) > filter.to) return false;
      const tests = { open: !done(t), active: ['active', 'retest'].includes(t.status), completed: done(t), blocked: t.status === 'blocked', stalled: a.stalled, cycle_seconds: a.cycle_seconds != null, blocked_seconds: (a.blocked_seconds || 0) > 0, at_risk_milestones: risk.has(t.id) };
      return !filter.metric || tests[filter.metric];
    });
  }
  function paint() {
    if (!alive || !content) return;
    remember(); chart?.destroy(); chart = null; content.replaceChildren();
    const rows = filteredTasks();
    const applicableMilestones = snapshot.milestones.filter(m => (!filter.project || String(m.project_id) === filter.project) && (!filter.milestone || String(m.id) === filter.milestone));
    const cycles = rows.map(t => t.execution.cycle_seconds).filter(v => v != null);
    const cards = [['open', 'Open tasks', rows.filter(t => !done(t)).length], ['active', 'Active tasks', rows.filter(t => ['active', 'retest'].includes(t.status)).length], ['completed', 'Completed tasks', rows.filter(t => done(t)).length], ['blocked', 'Blocked tasks', rows.filter(t => t.status === 'blocked').length], ['stalled', 'Stalled tasks', rows.filter(t => t.execution.stalled).length], ['cycle_seconds', 'Average cycle · completed', cycles.length ? duration(cycles.reduce((a, b) => a + b, 0) / cycles.length) : 'Unavailable'], ['blocked_seconds', 'Recorded blocked time', rows.some(t => t.execution.blocked_seconds != null) ? duration(rows.reduce((sum, t) => sum + (t.execution.blocked_seconds || 0), 0)) : 'Unavailable'], ['at_risk_milestones', 'At-risk milestones', applicableMilestones.filter(m => ['at_risk', 'delayed'].includes(m.delivery_status)).length]];
    const stats = el('div', 'ei-stats');
    for (const [key, label, value] of cards) { const card = button('', () => { filter.metric = filter.metric === key ? '' : key; paint(); }, 'ei-stat'); card.title = snapshot.definitions[key] || label; card.setAttribute('aria-pressed', String(filter.metric === key)); card.append(el('strong', '', String(value)), el('span', '', label)); stats.append(card); }
    metrics.replaceChildren(stats);
    const summary = el('p', 'ei-notice', rows.length + ' tasks · ' + applicableMilestones.length + ' milestones · as of ' + date(snapshot.as_of) + (filter.metric ? ' · ' + filter.metric.replaceAll('_', ' ') : ''));
    if (filter.metric) summary.append(button('Clear metric filter', () => { filter.metric = ''; paint(); })); content.append(summary);
    const milestones = el('div', 'ei-milestones');
    for (const milestone of applicableMilestones) {
      const card = button('', () => showMilestone(milestone), 'ei-milestone'); card.dataset.risk = milestone.delivery_status;
      card.append(el('strong', '', '◆ ' + milestone.title), el('small', '', (milestone.due_date || 'No target date') + ' · ' + milestone.delivery_status.replaceAll('_', ' ')), el('small', '', milestone.progress == null ? 'No linked tasks' : Math.round(milestone.progress * 100) + '% · weighted leaf tasks'));
      if (milestone.progress != null) { const track = el('div', 'ei-progress'), fill = el('span'); fill.style.width = milestone.progress * 100 + '%'; track.append(fill); card.append(track); } milestones.append(card);
    }
    content.append(milestones);
    if (!rows.length) { content.append(el('p', 'ei-notice', 'No tasks match these filters. Clear filters to inspect other authorized work.')); return; }
    if (mode === 'analysis') renderAnalysis(content, rows, applicableMilestones);
    else {
      const legend = el('div', 'ei-legend'); for (const [cls, label] of [['waiting', 'Waiting'], ['active', 'Active state'], ['blocked', 'Blocked'], ['stalled', 'Inactive signal in task label'], ['unknown', 'Unknown history'], ['completed', 'Completed'], ['planned', 'Planned']]) legend.append(el('span', cls, label)); content.append(legend);
      if (!mobileMode.matches) chart = renderExecutionGantt(content, rows, applicableMilestones, { onSelect: showTask, onMilestone: showMilestone, timeZone: snapshot.config.timezone, now: Date.parse(snapshot.as_of), state });
      if (!mobileMode.matches) return;
      const mobile = el('div', 'ei-mobile-list');
      const mobileRows = hierarchyRows(rows, state.collapsed || new Set());
      for (const { task, depth, hasChildren } of mobileRows.slice(0, state.mobileLimit || 100)) {
        const card = el('article', 'ei-mobile-card'); card.style.marginLeft = Math.min(depth, 4) * 8 + 'px';
        if (hasChildren) card.append(button(state.collapsed?.has(task.id) ? 'Expand subtasks' : 'Collapse subtasks', () => { state.collapsed ||= new Set(); if (state.collapsed.has(task.id)) state.collapsed.delete(task.id); else state.collapsed.add(task.id); paint(); }));
        card.append(button('#' + task.id + ' ' + task.title, () => showTask(task)), el('p', '', task.status + (task.execution.stalled ? ' · inactive' : '') + ' · Due ' + (task.due_date || 'not scheduled')), el('p', 'ei-muted', 'Active state: ' + duration(task.execution.active_seconds) + ' · Blocked: ' + duration(task.execution.blocked_seconds))); mobile.append(card);
      }
      if (mobileRows.length > (state.mobileLimit || 100)) mobile.append(button('Show 100 more tasks', () => { state.mobileLimit = (state.mobileLimit || 100) + 100; paint(); }));
      content.append(mobile);
    }
  }
  function renderAnalysis(container, rows, milestones) {
    const grid = el('div', 'ei-analysis');
    const rank = (title, subset, value, label) => {
      const section = el('section', 'ei-ranking'); section.append(el('h4', '', title));
      const ordered = subset.filter(t => value(t) != null).sort((a, b) => value(b) - value(a)).slice(0, 10);
      if (!ordered.length) section.append(el('p', 'ei-notice', 'No recorded data in this selection.'));
      for (const task of ordered) { const row = button('', () => showTask(task), 'ei-rank-row'); row.title = task.title + (task.blocked_reason ? ' · ' + task.blocked_reason : ''); row.append(el('span', '', '#' + task.id + ' ' + task.title), el('small', '', label(task))); section.append(row); }
      grid.append(section);
    };
    rank('Prioritize today · explainable score', rows.filter(t => !done(t)), t => t.execution.bottleneck_score, t => t.execution.bottleneck_score + ' / 100');
    rank('Longest cycle · completed', rows.filter(done), t => t.execution.cycle_seconds, t => duration(t.execution.cycle_seconds));
    rank('Aging work · open cycle', rows.filter(t => !done(t)), t => t.execution.elapsed_cycle_seconds, t => duration(t.execution.elapsed_cycle_seconds));
    rank('Most recorded blocked time', rows, t => t.execution.blocked_seconds, t => duration(t.execution.blocked_seconds));
    rank('Stalled work · business days', rows.filter(t => t.execution.stalled), t => t.execution.inactivity_business_days, t => t.execution.inactivity_business_days + ' business days');
    rank('Overdue or finished late', rows.filter(t => t.execution.overdue || t.execution.finished_late), t => t.execution.schedule_variance_days, t => t.execution.schedule_variance_days + ' calendar days');
    container.append(grid);
    const health = el('section', 'ei-ranking'); health.append(el('h4', '', 'Execution health by project'));
    const table = el('table', 'ei-table'), header = el('tr'); ['Project', 'Open', 'Blocked', 'Stalled', 'Median cycle'].forEach(x => header.append(el('th', '', x))); table.append(header);
    const projects = new Map(); for (const task of rows) { if (!projects.has(task.project_id)) projects.set(task.project_id, []); projects.get(task.project_id).push(task); }
    for (const tasks of projects.values()) { const values = tasks.map(t => t.execution.cycle_seconds).filter(x => x != null).sort((a, b) => a - b); const mid = Math.floor(values.length / 2); const med = values.length ? values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2 : null;
      const row = el('tr'); [tasks[0].project_title || 'Unassigned', tasks.filter(t => !done(t)).length, tasks.filter(t => t.status === 'blocked').length, tasks.filter(t => t.execution.stalled).length, duration(med)].forEach(x => row.append(el('td', '', String(x)))); table.append(row); }
    health.append(table); container.append(health);
    const risk = el('section', 'ei-ranking'); risk.append(el('h4', '', 'Milestone risk'));
    for (const milestone of milestones.filter(m => ['at_risk', 'delayed'].includes(m.delivery_status))) risk.append(button(milestone.title + ' · ' + milestone.delivery_status.replaceAll('_', ' '), () => showMilestone(milestone)));
    if (!risk.querySelector('button')) risk.append(el('p', 'ei-notice', 'No recorded risk signals in this milestone selection.')); container.append(risk);
  }
  function build() {
    if (!alive) return;
    chart?.destroy(); root.replaceChildren();
    const head = el('div', 'ei-heading'), title = el('div'); title.append(el('h3', '', mode === 'analysis' ? 'Bottleneck Analysis' : 'Execution Intelligence'), el('small', '', 'Track progress, identify bottlenecks, and understand milestone delivery.')); head.append(title, button('Refresh history', () => refresh()));
    if (snapshot.can_manage) head.append(button('Execution calendar', showCalendar));
    if (snapshot.can_manage || projectId && snapshot.tasks.some(t => t.can_edit)) head.append(button('New milestone', async () => {
      const container = panel('New milestone');
      try { const result = projectId ? { key_results: [] } : await P.call('/operating/key-results/'); if (container.isConnected) milestoneForm(container, null, result.key_results || []); }
      catch (error) { container.append(el('p', 'ei-status', error.message)); }
    }));
    metrics = el('div'); root.append(head, metrics);
    const filters = el('div', 'ei-filters');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Task title or #ID'; search.value = filter.q; search.setAttribute('aria-label', 'Search execution tasks'); search.oninput = () => { filter.q = search.value; paint(); }; filters.append(search);
    const choices = [
      ['project', 'All projects', new Map(snapshot.tasks.filter(t => t.project_id).map(t => [t.project_id, t.project_title]))],
      ['owner', 'All owners', new Map(snapshot.tasks.filter(t => t.owner).map(t => [t.owner.id, t.owner.name]))],
      ['status', 'All statuses', new Map(snapshot.tasks.map(t => [t.status, t.status.replaceAll('_', ' ')]))],
      ['priority', 'All priorities', new Map(['p0', 'p1', 'p2', 'p3'].map(x => [x, x.toUpperCase()]))],
      ['milestone', 'All milestones', new Map(snapshot.milestones.map(m => [m.id, m.title]))],
    ];
    for (const [key, title, values] of choices) { if (key === 'project' && projectId) continue; const control = selectControl(title, [['', title], ...values], filter[key]); control.onchange = () => { filter[key] = control.value; paint(); }; filters.append(control); }
    for (const key of ['from', 'to']) { const input = el('input'); input.type = 'date'; input.value = filter[key]; input.title = key === 'from' ? 'Execution range starts' : 'Execution range ends'; input.setAttribute('aria-label', input.title); input.onchange = () => { filter[key] = input.value; paint(); }; filters.append(input); }
    const completed = el('input'); completed.type = 'checkbox'; completed.checked = state.completed; completed.onchange = () => { state.completed = completed.checked; paint(); }; filters.append(field('Show completed', completed), button('Clear filters', () => { Object.keys(filter).forEach(k => filter[k] = ''); state.completed = true; build(); }));
    root.append(filters, el('p', 'ei-notice', snapshot.history_notice)); content = el('div'); root.append(content); paint();
  }
  async function refresh() {
    const version = ++generation;
    try { const result = await P.call(endpoint);
      if (!alive || version !== generation || !root.isConnected) return;
      snapshot = result; build();
      return true;
    } catch (error) {
      if (!alive || version !== generation) return;
      if (snapshot) root.prepend(el('p', 'ei-status', 'Refresh failed. Displayed values retain their previous as-of time: ' + error.message));
      else { root.replaceChildren(el('p', 'ei-status', 'Execution history unavailable: ' + error.message), button('Retry', () => refresh())); }
      return false;
    }
  }
  const lifecycle = { destroy() { alive = false; generation++; chart?.destroy(); closeDrawer(false); mobileMode.removeEventListener('change', onMobileChange); } };
  host._execution = lifecycle;
  void refresh(); return lifecycle;
}
