import * as P from './ws-platform.js?v=20260914-7';
import { observeSurface } from './ws-runtime-performance.js?v=20260920-perf1';

const state = {
  observer: null,
  scheduled: false,
  deckLoading: false,
};

function route() {
  return location.pathname.replace(/\/$/, '') || '/';
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function button(label, onClick, primary = false) {
  const node = el('button', primary ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function go(path) {
  if (path === route()) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  schedule();
}

function installDialogStyle() {
  if (document.getElementById('ws-task-deck-dialog-style')) return;
  const style = document.createElement('style');
  style.id = 'ws-task-deck-dialog-style';
  style.textContent = `
    .ws-action-dialog-layer { position:fixed; inset:0; z-index:1200; display:grid; place-items:center; padding:16px; overflow:auto; background:rgba(0,0,0,.42); }
    .ws-action-dialog { width:min(620px,calc(100vw - 32px)); max-height:min(90vh,820px); overflow:auto; border:1px solid var(--line,#d5d9df); border-radius:14px; padding:0; background:var(--panel,#fff); color:inherit; box-shadow:0 24px 80px rgba(0,0,0,.28); }
    .ws-action-dialog__body { padding:20px; display:grid; gap:14px; }
    .ws-action-dialog__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    .ws-action-dialog__head h2 { margin:0; font-size:1.15rem; }
    .ws-action-dialog__grid { display:grid; gap:12px; }
    .ws-action-dialog__field { display:grid; gap:6px; font-size:.86rem; }
    .ws-action-dialog__field > span { font-weight:600; }
    .ws-action-dialog textarea { min-height:88px; resize:vertical; }
    .ws-action-dialog__actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .ws-action-dialog__error { margin:0; min-height:1.2em; color:var(--danger,#b42318); font-size:.84rem; }
    .ws-core-deck-surface { display:grid; gap:16px; }
    .ws-core-deck-hero { padding:22px; }
    .ws-core-deck-hero h2 { margin:0 0 8px; }
    .ws-core-deck-hero p { max-width:760px; }
  `;
  document.head.append(style);
}

function field(label, input) {
  const wrap = el('label', 'ws-action-dialog__field');
  wrap.append(el('span', '', label), input);
  return wrap;
}

function input(type = 'text', { name = '', value = '', placeholder = '', required = false } = {}) {
  const node = el('input', 'v-input');
  node.type = type;
  node.name = name;
  node.value = value;
  node.placeholder = placeholder;
  node.required = required;
  return node;
}

function select(name, choices, value = '') {
  const node = el('select', 'v-input');
  node.name = name;
  for (const [key, label] of choices) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = key === value;
    node.append(option);
  }
  return node;
}

function textarea(name, placeholder = '') {
  const node = el('textarea', 'v-input');
  node.name = name;
  node.placeholder = placeholder;
  return node;
}

function modal(title, build, submitLabel, onSubmit) {
  installDialogStyle();
  const layer = el('div', 'ws-action-dialog-layer');
  const dialog = el('section', 'ws-action-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  const form = el('form', 'ws-action-dialog__body');

  const onKeydown = (event) => {
    if (event.key === 'Escape') dismiss();
  };
  const dismiss = () => {
    document.removeEventListener('keydown', onKeydown);
    layer.remove();
  };

  const head = el('div', 'ws-action-dialog__head');
  head.append(el('h2', '', title));
  const close = button('Close', dismiss);
  close.setAttribute('aria-label', 'Close');
  head.append(close);
  const grid = el('div', 'ws-action-dialog__grid');
  const fields = build(grid) || {};
  const error = el('p', 'ws-action-dialog__error');
  const actions = el('div', 'ws-action-dialog__actions');
  const cancel = button('Cancel', dismiss);
  const submit = button(submitLabel, () => {}, true);
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(head, grid, error, actions);
  dialog.append(form);
  layer.append(dialog);
  document.body.append(layer);

  layer.addEventListener('pointerdown', (event) => {
    if (event.target === layer) dismiss();
  });
  document.addEventListener('keydown', onKeydown);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    cancel.disabled = true;
    try {
      await onSubmit(fields, new FormData(form));
      dismiss();
    } catch (err) {
      error.textContent = err?.data?.error || err?.message || 'The action could not be completed.';
      submit.disabled = false;
      cancel.disabled = false;
    }
  });

  const firstField = form.querySelector('input:not([type="hidden"]), select, textarea, button');
  if (firstField) queueMicrotask(() => firstField.focus());
  return layer;
}

function openProjectCreator() {
  modal('New research project', (grid) => {
    const title = input('text', { name: 'title', placeholder: 'Project title', required: true });
    const category = select('category', [
      ['internal', 'Internal research'],
      ['client', 'Client project'],
      ['community', 'Community project'],
    ], 'internal');
    const description = textarea('description', 'Short scope or context');
    const question = textarea('research_question', 'Primary research question');
    grid.append(
      field('Project title', title),
      field('Category', category),
      field('Description', description),
      field('Research question', question),
    );
    return { title, category, description, question };
  }, 'Create project', async (_fields, data) => {
    const result = await P.call('/platform/projects/', {
      method: 'POST',
      body: {
        title: String(data.get('title') || '').trim(),
        category: data.get('category') || 'internal',
        visibility: 'private',
        description: String(data.get('description') || '').trim(),
        research_question: String(data.get('research_question') || '').trim(),
      },
    });
    go(`/workspace/research/projects/${result.project.id}`);
  });
}

async function openTaskCreator() {
  const data = await P.call('/platform/projects/');
  const projects = (data.projects || []).filter((project) => project.permissions?.can_edit);
  if (!projects.length) {
    return modal('New research task', (grid) => {
      const note = el('p', 'v-note', 'Create a Research project first, or ask for edit access to an existing project.');
      grid.append(note);
      return {};
    }, 'Open projects', async () => {
      go('/workspace/research/projects');
    });
  }

  modal('New research task', (grid) => {
    const project = select('project_id', projects.map((item) => [String(item.id), item.title]), String(projects[0].id));
    const title = input('text', { name: 'title', placeholder: 'Task title', required: true });
    const due = input('date', { name: 'due_date', required: true });
    const priority = select('priority', [
      ['p0', 'P0 · Critical'],
      ['p1', 'P1 · High'],
      ['p2', 'P2 · Normal'],
      ['p3', 'P3 · Low'],
    ], 'p2');
    const done = textarea('definition_of_done', 'What must be true for this task to be complete?');
    const description = textarea('description', 'Optional context');
    grid.append(
      field('Project', project),
      field('Task title', title),
      field('Due date', due),
      field('Priority', priority),
      field('Definition of done', done),
      field('Description', description),
    );
    return { project };
  }, 'Create task', async (fields, formData) => {
    const projectId = Number(formData.get('project_id') || fields.project.value);
    const result = await P.call(`/platform/projects/${projectId}/tasks/`, {
      method: 'POST',
      body: {
        title: String(formData.get('title') || '').trim(),
        due_date: formData.get('due_date'),
        priority: formData.get('priority') || 'p2',
        definition_of_done: String(formData.get('definition_of_done') || '').trim(),
        description: String(formData.get('description') || '').trim(),
        status: 'active',
      },
    });
    if (!result.task?.id) throw new Error('task_create_failed');
    go(`/workspace/research/projects/${projectId}/tasks`);
  });
}

function ensureResearchActions() {
  const path = route();
  if (!['/workspace/research', '/workspace/research/projects', '/workspace/research/tasks'].includes(path)) return;
  const doc = document.querySelector('#ws-view .ws-doc, #ws-view .rkms-doc, #ws-view');
  if (!doc || doc.querySelector('[data-research-create-actions]')) return;

  const head = doc.querySelector('.ws-doc__head, .rkms-head, header');
  const bar = el('div', 'v-toolbar');
  bar.dataset.researchCreateActions = 'true';

  // The Projects page already owns the full project form (visibility, secure
  // data room, etc.). Add the quick New project action only on the Research
  // home/task surfaces so that route never receives two competing buttons.
  if (path !== '/workspace/research/projects') {
    bar.append(button('New project', openProjectCreator, true));
  }
  bar.append(button('New task', () => {
    openTaskCreator().catch((error) => {
      console.error('Research task creator failed', error);
    });
  }));

  if (head?.nextSibling) head.parentNode.insertBefore(bar, head.nextSibling);
  else if (head) head.after(bar);
  else doc.prepend(bar);
}

function dedupeSelectedNavigation() {
  for (const nav of document.querySelectorAll('#ws-index-body nav, #ws-index-body .fl-index-nav')) {
    const current = [...nav.querySelectorAll('[aria-current="page"]')];
    if (current.length <= 1) continue;
    // Parent overview routes are rendered before their more specific child.
    // Keep the deepest/later match so Dashboard + Discussions can never both
    // appear selected on /workspace/dashboard/discussions (same for Admin/LMS).
    current.slice(0, -1).forEach((node) => node.removeAttribute('aria-current'));
  }
}

async function renderCoreDeckSurface() {
  if (route() !== '/workspace/core/tasks' || state.deckLoading) return;
  const doc = document.querySelector('#ws-view .ws-doc');
  if (!doc || doc.querySelector('[data-core-deck-surface]')) return;
  state.deckLoading = true;
  try {
    const head = doc.querySelector('.ws-doc__head');
    if (!head) return;
    [...doc.children].forEach((child) => {
      if (child !== head) child.remove();
    });

    const surface = el('div', 'ws-core-deck-surface');
    surface.dataset.coreDeckSurface = 'true';
    const hero = el('section', 'v-panel ws-core-deck-hero');
    hero.append(
      el('h2', '', 'Nextcloud Deck is the Core task board'),
      el('p', 'v-note', 'Create, move, assign and complete Core tasks in Deck. Gravitas keeps the initiative, project and research links behind those cards, while title, status and due date stay synchronized.'),
    );
    const actions = el('div', 'v-toolbar');
    const status = el('span', 'v-toolbar__count', 'Connecting to Nextcloud…');
    actions.append(status);
    hero.append(actions);
    surface.append(hero);
    doc.append(surface);

    const cloud = await P.call('/platform/nextcloud/');
    const root = String(cloud.nextcloud?.url || '').replace(/\/$/, '');
    let deckUrl = root ? `${root}/index.php/apps/deck/` : '';
    let adminState = null;
    try {
      adminState = await P.call('/platform/admin/deck/');
      if (adminState.board?.url) deckUrl = adminState.board.url;
    } catch (error) {
      if (error?.status !== 403) console.warn('Deck admin status unavailable', error);
    }

    actions.innerHTML = '';
    if (deckUrl) {
      const open = button('Open Nextcloud Deck', () => window.open(deckUrl, '_blank', 'noopener'), true);
      actions.append(open);
      status.textContent = adminState?.board
        ? `${adminState.task_count || 0} mirrored Core tasks · bidirectional sync`
        : 'Core task execution opens in your Nextcloud Deck';
    } else {
      status.textContent = 'Nextcloud Deck is not configured yet.';
    }

    actions.append(button('Planning & Projects', () => go('/workspace/operating')));

    if (adminState) {
      const sync = button('Reconcile Deck now', async () => {
        sync.disabled = true;
        status.textContent = 'Reconciling Gravitas and Deck…';
        try {
          const result = await P.call('/platform/admin/deck/sync/', { method: 'POST', body: {} });
          if (result.board?.url) deckUrl = result.board.url;
          const changes = result.changes || {};
          status.textContent = `${result.tasks || 0} tasks · ${changes.created || 0} created · ${changes.pulled || 0} pulled · ${changes.conflicts || 0} conflicts`;
        } catch (error) {
          status.textContent = error?.data?.error || 'Deck reconciliation failed.';
        } finally {
          sync.disabled = false;
        }
      });
      actions.append(sync);
    }
    actions.append(status);
  } finally {
    state.deckLoading = false;
  }
}

function reconcile() {
  dedupeSelectedNavigation();
  ensureResearchActions();
  renderCoreDeckSurface().catch((error) => console.error('Core Deck surface failed', error));
}

function schedule() {
  if (state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    reconcile();
  });
}

export function installWorkspaceTaskDeckFixes() {
  installDialogStyle();
  if (!state.observer) {
    const view = document.getElementById('ws-view');
    const index = document.getElementById('ws-index-body');
    state.observer = observeSurface({ target: view, callback: schedule, subtree: false });
    observeSurface({ target: index, callback: schedule, subtree: false });
    addEventListener('popstate', schedule);
    addEventListener('ws:navigate', schedule);
  }
  schedule();
}