import * as P from './ws-platform.js?v=20260919-planning1';
import {
  renderCertificates,
  renderCourse,
  renderLearningCatalog,
  renderLearningOverview,
  renderMemberDiscussions,
  renderMemberLibrary,
  renderMemberOverview,
  renderMyLearning,
} from './ws-member-lms.js?v=20261002-tabs1';
import { renderMemberProgress } from './ws-member-progress.js?v=20260924-unify1';
import { renderMemberSupport } from './ws-support.js?v=20260920-dashboard3';
import {
  renderAdminActivity,
  renderAdminCourseEditor,
  renderAdminLabs,
  renderAdminNewsletter,
  renderAdminTickets,
  renderAdminDeck,
  renderAdminLms,
  renderAdminModeration,
  renderAdminOverview,
  renderAdminResearch,
  renderAdminResearchProject,
  renderAdminUser,
  renderAdminUsers,
} from './ws-admin.js?v=20261002-admin2';
import { renderAdminContent, renderAdminContentEditor } from './ws-topic-admin.js?v=20261002-admin1';
import { renderCoreLinks } from './ws-core-links.js?v=20261002-admin1';
import { renderResearchProject } from './ws-project.js?v=20261006-mindmap1';

const icon = (name) => window.GravitasIcons?.icon(name, 'g-wi') || '';
const $ = (selector, root = document) => root.querySelector(selector);
const state = { installed: false, scheduled: false, drawn: '' };

const DASHBOARD_INDEX = [
  ['Dashboard', '/workspace/dashboard', 'dashboard', 'Your day at a glance'],
  ['Library', '/workspace/dashboard/library', 'library', 'What you saved from the site'],
  ['Discussions', '/workspace/dashboard/discussions', 'discussion', 'Your comments and replies'],
  ['Progress', '/workspace/dashboard/progress', 'progress', 'Courses and research you are in'],
  ['Support', '/workspace/dashboard/support', 'support', 'Ask the Gravitas+ team for help'],
];

const LEARNING_INDEX = [
  ['Overview', '/workspace/learning', 'overview', 'Where your learning stands'],
  ['Library', '/workspace/learning/library', 'library', 'What you saved from the site'],
  ['Course catalog', '/workspace/learning/catalog', 'catalog', 'Browse courses you can join'],
  ['My learning', '/workspace/learning/my', 'learning', 'Courses you are taking'],
  ['Certificates', '/workspace/learning/certificates', 'certificate', 'Courses you have completed'],
];

const ADMIN_INDEX = [
  ['Admin overview', '/workspace/core/admin', 'overview', 'The whole platform at a glance'],
  ['Users & Access', '/workspace/core/admin/users', 'team', 'Accounts, roles and permissions'],
  ['Topics', '/workspace/core/admin/content', 'topic', 'Write and publish site topics'],
  ['Moderation', '/workspace/core/admin/moderation', 'moderation', 'Review public comments'],
  ['Newsletter', '/workspace/core/admin/newsletter', 'mail', 'Subscribers and campaigns'],
  ['Support tickets', '/workspace/core/admin/tickets', 'support', 'Reply to member requests'],
  ['Interactive Lab', '/workspace/core/admin/labs', 'lab', 'Build interactive experiments'],
  ['LMS Admin', '/workspace/core/admin/lms', 'course', 'Courses, lessons and enrolments'],
  ['Research Admin', '/workspace/core/admin/research', 'space-research', 'Every research project'],
  ['Cross-layer Links', '/workspace/core/admin/links', 'link', 'Connect items across workspaces'],
  ['Activity', '/workspace/core/admin/activity', 'activity', 'Who changed what, and when'],
  ['Nextcloud Deck', '/workspace/core/admin/deck', 'board', 'Core tasks as Nextcloud boards'],
  ['Back to Core Ops', '/workspace/core', 'space-core', 'Return to the Core workspace'],
];

