import * as P from './ws-platform.js?v=20260914-7';

const VERSION = '20260915-1';
const MENU_LABELS = new Map([
  ['Tasks & Execution', 'Tasks'],
  ['Content Pipeline', 'Content'],
  ['Assets & Blueprints', 'Assets'],
  ['Content Studio Blueprint', 'Studio'],
  ['Planning & Projects', 'Planning'],
  ['Team & Access', 'Team'],
  ['Files & Data Rooms', 'Files'],
  ['Mind Maps', 'Maps'],
  ['Shared with me', 'Shared'],
  ['Learning Paths', 'Paths'],
  ['Knowledge Base', 'Knowledge'],
  ['Recall & Review', 'Recall'],
  ['Course catalog', 'Catalog'],
  ['My learning', 'Learning'],
  ['Personal learning notes', 'Notes'],
  ['Admin overview', 'Overview'],
  ['Users & Access', 'Users'],
  ['Public Content', 'Content'],
  ['LMS Admin', 'LMS'],
  ['Research Admin', 'Research'],
  ['Cross-layer Links', 'Links'],
  ['Nextcloud Deck', 'Deck'],
  ['Back to Core Ops', 'Core'],
  ['Platform Admin', 'Admin'],
]);

let scheduled = false;
let teamLoading = false;

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
}

function currentPath() {
  return location.pathname.replace(/\/$/, '') || '/';
}

function navigate(path, before = null) {
  if (before) before();
  const next = new URL(path, location.origin);
  if (next.pathname === location.pathname && next.search === location.search && next.hash === location.hash) return;
  history.pushState({}, '', `${next.pathname}${next.search}${next.hash}`);
  dispatchEvent(new PopStateEvent('popstate'));
  dispatchEvent(new CustomEvent('ws:navigate'));
}

