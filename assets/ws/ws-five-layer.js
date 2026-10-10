import { renderWorkReports } from './ws-work-reports.js?v=20261011-r4';
import * as P from './ws-platform.js?v=20261011-r4';
import {
  renderCertificates,
  renderCourse,
  renderLearningCatalog,
  renderLearningOverview,
  renderMemberDiscussions,
  renderMemberLibrary,
  renderMemberOverview,
  renderMyLearning,
} from './ws-member-lms.js?v=20261011-r4';
import { renderMemberProgress } from './ws-member-progress.js?v=20261011-r4';
import { renderMemberSupport } from './ws-support.js?v=20261011-r4';
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
} from './ws-admin.js?v=20261011-r4';
import { renderAdminContent, renderAdminContentEditor } from './ws-topic-admin.js?v=20261011-r4';
import { renderCoreLinks } from './ws-core-links.js?v=20261011-r4';
import { renderResearchProject } from './ws-project.js?v=20261011-r4';

const icon = (name) => window.GravitasIcons?.icon(name, 'g-wi') || '';
const $ = (selector, root = document) => root.querySelector(selector);
/* ws-app is the one router. It calls renderFiveLayer() for the routes
   pathKind() recognises and hands over its own go(); this module used to
   listen to popstate and ws:navigate itself, rebuild the rail ws-app had
   drawn, and add an Admin entry to ws-app's Core index from a
   MutationObserver — three ways of drawing over another module's work. */
let go = (path) => location.assign(path);

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
  ['Catalog', '/workspace/learning/catalog', 'catalog', 'Browse courses you can join'],
  ['Learning', '/workspace/learning/my', 'learning', 'Courses you are taking'],
  ['Certificates', '/workspace/learning/certificates', 'certificate', 'Courses you have completed'],
];

const ADMIN_INDEX = [
  ['Overview', '/workspace/core/admin', 'overview', 'The whole platform at a glance'],
  ['Users', '/workspace/core/admin/users', 'team', 'Accounts, roles and permissions'],
  ['Topics', '/workspace/core/admin/content', 'topic', 'Write and publish site topics'],
  ['Moderation', '/workspace/core/admin/moderation', 'moderation', 'Review public comments'],
  ['Newsletter', '/workspace/core/admin/newsletter', 'mail', 'Subscribers and campaigns'],
  ['Support Tickets', '/workspace/core/admin/tickets', 'support', 'Reply to member requests'],
  ['Interactive Lab', '/workspace/core/admin/labs', 'lab', 'Build interactive experiments'],
  ['LMS', '/workspace/core/admin/lms', 'course', 'Courses, lessons and enrollments'],
  ['Research', '/workspace/core/admin/research', 'space-research', 'Every research project'],
  ['Links', '/workspace/core/admin/links', 'link', 'Connect items across workspaces'],
  ['Activity', '/workspace/core/admin/activity', 'activity', 'Who changed what, and when'],
  // Fixed series, outside the count: it joined the list after the others
  // had their colours, and they keep them.
  ['Nextcloud Mirror', '/workspace/core/admin/nextcloud', 'storage', 'Files, Notes and Deck in sync', '3'],
  ['Deck', '/workspace/core/admin/deck', 'board', 'Core tasks as Nextcloud boards'],
  ['Core', '/workspace/core', 'space-core', 'Return to the Core workspace'],
];

function pathKind(path = location.pathname) {
  if (path === '/workspace' || path === '/workspace/' || path === '/workspace/my-work' || path === '/workspace/my-work/') {
    return { kind: 'redirect', to: '/workspace/dashboard' };
  }
  if (path === '/workspace/kms' || path === '/workspace/kms/') return { kind: 'redirect', to: '/workspace/learning' };

  if (path === '/workspace/core/work-reports' || path === '/workspace/core/work-reports/') return { kind: 'work-reports' };
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
    const tabs = new Set(['structure', 'overview', 'milestones', 'tasks', 'notes', 'sources', 'files', 'discussions', 'experiments', 'activity']);
    const tab = match[2] && tabs.has(match[2]) ? match[2] : 'structure';
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

/* `series` gives the link the same tinted round mark the Research and Core
   index rows carry (ws-app.js sectionRow), in the same position order, so
   the index looks like one component whichever workspace drew it.

   `hint` is the short line under the name saying what the section holds,
   for a reader meeting the product for the first time. The name is the
   button's direct text node and the hint a span beside it. */
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
  node.addEventListener('click', () => go(path));
  return node;
}