function navigate(path, { replace = false } = {}) {
  // Public learning paths and public-site content deliberately leave the
  // workspace shell. Treating those URLs as SPA routes made ws-app fall back
  // to its home route and looked like the link did nothing.
  if (!String(path || '').startsWith('/workspace')) {
    location.href = path;
    return;
  }
  if (path === location.pathname && !location.search && !location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  var owned = pathKind(path);
  // Five-layer pages have their own renderer. Sending a synthetic popstate
  // here also woke the legacy router, which treats unknown routes as Home and
  // could repaint Research/Home over the requested page. Only legacy routes
  // need the old router; five-layer routes emit the lightweight navigation
  // event and render once.
  dispatchEvent(new CustomEvent('ws:navigate'));
  if (!owned || owned.kind === 'learning-legacy') {
    dispatchEvent(new PopStateEvent('popstate'));
  }
  schedule();
}

function pathKind(path = location.pathname) {
  if (path === '/workspace' || path === '/workspace/' || path === '/workspace/my-work' || path === '/workspace/my-work/') {
    return { kind: 'redirect', to: '/workspace/dashboard' };
  }
  if (path === '/workspace/kms' || path === '/workspace/kms/') return { kind: 'redirect', to: '/workspace/learning' };

  if (path === '/workspace/dashboard' || path === '/workspace/dashboard/') return { kind: 'dashboard', page: 'overview' };
  if (path === '/workspace/dashboard/library' || path === '/workspace/dashboard/library/') return { kind: 'dashboard', page: 'library' };
  if (path === '/workspace/dashboard/discussions' || path === '/workspace/dashboard/discussions/') return { kind: 'dashboard', page: 'discussions' };
  if (path === '/workspace/dashboard/progress' || path === '/workspace/dashboard/progress/') return { kind: 'dashboard', page: 'progress' };
  if (path === '/workspace/dashboard/support' || path === '/workspace/dashboard/support/') return { kind: 'dashboard', page: 'support' };

  if (path === '/workspace/learning' || path === '/workspace/learning/') return { kind: 'learning', page: 'overview' };
  if (path === '/workspace/learning/library' || path === '/workspace/learning/library/') return { kind: 'learning', page: 'library' };
  if (path === '/workspace/learning/catalog' || path === '/workspace/learning/catalog/') return { kind: 'learning', page: 'catalog' };
  if (path === '/workspace/learning/my' || path === '/workspace/learning/my/') return { kind: 'learning', page: 'my' };
  if (path === '/workspace/learning/certificates' || path === '/workspace/learning/certificates/') return { kind: 'learning', page: 'certificates' };
  let match = path.match(/^\/workspace\/learning\/courses\/(\d+)\/edit\/?$/);
  if (match) return { kind: 'learning', page: 'course-author', id: match[1] };
  match = path.match(/^\/workspace\/learning\/courses\/(\d+)(?:\/lessons\/(\d+))?\/?$/);
  if (match) return { kind: 'learning', page: 'course', id: match[1], lesson: match[2] || '' };

  // Legacy KMS tools remain reachable, but they are visually folded under
  // Learning instead of being presented as a sixth top-level workspace.
  if (path.startsWith('/workspace/kms/')) return { kind: 'learning-legacy' };

  match = path.match(/^\/workspace\/research\/projects\/(\d+)(?:\/([a-z-]+))?\/?$/);
  if (match) {
    const tabs = new Set(['overview', 'milestones', 'tasks', 'notes', 'sources', 'files', 'discussions', 'experiments', 'activity']);
    const tab = match[2] && tabs.has(match[2]) ? match[2] : 'overview';
    return { kind: 'research-project', id: match[1], tab };
  }

  if (path === '/workspace/core/admin' || path === '/workspace/core/admin/') return { kind: 'admin', page: 'overview' };
  if (path === '/workspace/core/admin/users' || path === '/workspace/core/admin/users/') return { kind: 'admin', page: 'users' };
  match = path.match(/^\/workspace\/core\/admin\/users\/(\d+)\/?$/);
  if (match) return { kind: 'admin', page: 'user', id: match[1] };
  if (path === '/workspace/core/admin/content' || path === '/workspace/core/admin/content/') return { kind: 'admin', page: 'content' };
  if (path === '/workspace/core/admin/content/new' || path === '/workspace/core/admin/content/new/') return { kind: 'admin', page: 'content-editor', id: 'new' };
  match = path.match(/^\/workspace\/core\/admin\/content\/(\d+)\/?$/);
  if (match) return { kind: 'admin', page: 'content-editor', id: match[1] };
  if (path === '/workspace/core/admin/moderation' || path === '/workspace/core/admin/moderation/') return { kind: 'admin', page: 'moderation' };
  if (path === '/workspace/core/admin/newsletter' || path === '/workspace/core/admin/newsletter/') return { kind: 'admin', page: 'newsletter' };
  if (path === '/workspace/core/admin/tickets' || path === '/workspace/core/admin/tickets/') return { kind: 'admin', page: 'tickets' };
  if (path === '/workspace/core/admin/labs' || path === '/workspace/core/admin/labs/') return { kind: 'admin', page: 'labs' };
  if (path === '/workspace/core/admin/lms' || path === '/workspace/core/admin/lms/') return { kind: 'admin', page: 'lms' };
  if (path === '/workspace/core/admin/lms/courses/new' || path === '/workspace/core/admin/lms/courses/new/') return { kind: 'admin', page: 'course-editor', id: 'new' };
  match = path.match(/^\/workspace\/core\/admin\/lms\/courses\/(\d+)\/?$/);
  if (match) return { kind: 'admin', page: 'course-editor', id: match[1] };
  if (path === '/workspace/core/admin/research' || path === '/workspace/core/admin/research/') return { kind: 'admin', page: 'research' };
  match = path.match(/^\/workspace\/core\/admin\/research\/(\d+)\/?$/);
  if (match) return { kind: 'admin', page: 'research-project', id: match[1] };
  if (path === '/workspace/core/admin/links' || path === '/workspace/core/admin/links/') return { kind: 'admin', page: 'links' };
  if (path === '/workspace/core/admin/activity' || path === '/workspace/core/admin/activity/') return { kind: 'admin', page: 'activity' };
  if (path === '/workspace/core/admin/deck' || path === '/workspace/core/admin/deck/') return { kind: 'admin', page: 'deck' };
  if (path === '/workspace/core/admin/nextcloud' || path === '/workspace/core/admin/nextcloud/') return { kind: 'admin', page: 'nextcloud' };
  return null;
}

function topArea(path = location.pathname) {
  if (path.startsWith('/workspace/core') || path.startsWith('/workspace/operating')) return 'core';
  if (path.startsWith('/workspace/research') || path.startsWith('/workspace/people') || path.startsWith('/workspace/community') || path.startsWith('/workspace/shared')) return 'research';
  if (path.startsWith('/workspace/learning') || path.startsWith('/workspace/kms')) return 'learning';
  if (path.startsWith('/workspace/dashboard') || path === '/workspace' || path.startsWith('/workspace/my-work')) return 'dashboard';
  return '';
}

function railButton(mark, label, active, path) {
  const button = document.createElement('button');
  button.className = 'ws-rail__btn fl-rail-button';
  button.type = 'button';
  button.innerHTML = icon(mark);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.fiveLayer = label.toLowerCase().replace(/\s+/g, '-');
  if (active) button.setAttribute('aria-current', 'page');
  button.addEventListener('click', () => navigate(path));
  return button;
}

/* Dashboard and Learning are drawn here, not by ws-app, so ws-app never
   redraws the rail on the way into them. Built once and left alone, the
   rail kept lighting whichever workspace the reader came from. Once built,
   the rail is re-lit from the URL on every render instead. */
function syncRail(rail) {
  const area = topArea();
  for (const button of rail.querySelectorAll('.fl-rail-button')) {
    if (button.dataset.fiveLayer === area) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (area) {
    const settings = [...rail.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === 'Settings');
    if (settings) settings.removeAttribute('aria-current');
  }
}

function normalizeRail() {
  const rail = $('#ws-rail');
  if (!rail) return;
  if (rail.querySelector('.fl-rail-button')) {
    syncRail(rail);
    return;
  }

  // Keep ws-app's account button because its closure owns profile state.
  // Everything above it is the old top-level model. Pulsar used to have a
  // rail button here too; it is the floating widget now (assets/chat.js).
  const settings = [...rail.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === 'Settings');
  if (settings) settings.remove();
  rail.innerHTML = '';

  const area = topArea();
  rail.append(railButton('dashboard', 'Dashboard', area === 'dashboard', '/workspace/dashboard'));
  const rule = document.createElement('div');
  rule.className = 'ws-rail__rule';
  rail.append(rule);

  if (P.canOpenLms() || area === 'learning') rail.append(railButton('space-knowledge', 'Learning', area === 'learning', '/workspace/learning'));
  if (P.canOpenResearch() || area === 'research') rail.append(railButton('space-research', 'Research', area === 'research', '/workspace/research'));
  if (P.canOpenCore() || area === 'core') rail.append(railButton('space-core', 'Core', area === 'core', '/workspace/core'));

  const spacer = document.createElement('div');
  spacer.className = 'ws-rail__spacer';
  rail.append(spacer);
  if (settings) rail.append(settings);
}

/* `series` gives the link the same tinted round mark the Research and Core
   index rows carry (ws-app.js sectionRow), in the same position order, so
   the index looks like one component whichever workspace drew it.

   `hint` is the short line under the name saying what the section holds,
   for a reader meeting the product for the first time. The name stays the
   button's direct text node: ws-actionable-ui shortens long names by
   rewriting exactly that node, and the hint is a span beside it. */
function indexButton(title, path, mark = 'overview', series = '1', active = null, hint = '') {
  const node = document.createElement('button');
  node.className = 'fl-index-link';
  node.type = 'button';
  node.dataset.series = series;
  const glyph = document.createElement('span');
  glyph.className = 'fl-index-link__icon';
  glyph.innerHTML = icon(mark);
  node.append(glyph, document.createTextNode(title));
  if (hint) {
    const small = document.createElement('span');
    small.className = 'fl-index-link__hint';
    small.textContent = hint;
    node.append(small);
    node.dataset.hinted = '';
  }
  if (active == null) {
    const here = location.pathname.replace(/\/$/, '');
    const target = path.replace(/\/$/, '');
    active = here === target || (target !== '/workspace/core' && here.startsWith(target + '/'));
  }
  if (active) node.setAttribute('aria-current', 'page');
  node.addEventListener('click', () => navigate(path));
  return node;
}

/* Exactly one entry is lit: the one whose path is the longest prefix of the
   URL. Each entry used to test the prefix on its own, so the workspace root
   ("Overview", "Dashboard", "Admin overview") matched every page below it —
   opening a course lit Overview, and Catalog lit both Catalog and Overview.
   `ancestor` overrides that for pages that belong under an entry their URL
   does not start with: a course lives at /learning/courses/… but sits in
   the index under My learning. */
function activeEntry(items, here = location.pathname) {
  const path = here.replace(/\/$/, '');
  let best = '';
  for (const [, target] of items) {
    const clean = target.replace(/\/$/, '');
    if ((path === clean || path.startsWith(clean + '/')) && clean.length > best.length) best = clean;
  }
  return best;
}

function renderIndex(title, items, footer = '', { ancestor = '', branches = new Map() } = {}) {
  const head = $('#ws-index-title');
  const body = $('#ws-index-body');
  const foot = $('#ws-index-count');
  if (!head || !body || !foot) return;
  // Redrawing the index to open a branch must not throw the reader back to
  // the top of a long course outline they were scrolling.
  const scroller = body.closest('.ws-pane__body, .ws-pane') || body;
  const scrolled = scroller.scrollTop;
  head.textContent = title;
  body.innerHTML = '';
  const nav = document.createElement('nav');
  nav.className = 'fl-index-nav';
  nav.setAttribute('aria-label', `${title} sections`);
  const lit = ancestor ? '' : activeEntry(items);
  items.forEach(([name, path, mark, hint], index) => {
    const clean = path.replace(/\/$/, '');
    const node = indexButton(name, path, mark, String((index % 4) + 1), clean === lit, hint);
    nav.append(node);
    const branch = branches.get(path);
    if (clean === ancestor) node.dataset.ancestor = 'true';
    if (branch) {
      node.setAttribute('aria-expanded', 'true');
      nav.append(branch);
    }
  });
  body.append(nav);
  foot.textContent = footer;
  scroller.scrollTop = scrolled;
  const current = nav.querySelector('.flc-tree [aria-current="page"]');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

/* ==========================================================================
   THE LEARNING INDEX
   A course is not a sixth section beside Catalog and Certificates; it is a
   thing the reader is taking. So the index draws every enrollment as a
   branch under My learning, and the open course unfolds into its modules
   and lessons there, the same way a Research project unfolds into its
   pages. A course opened from the catalog without an enrollment hangs under
   Course catalog instead, because that is where the reader found it.

   Enrollments come from /lms/me/ once per session. The open course's
   outline is handed over by the course screen itself (ctx.outline), which
   already holds the structure, so drawing the tree costs no second request
   for it. Completion marks only appear for lessons the learning plan
   reports on — required lessons. An optional lesson gets no tick rather
   than a guessed one.
   ========================================================================== */

const learningTree = { enrollments: null, pending: null, outline: null };

function loadEnrollments() {
  if (learningTree.enrollments || learningTree.pending) return;
  learningTree.pending = P.lmsMe()
    .then((data) => { learningTree.enrollments = (data.enrollments || []).filter((item) => item.status !== 'revoked'); })
    .catch(() => { learningTree.enrollments = []; })
    .finally(() => {
      learningTree.pending = null;
      if (pathKind()?.kind === 'learning') drawLearningIndex(pathKind());
    });
}

function treeRow(cls, text, { path = '', mark = '', current = false, state = '', meta = '', title = '' } = {}) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = cls;
  if (state) node.dataset.state = state;
  if (current) node.setAttribute('aria-current', 'page');
  if (title) node.title = title;
  const glyph = document.createElement('span');
  glyph.className = 'flc-tree__mark';
  glyph.innerHTML = mark ? icon(mark) : '';
  const label = document.createElement('span');
  label.className = 'flc-tree__label';
  label.textContent = text;
  node.append(glyph, label);
  if (meta) {
    const small = document.createElement('small');
    small.className = 'flc-tree__meta';
    small.textContent = meta;
    node.append(small);
  }
  if (path) node.addEventListener('click', () => navigate(path));
  return node;
}

function courseOutline(outline, route) {
  const box = document.createElement('div');
  box.className = 'flc-tree__outline';
  box.setAttribute('role', 'group');
  const base = `/workspace/learning/courses/${outline.course.id}`;
  for (const module of outline.course.modules || []) {
    const lessons = module.lessons || [];
    if (!lessons.length) continue;
    const head = document.createElement('div');
    head.className = 'flc-tree__module';
    head.textContent = module.title;
    box.append(head);
    for (const lesson of lessons) {
      const done = outline.done?.has(String(lesson.id));
      const state = lesson.locked ? 'locked' : done ? 'done' : '';
      box.append(treeRow('flc-tree__lesson', lesson.title, {
        path: `${base}/lessons/${lesson.id}`,
        mark: lesson.locked ? 'secure' : done ? 'check' : '',
        state,
        current: String(route.lesson) === String(lesson.id),
        title: lesson.locked ? `${lesson.title} · locked` : lesson.title,
      }));
    }
  }
  if (!box.childElementCount) {
    const none = document.createElement('div');
    none.className = 'flc-tree__module';
    none.textContent = 'No lessons published yet';
    box.append(none);
  }
  return box;
}

function courseBranch(courses, route) {
  const box = document.createElement('div');
  box.className = 'flc-tree';
  box.setAttribute('role', 'group');
  for (const course of courses) {
    const open = route.page === 'course' && String(route.id) === String(course.id);
    const share = Number(course.progress);
    const node = treeRow('flc-tree__course', course.title || 'Course', {
      path: `/workspace/learning/courses/${course.id}`,
      mark: 'course',
      current: open && !route.lesson,
      meta: Number.isFinite(share) && course.enrolled ? `${Math.round(share)}%` : '',
      title: course.title,
    });
    if (open) node.dataset.open = 'true';
    box.append(node);
    const outline = learningTree.outline;
    if (open && outline && String(outline.course.id) === String(course.id)) box.append(courseOutline(outline, route));
  }
  return box;
}

function drawLearningIndex(route) {
  loadEnrollments();
  const footer = P.canOpenLms() ? 'LMS access enabled' : 'Catalog access';
  const enrolled = (learningTree.enrollments || []).map((item) => ({
    id: item.course_id, title: item.course_title, progress: item.progress_percent, enrolled: true,
  }));
  const branches = new Map();
  let ancestor = '';
  if (route.page === 'course') {
    const outline = learningTree.outline && String(learningTree.outline.course.id) === String(route.id) ? learningTree.outline : null;
    const known = enrolled.find((item) => String(item.id) === String(route.id));
    const isEnrolled = outline ? !!outline.course.enrolled : (known || !learningTree.enrollments);
    if (outline && known) {
      known.title = outline.course.title;
      known.progress = outline.course.progress_percent;
    }
    if (isEnrolled && outline && !known) {
      enrolled.unshift({ id: outline.course.id, title: outline.course.title, progress: outline.course.progress_percent, enrolled: true });
    }
    if (isEnrolled) {
      ancestor = '/workspace/learning/my';
    } else {
      ancestor = '/workspace/learning/catalog';
      branches.set('/workspace/learning/catalog', courseBranch([{ id: route.id, title: outline?.course.title || 'Course' }], route));
    }
  }
  if (enrolled.length) branches.set('/workspace/learning/my', courseBranch(enrolled, route));
  renderIndex('Learning', LEARNING_INDEX, footer, { ancestor, branches });
}

/* Called by the course screen once it holds the course. `done` is the set
   of lesson ids the learning plan reports as complete. */
function setCourseOutline(course, done = new Set()) {
  learningTree.outline = { course, done };
  const route = pathKind();
  if (route?.kind === 'learning' && route.page === 'course' && String(route.id) === String(course.id)) drawLearningIndex(route);
  if (course.enrolled && learningTree.enrollments && !learningTree.enrollments.some((item) => String(item.course_id) === String(course.id))) {
    // Enrolled from this screen a moment ago; the cached list predates it.
    learningTree.enrollments = null;
    loadEnrollments();
  }
}

function ensureCoreAdminEntry() {
  if (!P.isCoreAdmin()) return;
  const route = pathKind();
  if (route?.kind === 'admin') return;
  if (topArea() !== 'core') return;
  const body = $('#ws-index-body');
  if (!body || body.querySelector('.fl-core-admin-entry')) return;
  const wrap = document.createElement('div');
  wrap.className = 'fl-core-admin-entry';
  wrap.append(indexButton('Platform Admin', '/workspace/core/admin', 'team', '1', null, 'Owner and admin tools'));
  body.prepend(wrap);
}

function setCrumbs(parts) {
  const crumbs = $('#ws-crumbs');
  if (!crumbs) return;
  crumbs.innerHTML = '';
  parts.forEach((part, index) => {
    if (index) {
      const sep = document.createElement('span');
      sep.className = 'ws-crumbs__sep';
      sep.textContent = '/';
      crumbs.append(sep);
    }
    if (part.path) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fl-crumb';
      button.textContent = part.label;
      button.addEventListener('click', () => navigate(part.path));
      crumbs.append(button);
    } else {
      const span = document.createElement('span');
      span.textContent = part.label;
      crumbs.append(span);
    }
  });
}

function rendererContext() {
  return { go: navigate };
}

async function renderCustom() {
  normalizeRail();
  const route = pathKind();
  state.drawn = route && route.kind !== 'redirect' && route.kind !== 'learning-legacy' ? location.pathname : '';
  if (!route) {
    ensureCoreAdminEntry();
    return false;
  }
  if (route.kind === 'redirect') {
    navigate(route.to, { replace: true });
    return true;
  }
  if (route.kind === 'learning' && !P.canOpenLms()) {
    navigate('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'learning-legacy' && !P.canOpenLms()) {
    navigate('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'research-project' && !P.canOpenResearch() && !P.canOpenCore()) {
    navigate('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'learning-legacy') {
    renderIndex('Learning', LEARNING_INDEX, 'Learning tools');
    setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, { label: 'Personal knowledge' }]);
    return false;
  }

  const host = $('#ws-view');
  if (!host) return false;
  const ctx = rendererContext();

  if (route.kind === 'dashboard') {
    renderIndex('Dashboard', DASHBOARD_INDEX, P.communityRole() ? labelRole(P.communityRole()) : 'Member');
    const titles = { overview: 'Dashboard', library: 'Library', discussions: 'Discussions', progress: 'Progress', support: 'Support' };
    setCrumbs([{ label: 'Dashboard', path: '/workspace/dashboard' }, ...(route.page === 'overview' ? [] : [{ label: titles[route.page] }])]);
    if (route.page === 'overview') await renderMemberOverview(host, ctx);
    if (route.page === 'library') await renderMemberLibrary(host, ctx);
    if (route.page === 'discussions') await renderMemberDiscussions(host, ctx);
    if (route.page === 'progress') await renderMemberProgress(host, ctx);
    if (route.page === 'support') await renderMemberSupport(host, ctx);
    return true;
  }

  if (route.kind === 'learning') {
    drawLearningIndex(route);
    const titles = { library: 'Library', catalog: 'Course catalog', my: 'My learning', certificates: 'Certificates', 'course-author': 'Edit course' };
    if (route.page !== 'course') {
      setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, ...(route.page === 'overview' ? [] : [{ label: titles[route.page] }])]);
    }
    if (route.page === 'overview') await renderLearningOverview(host, ctx);
    if (route.page === 'library') await renderMemberLibrary(host, ctx);
    if (route.page === 'catalog') await renderLearningCatalog(host, ctx);
    if (route.page === 'my') await renderMyLearning(host, ctx);
    if (route.page === 'certificates') await renderCertificates(host, ctx);
    if (route.page === 'course') {
      // The course screen names its own trail once it knows the course and
      // the lesson; until then the trail says where it is going.
      setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, { label: 'My learning', path: '/workspace/learning/my' }, { label: 'Course' }]);
      await renderCourse(host, route.id, {
        ...ctx,
        lesson: route.lesson,
        outline: setCourseOutline,
        crumbs: (parts) => setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, ...parts]),
      });
    }
    if (route.page === 'course-author') {
      setCrumbs([
        { label: 'Learning', path: '/workspace/learning' },
        { label: 'Course', path: `/workspace/learning/courses/${route.id}` },
        { label: 'Edit course' },
      ]);
      await renderAdminCourseEditor(host, route.id, { ...ctx, authorMode: true });
    }
    return true;
  }

  if (route.kind === 'research-project') {
    setCrumbs([{ label: 'Research', path: '/workspace/research' }, { label: 'Projects', path: '/workspace/research/projects' }, { label: route.tab === 'overview' ? 'Project' : route.tab }]);
    await renderResearchProject(host, route.id, route.tab, ctx);
    return true;
  }

  if (route.kind === 'admin') {
    if (!P.isCoreAdmin()) {
      navigate('/workspace/core', { replace: true });
      return true;
    }
    renderIndex('Platform Admin', ADMIN_INDEX, 'Core owner/admin only');
    setCrumbs([{ label: 'Core', path: '/workspace/core' }, { label: 'Platform Admin', path: '/workspace/core/admin' }, ...(route.page === 'overview' ? [] : [{ label: adminTitle(route.page) }])]);
    if (route.page === 'overview') await renderAdminOverview(host, ctx);
    if (route.page === 'users') await renderAdminUsers(host, ctx);
    if (route.page === 'user') await renderAdminUser(host, route.id, ctx);
    if (route.page === 'content') await renderAdminContent(host, ctx);
    if (route.page === 'content-editor') await renderAdminContentEditor(host, route.id, ctx);
    if (route.page === 'moderation') await renderAdminModeration(host, ctx);
    if (route.page === 'newsletter') await renderAdminNewsletter(host, ctx);
    if (route.page === 'tickets') await renderAdminTickets(host, ctx);
    if (route.page === 'labs') await renderAdminLabs(host, ctx);
    if (route.page === 'lms') await renderAdminLms(host, ctx);
    if (route.page === 'course-editor') await renderAdminCourseEditor(host, route.id, ctx);
    if (route.page === 'research') await renderAdminResearch(host, ctx);
    if (route.page === 'research-project') await renderAdminResearchProject(host, route.id, ctx);
    if (route.page === 'links') await renderCoreLinks(host, ctx);
    if (route.page === 'activity') await renderAdminActivity(host, ctx);
    if (route.page === 'deck') await renderAdminDeck(host, ctx);
    // The native-app router owns the Nextcloud Mirror body. Recognizing this
    // route here still gives it the correct Platform Admin index and guard.
    if (route.page === 'nextcloud') host.innerHTML = '<div class="fl-skeleton"></div>';
    return true;
  }
  return false;
}

