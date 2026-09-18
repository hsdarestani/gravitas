/* ========================================================================== 
   GRAVITAS+ · CORE CONTENT PIPELINE

   Layer 5 owns the production flow. The backend already exposes the canonical
   ContentWorkItem lifecycle, but the previous Core view was read-only. This
   module makes that same data operational without introducing another board
   model: create, edit, move, request research, publish metadata and archive
   all write through /api/platform/content/.
   ========================================================================== */

import * as P from './ws-platform.js?v=20260918-access3';

const STATUS = [
  ['idea', 'Idea'],
  ['selected', 'Selected'],
  ['research', 'Research'],
  ['brief', 'Brief'],
  ['script', 'Script'],
  ['scientific_review', 'Scientific review'],
  ['production', 'Production'],
  ['edit', 'Edit'],
  ['qa', 'QA'],
  ['published', 'Published'],
];
const KINDS = [
  ['video', 'Video'],
  ['article', 'Article'],
  ['reel', 'Short / Reel'],
  ['podcast', 'Podcast'],
  ['design', 'Design'],
  ['other', 'Other'],
];

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

function action(label, handler, solid = false, tiny = false) {
  const button = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, label);
  button.type = 'button';
  if (handler) button.addEventListener('click', handler);
  return button;
}

function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.value = value ?? '';
  node.placeholder = placeholder;
  return node;
}

function textarea(value = '', rows = 4, placeholder = '') {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.value = value ?? '';
  node.rows = rows;
  node.placeholder = placeholder;
  return node;
}

function select(options, value = '') {
  const node = el('select', 'v-input fl-input');
  for (const [key, label] of options) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = String(key) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function field(label, control, hint = '') {
  const wrap = el('label', 'fl-field');
  wrap.append(el('span', 'fl-field__label', label), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
}

function statusLine() {
  const node = el('p', 'v-note');
  node.hidden = true;
  return node;
}

function setStatus(node, text, tone = '') {
  node.textContent = text;
  node.hidden = !text;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function panel(title, note = '') {
  const box = el('section', 'v-panel fl-panel');
  const head = el('div', 'v-panel__head fl-panel__head');
  const copy = el('div');
  copy.append(el('h2', 'v-panel__title fl-panel__title', title));
  if (note) copy.append(el('p', 'fl-muted', note));
  head.append(copy);
  const body = el('div', 'v-panel__body fl-panel__body');
  box.append(head, body);
  return { box, head, body };
}

function routeActive() {
  return location.pathname.replace(/\/$/, '') === '/workspace/core/content';
}

function formatDate(value) {
  return value ? P.formatDate(value) : '';
}

function stageLabel(value) {
  return STATUS.find(([key]) => key === value)?.[1] || P.label(value);
}

function kindLabel(value) {
  return KINDS.find(([key]) => key === value)?.[1] || P.label(value);
}

function metrics(items) {
  const wrap = el('div', 'v-stats');
  const open = items.filter((item) => !['published', 'archived'].includes(item.status)).length;
  const research = items.filter((item) => ['research', 'brief', 'scientific_review'].includes(item.status)).length;
  const production = items.filter((item) => ['production', 'edit', 'qa'].includes(item.status)).length;
  const published = items.filter((item) => item.status === 'published').length;
  for (const [label, value] of [['Open', open], ['Research', research], ['Production', production], ['Published', published]]) {
    const cell = el('div', 'v-stat');
    cell.append(el('b', 'v-stat__value', String(value)), el('span', 'v-stat__label', label));
    wrap.append(cell);
  }
  return wrap;
}

function newItemForm(onSaved, onCancel) {
  const p = panel('New content item', 'Start at Idea or place an existing piece at its real production stage.');
  const form = el('form', 'fl-form');
  const title = input('', 'text', 'Working title');
  const kind = select(KINDS, 'video');
  const state = select(STATUS, 'idea');
  const due = input('', 'date');
  const description = textarea('', 4, 'Brief, angle, audience or production notes');
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Title', title), field('Type', kind), field('Stage', state), field('Due date', due));
  form.append(grid, field('Brief', description));
  const line = statusLine();
  const save = action('Create content', null, true); save.type = 'submit';
  const cancel = action('Cancel', onCancel);
  const buttons = el('div', 'fl-form-actions'); buttons.append(save, cancel);
  form.append(buttons, line); p.body.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!title.value.trim()) { setStatus(line, 'Title is required.', 'bad'); title.focus(); return; }
    save.disabled = true; setStatus(line, 'Creating…');
    try {
      await P.call('/platform/content/', {
        method: 'POST',
        body: {
          title: title.value.trim(),
          kind: kind.value,
          status: state.value,
          due_date: due.value || null,
          description: description.value.trim(),
        },
      });
      setStatus(line, 'Created.', 'ok');
      await onSaved();
    } catch (error) {
      setStatus(line, error?.message === 'title_required' ? 'Title is required.' : 'Content item could not be created.', 'bad');
      save.disabled = false;
    }
  });
  requestAnimationFrame(() => title.focus());
  return p.box;
}