function button(label, handler, solid = false, tiny = false) {
  const node = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function injectStyles() {
  if (document.getElementById('ws-actionable-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'ws-actionable-ui-style';
  style.textContent = `
    .v-stat[data-actionable], .fl-metric[data-actionable] { position: relative; cursor: pointer; outline: none; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
    .v-stat[data-actionable]::after, .fl-metric[data-actionable]::after { content: '→'; position: absolute; top: 10px; right: 12px; opacity: .48; font-size: 13px; }
    .v-stat[data-actionable]:hover, .fl-metric[data-actionable]:hover, .v-stat[data-actionable]:focus-visible, .fl-metric[data-actionable]:focus-visible { border-color: color-mix(in srgb, currentColor 34%, transparent); background: color-mix(in srgb, currentColor 5%, transparent); transform: translateY(-1px); }
    .v-row[data-actionable], .fl-row[data-actionable] { cursor: pointer; outline: none; }
    .v-row[data-actionable]:hover, .fl-row[data-actionable]:hover, .v-row[data-actionable]:focus-visible, .fl-row[data-actionable]:focus-visible { background: color-mix(in srgb, currentColor 5%, transparent); }
    .au-team { display: grid; gap: 18px; }
    .au-team__toolbar, .au-panel__head, .au-row__actions, .au-modal__actions, .au-filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .au-team__toolbar { justify-content: space-between; }
    .au-team__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr)); gap: 10px; }
    .au-team__stat { min-height: 94px; text-align: left; border: 1px solid var(--ws-line, rgba(255,255,255,.12)); border-radius: 12px; background: transparent; color: inherit; padding: 14px; cursor: pointer; position: relative; }
    .au-team__stat::after { content: '→'; position: absolute; top: 12px; right: 12px; opacity: .45; }
    .au-team__stat strong { display: block; font-size: 25px; line-height: 1; margin-bottom: 9px; }
    .au-team__stat span { font-size: 12px; opacity: .72; }
    .au-panel { border: 1px solid var(--ws-line, rgba(255,255,255,.12)); border-radius: 14px; overflow: hidden; }
    .au-panel__head { justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--ws-line, rgba(255,255,255,.1)); }
    .au-panel__head h2 { margin: 0; font-size: 15px; }
    .au-panel__body { display: grid; }
    .au-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 13px 16px; border-top: 1px solid var(--ws-line, rgba(255,255,255,.08)); }
    .au-row:first-child { border-top: 0; }
    .au-row__main { min-width: 0; }
    .au-row__main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .au-row__meta { display: block; margin-top: 4px; font-size: 12px; opacity: .68; overflow-wrap: anywhere; }
    .au-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
    .au-badge { font-size: 10px; letter-spacing: .02em; border: 1px solid var(--ws-line, rgba(255,255,255,.12)); border-radius: 999px; padding: 3px 7px; opacity: .78; }
    .au-empty { padding: 18px 16px; opacity: .68; }
    .au-modal-layer { position: fixed; inset: 0; z-index: 1400; display: grid; place-items: center; padding: 18px; background: rgba(0,0,0,.56); }
    .au-modal { width: min(640px, 100%); max-height: min(780px, calc(100vh - 36px)); overflow: auto; border: 1px solid var(--ws-line, rgba(255,255,255,.16)); border-radius: 16px; background: var(--ws-surface, #071f2a); color: inherit; box-shadow: 0 24px 80px rgba(0,0,0,.38); padding: 18px; }
    .au-modal__head { display: flex; justify-content: space-between; gap: 14px; align-items: center; margin-bottom: 14px; }
    .au-modal__head h2 { margin: 0; font-size: 18px; }
    .au-form { display: grid; gap: 12px; }
    .au-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap: 10px; }
    .au-field { display: grid; gap: 6px; font-size: 12px; }
    .au-field > span { opacity: .72; }
    .au-check { display: flex; gap: 8px; align-items: center; font-size: 12px; }
    .au-status { min-height: 18px; margin: 0; font-size: 12px; opacity: .75; }
    .au-status[data-tone='bad'] { color: #ff9d9d; opacity: 1; }
    .au-status[data-tone='ok'] { color: #9ce5b0; opacity: 1; }
    .au-focus-panel { margin-top: 14px; }
    .au-filter-note { margin: 8px 0 14px; padding: 10px 12px; border: 1px solid var(--ws-line, rgba(255,255,255,.1)); border-radius: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    @media (max-width: 700px) { .au-row { grid-template-columns: 1fr; } .au-row__actions { justify-content: flex-start; } }
  `;
  document.head.append(style);
}

function directText(node) {
  return [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.nodeValue.trim());
}

function compactMenus() {
  const selectors = ['#ws-index-body .ws-node__label', '#ws-index-body .fl-index-link'];
  for (const node of document.querySelectorAll(selectors.join(','))) {
    const textNode = directText(node);
    const current = textNode ? textNode.nodeValue.trim() : node.textContent.trim();
    const next = MENU_LABELS.get(current);
    if (!next) continue;
    if (textNode) textNode.nodeValue = textNode.nodeValue.replace(current, next);
    else node.textContent = next;
    node.setAttribute('aria-label', next);
    if (node.title) node.title = next;
  }
}

function actionable(node, handler, label) {
  if (!node || node.dataset.actionable === VERSION) return;
  node.dataset.actionable = VERSION;
  if (node.tagName !== 'BUTTON' && node.tagName !== 'A') {
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
  }
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('click', (event) => {
    if (event.target.closest('button,a,input,select,textarea') && event.target !== node) return;
    handler();
  });
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== node) return;
    event.preventDefault();
    handler();
  });
}

function panelByTitle(title) {
  return [...document.querySelectorAll('#ws-view .v-panel, #ws-view .fl-panel')]
    .find((panel) => panel.querySelector('h2')?.textContent.trim() === title) || null;
}