/* Exactly one entry is lit: the one whose path is the longest prefix of the
   URL. Each entry used to test the prefix on its own, so the workspace root
   ("Overview", "Dashboard", "Admin Overview") matched every page below it —
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
  let counted = 0;
  items.forEach(([name, path, mark, hint, fixed]) => {
    const clean = path.replace(/\/$/, '');
    const series = fixed || String((counted++ % 4) + 1);
    const node = indexButton(name, path, mark, series, clean === lit, hint);
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
  if (path) node.addEventListener('click', () => go(path));
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

/* The Platform Admin entry at the top of the Core index, for owners and
   admins. ws-app puts it there when it draws that index. */
export function coreAdminEntry(navigate) {
  if (navigate) go = navigate;
  const wrap = document.createElement('div');
  wrap.className = 'fl-core-admin-entry';
  wrap.append(indexButton('Admin', '/workspace/core/admin', 'team', '1', null, 'Owner and admin tools'));
  return wrap;
}

/* The Mirror page has always carried its own plain trail, the one the
   Nextcloud module drew before this module drew the admin pages. */
function mirrorCrumbs() {
  const crumbs = $('#ws-crumbs');
  if (!crumbs) return;
  const parent = document.createElement('span');
  parent.className = 'ws-crumbs__plain';
  parent.textContent = 'Core Admin';
  const sep = document.createElement('span');
  sep.className = 'ws-crumbs__sep';
  sep.textContent = '/';
  const here = document.createElement('span');
  here.className = 'ws-crumbs__here';
  here.textContent = 'Nextcloud Mirror';
  crumbs.replaceChildren(parent, sep, here);
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
      button.addEventListener('click', () => go(part.path));
      crumbs.append(button);
    } else {
      const span = document.createElement('span');
      span.textContent = part.label;
      crumbs.append(span);
    }
  });
}

/* What this module draws for a path: null for routes it does not own. */
export function fiveLayerRoute(path = location.pathname) {
  return pathKind(path);
}

/* Draws the screen, its index and its trail for the current path. Returns
   true when it drew the view; false for the Knowledge tools, whose views
   ws-app draws under this module's Learning index. */
export async function renderFiveLayer(hostNode, { go: navigate, renderNotesMirror = null } = {}) {
  if (navigate) go = navigate;
  const route = pathKind();
  if (!route) return false;
  if (route.kind === 'redirect') {
    go(route.to, { replace: true });
    return true;
  }
  if (route.kind === 'learning' && !P.canOpenLms()) {
    go('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'learning-legacy' && !P.canOpenLms()) {
    go('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'research-project' && !P.canOpenResearch() && !P.canOpenCore()) {
    go('/workspace/dashboard', { replace: true });
    return true;
  }
  if (route.kind === 'learning-legacy') {
    renderIndex('Learning', LEARNING_INDEX, 'Learning tools');
    setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, { label: 'Personal knowledge' }]);
    return false;
  }

  const host = hostNode || $('#ws-view');
  if (!host) return false;
  const ctx = { go };

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
    const titles = { library: 'Library', catalog: 'Course Catalog', my: 'My Learning', certificates: 'Certificates', 'course-author': 'Edit course' };
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
      setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, { label: 'My Learning', path: '/workspace/learning/my' }, { label: 'Course' }]);
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

  if (route.kind === 'work-reports') {
    setCrumbs([{ label: 'Core', path: '/workspace/core' }, { label: 'Daily Work Reports' }]);
    await renderWorkReports(host, ctx); return true;
  }
  if (route.kind === 'research-project') {
    setCrumbs([{ label: 'Research', path: '/workspace/research' }, { label: 'Projects', path: '/workspace/research/projects' }, { label: route.tab === 'overview' ? 'Project' : route.tab }]);
    await renderResearchProject(host, route.id, route.tab, ctx);
    return true;
  }

  if (route.kind === 'admin') {
    if (!P.isCoreAdmin()) {
      go('/workspace/core', { replace: true });
      return true;
    }
    renderIndex('Platform Admin', ADMIN_INDEX, 'Core owner/admin only');
    if (route.page === 'nextcloud') mirrorCrumbs();
    else setCrumbs([{ label: 'Core', path: '/workspace/core' }, { label: 'Platform Admin', path: '/workspace/core/admin' }, ...(route.page === 'overview' ? [] : [{ label: adminTitle(route.page) }])]);
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
    // The Mirror's body is drawn by the Notes module, which owns the mirror.
    if (route.page === 'nextcloud' && renderNotesMirror) await renderNotesMirror(host);
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
    newsletter: 'Newsletter', tickets: 'Support Tickets', labs: 'Interactive Lab',
    lms: 'LMS Admin', 'course-editor': 'Course', research: 'Research Admin', 'research-project': 'Project', links: 'Cross-layer Links', activity: 'Activity', deck: 'Nextcloud Deck', nextcloud: 'Nextcloud Mirror',
  }[page] || 'Admin';
}