function editItemForm(item, onSaved, onCancel) {
  const p = panel(`Edit · ${item.title}`, 'Changes are saved to the canonical Layer 5 content item.');
  const form = el('form', 'fl-form');
  const title = input(item.title);
  const kind = select(KINDS, item.kind);
  const state = select(STATUS, item.status);
  const due = input(item.due_date || '', 'date');
  const description = textarea(item.description || '', 5);
  const publishedUrl = input(item.published_url || '', 'url', 'https://…');
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Title', title), field('Type', kind), field('Stage', state), field('Due date', due));
  form.append(grid, field('Brief / production notes', description), field('Published URL', publishedUrl, 'Used when the piece is live.'));

  const line = statusLine();
  const save = action('Save changes', null, true); save.type = 'submit';
  const cancel = action('Cancel', onCancel);
  const archive = action('Archive', async () => {
    if (!confirm(`Archive “${item.title}”?`)) return;
    archive.disabled = true; save.disabled = true;
    setStatus(line, 'Archiving…');
    try {
      await P.call(`/platform/content/${item.id}/`, { method: 'DELETE' });
      await onSaved();
    } catch {
      setStatus(line, 'Item could not be archived.', 'bad');
      archive.disabled = false; save.disabled = false;
    }
  });
  const buttons = el('div', 'fl-form-actions'); buttons.append(save, cancel, archive);
  form.append(buttons, line); p.body.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!title.value.trim()) { setStatus(line, 'Title is required.', 'bad'); return; }
    save.disabled = true; archive.disabled = true; setStatus(line, 'Saving…');
    try {
      await P.call(`/platform/content/${item.id}/`, {
        method: 'PATCH',
        body: {
          title: title.value.trim(),
          kind: kind.value,
          status: state.value,
          due_date: due.value || null,
          description: description.value.trim(),
          published_url: publishedUrl.value.trim(),
        },
      });
      await onSaved();
    } catch {
      setStatus(line, 'Changes could not be saved.', 'bad');
      save.disabled = false; archive.disabled = false;
    }
  });
  return p.box;
}