function scrollPanel(title) {
  panelByTitle(title)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function metricAction(path, label) {
  if (path === '/workspace/core') {
    return {
      'Open tasks': () => navigate('/workspace/core/tasks'),
      'Initiatives': () => navigate('/workspace/operating/initiatives'),
      'Content pipeline': () => navigate('/workspace/core/content'),
      'Waiting on research': () => navigate('/workspace/research/tasks?show=requests'),
    }[label];
  }
  if (path === '/workspace/core/tasks') {
    return {
      'Open tasks': () => scrollPanel('Current execution'),
      'Initiatives': () => navigate('/workspace/operating/initiatives'),
      'Content': () => navigate('/workspace/core/content'),
      'Research handoffs': () => navigate('/workspace/research/tasks?show=requests'),
    }[label];
  }
  if (path.startsWith('/workspace/operating')) {
    return {
      'Objectives': () => navigate('/workspace/operating?show=objectives'),
      'Initiatives': () => navigate('/workspace/operating/initiatives'),
      'Open tasks': () => navigate('/workspace/core/tasks'),
      'Milestones': () => navigate('/workspace/operating?show=milestones'),
    }[label];
  }
  if (path === '/workspace/research') {
    return {
      'Active projects': () => navigate('/workspace/research/projects', () => sessionStorage.setItem('gravitas.research.projectView', 'cards')),
      'Client projects': () => navigate('/workspace/research/projects?category=client', () => sessionStorage.setItem('gravitas.research.projectView', 'cards')),
      'Community projects': () => navigate('/workspace/research/projects?category=community', () => sessionStorage.setItem('gravitas.research.projectView', 'cards')),
      'Research requests': () => navigate('/workspace/research/tasks?show=requests'),
    }[label];
  }
  if (path === '/workspace/kms') {
    return ['Due now', 'Reviewed today', 'Day streak', 'Held'].includes(label)
      ? () => navigate('/workspace/kms/recall') : null;
  }
  if (path === '/workspace/dashboard') {
    return {
      'Saved': () => navigate('/workspace/dashboard/library'),
      'Discussions': () => navigate('/workspace/dashboard/discussions'),
      'Active courses': () => navigate('/workspace/learning/my?status=active'),
      'Research projects': () => navigate('/workspace/research/projects'),
    }[label];
  }
  if (path === '/workspace/dashboard/library') {
    return {
      'Saved': () => scrollPanel('Saved'),
      'Following': () => scrollPanel('Following'),
    }[label];
  }
  if (path === '/workspace/dashboard/discussions') {
    return {
      'Contributions': () => navigate('/workspace/dashboard/discussions'),
      'Published': () => navigate('/workspace/dashboard/discussions?status=published'),
      'Pending review': () => navigate('/workspace/dashboard/discussions?status=pending'),
    }[label];
  }
  if (path === '/workspace/learning') {
    return {
      'In progress': () => navigate('/workspace/learning/my?status=active'),
      'Completed': () => navigate('/workspace/learning/my?status=completed'),
      'Certificates': () => navigate('/workspace/learning/certificates'),
      'Catalog': () => navigate('/workspace/learning/catalog'),
    }[label];
  }
  if (path === '/workspace/core/admin') {
    return {
      'Accounts': () => navigate('/workspace/core/admin/users'),
      'Active learners': () => navigate('/workspace/core/admin/lms'),
      'Research projects': () => navigate('/workspace/core/admin/research'),
      'Comments pending': () => navigate('/workspace/core/admin/moderation'),
      'Published content': () => navigate('/workspace/core/admin/content'),
      'Audit events': () => navigate('/workspace/core/admin/activity'),
    }[label];
  }
  return null;
}

function wireMetrics() {
  const path = currentPath();
  for (const node of document.querySelectorAll('#ws-view .v-stat, #ws-view .fl-metric')) {
    const label = node.querySelector('.v-stat__label, .fl-metric__title')?.textContent.trim();
    if (!label) continue;
    const handler = metricAction(path, label);
    if (handler) actionable(node, handler, `Open ${label}`);
  }
}

function wireDashboardRows() {
  const path = currentPath();
  const map = new Map();
  if (path === '/workspace/core') {
    map.set('Content pipeline', () => navigate('/workspace/core/content'));
    map.set('Initiatives', () => navigate('/workspace/operating/initiatives'));
    map.set('Up next', () => navigate('/workspace/operating?show=meetings'));
  } else if (path === '/workspace/research') {
    map.set('Research requests', () => navigate('/workspace/research/tasks?show=requests'));
  } else if (path === '/workspace/dashboard') {
    map.set('Recently saved', () => navigate('/workspace/dashboard/library'));
    map.set('Recent activity', () => navigate('/workspace/dashboard/progress'));
  } else if (path === '/workspace/my-work' || path === '/workspace') {
    map.set('Up next', () => navigate('/workspace/operating?show=meetings'));
  } else if (path === '/workspace/core/admin') {
    map.set('Layer access state', null);
  }

  for (const [title, fallback] of map) {
    const panel = panelByTitle(title);
    if (!panel) continue;
    for (const row of panel.querySelectorAll('.v-row, .fl-row')) {
      if (row.matches('button,a') || row.querySelector('button,a,input,select,textarea')) continue;
      let handler = fallback;
      if (path === '/workspace/research' && title === 'Recent knowledge') {
        const meta = row.querySelector('small')?.textContent.toLowerCase() || '';
        handler = meta.includes('dataset') ? () => navigate('/workspace/research/datasets')
          : meta.includes('file') ? () => navigate('/workspace/research/files')
            : () => navigate('/workspace/research/editor');
      }
      if (path === '/workspace/core/admin' && title === 'Layer access state') {
        const name = row.querySelector('strong')?.textContent.trim().toLowerCase();
        handler = name === 'lms' ? () => navigate('/workspace/core/admin/lms')
          : name === 'research' ? () => navigate('/workspace/core/admin/research')
            : name === 'core' ? () => navigate('/workspace/core/team')
              : () => navigate('/workspace/core/admin/users');
      }
      if (handler) actionable(row, handler, `Open ${title}`);
    }
  }

  if (path === '/workspace/research') {
    const recent = panelByTitle('Recent knowledge');
    if (recent) {
      for (const row of recent.querySelectorAll('.v-row')) {
        if (row.matches('button') || row.querySelector('button,a,input,select,textarea')) continue;
        const meta = row.querySelector('small')?.textContent.toLowerCase() || '';
        const handler = meta.includes('dataset') ? () => navigate('/workspace/research/datasets')
          : meta.includes('file') ? () => navigate('/workspace/research/files')
            : () => navigate('/workspace/research/editor');
        actionable(row, handler, 'Open related research material');
      }
    }
  }
}

function applyDiscussionFilter() {
  if (currentPath() !== '/workspace/dashboard/discussions') return;
  const status = new URLSearchParams(location.search).get('status');
  if (!status) return;
  const panel = panelByTitle('Recent contributions');
  if (!panel || panel.dataset.auFilter === status) return;
  panel.dataset.auFilter = status;
  const wanted = status === 'published' ? 'published' : 'pending review';
  let visible = 0;
  for (const row of panel.querySelectorAll('.fl-row')) {
    const show = (row.textContent || '').toLowerCase().includes(wanted);
    row.hidden = !show;
    if (show) visible += 1;
  }
  const note = el('div', 'au-filter-note');
  note.append(el('span', '', `${visible} ${status === 'published' ? 'published' : 'pending'} contribution${visible === 1 ? '' : 's'}`));
  note.append(button('Clear', () => navigate('/workspace/dashboard/discussions'), false, true));
  panel.before(note);
}

function applyLearningFilter() {
  if (currentPath() !== '/workspace/learning/my') return;
  const status = new URLSearchParams(location.search).get('status');
  if (!status) return;
  const panel = panelByTitle('Enrollments');
  if (!panel || panel.dataset.auFilter === status) return;
  panel.dataset.auFilter = status;
  let visible = 0;
  for (const row of panel.querySelectorAll('.fl-row')) {
    const text = (row.textContent || '').toLowerCase();
    const show = status === 'completed'
      ? text.includes('completed')
      : (text.includes('active') || text.includes('paused'));
    row.hidden = !show;
    if (show) visible += 1;
  }
  const note = el('div', 'au-filter-note');
  note.append(el('span', '', `${visible} ${status === 'completed' ? 'completed' : 'active'} enrollment${visible === 1 ? '' : 's'}`));
  note.append(button('Clear', () => navigate('/workspace/learning/my'), false, true));
  panel.before(note);
}

function applyResearchProjectFilter() {
  if (currentPath() !== '/workspace/research/projects') return;
  const category = new URLSearchParams(location.search).get('category');
  if (!category) return;
  const cards = [...document.querySelectorAll('#ws-view .v-project')];
  if (!cards.length) return;
  const wanted = category === 'client' ? 'client' : category === 'community' ? 'community' : '';
  if (!wanted) return;
  let visible = 0;
  for (const card of cards) {
    const badge = card.querySelector('.v-badge')?.textContent.trim().toLowerCase() || '';
    const show = badge === wanted;
    card.hidden = !show;
    if (show) visible += 1;
  }
  const toolbar = document.querySelector('#ws-view .v-toolbar');
  const count = toolbar?.querySelector('.v-toolbar__count');
  if (count) count.textContent = `${visible} ${wanted} project${visible === 1 ? '' : 's'}`;
  if (document.querySelector('[data-au-project-filter]')) return;
  const note = el('div', 'au-filter-note');
  note.dataset.auProjectFilter = wanted;
  note.append(el('span', '', `Showing ${wanted} projects`));
  note.append(button('All projects', () => navigate('/workspace/research/projects'), false, true));
  toolbar?.insertAdjacentElement('afterend', note);
}

async function renderResearchRequests() {
  if (currentPath() !== '/workspace/research/tasks') return;
  if (new URLSearchParams(location.search).get('show') !== 'requests') return;
  const doc = document.querySelector('#ws-view .ws-doc');
  if (!doc || doc.querySelector('[data-au-requests]')) return;
  const head = doc.querySelector(':scope > .ws-doc__head');
  if (!head) return;
  [...doc.children].forEach((child) => { if (child !== head) child.remove(); });
  head.querySelector('.ws-doc__title').textContent = 'Research Requests';
  const meta = head.querySelector('.ws-doc__meta');
  if (meta) meta.textContent = 'Requests and handoffs waiting for research action.';

  const root = el('div', 'au-team');
  root.dataset.auRequests = VERSION;
  const toolbar = el('div', 'au-team__toolbar');
  toolbar.append(button('Tasks', () => navigate('/workspace/research/tasks')), button('Refresh', () => { root.remove(); renderResearchRequests(); }));
  root.append(toolbar, el('div', 'ws-skel', 'Loading requests…'));
  doc.append(root);
  try {
    const data = await P.researchRequests();
    if (!root.isConnected) return;
    root.querySelector('.ws-skel')?.remove();
    const requests = data.requests || data.items || [];
    const panel = teamPanel('Requests', `${requests.length} total`);
    if (!requests.length) panel.body.append(el('div', 'au-empty', 'No research requests are waiting.'));
    for (const item of requests) {
      const actions = [];
      if (item.project_id) actions.push(button('Project', () => navigate(`/workspace/research/projects/${item.project_id}`), false, true));
      panel.body.append(teamRow(item.title || 'Untitled request', P.meta?.([P.label(item.status), item.project_title, item.assignee, item.due_date ? P.formatDate(item.due_date) : '']) || '', [P.label(item.priority || ''), P.label(item.status || '')], actions));
    }
    root.append(panel.box);
  } catch (error) {
    root.querySelector('.ws-skel')?.remove();
    root.append(el('div', 'ws-alert', error?.message || 'Research requests could not be loaded.'));
  }
}

async function renderPlanningFocus() {
  if (!currentPath().startsWith('/workspace/operating')) return;
  const show = new URLSearchParams(location.search).get('show');
  if (!['objectives', 'milestones', 'meetings'].includes(show)) return;
  if (document.querySelector(`[data-au-planning-focus="${show}"]`)) return;
  const stats = document.querySelector('#ws-view .v-stats');
  if (!stats) return;
  const panel = teamPanel(show[0].toUpperCase() + show.slice(1), 'Opened from the dashboard count.');
  panel.box.classList.add('au-focus-panel');
  panel.box.dataset.auPlanningFocus = show;
  panel.body.append(el('div', 'au-empty', 'Loading…'));
  stats.insertAdjacentElement('afterend', panel.box);
  try {
    const endpoint = show === 'objectives' ? '/operating/objectives/' : show === 'milestones' ? '/operating/milestones/' : '/operating/meetings/';
    const data = await P.call(endpoint);
    panel.body.innerHTML = '';
    const items = data[show] || data.results || [];
    if (!items.length) panel.body.append(el('div', 'au-empty', `No ${show} found.`));
    for (const item of items) {
      const title = item.title || item.name || 'Untitled';
      const meta = P.meta?.([
        P.label(item.status || ''),
        item.owner?.name || item.owner || '',
        item.due_date ? P.formatDate(item.due_date) : '',
        item.scheduled_for ? P.formatDate(item.scheduled_for) : '',
      ]) || '';
      panel.body.append(teamRow(title, meta, [], []));
    }
    panel.head.append(button('Close', () => navigate('/workspace/operating'), false, true));
    panel.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    panel.body.innerHTML = '';
    panel.body.append(el('div', 'au-empty', error?.message || `Could not load ${show}.`));
  }
}

function teamPanel(title, note = '') {
  const box = el('section', 'au-panel');
  const head = el('div', 'au-panel__head');
  const left = el('div');
  left.append(el('h2', '', title));
  if (note) left.append(el('small', 'au-row__meta', note));
  head.append(left);
  const body = el('div', 'au-panel__body');
  box.append(head, body);
  return { box, head, body };
}

function teamRow(title, meta, badges = [], actions = []) {
  const row = el('div', 'au-row');
  const main = el('div', 'au-row__main');
  main.append(el('strong', '', title));
  if (meta) main.append(el('span', 'au-row__meta', meta));
  if (badges.filter(Boolean).length) {
    const strip = el('div', 'au-badges');
    for (const text of badges.filter(Boolean)) strip.append(el('span', 'au-badge', text));
    main.append(strip);
  }
  row.append(main);
  if (actions.length) {
    const tools = el('div', 'au-row__actions');
    for (const action of actions) tools.append(action);
    row.append(tools);
  }
  return row;
}

function field(label, control, hint = '') {
  const wrap = el('label', 'au-field');
  wrap.append(el('span', '', label), control);
  if (hint) wrap.append(el('small', 'au-row__meta', hint));
  return wrap;
}

function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.value = value ?? '';
  node.placeholder = placeholder;
  return node;
}

