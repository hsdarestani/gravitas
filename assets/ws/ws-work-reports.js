/* Daily reporting keeps the entry lightweight and the confirmation explicit.
 * This surface edits proposals, never tasks directly. The server binds every
 * approval to a proposal revision and a task revision. Confirmed reports are
 * immutable; corrections are new reports referring to their predecessor. */
import { call } from './ws-platform.js?v=20261008-operational2';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (text, fn) => { const b = el('button', 'ws-btn', text); b.type = 'button'; b.onclick = fn; return b; };

export async function renderWorkReports(host, { go }) {
  host.replaceChildren();
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc wr-page'); host.append(doc);
  doc.append(el('h1', 'ws-doc__title', 'Daily work reports'), el('p', 'fl-muted', 'Tell Pulsar what changed. Review the proposal before confirming any task updates.'));
  const status = el('p', 'fl-muted', 'Loading your work…'); doc.append(status);
  let data;
  try { data = await call('/platform/work-reports/'); } catch (e) { status.textContent = e.message; doc.append(button('Retry', () => renderWorkReports(host, { go }))); return; }
  status.textContent = data.date;
  const reminder = el('p', 'fl-muted'); doc.append(reminder);
  function paintReminder() {
    const checkin = data.checkin || {};
    reminder.textContent = checkin.confirmed ? 'Today’s report is confirmed.' : `${checkin.due ? 'Pulsar is asking: What did you work on today?' : `Daily reporting starts at ${checkin.hour}:00 (${checkin.timezone}).`} ${checkin.telegram_connected ? `Telegram delivery: ${checkin.telegram_delivery}.` : 'Telegram is not connected. You can submit your report here.'}`;
  }
  paintReminder();
  const work = el('section', 'fl-panel'); work.append(el('h2', null, 'What should I work on now?'));
  function paintWork() {
  work.replaceChildren(el('h2', null, 'What should I work on now?'));
  for (const task of data.tasks.filter(t => !['done', 'archived'].includes(t.status))) {
    const r = el('div', 'fl-row wr-work-entry');
    r.append(button(task.title, () => go(`/workspace/core/tasks?task=${task.id}`)), el('small', 'fl-muted', `${task.priority} · ${task.status} · Due ${task.due_date || '—'} · ${task.project}`));
    r.append(el('p', 'fl-muted', `${task.objective} → ${task.key_result}`));
    if (task.latest_progress?.progress) r.append(el('p', null, `Latest progress: ${task.latest_progress.progress}`));
    if (task.latest_progress?.next_action) r.append(el('p', null, `Next: ${task.latest_progress.next_action}`));
    if (task.latest_progress?.artifact_url) { const link = el('a', 'ws-btn', 'Open artifact'); link.href = task.latest_progress.artifact_url; link.target = '_blank'; link.rel = 'noopener'; r.append(link); }
    if (task.dependency || task.blocked_reason) r.append(el('p', null, `Waiting: ${task.dependency || task.blocked_reason}`));
    work.append(r);
  }
  }
  paintWork();
  doc.append(work);
  const input = el('textarea', 'v-input fl-input'); input.rows = 4; input.maxLength = 16000; input.setAttribute('aria-label', 'What did you work on today?'); input.placeholder = 'What did you work on, what changed, and what comes next?';
  let correction = null;
  const form = el('form', 'fl-panel fl-form'); form.append(input);
  const submit = el('button', 'ws-btn ws-btn--solid', 'Review with Pulsar'); submit.type = 'submit'; form.append(submit); doc.append(form);
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try { const result = await call('/platform/work-reports/', { method: 'POST', body: { text: input.value, source_key: crypto.randomUUID(), supersedes: correction } }); data.reports.unshift(result.report); input.value = ''; correction = null; dateFilter.value = stateFilter.value = ''; redraw(); status.textContent = 'Proposal ready. Tasks have not changed.'; }
    catch (e) { status.textContent = e.message; } finally { submit.disabled = false; }
  };
  const history = el('div');
  const filters = el('div', 'fl-row');
  const dateFilter = el('input', 'v-input fl-input'); dateFilter.type = 'date'; dateFilter.setAttribute('aria-label', 'Filter reports by date');
  const stateFilter = el('select', 'v-input fl-input'); stateFilter.setAttribute('aria-label', 'Filter reports by status');
  for (const [value, label] of [['', 'All reports'], ['pending', 'Needs confirmation'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']]) {
    const option = el('option', null, label); option.value = value; stateFilter.append(option);
  }
  async function filterHistory() {
    const query = new URLSearchParams();
    if (dateFilter.value) query.set('date', dateFilter.value);
    if (stateFilter.value) query.set('status', stateFilter.value);
    try { data.reports = (await call(`/platform/work-reports/?${query}`)).reports; redraw(); }
    catch (error) { status.textContent = `Report history unavailable: ${error.message}`; }
  }
  dateFilter.onchange = stateFilter.onchange = filterHistory;
  filters.append(dateFilter, stateFilter, button('Clear filters', () => { dateFilter.value = stateFilter.value = ''; filterHistory(); }));
  doc.append(filters, history);
  function redraw() {
    history.replaceChildren();
    for (const report of data.reports.filter(r => (!dateFilter.value || r.date === dateFilter.value) && (!stateFilter.value || r.status === stateFilter.value))) {
      const card = el('section', 'fl-panel'); card.append(el('h2', null, `${report.date} · ${report.status}`), el('p', 'fl-muted', `${report.source} · ${report.created_at}`), el('p', null, report.original_text));
      if (report.supersedes) card.append(el('small', null, 'Correction of an earlier confirmed report'));
      const draft = structuredClone(report.interpretation);
      const updates = el('div'); card.append(updates);
      const paintUpdates = () => {
        updates.replaceChildren();
        for (const update of draft.updates) {
          const row = el('div', 'fl-panel fl-form-grid');
          const picker = el('select', 'v-input fl-input'); picker.setAttribute('aria-label', 'Related task');
          const unmatched = el('option', null, 'Unmatched work'); unmatched.value = ''; picker.append(unmatched);
          for (const task of data.tasks) { const o = el('option', null, task.title); o.value = String(task.id); picker.append(o); }
          picker.value = String(update.task_id || ''); picker.disabled = report.status !== 'pending';
          picker.onchange = () => { const task = data.tasks.find(t => String(t.id) === picker.value); update.task_id = task?.id || null; update.title = task?.title || 'Unmatched work'; };
          row.append(picker);
          const statuses = el('select', 'v-input fl-input'); statuses.setAttribute('aria-label', 'Suggested status');
          const same = el('option', null, 'Keep status unchanged'); same.value = ''; statuses.append(same);
          for (const [key, label] of data.statuses) { const o = el('option', null, label); o.value = key; statuses.append(o); }
          statuses.value = update.status || ''; statuses.disabled = report.status !== 'pending'; statuses.onchange = () => { update.status = statuses.value || null; }; row.append(statuses);
          for (const [key, label] of [['progress', 'What changed'], ['deliverable', 'Output'], ['blocker', 'Blocker'], ['next_action', 'Next step'], ['artifact_url', 'Artifact link']]) {
            const field = el('input', 'v-input fl-input'); field.setAttribute('aria-label', label); field.placeholder = label; field.value = update[key] || ''; field.disabled = report.status !== 'pending'; field.oninput = () => { update[key] = field.value; }; const group = el('label', 'fl-field'); group.append(el('span', 'fl-field__label', label), field); row.append(group);
          }
          updates.append(row);
        }
      };
      paintUpdates();
      if (draft.unmatched_work) card.append(el('p', null, `Unmatched work: ${draft.unmatched_work}`));
      const tools = el('div', 'fl-row__actions'); card.append(tools);
      const act = async action => {
        for (const b of tools.querySelectorAll('button')) b.disabled = true;
        try {
          const result = await call(`/platform/work-reports/${report.id}/`, { method: 'POST', body: { action, revision: report.revision, interpretation: draft } });
          const at = data.reports.findIndex(r => r.id === report.id); data.reports[at] = result.report;
          const refreshed = await call('/platform/work-reports/');
          data.tasks = refreshed.tasks; data.checkin = refreshed.checkin; paintReminder();
          paintWork();
          redraw(); status.textContent = action === 'edit' ? 'Revised proposal saved. Review it, then confirm.' : `Report ${result.report.status}.`;
        } catch (e) { status.textContent = e.message; for (const b of tools.querySelectorAll('button')) b.disabled = false; }
      };
      if (report.status === 'pending') {
        tools.append(button('Add task update', () => { draft.updates.push({ task_id: null, progress: draft.unmatched_work || '', status: null }); paintUpdates(); }), button('Save revised proposal', () => act('edit')),
          button('Confirm displayed proposal', () => {
            if (JSON.stringify(draft) !== JSON.stringify(report.interpretation)) { status.textContent = 'Save the revised proposal first, then confirm that version.'; return; }
            act('confirm');
          }), button('Cancel', () => act('cancel')));
      } else if (report.status === 'confirmed') tools.append(button('Add correction', () => { correction = report.id; input.value = report.original_text; input.focus(); status.textContent = 'Add a correction. The original report remains in history.'; }));
      history.append(card);
    }
  }
  redraw();
  try {
    const overview = await call('/platform/work-reports/overview/');
    const panel = el('section', 'fl-panel'); panel.append(el('h2', null, 'Team activity today'));
    for (const report of overview.reports) panel.append(el('p', null, `${report.user}: ${report.interpretation.summary || report.original_text}`));
    panel.append(el('h3', null, 'Daily reporting coverage'));
    for (const member of overview.checkins || []) panel.append(el('p', null, `${member.user}: ${member.confirmed ? 'Confirmed today' : member.due ? 'Awaiting report' : 'Not due yet'} · ${member.telegram_connected ? `Telegram: ${member.telegram_delivery}` : 'Platform only · Telegram not connected'}`));
    panel.append(el('h3', null, 'Active blockers'));
    for (const t of overview.blockers) panel.append(el('p', null, `${t.owner} · ${t.title}: ${t.reason || t.dependency}`));
    panel.append(el('h3', null, 'No update in three days'));
    for (const t of overview.stale_tasks) panel.append(button(t.title, () => go(`/workspace/core/tasks?task=${t.id}`)));
    doc.append(panel);
  } catch (e) { if (e.status !== 403) status.textContent = `Team overview unavailable: ${e.message}`; }
}