function researchForm(item, onSaved, onCancel) {
  const p = panel(`Research handoff · ${item.title}`, 'This creates or reuses the linked Research Project and opens a tracked Research Request.');
  const form = el('form', 'fl-form');
  const question = textarea('', 3, 'What exactly needs to be established?');
  const brief = textarea(item.description || '', 5, 'Evidence, scope, constraints and expected output');
  const due = input(item.due_date || '', 'date');
  const priority = select([['p0', 'P0 · Critical'], ['p1', 'P1 · High'], ['p2', 'P2 · Normal'], ['p3', 'P3 · Low']], 'p2');
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Due date', due), field('Priority', priority));
  form.append(field('Research question', question), field('Research brief', brief), grid);
  const line = statusLine();
  const submit = action('Send to Research', null, true); submit.type = 'submit';
  const cancel = action('Cancel', onCancel);
  const buttons = el('div', 'fl-form-actions'); buttons.append(submit, cancel);
  form.append(buttons, line); p.body.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!question.value.trim() && !brief.value.trim()) { setStatus(line, 'Add a research question or brief.', 'bad'); return; }
    submit.disabled = true; setStatus(line, 'Creating research handoff…');
    try {
      await P.call(`/platform/content/${item.id}/`, {
        method: 'POST',
        body: {
          action: 'request_research',
          title: `Research for ${item.title}`,
          project_title: item.title,
          research_question: question.value.trim(),
          brief: brief.value.trim(),
          due_date: due.value || null,
          priority: priority.value,
        },
      });
      await onSaved();
    } catch {
      setStatus(line, 'Research handoff could not be created.', 'bad');
      submit.disabled = false;
    }
  });
  return p.box;
}

function closeContentModal(modal) {
  if (!modal) return;
  modal.remove();
}

async function openContentModal(item, redraw) {
  const modal = el('div', 'core-content-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Content card · ${item.title}`);
  modal.tabIndex = -1;

  const frame = el('div', 'core-content-modal__frame');
  const head = el('header', 'core-content-modal__head');
  head.append(el('div', 'core-content-modal__heading', 'Content card'));
  const close = action('Close', () => closeContentModal(modal));
  close.classList.add('core-content-modal__close');
  head.append(close);

  const body = el('div', 'core-content-modal__body');
  body.append(el('div', 'ws-skel'));
  frame.append(head, body);
  modal.append(frame);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeContentModal(modal);
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeContentModal(modal);
  });

  document.body.append(modal);
  window.requestAnimationFrame(() => modal.focus());

  try {
    const view = await detailItemPanel(item, redraw, () => closeContentModal(modal));
    body.innerHTML = '';
    body.append(view);
  } catch (error) {
    body.innerHTML = '';
    const alert = el('div', 'ws-alert');
    alert.append(el('strong', 'ws-alert__title', 'Content card unavailable'));
    alert.append(el('p', '', error?.message || 'The card could not be opened.'));
    alert.append(action('Close', () => closeContentModal(modal), true));
    body.append(alert);
  }
}

