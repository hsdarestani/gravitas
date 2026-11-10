/* A task has one next action. The remaining steps, other QA parts, and
   submitted rounds stay available in disclosures on the same card. */
import { call } from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';

const errors = {
  workflow_approval_required: 'Approve every QA part, then choose Final approval in the workflow.',
  workflow_already_approved: 'This workflow already has final approval.',
  workflow_changed: 'Someone updated this workflow. Copy any unsaved edits before refreshing.',
  workflow_closed: 'This workflow is closed.',
  workflow_finish_steps: 'Finish the workflow steps before submitting QA.',
  workflow_finish_checklist: 'Check off each item before submitting for review.',
  workflow_checklist_required: 'Keep at least one checklist item.',
  workflow_invalid_checklist: 'Give each checklist item a short, clear name.',
  workflow_keep_requested_fixes: 'Keep the requested fixes in the checklist.',
  workflow_invalid_preview: 'Enter a full preview link starting with https:// or http://.',
  workflow_invalid_reference: 'Enter a full reference link starting with https:// or http://.',
  workflow_preview_required: 'Add a preview link for the reviewer.',
  workflow_reviewer_required: 'Another task editor needs to review this submission.',
  workflow_feedback_required: 'Enter feedback before posting.',
  workflow_fixes_required: 'Enter one short fix per line. Leave room for the fixes in the checklist.',
  workflow_iteration_closed: 'This round is closed. Refresh to see the latest round.',
  workflow_names_required: 'Enter one to ten steps and one to ten QA parts.',
  workflow_invalid_name: 'Keep step and QA part names under 80 characters.',
  workflow_duplicate_name: 'Use each step or QA part name once.',
  workflow_step_locked: 'Manage this step from its parent workflow.',
  permission_denied: 'You don’t have permission to make this change.',
};
export function workflowError(error, fallback) {
  return errors[error?.data?.error] || fallback || error?.data?.error || error?.message || 'Something went wrong. Try again.';
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function button(label, run, primary = false) {
  const element = node('button', primary ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  element.type = 'button';
  element.addEventListener('click', run);
  return element;
}

function field(label, input) {
  const element = node('label', 'wf-field');
  input.setAttribute('aria-label', label);
  element.append(node('span', '', label), input);
  return element;
}

function input(type, value = '') {
  const element = node('input', type === 'checkbox' ? '' : 'v-input');
  element.type = type;
  element.value = value;
  return element;
}

function textarea(value = '', rows = 3) {
  const element = node('textarea', 'v-input');
  element.value = value;
  element.rows = rows;
  return element;
}

export function taskOptions(...fields) {
  const element = node('details', 'wf-options');
  const body = node('div', 'wf-options__body');
  body.append(...fields);
  element.append(node('summary', '', 'More options'), body);
  return element;
}

function map(labels, current = -1) {
  const list = node('ol', 'wf-map');
  labels.forEach((label, index) => {
    const item = node('li', '', label);
    if (index === current) item.setAttribute('aria-current', 'step');
    list.append(item);
  });
  return list;
}

export function workflowPicker() {
  const element = node('div', 'wf-picker');
  const select = node('select', 'v-input');
  select.append(new Option('No workflow', ''));
  const preview = node('div', 'wf-picker__preview');
  const custom = node('div', 'wf-picker__custom');
  const steps = textarea();
  steps.placeholder = 'One step per line';
  const parts = textarea();
  parts.placeholder = 'One QA part per line';
  custom.append(field('Steps', steps), field('QA parts', parts));
  custom.hidden = true;
  const status = node('small', 'wf-note');
  status.setAttribute('role', 'status');
  let templates = [];
  let creation = null;
  const lines = control => control.value.split('\n').map(value => value.trim()).filter(Boolean);
  const update = () => {
    const template = templates.find(item => item.id === select.value);
    custom.hidden = template?.id !== 'graphic_design';
    preview.replaceChildren();
    if (!template) return;
    const names = custom.hidden ? template.steps : lines(steps);
    const checks = custom.hidden ? template.parts : lines(parts);
    if (names.length) preview.append(map([...names, 'QA', 'Final approval']));
    if (checks.length) preview.append(node('p', 'wf-note', 'QA: ' + checks.join(' · ')));
  };
  select.addEventListener('change', update);
  steps.addEventListener('input', update);
  parts.addEventListener('input', update);
  element.append(field('Workflow', select), custom, preview, status);

  async function load() {
    status.textContent = 'Loading workflows…';
    try {
      templates = (await call('/platform/task-workflow-templates/')).templates;
      select.replaceChildren(new Option('No workflow', ''), ...templates.map(item => new Option(item.label, item.id)));
      status.textContent = '';
    } catch {
      status.replaceChildren('Workflows are unavailable. ', button('Retry', load));
    }
  }
  void load();
  return {
    element,
    value(taskFields) {
      if (!select.value) return undefined;
      const config = { template: select.value };
      if (select.value === 'graphic_design') {
        config.steps = lines(steps);
        config.parts = lines(parts);
      }
      const fingerprint = JSON.stringify([config, taskFields]);
      if (creation?.fingerprint !== fingerprint) creation = { fingerprint, id: crypto.randomUUID() };
      return { ...config, creation_id: creation.id };
    },
  };
}

export function workflowStatusOptions(options, task) {
  if (task.workflow_state === 'pending') return options.filter(([value]) => value !== 'done');
  if (task.workflow_state === 'approved') return options.filter(([value]) => ['done', 'archived'].includes(value));
  if (task.workflow_position != null) return options.filter(([value]) => task.status === 'done' ? value === 'done' : value !== 'archived');
  return options;
}

const roundName = (part, round) => 'QA ' + part.name + ' ' + String(round.number).padStart(3, '0');
const currentRound = part => part.iterations.at(-1);
const labels = { draft: 'To submit', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved' };

function badge(label, state = '') {
  const element = node('span', 'wf-badge', label);
  element.dataset.state = state;
  return element;
}

function feedbackList(round) {
  const list = node('ul', 'wf-feedback');
  for (const item of round.comments) {
    const entry = node('li');
    entry.append(node('strong', '', item.by.name), node('p', '', item.text));
    list.append(entry);
  }
  return list;
}

function roundEvidence(round) {
  const evidence = node('div', 'wf-round__evidence');
  const links = node('div', 'wf-actions');
  for (const [name, value] of [['Open preview', round.preview], ['Open reference', round.reference]]) {
    if (!value) continue;
    const link = node('a', 'ws-btn', name);
    link.href = value;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  evidence.append(links);
  if (round.submitted) evidence.append(node('small', 'wf-note', 'Submitted by ' + round.submitted.by.name));
  if (round.reviewed) evidence.append(node('small', 'wf-note', labels[round.status] + ' by ' + round.reviewed.by.name));
  const checklist = node('details', 'wf-disclosure');
  checklist.append(node('summary', '', 'Submitted checklist'));
  const list = node('ul', 'wf-read-checklist');
  for (const item of round.items) list.append(node('li', '', (item.done ? '✓ ' : '') + item.text));
  checklist.append(list);
  evidence.append(checklist, feedbackList(round));
  return evidence;
}

export function mountTaskWorkflow(host, task, { projectId, onChange, openStep, more } = {}) {
  const section = node('section', 'wf-card');
  section.setAttribute('aria-label', 'Task workflow');
  const content = node('div', 'wf-content');
  const feedback = node('p', 'wf-notice');
  feedback.setAttribute('role', 'status');
  const details = more ? button('Task details', more) : null;
  section.append(content, feedback);
  if (details) section.append(node('div', 'wf-footer'));
  section.querySelector('.wf-footer')?.append(details);
  host.append(section);
  const path = projectId == null ? `/operating/tasks/${task.id}/workflow/` :
    `/platform/projects/${projectId}/tasks/${task.id}/workflow/`;
  let data;
  let busy = false;
  let selected = null;
  let showSteps = false;
  const drafts = new Map();

  async function load() {
    section.insertBefore(feedback, content);
    feedback.textContent = 'Loading workflow…';
    try {
      data = (await call(path)).workflow;
      drafts.clear();
      feedback.textContent = '';
      paint();
    } catch (error) {
      feedback.replaceChildren(workflowError(error), ' ', button('Retry', load));
    }
  }

  async function act(action, fields = {}, source = null) {
    if (busy) return;
    busy = true;
    const area = source?.closest('.wf-next, .wf-round__draft, .wf-review');
    if (area) area.append(feedback);
    content.inert = true;
    feedback.textContent = 'Saving…';
    try {
      data = (await call(path, { method: 'POST', body: { action, revision: data.revision, ...fields } })).workflow;
      if (fields.part) drafts.delete(fields.part);
      if (action === 'approve' || action === 'submit') selected = null;
      feedback.textContent = {
        complete_step: 'Step completed.', save: 'Draft saved.', submit: 'Sent for review.',
        comment: 'Comment posted.', request_changes: 'Fixes added to the next round.',
        approve: 'QA part approved.', finalize: 'Task approved and marked done.',
      }[action];
      section.insertBefore(feedback, content);
      paint();
      if (action === 'finalize')
        Promise.resolve().then(() => onChange?.()).catch(() => {});
    } catch (error) {
      feedback.textContent = workflowError(error);
      if (error.status === 409 || error.code === 'request_timeout') feedback.append(' ', button('Refresh workflow', load));
    } finally {
      content.inert = false;
      busy = false;
      const target = source?.isConnected ? source :
        content.querySelector('.wf-part[open] > summary, .wf-next button, [aria-current="step"]');
      target?.focus({ preventScroll: !!source?.isConnected });
    }
  }

  function draftEditor(part, round) {
    const key = { part: part.id, iteration: round.number };
    const state = drafts.get(part.id) || {
      items: round.items.map(item => ({ ...item })), preview: round.preview, reference: round.reference,
    };
    drafts.set(part.id, state);
    const body = node('div', 'wf-round__draft');
    const list = node('div', 'wf-checklist');
    const edit = node('details', 'wf-disclosure');
    const fields = node('div', 'wf-checklist__edit');
    const add = button('Add item', () => {
      state.items.push({ text: '', done: false });
      paintItems();
      fields.querySelector('div:last-child input')?.focus();
      changed();
    });
    edit.append(node('summary', '', 'Edit checklist'), fields, add);
    const preview = input('url', state.preview);
    preview.placeholder = 'https://';
    const reference = input('url', state.reference);
    reference.placeholder = 'https://';
    const moreLinks = node('details', 'wf-disclosure');
    moreLinks.open = !!state.reference;
    moreLinks.append(node('summary', '', 'Reference link (optional)'), field('Reference link', reference));
    const send = button('Submit for review', () => act('submit', { ...key, ...state }, send), true);
    const save = button('Save draft', () => act('save', { ...key, ...state }, save));
    const actions = node('div', 'wf-actions');
    actions.append(send, save);
    const changed = () => {
      save.hidden = JSON.stringify(state) === JSON.stringify({ items: round.items, preview: round.preview, reference: round.reference });
    };
    const paintItems = () => {
      list.replaceChildren();
      fields.replaceChildren();
      add.disabled = state.items.length >= data.max_items;
      state.items.forEach((item, index) => {
        const check = input('checkbox');
        check.checked = item.done;
        const text = node('span', '', item.text || 'New checklist item');
        check.addEventListener('change', () => { item.done = check.checked; changed(); });
        const line = node('label', 'wf-checklist__item');
        line.append(check, text);
        list.append(line);
        if (item.fix) return;
        const row = node('div', 'wf-checklist__edit-row');
        const name = input('text', item.text);
        name.maxLength = data.max_text;
        name.setAttribute('aria-label', 'Checklist item ' + (index + 1));
        name.addEventListener('input', () => {
          item.text = name.value;
          text.textContent = item.text || 'New checklist item';
          changed();
        });
        const remove = button('Remove', () => { state.items.splice(index, 1); paintItems(); changed(); });
        remove.setAttribute('aria-label', 'Remove checklist item ' + (index + 1));
        remove.disabled = state.items.length === 1;
        row.append(name, remove);
        fields.append(row);
      });
    };
    preview.addEventListener('input', () => { state.preview = preview.value; changed(); });
    reference.addEventListener('input', () => { state.reference = reference.value; changed(); });
    paintItems();
    changed();
    body.append(list, edit, field('Preview link', preview), moreLinks, actions);
    return body;
  }

  function reviewEditor(part, round) {
    const controls = node('div', 'wf-review');
    const canReview = data.can_edit && round.submitted.by.id !== data.viewer_id;
    if (!data.can_comment && !canReview) return controls;
    const key = { part: part.id, iteration: round.number };
    const text = textarea('', 2);
    text.maxLength = 4000;
    text.placeholder = canReview ? 'One fix per line when requesting changes' : 'Add a comment';
    const actions = node('div', 'wf-actions');
    const add = button('Post comment', () => act('comment', { ...key, feedback: text.value }, add));
    if (canReview) {
      const approve = button('Approve part', () => act('approve', { ...key, feedback: text.value }, approve), true);
      const changes = button('Request changes', () => act('request_changes', { ...key, feedback: text.value }, changes));
      actions.append(approve, changes);
    }
    if (data.can_comment) actions.append(add);
    controls.append(field('Feedback', text), actions);
    return controls;
  }

  function partCard(part, open, readonly) {
    const round = currentRound(part);
    const box = node('details', 'wf-part');
    box.dataset.part = String(part.id);
    box.open = open;
    const summary = node('summary');
    summary.append(node('strong', '', roundName(part, round)), badge(labels[round.status], round.status));
    box.append(summary);
    const body = node('div', 'wf-part__body');
    if (round.status === 'draft') {
      if (data.can_edit && !readonly) body.append(draftEditor(part, round));
      else body.append(node('p', 'wf-note', 'Waiting for a submission.'));
    } else {
      body.append(roundEvidence(round));
      if (round.status === 'in_review' && !readonly) {
        if (round.submitted.by.id === data.viewer_id)
          body.append(node('p', 'wf-note', 'Waiting for another task editor to review.'));
        body.append(reviewEditor(part, round));
      }
    }
    if (part.iterations.length > 1) {
      const history = node('details', 'wf-disclosure wf-history');
      history.append(node('summary', '', 'Previous rounds (' + (part.iterations.length - 1) + ')'));
      for (const earlier of part.iterations.slice(0, -1).reverse()) {
        const row = node('details', 'wf-disclosure');
        row.append(node('summary', '', roundName(part, earlier) + ' · ' + labels[earlier.status]), roundEvidence(earlier));
        history.append(row);
      }
      body.append(history);
    }
    box.append(body);
    box.addEventListener('toggle', () => {
      if (!box.open) return;
      selected = part.id;
      for (const other of content.querySelectorAll('.wf-part[open]')) if (other !== box) other.open = false;
    });
    return box;
  }

  function paint() {
    const approved = data.parts.filter(part => currentRound(part).status === 'approved').length;
    const done = !!data.final_approval.at;
    const archived = data.status === 'archived';
    const allApproved = approved === data.parts.length;
    const heading = node('header', 'wf-heading');
    heading.append(node('strong', '', data.template + ' workflow'));
    if (done || archived) heading.append(badge(done ? 'Approved' : 'Archived', done ? 'approved' : ''));
    const progress = map(['Steps', 'QA', 'Final approval'], data.steps_done ? (allApproved ? 2 : 1) : 0);
    progress.setAttribute('aria-label', 'Workflow progress');
    progress.querySelector('[aria-current="step"]')?.setAttribute('tabindex', '-1');
    content.replaceChildren(heading, progress);

    const step = data.steps.find(item => item.status !== 'done');
    if (step && !archived) {
      const next = node('div', 'wf-next');
      next.append(node('span', 'wf-note', 'Next step'), node('h3', '', step.title));
      const actions = node('div', 'wf-actions');
      if (step.can_edit) {
        const mark = button('Mark step done', () => act('complete_step', { step: step.id }, mark), true);
        actions.append(mark);
      }
      if (step.id && openStep) actions.append(button('Open step', () => openStep(step)));
      next.append(actions);
      content.append(next);
    }

    const stages = node('details', 'wf-disclosure');
    stages.open = showSteps;
    const count = data.steps.filter(item => item.status === 'done').length;
    stages.append(node('summary', '', `All steps · ${count}/${data.steps.length} done`));
    const list = node('ol', 'wf-steps');
    for (const item of data.steps) {
      const row = node('li');
      row.append(item.id && openStep ? button(item.title, () => openStep(item)) : node('span', '', item.title));
      row.append(node('small', 'wf-note', item.status === 'done' ? 'Done' : item === step ? 'Next' : 'To do'));
      list.append(row);
    }
    stages.append(list);
    stages.addEventListener('toggle', () => { showSteps = stages.open; });
    content.append(stages);
    if (!data.steps_done) return;

    const qa = node('section', 'wf-qa');
    const title = node('div', 'wf-heading');
    title.append(node('h3', '', 'Quality review'), node('small', 'wf-note', `${approved}/${data.parts.length} approved`));
    qa.append(title);
    const suggested = data.parts.find(part => data.can_edit && currentRound(part).status === 'in_review'
      && currentRound(part).submitted.by.id !== data.viewer_id)
      || data.parts.find(part => currentRound(part).status === 'draft')
      || data.parts.find(part => currentRound(part).status === 'in_review');
    for (const part of data.parts) qa.append(partCard(part, part.id === (selected ?? suggested?.id), done || archived));
    content.append(qa);
    if (allApproved && !archived) {
      const final = node('div', 'wf-next');
      final.append(node('h3', '', 'Final approval'));
      if (done) final.append(node('p', 'wf-note', 'Approved by ' + data.final_approval.by.name));
      else if (data.can_edit) {
        final.append(node('p', 'wf-note', 'All QA parts are approved.'));
        const approve = button('Approve and finish task', () => act('finalize', {}, approve), true);
        final.append(approve);
      }
      content.append(final);
    }
  }

  void load();
  return section;
}
