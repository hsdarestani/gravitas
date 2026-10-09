/* Daily reporting keeps the entry lightweight and the confirmation explicit.
 * This surface edits proposals, never tasks directly. The server binds every
 * approval to a proposal revision and a task revision. Confirmed reports are
 * immutable; corrections are new reports referring to their predecessor.
 *
 * Layout. The first version stacked everything in one column: a date on its
 * own line, a reminder sentence, the task list as outlined buttons, the
 * composer, then filters that stretched a date picker across the page. The
 * thing the reader came to do — write today's report — sat below the fold
 * behind the list of what they were already doing. Writing now leads the
 * main column with the history under it, the open tasks are a reference
 * rail beside it, and a settled report reads as text rather than as a form
 * of disabled inputs, because nothing on it can change any more. */
import { call, label, formatDate } from './ws-platform.js?v=20261008-operational2';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (text, fn, variant = '') => { const b = el('button', `ws-btn${variant ? ` ws-btn--${variant}` : ''}`, text); b.type = 'button'; b.onclick = fn; return b; };
const chip = (text, tone = '') => { const c = el('span', 'wr-chip', text); if (tone) c.dataset.tone = tone; return c; };

const REPORT_STATES = { pending: ['Needs confirmation', 'caution'], confirmed: ['Confirmed', 'positive'], cancelled: ['Cancelled', 'muted'] };
const TASK_TONES = { blocked: 'critical', waiting: 'caution', needs_review: 'caution', retest: 'caution', active: 'accent', ready: 'accent', done: 'positive' };
const UPDATE_FIELDS = [['progress', 'What changed'], ['deliverable', 'Output'], ['blocker', 'Blocker'], ['next_action', 'Next step'], ['artifact_url', 'Artifact link']];

function stamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function section(title, extra) {
  const wrap = el('section', 'wr-card');
  const head = el('header', 'wr-card__head');
  head.append(el('h2', 'wr-card__title', title));
  if (extra) head.append(extra);
  wrap.append(head);
  return wrap;
}