async function detailItemPanel(item, redraw, onClose) {
  const p = panel(item.title, 'Content card · production details, discussion and attachments.');
  const close = action('Close', onClose);
  p.head.append(close);

  const facts = el('div', 'fl-metrics');
  for (const [labelText, value] of [
    ['Stage', stageLabel(item.status)],
    ['Type', kindLabel(item.kind)],
    ['Owner', item.owner || 'Unassigned'],
    ['Due', item.due_date ? formatDate(item.due_date) : '—'],
  ]) {
    const cell = el('div', 'fl-metric');
    cell.append(el('strong', 'fl-metric__value', String(value)), el('span', 'fl-metric__title', labelText));
    facts.append(cell);
  }
  p.body.append(facts);
  if (item.description) p.body.append(el('p', 'fl-row__body', item.description));

  const comments = panel('Discussion');
  const attachments = panel('Attachments', 'Maximum 10 MB per attachment.');
  p.body.append(comments.box, attachments.box);

  const loadComments = async () => {
    comments.body.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.contentComments(item.id);
      comments.body.innerHTML = '';
      for (const row of data.comments || []) {
        const line = el('div', 'fl-row');
        const main = el('div', 'fl-row__main');
        main.append(el('strong', '', row.author), el('small', 'fl-muted', formatDate(row.created_at)), el('p', 'fl-row__body', row.body));
        line.append(main); comments.body.append(line);
      }
      if (!(data.comments || []).length) comments.body.append(el('p', 'fl-muted', 'No comments yet.'));
      const form = el('form', 'fl-form');
      const body = textarea('', 3, 'Add a comment to this card…');
      const send = action('Comment', null, true); send.type = 'submit';
      const line = statusLine();
      form.append(body, send, line);
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); if (!body.value.trim()) return;
        send.disabled = true; setStatus(line, 'Posting…');
        try { await P.addContentComment(item.id, body.value.trim()); await loadComments(); }
        catch (error) { setStatus(line, error?.message || 'Comment could not be posted.', 'bad'); send.disabled = false; }
      });
      comments.body.append(form);
    } catch (error) {
      comments.body.innerHTML = ''; comments.body.append(el('p', 'fl-muted', error?.message || 'Comments unavailable.'));
    }
  };

  const loadAttachments = async () => {
    attachments.body.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.contentAttachments(item.id);
      attachments.body.innerHTML = '';
      for (const row of data.attachments || []) {
        const open = el('a', 'ws-btn ws-btn--tiny', 'Download');
        open.href = row.download_url;
        attachments.body.append((() => {
          const line = el('div', 'fl-row');
          const main = el('div', 'fl-row__main');
          main.append(el('strong', '', row.name), el('small', 'fl-muted', P.meta([P.formatBytes(row.size), row.uploader, formatDate(row.created_at)])));
          line.append(main, open); return line;
        })());
      }
      if (!(data.attachments || []).length) attachments.body.append(el('p', 'fl-muted', 'No attachments yet.'));
      const form = el('form', 'fl-form');
      const file = input('', 'file');
      const upload = action('Upload attachment', null, true); upload.type = 'submit';
      const line = statusLine();
      form.append(file, upload, line);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const chosen = file.files?.[0];
        if (!chosen) return;
        if (chosen.size > 10 * 1024 * 1024) { setStatus(line, 'Maximum attachment size is 10 MB.', 'bad'); return; }
        upload.disabled = true; setStatus(line, 'Uploading…');
        try { await P.uploadContentAttachment(item.id, chosen); await loadAttachments(); }
        catch (error) { setStatus(line, error?.message || 'Upload failed.', 'bad'); upload.disabled = false; }
      });
      attachments.body.append(form);
    } catch (error) {
      attachments.body.innerHTML = ''; attachments.body.append(el('p', 'fl-muted', error?.message || 'Attachments unavailable.'));
    }
  };

  await Promise.all([loadComments(), loadAttachments()]);
  return p.box;
}

function card(item, redraw, openForm) {
  const node = el('article', 'v-card core-content-card');
  node.dataset.contentId = String(item.id);
  node.append(el('h3', '', item.title));
  if (item.description) node.append(el('p', '', item.description.slice(0, 180)));
  const meta = el('div', 'v-card__meta');
  meta.append(el('span', '', kindLabel(item.kind)));
  if (item.owner) meta.append(el('span', '', item.owner));
  if (item.due_date) meta.append(el('span', '', formatDate(item.due_date)));
  node.append(meta);
  if (item.research_project_title) {
    const linked = el('span', 'v-badge', `Research · ${item.research_project_title}`);
    node.append(linked);
  }

  const stage = select(STATUS, item.status);
  stage.setAttribute('aria-label', `Stage for ${item.title}`);
  stage.classList.add('core-content-stage');
  stage.addEventListener('change', async () => {
    const before = item.status;
    stage.disabled = true;
    try {
      await P.call(`/platform/content/${item.id}/`, { method: 'PATCH', body: { status: stage.value } });
      await redraw();
    } catch {
      stage.value = before;
      stage.disabled = false;
    }
  });
  node.append(stage);

  const actions = el('div', 'fl-form-actions core-content-card__actions');
  actions.append(action('Open card', () => openContentModal(item, redraw), true, true));
  actions.append(action('Edit', () => openForm(editItemForm(item, redraw, () => openForm(null))), false, true));
  if (!item.research_project_id && !['published', 'archived'].includes(item.status)) {
    actions.append(action('Request research', () => openForm(researchForm(item, redraw, () => openForm(null))), false, true));
  }
  if (item.published_url) {
    const open = el('a', 'ws-btn ws-btn--tiny', 'Open live');
    open.href = item.published_url; open.target = '_blank'; open.rel = 'noopener';
    actions.append(open);
  }
  node.append(actions);
  return node;
}