function labelRole(value) {
  return String(value || 'member').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function adminTitle(page) {
  return {
    users: 'Users & Access', user: 'Account', content: 'Topics', 'content-editor': 'Topic', moderation: 'Moderation',
    newsletter: 'Newsletter', tickets: 'Support tickets', labs: 'Interactive Lab',
    lms: 'LMS Admin', 'course-editor': 'Course', research: 'Research Admin', 'research-project': 'Project', links: 'Cross-layer Links', activity: 'Activity', deck: 'Nextcloud Deck', nextcloud: 'Nextcloud Mirror',
  }[page] || 'Admin';
}

function schedule() {
  if (state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(async () => {
    state.scheduled = false;
    await renderCustom();
  });
}

export function installFiveLayer() {
  if (state.installed) return;
  state.installed = true;

  addEventListener('popstate', schedule);
  // workspace.html sends one `settle` navigation when ws-app finishes
  // booting, for the overlays whose legacy routes start() may have redrawn.
  // ws-app no longer touches the routes drawn here, so redrawing one that is
  // already on screen only flashed its loading state a second time.
  addEventListener('ws:navigate', (event) => {
    if (event.detail?.settle && state.drawn === location.pathname) return;
    schedule();
  });

  const rail = $('#ws-rail');
  const index = $('#ws-index-body');
  const observer = new MutationObserver(() => {
    normalizeRail();
    ensureCoreAdminEntry();
  });
  if (rail) observer.observe(rail, { childList: true });
  if (index) observer.observe(index, { childList: true, subtree: false });
  state.observer = observer;

  schedule();
}