export async function renderWorkReports(host, { go }) {
  host.replaceChildren();
  const doc = el('div', 'ws-doc ws-doc--wide wr'); host.append(doc);

  const head = el('header', 'wr-head');
  const intro = el('div', 'wr-head__intro');
  intro.append(el('h1', 'ws-doc__title', 'Daily Work Reports'), el('p', 'ws-doc__meta', 'Tell Pulsar what changed. Review the proposal before confirming any task updates.'));
  const chips = el('div', 'wr-head__chips');
  head.append(intro, chips);
  doc.append(head);

  const status = el('p', 'wr-notice', 'Loading your work…');
  status.setAttribute('role', 'status');
  doc.append(status);
  const notify = (text) => { status.textContent = text; status.hidden = !text; };

  let data;
  try { data = await call('/platform/work-reports/'); } catch (e) { notify(e.message); doc.append(button('Retry', () => renderWorkReports(host, { go }))); return; }
  notify('');

  const layout = el('div', 'wr-layout');
  const main = el('div', 'wr-main');
  const side = el('aside', 'wr-side');
  layout.append(main, side);
  doc.append(layout);

  /* ---- Check-in state ------------------------------------------------- */
  const prompt = el('p', 'wr-compose__prompt');
  function paintReminder() {
    const checkin = data.checkin || {};
    chips.replaceChildren(
      checkin.confirmed ? chip('Today’s report confirmed', 'positive')
        : checkin.due ? chip('Report due today', 'caution')
          : chip(`Reporting opens ${checkin.hour}:00 · ${checkin.timezone}`),
      checkin.telegram_connected ? chip(`Telegram · ${checkin.telegram_delivery}`) : chip('Telegram not connected', 'muted'),
    );
    prompt.textContent = checkin.confirmed
      ? 'Today’s report is confirmed. Anything new goes in as another report.'
      : checkin.due ? 'Pulsar is asking: what did you work on today?'
        : `Daily reporting starts at ${checkin.hour}:00 (${checkin.timezone}). You can write it here whenever you are ready.`;
  }
  paintReminder();

  /* ---- Composer ------------------------------------------------------- */
  const form = el('form', 'wr-card wr-compose');
  const composeHead = el('header', 'wr-card__head');
  composeHead.append(el('h2', 'wr-card__title', 'Today’s report'), el('span', 'wr-card__meta', formatDate(data.date) || data.date));
  const correctionBar = el('div', 'wr-compose__correction'); correctionBar.hidden = true;
  const input = el('textarea', 'v-input wr-compose__input'); input.rows = 5; input.maxLength = 16000; input.setAttribute('aria-label', 'What did you work on today?'); input.placeholder = 'What did you work on, what changed, and what comes next?';
  const foot = el('div', 'wr-compose__foot');
  const submit = el('button', 'ws-btn ws-btn--solid ws-btn--lg', 'Review with Pulsar'); submit.type = 'submit';
  foot.append(el('small', 'wr-compose__hint', 'Pulsar drafts the task updates. Nothing changes until you confirm.'), submit);
  form.append(composeHead, prompt, correctionBar, input, foot);
  main.append(form);

  let correction = null;
  function setCorrection(report) {
    correction = report ? report.id : null;
    correctionBar.hidden = !report;
    if (!report) return;
    correctionBar.replaceChildren(el('span', null, `Correcting the confirmed report from ${formatDate(report.date) || report.date}. The original stays in history.`), button('Stop correcting', () => setCorrection(null), 'ghost'));
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (!input.value.trim()) { input.focus(); return; }
    submit.disabled = true;
    try {
      const result = await call('/platform/work-reports/', { method: 'POST', body: { text: input.value, source_key: crypto.randomUUID(), supersedes: correction } });
      data.reports.unshift(result.report); input.value = ''; setCorrection(null); dateFilter.value = stateFilter.value = ''; redraw();
      notify('Proposal ready. Tasks have not changed.');
    } catch (e) { notify(e.message); } finally { submit.disabled = false; }
  };

  /* ---- History -------------------------------------------------------- */
  const filters = el('div', 'wr-filters');
  const dateFilter = el('input', 'v-input wr-filters__date'); dateFilter.type = 'date'; dateFilter.setAttribute('aria-label', 'Filter reports by date');
  const stateFilter = el('select', 'v-input wr-filters__state'); stateFilter.setAttribute('aria-label', 'Filter reports by status');
  for (const [value, text] of [['', 'All reports'], ['pending', 'Needs confirmation'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']]) {
    const option = el('option', null, text); option.value = value; stateFilter.append(option);
  }
  const clear = button('Clear', () => { dateFilter.value = stateFilter.value = ''; filterHistory(); }, 'ghost');
  filters.append(dateFilter, stateFilter, clear);
  const historyCard = section('Report history', filters);
  historyCard.classList.add('wr-history');
  const history = el('div', 'wr-history__list');
  historyCard.append(history);
  main.append(historyCard);

  async function filterHistory() {
    const query = new URLSearchParams();
    if (dateFilter.value) query.set('date', dateFilter.value);
    if (stateFilter.value) query.set('status', stateFilter.value);
    try { data.reports = (await call(`/platform/work-reports/?${query}`)).reports; redraw(); }
    catch (error) { notify(`Report history unavailable: ${error.message}`); }
  }
  dateFilter.onchange = stateFilter.onchange = filterHistory;

  function redraw() {
    clear.hidden = !dateFilter.value && !stateFilter.value;
    const shown = data.reports.filter(r => (!dateFilter.value || r.date === dateFilter.value) && (!stateFilter.value || r.status === stateFilter.value));
    history.replaceChildren();
    if (!shown.length) {
      history.append(el('p', 'wr-empty', dateFilter.value || stateFilter.value ? 'No reports match these filters.' : 'No reports yet. Your first one will appear here for review.'));
      return;
    }
    for (const report of shown) history.append(reportCard(report));
  }

  function reportCard(report) {
    const pending = report.status === 'pending';
    const [stateLabel, tone] = REPORT_STATES[report.status] || [label(report.status), ''];
    const card = el('article', 'wr-report'); card.dataset.status = report.status;
    const top = el('header', 'wr-report__head');
    top.append(el('strong', 'wr-report__date', formatDate(report.date) || report.date), chip(stateLabel, tone), el('span', 'wr-report__meta', [label(report.source), stamp(report.created_at)].filter(Boolean).join(' · ')));
    card.append(top);
    if (report.supersedes) card.append(el('p', 'wr-report__note', 'Correction of an earlier confirmed report'));
    card.append(el('blockquote', 'wr-report__text', report.original_text));

    const draft = structuredClone(report.interpretation);
    const updates = el('div', 'wr-updates'); card.append(updates);
    const paintUpdates = () => {
      updates.replaceChildren();
      if (draft.updates.length) updates.append(el('h3', 'wr-updates__title', pending ? 'Proposed task updates' : 'Task updates'));
      for (const update of draft.updates) updates.append(pending ? updateEditor(update) : updateSummary(update));
    };
    paintUpdates();
    if (draft.unmatched_work) {
      const unmatched = el('p', 'wr-report__unmatched');
      unmatched.append(el('span', 'wr-label', 'Unmatched work'), document.createTextNode(draft.unmatched_work));
      card.append(unmatched);
    }

    const tools = el('footer', 'wr-report__actions');
    const act = async action => {
      for (const b of tools.querySelectorAll('button')) b.disabled = true;
      try {
        const result = await call(`/platform/work-reports/${report.id}/`, { method: 'POST', body: { action, revision: report.revision, interpretation: draft } });
        const at = data.reports.findIndex(r => r.id === report.id); data.reports[at] = result.report;
        const refreshed = await call('/platform/work-reports/');
        data.tasks = refreshed.tasks; data.checkin = refreshed.checkin; paintReminder();
        paintWork();
        redraw(); notify(action === 'edit' ? 'Revised proposal saved. Review it, then confirm.' : `Report ${result.report.status}.`);
      } catch (e) { notify(e.message); for (const b of tools.querySelectorAll('button')) b.disabled = false; }
    };
    if (pending) {
      const secondary = el('div', 'wr-report__secondary');
      secondary.append(
        button('Add task update', () => { draft.updates.push({ task_id: null, progress: draft.unmatched_work || '', status: null }); paintUpdates(); }, 'ghost'),
        button('Save revised proposal', () => act('edit'), 'ghost'),
        button('Cancel report', () => act('cancel'), 'ghost'),
      );
      tools.append(secondary, button('Confirm displayed proposal', () => {
        if (JSON.stringify(draft) !== JSON.stringify(report.interpretation)) { notify('Save the revised proposal first, then confirm that version.'); return; }
        act('confirm');
      }, 'solid'));
    } else if (report.status === 'confirmed') {
      tools.append(button('Add correction', () => { setCorrection(report); input.value = report.original_text; input.focus(); form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 'ghost'));
    }
    if (tools.childElementCount) card.append(tools);
    return card;
  }

  function updateEditor(update) {
    const row = el('div', 'wr-update wr-update--edit');
    const picker = el('select', 'v-input'); picker.setAttribute('aria-label', 'Related task');
    const unmatched = el('option', null, 'Unmatched work'); unmatched.value = ''; picker.append(unmatched);
    for (const task of data.tasks) { const o = el('option', null, task.title); o.value = String(task.id); picker.append(o); }
    picker.value = String(update.task_id || '');
    picker.onchange = () => { const task = data.tasks.find(t => String(t.id) === picker.value); update.task_id = task?.id || null; update.title = task?.title || 'Unmatched work'; };
    const statuses = el('select', 'v-input'); statuses.setAttribute('aria-label', 'Suggested status');
    const same = el('option', null, 'Keep status unchanged'); same.value = ''; statuses.append(same);
    for (const [key, text] of data.statuses) { const o = el('option', null, text); o.value = key; statuses.append(o); }
    statuses.value = update.status || ''; statuses.onchange = () => { update.status = statuses.value || null; };
    const top = el('div', 'wr-update__top'); top.append(picker, statuses);
    const grid = el('div', 'wr-update__fields');
    for (const [key, text] of UPDATE_FIELDS) {
      const field = el('input', 'v-input'); field.setAttribute('aria-label', text); field.placeholder = text; field.value = update[key] || ''; field.oninput = () => { update[key] = field.value; };
      const group = el('label', 'wr-field'); group.append(el('span', 'wr-label', text), field); grid.append(group);
    }
    row.append(top, grid);
    return row;
  }

  function updateSummary(update) {
    const row = el('div', 'wr-update');
    const top = el('div', 'wr-update__top');
    top.append(el('strong', null, update.title || 'Unmatched work'));
    if (update.status) top.append(chip(label((data.statuses.find(([key]) => key === update.status) || [, update.status])[1]), TASK_TONES[update.status]));
    row.append(top);
    const list = el('dl', 'wr-update__facts');
    for (const [key, text] of UPDATE_FIELDS) {
      if (!update[key]) continue;
      const value = el('dd');
      if (key === 'artifact_url') { const a = el('a', null, update[key]); a.href = update[key]; a.target = '_blank'; a.rel = 'noopener'; value.append(a); }
      else value.textContent = update[key];
      list.append(el('dt', null, text), value);
    }
    if (list.childElementCount) row.append(list);
    return row;
  }

  /* ---- Open tasks ----------------------------------------------------- */
  const work = section('What should I work on now?');
  work.classList.add('wr-work');
  const workCount = el('span', 'wr-count');
  work.querySelector('.wr-card__head').append(workCount);
  const workList = el('div', 'wr-work__list');
  work.append(workList);
  side.append(work);

  function paintWork() {
    const open = data.tasks.filter(t => !['done', 'archived'].includes(t.status));
    workCount.textContent = String(open.length);
    workList.replaceChildren();
    if (!open.length) { workList.append(el('p', 'wr-empty', 'Nothing open is assigned to you.')); return; }
    for (const task of open) {
      const item = el('div', 'wr-task'); item.dataset.tone = TASK_TONES[task.status] || '';
      const title = el('button', 'wr-task__title', task.title); title.type = 'button';
      title.onclick = () => go(`/workspace/core/tasks?task=${task.id}`);
      const meta = el('div', 'wr-task__meta');
      const overdue = task.due_date && task.due_date < data.date;
      meta.append(chip(String(task.priority || '').toUpperCase()), el('span', 'wr-task__status', label(task.status)));
      if (task.due_date) { const due = el('span', 'wr-task__due', `Due ${formatDate(task.due_date)}`); if (overdue) due.dataset.overdue = 'true'; meta.append(due); }
      item.append(title, meta, el('p', 'wr-task__trace', `${task.objective} → ${task.key_result}`));
      const latest = task.latest_progress || {};
      const notes = el('dl', 'wr-task__notes');
      if (latest.progress) notes.append(el('dt', null, 'Latest'), el('dd', null, latest.progress));
      if (latest.next_action) notes.append(el('dt', null, 'Next'), el('dd', null, latest.next_action));
      if (task.dependency || task.blocked_reason) notes.append(el('dt', null, 'Waiting'), el('dd', null, task.dependency || task.blocked_reason));
      if (notes.childElementCount) item.append(notes);
      if (latest.artifact_url) { const link = el('a', 'wr-task__link', 'Open artifact ↗'); link.href = latest.artifact_url; link.target = '_blank'; link.rel = 'noopener'; item.append(link); }
      workList.append(item);
    }
  }
  paintWork();
  redraw();

  /* ---- Team overview (Core owners and admins) ------------------------- */
  try {
    const overview = await call('/platform/work-reports/overview/');
    const team = el('section', 'wr-team');
    team.append(el('h2', 'wr-team__title', 'Team today'));
    const grid = el('div', 'wr-team__grid');
    const block = (title, items, empty) => {
      const card = section(title);
      const count = el('span', 'wr-count', String(items.length)); card.querySelector('.wr-card__head').append(count);
      const list = el('ul', 'wr-list');
      if (!items.length) list.append(el('li', 'wr-empty', empty));
      for (const item of items) list.append(item);
      card.append(list);
      return card;
    };
    const line = (who, text, tone) => {
      const li = el('li', 'wr-list__item');
      li.append(el('strong', null, who), tone ? chip(text, tone) : el('span', null, text));
      return li;
    };
    grid.append(
      block('Activity', overview.reports.map(r => line(r.user, r.interpretation.summary || r.original_text)), 'No confirmed reports yet today.'),
      block('Reporting coverage', (overview.checkins || []).map(m => {
        const li = line(m.user, m.confirmed ? 'Confirmed' : m.due ? 'Awaiting report' : 'Not due yet', m.confirmed ? 'positive' : m.due ? 'caution' : 'muted');
        li.append(el('small', null, m.telegram_connected ? `Telegram · ${m.telegram_delivery}` : 'Platform only'));
        return li;
      }), 'No Core members to report.'),
      block('Active blockers', overview.blockers.map(t => {
        const li = line(t.owner, t.title);
        li.append(el('small', null, t.reason || t.dependency));
        return li;
      }), 'Nothing is blocked.'),
      block('No update in three days', overview.stale_tasks.map(t => {
        const li = el('li', 'wr-list__item');
        const b = el('button', 'wr-task__title', t.title); b.type = 'button'; b.onclick = () => go(`/workspace/core/tasks?task=${t.id}`);
        li.append(b);
        return li;
      }), 'Every open task has a recent update.'),
    );
    team.append(grid);
    doc.append(team);
  } catch (e) { if (e.status !== 403) notify(`Team overview unavailable: ${e.message}`); }
}