async function renderPipeline(root) {
  root.innerHTML = '';
  const loading = el('div', 'ws-skel');
  for (let i = 0; i < 7; i += 1) loading.append(el('i'));
  root.append(loading);

  try {
    const data = await P.content();
    const items = (data.items || []).filter((item) => item.status !== 'archived');
    root.innerHTML = '';
    root.append(metrics(items));

    const toolbar = el('div', 'v-toolbar core-content-toolbar');
    const search = input('', 'search', 'Search content');
    search.setAttribute('aria-label', 'Search content pipeline');
    const kind = select([['', 'All content types'], ...KINDS], '');
    const count = el('span', 'v-toolbar__count');
    const add = action('New content', null, true);
    toolbar.append(add, search, kind, count);
    root.append(toolbar);

    let formHost = null;
    const openForm = (form) => {
      if (formHost) formHost.remove();
      formHost = form;
      if (form) toolbar.insertAdjacentElement('afterend', form);
    };
    const reload = async () => { openForm(null); await renderPipeline(root); };
    add.addEventListener('click', () => openForm(newItemForm(reload, () => openForm(null))));

    const board = el('div', 'v-board core-content-board');
    board.tabIndex = 0;
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'Content production pipeline');
    root.append(board);

    const draw = () => {
      board.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const visible = items.filter((item) => {
        if (kind.value && item.kind !== kind.value) return false;
        if (!q) return true;
        return `${item.title} ${item.description || ''} ${item.owner || ''}`.toLowerCase().includes(q);
      });
      count.textContent = `${visible.length} of ${items.length}`;
      for (const [status, label] of STATUS) {
        const matches = visible.filter((item) => item.status === status);
        const lane = el('section', 'v-column');
        const head = el('div', 'v-column__head');
        head.append(el('strong', '', label), el('span', 'v-column__count', String(matches.length)));
        lane.append(head);
        if (!matches.length) lane.append(el('div', 'v-column__empty'));
        for (const item of matches) lane.append(card(item, reload, openForm));
        board.append(lane);
      }
    };
    search.addEventListener('input', draw);
    kind.addEventListener('change', draw);
    draw();
  } catch (error) {
    root.innerHTML = '';
    const alert = el('div', 'ws-alert');
    alert.append(el('strong', 'ws-alert__title', 'Content pipeline unavailable'));
    alert.append(el('p', '', error?.message === 'core_workspace_for_internal_team_only'
      ? 'Your account does not have Core access.'
      : 'The production data could not be loaded. Nothing was changed.'));
    alert.append(action('Try again', () => renderPipeline(root), true));
    root.append(alert);
  }
}

function mount() {
  if (!routeActive()) return;
  const doc = document.querySelector('#ws-view .ws-doc');
  if (!doc || doc.querySelector('[data-core-content-actions]')) return;
  const head = doc.querySelector(':scope > .ws-doc__head');
  if (!head) return;

  const root = el('div', 'core-content-actions');
  root.dataset.coreContentActions = '1';
  // The legacy view is a read-only rendering of the same endpoint. Once this
  // operational surface mounts, remove the detached read-only holder so users
  // never see two versions of one pipeline.
  for (const child of [...doc.children]) if (child !== head) child.remove();
  doc.append(root);
  renderPipeline(root);
}

let queued = false;
function reconcile() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; mount(); });
}

export function installCoreContentActions() {
  if (window.__gravitasCoreContentActionsInstalled) return;
  window.__gravitasCoreContentActionsInstalled = true;
  const root = document.getElementById('ws');
  if (!root) return;
  new MutationObserver(reconcile).observe(root, { childList: true, subtree: true });
  addEventListener('popstate', reconcile);
  reconcile();
}