function select(options, value) {
  const node = el('select', 'v-input fl-input');
  for (const [key, label] of options) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = String(key) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function checkbox(checked, label) {
  const wrap = el('label', 'au-check');
  const control = document.createElement('input');
  control.type = 'checkbox';
  control.checked = !!checked;
  wrap.append(control, el('span', '', label));
  return { wrap, control };
}

function openModal(title, build) {
  const layer = el('div', 'au-modal-layer');
  const modal = el('section', 'au-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);
  const head = el('div', 'au-modal__head');
  head.append(el('h2', '', title));
  const close = button('Close', () => layer.remove(), false, true);
  head.append(close);
  modal.append(head);
  build(modal, () => layer.remove());
  layer.append(modal);
  layer.addEventListener('pointerdown', (event) => { if (event.target === layer) layer.remove(); });
  const escape = (event) => {
    if (event.key === 'Escape') {
      layer.remove();
      removeEventListener('keydown', escape);
    }
  };
  addEventListener('keydown', escape);
  document.body.append(layer);
  requestAnimationFrame(() => modal.querySelector('input,select,button')?.focus());
}

function fmtBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

async function refreshTeam() {
  const root = document.querySelector('[data-au-team-root]');
  if (root) root.remove();
  await renderTeamPage(true);
}

function addExistingToCore(user) {
  return async () => {
    try {
      await P.call('/platform/team/', { method: 'POST', body: { email: user.email, name: user.name, role: 'member', send_setup: false } });
      await refreshTeam();
    } catch (error) {
      alert(error?.message || 'The member could not be added.');
    }
  };
}

function openAddMember() {
  openModal('Add Core member', (modal, close) => {
    const form = el('form', 'au-form');
    const email = input('', 'email', 'name@example.com');
    const name = input('', 'text', 'Display name');
    const role = select([['member', 'Member'], ['admin', 'Admin']], 'member');
    const password = input('', 'password', 'Optional temporary password');
    const setup = checkbox(true, 'Send password setup email');
    const grid = el('div', 'au-grid');
    grid.append(field('Email', email), field('Name', name), field('Core role', role), field('Temporary password', password, 'Leave blank to use the setup email.'));
    const status = el('p', 'au-status');
    const save = button('Add member', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'au-modal__actions');
    actions.append(save, button('Cancel', close));
    form.append(grid, setup.wrap, actions, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await P.call('/platform/team/', { method: 'POST', body: {
          email: email.value.trim(), name: name.value.trim(), role: role.value,
          password: password.value, send_setup: setup.control.checked,
        } });
        status.textContent = 'Member added.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 250);
      } catch (error) {
        status.textContent = error?.message || 'Member was not added.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    });
    modal.append(form);
  });
}

function openMemberEditor(member, viewer) {
  openModal(`Edit ${member.name}`, (modal, close) => {
    const form = el('form', 'au-form');
    const name = input(member.name);
    const email = input(member.email, 'email');
    const roleOptions = member.role === 'owner' ? [['owner', 'Owner'], ['admin', 'Admin'], ['member', 'Member']] : [['admin', 'Admin'], ['member', 'Member']];
    const role = select(roleOptions, member.role);
    if (member.role === 'owner' && !viewer?.is_superuser) role.disabled = true;
    const active = checkbox(member.is_active, 'Account can sign in');
    if (member.is_superuser && !viewer?.is_superuser) active.control.disabled = true;
    const grid = el('div', 'au-grid');
    grid.append(field('Name', name), field('Email', email), field('Core role', role));
    const status = el('p', 'au-status');
    const save = button('Save', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'au-modal__actions');
    actions.append(save, button('Cancel', close));
    form.append(grid, active.wrap, actions, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = 'Saving…';
      const body = { name: name.value.trim(), email: email.value.trim(), is_active: active.control.checked };
      if (!role.disabled) body.role = role.value;
      try {
        await P.call(`/platform/team/${member.id}/`, { method: 'PATCH', body });
        status.textContent = 'Saved.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 220);
      } catch (error) {
        status.textContent = error?.message || 'Changes were not saved.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    });
    modal.append(form);
  });
}

function openPasswordReset(member) {
  openModal(`Password · ${member.name}`, (modal, close) => {
    const status = el('p', 'au-status');
    const send = button('Send setup email', async () => {
      send.disabled = true;
      status.textContent = 'Sending…';
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'email' } });
        status.textContent = 'Password setup email sent.';
        status.dataset.tone = 'ok';
      } catch (error) {
        status.textContent = error?.message || 'Email could not be sent.';
        status.dataset.tone = 'bad';
        send.disabled = false;
      }
    }, true);
    const temp = input('', 'password', 'Temporary password');
    const setTemp = button('Set temporary password', async () => {
      setTemp.disabled = true;
      status.textContent = 'Updating…';
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'temporary', password: temp.value } });
        status.textContent = 'Temporary password set.';
        status.dataset.tone = 'ok';
      } catch (error) {
        status.textContent = error?.data?.messages?.join(' ') || error?.message || 'Password was not changed.';
        status.dataset.tone = 'bad';
        setTemp.disabled = false;
      }
    });
    const form = el('div', 'au-form');
    form.append(send, field('Temporary password', temp), setTemp, status, button('Close', close));
    modal.append(form);
  });
}

function openStorageEditor(member, storage) {
  openModal(`Storage · ${member.name}`, (modal, close) => {
    const row = storage || {};
    const quotaGb = input(row.quota_bytes ? (row.quota_bytes / (1024 ** 3)).toFixed(2) : '5', 'number');
    quotaGb.min = '0.1'; quotaGb.max = '2048'; quotaGb.step = '0.1';
    const status = el('p', 'au-status');
    const save = button('Save quota', async () => {
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const quotaBytes = Math.round(Number(quotaGb.value) * (1024 ** 3));
        await P.call(`/platform/team/${member.id}/storage/`, { method: 'PATCH', body: { quota_bytes: quotaBytes } });
        status.textContent = 'Quota saved.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 220);
      } catch (error) {
        status.textContent = error?.message || 'Quota was not saved.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    }, true);
    const info = el('p', 'au-row__meta', row.quota_bytes ? `${fmtBytes(row.used_bytes)} used of ${fmtBytes(row.quota_bytes)} · ${row.percentage ?? 0}%` : 'Storage usage is unavailable.');
    const form = el('div', 'au-form');
    form.append(info, field('Quota (GB)', quotaGb), save, status, button('Close', close));
    modal.append(form);
  });
}

async function removeMember(member) {
  if (!confirm(`Remove ${member.name} from Core? The account and Research access will remain.`)) return;
  try {
    await P.call(`/platform/team/${member.id}/`, { method: 'DELETE' });
    await refreshTeam();
  } catch (error) {
    alert(error?.message || 'The member could not be removed.');
  }
}

function teamStat(value, label, target, filter = '') {
  const node = el('button', 'au-team__stat');
  node.type = 'button';
  node.append(el('strong', '', String(value ?? 0)), el('span', '', label));
  node.addEventListener('click', () => {
    const section = document.getElementById(target);
    if (!section) return;
    if (filter) section.dataset.filter = filter;
    for (const row of section.querySelectorAll('.au-row')) {
      row.hidden = filter === 'admin' ? !['admin', 'owner'].some((role) => row.dataset.role === role)
        : filter === 'active' ? row.dataset.active !== 'true' : false;
    }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return node;
}

async function renderTeamPage(force = false) {
  if (currentPath() !== '/workspace/core/team') return;
  const doc = document.querySelector('#ws-view .ws-doc');
  const head = doc?.querySelector(':scope > .ws-doc__head');
  if (!doc || !head || teamLoading) return;
  if (!force && doc.querySelector('[data-au-team-root]')) return;
  teamLoading = true;
  try {
    const [data, storageData] = await Promise.all([P.team(), P.teamStorage().catch(() => null)]);
    if (currentPath() !== '/workspace/core/team' || !doc.isConnected) return;
    [...doc.children].forEach((child) => { if (child !== head) child.remove(); });
    head.querySelector('.ws-doc__title').textContent = 'Team & Access';
    const meta = head.querySelector('.ws-doc__meta');
    if (meta) meta.textContent = 'Manage Core membership, roles, account state, password recovery and storage from one place.';

    const root = el('div', 'au-team');
    root.dataset.auTeamRoot = VERSION;
    const toolbar = el('div', 'au-team__toolbar');
    const left = el('div', 'au-row__actions');
    left.append(button('Add member', openAddMember, true), button('Refresh', refreshTeam));
    const right = el('div', 'au-row__actions');
    right.append(button('Platform users', () => navigate('/workspace/core/admin/users')));
    toolbar.append(left, right);
    root.append(toolbar);

    const counts = data.counts || {};
    const statGrid = el('div', 'au-team__stats');
    statGrid.append(
      teamStat(counts.core_members, 'Members', 'au-core-members'),
      teamStat(counts.core_admins, 'Admins', 'au-core-members', 'admin'),
      teamStat(counts.active_members, 'Active', 'au-core-members', 'active'),
      teamStat(counts.external_researchers, 'Researchers', 'au-researchers'),
      teamStat(counts.registered_users, 'Accounts', 'au-accounts'),
    );
    root.append(statGrid);

    const storageByUser = new Map((storageData?.users || []).map((item) => [Number(item.user_id), item]));
    const membersPanel = teamPanel('Core members', `${(data.members || []).length} member${(data.members || []).length === 1 ? '' : 's'}`);
    membersPanel.box.id = 'au-core-members';
    if (!(data.members || []).length) membersPanel.body.append(el('div', 'au-empty', 'No Core members found.'));
    for (const member of data.members || []) {
      const storage = storageByUser.get(Number(member.id));
      const badges = [P.label(member.role), member.is_active ? 'Active' : 'Inactive', member.nextcloud?.provisioned ? 'Nextcloud' : '', `${member.research_projects || 0} research`];
      if (storage) badges.push(`${storage.percentage ?? 0}% storage`);
      const actions = [];
      const protectedOwner = member.role === 'owner' && !data.viewer?.is_superuser;
      const protectedSuper = member.is_superuser && !data.viewer?.is_superuser;
      if (!protectedOwner && !protectedSuper) actions.push(button('Edit', () => openMemberEditor(member, data.viewer), false, true));
      if (!protectedSuper) actions.push(button('Password', () => openPasswordReset(member), false, true));
      if (!protectedSuper) actions.push(button('Storage', () => openStorageEditor(member, storage), false, true));
      actions.push(button('Account', () => navigate(`/workspace/core/admin/users/${member.id}`), false, true));
      if (!protectedOwner && !protectedSuper && member.id !== data.viewer?.id) actions.push(button('Remove', () => removeMember(member), false, true));
      const row = teamRow(member.name, P.meta?.([member.email, member.last_login ? `Last login ${P.formatDate(member.last_login)}` : 'Never signed in']) || member.email, badges, actions);
      row.dataset.role = member.role;
      row.dataset.active = String(!!member.is_active);
      membersPanel.body.append(row);
    }
    root.append(membersPanel.box);

    const researchersPanel = teamPanel('External researchers', 'Research participants who are not Core members.');
    researchersPanel.box.id = 'au-researchers';
    if (!(data.researchers || []).length) researchersPanel.body.append(el('div', 'au-empty', 'No external researchers.'));
    for (const user of data.researchers || []) {
      researchersPanel.body.append(teamRow(user.name, P.meta?.([user.email, user.institution, user.headline]) || user.email, [`${user.research_projects || 0} projects`, user.is_active ? 'Active' : 'Inactive'], [
        button('Add to Core', addExistingToCore(user), true, true),
        button('Account', () => navigate(`/workspace/core/admin/users/${user.id}`), false, true),
      ]));
    }
    root.append(researchersPanel.box);

    const accountsPanel = teamPanel('Registered accounts', 'Accounts without Core membership or Research participation.');
    accountsPanel.box.id = 'au-accounts';
    if (!(data.registered_users || []).length) accountsPanel.body.append(el('div', 'au-empty', 'No unassigned registered accounts.'));
    for (const user of data.registered_users || []) {
      accountsPanel.body.append(teamRow(user.name, P.meta?.([user.email, user.date_joined ? `Joined ${P.formatDate(user.date_joined)}` : '']) || user.email, [user.is_active ? 'Active' : 'Inactive', user.nextcloud?.provisioned ? 'Nextcloud' : ''], [
        button('Add to Core', addExistingToCore(user), true, true),
        button('Account', () => navigate(`/workspace/core/admin/users/${user.id}`), false, true),
      ]));
    }
    root.append(accountsPanel.box);
    doc.append(root);
  } catch (error) {
    if (doc?.isConnected) {
      [...doc.children].forEach((child) => { if (child !== head) child.remove(); });
      const alert = el('div', 'ws-alert');
      alert.append(el('strong', 'ws-alert__title', 'Team controls unavailable'), el('p', '', error?.message || 'The team service did not answer.'), button('Retry', () => renderTeamPage(true)));
      doc.append(alert);
    }
  } finally {
    teamLoading = false;
  }
}

function run() {
  scheduled = false;
  compactMenus();
  wireMetrics();
  wireDashboardRows();
  applyDiscussionFilter();
  applyLearningFilter();
  applyResearchProjectFilter();
  renderResearchRequests();
  renderPlanningFocus();
  renderTeamPage();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(run);
}

export function installActionableUi() {
  if (globalThis.__gravitasActionableUiInstalled) return;
  globalThis.__gravitasActionableUiInstalled = true;
  injectStyles();
  addEventListener('ws:navigate', schedule);
  addEventListener('popstate', schedule);
  const root = document.getElementById('ws') || document.body;
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
}

installActionableUi();
