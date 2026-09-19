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
} from './ws-member-lms.js?v=20260919-advanced7';
import { renderMemberProgress } from './ws-member-progress.js?v=20260918-progress3';
import { renderMemberSupport } from './ws-support.js?v=20260918-support1';
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
} from './ws-admin.js?v=20260919-advanced6';
import { renderAdminContent, renderAdminContentEditor } from './ws-topic-admin.js?v=20260918-fix1';
import { renderCoreLinks } from './ws-core-links.js?v=20260914-1';
import { renderResearchProject } from './ws-project.js?v=20260914-2';

const icon = (name) => window.GravitasIcons?.icon(name, 'g-wi') || '';
const $ = (selector, root = document) => root.querySelector(selector);
const state = { installed: false, scheduled: false };

const DASHBOARD_INDEX = [
  ['Dashboard', '/workspace/dashboard', 'overview'],
  ['Library', '/workspace/dashboard/library', 'files'],
  ['Discussions', '/workspace/dashboard/discussions', 'collaboration'],
  ['Progress', '/workspace/dashboard/progress', 'target'],
  ['Support', '/workspace/dashboard/support', 'collaboration'],
];

const LEARNING_INDEX = [
  ['Overview', '/workspace/learning', 'overview'],
  ['Library', '/workspace/learning/library', 'files'],
  ['Course catalog', '/workspace/learning/catalog', 'planning'],
  ['My learning', '/workspace/learning/my', 'notes'],
  ['Certificates', '/workspace/learning/certificates', 'target'],
];

const ADMIN_INDEX = [
  ['Admin overview', '/workspace/core/admin', 'overview'],
  ['Users & Access', '/workspace/core/admin/users', 'team'],
  ['Topics', '/workspace/core/admin/content', 'content'],
  ['Moderation', '/workspace/core/admin/moderation', 'collaboration'],
  ['Newsletter', '/workspace/core/admin/newsletter', 'mail'],
  ['Support tickets', '/workspace/core/admin/tickets', 'collaboration'],
  ['Interactive Lab', '/workspace/core/admin/labs', 'lab'],
  ['LMS Admin', '/workspace/core/admin/lms', 'planning'],
  ['Research Admin', '/workspace/core/admin/research', 'projects'],
  ['Cross-layer Links', '/workspace/core/admin/links', 'link'],
  ['Activity', '/workspace/core/admin/activity', 'cycle'],
  ['Nextcloud Deck', '/workspace/core/admin/deck', 'tasks'],
  ['Back to Core Ops', '/workspace/core', 'space-core'],
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
  let match = path.match(/^\/workspace\/learning\/courses\/(\d+)\/?$/);
  if (match) return { kind: 'learning', page: 'course', id: match[1] };

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

function normalizeRail() {
  const rail = $('#ws-rail');
  if (!rail || rail.querySelector('.fl-rail-button')) return;

  // Keep ws-app's Plusar and account buttons because their closures own dock
  // focus/profile state. Everything above them is the old top-level model.
  const plusar = [...rail.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === 'Plusar');
  const settings = [...rail.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === 'Settings');
  if (plusar) plusar.remove();
  if (settings) settings.remove();
  rail.innerHTML = '';

  const area = topArea();
  rail.append(railButton('overview', 'Dashboard', area === 'dashboard', '/workspace/dashboard'));
  const rule = document.createElement('div');
  rule.className = 'ws-rail__rule';
  rail.append(rule);

  if (P.canOpenLms() || area === 'learning') rail.append(railButton('space-knowledge', 'Learning', area === 'learning', '/workspace/learning'));
  if (P.canOpenResearch() || area === 'research') rail.append(railButton('space-research', 'Research', area === 'research', '/workspace/research'));
  if (P.canOpenCore() || area === 'core') rail.append(railButton('space-core', 'Core', area === 'core', '/workspace/core'));

  const spacer = document.createElement('div');
  spacer.className = 'ws-rail__spacer';
  rail.append(spacer);
  if (plusar) rail.append(plusar);
  if (settings) rail.append(settings);
}

function indexButton(title, path, mark = 'overview') {
  const node = document.createElement('button');
  node.className = 'fl-index-link';
  node.type = 'button';
  const glyph = document.createElement('span');
  glyph.className = 'fl-index-link__icon';
  glyph.innerHTML = icon(mark);
  node.append(glyph, document.createTextNode(title));
  const here = location.pathname.replace(/\/$/, '');
  const target = path.replace(/\/$/, '');
  const active = here === target || (target !== '/workspace/core' && here.startsWith(target + '/'));
  if (active) node.setAttribute('aria-current', 'page');
  node.addEventListener('click', () => navigate(path));
  return node;
}

function renderIndex(title, items, footer = '') {
  const head = $('#ws-index-title');
  const body = $('#ws-index-body');
  const foot = $('#ws-index-count');
  if (!head || !body || !foot) return;
  head.textContent = title;
  body.innerHTML = '';
  const nav = document.createElement('nav');
  nav.className = 'fl-index-nav';
  nav.setAttribute('aria-label', `${title} sections`);
  items.forEach(([name, path, mark]) => nav.append(indexButton(name, path, mark)));
  body.append(nav);
  foot.textContent = footer;
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
  wrap.append(indexButton('Platform Admin', '/workspace/core/admin', 'team'));
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
    renderIndex('Learning', LEARNING_INDEX, P.canOpenLms() ? 'LMS access enabled' : 'Catalog access');
    setCrumbs([{ label: 'Learning', path: '/workspace/learning' }, ...(route.page === 'overview' ? [] : [{ label: route.page === 'course' ? 'Course' : route.page }])]);
    if (route.page === 'overview') await renderLearningOverview(host, ctx);
    if (route.page === 'library') await renderMemberLibrary(host, ctx);
    if (route.page === 'catalog') await renderLearningCatalog(host, ctx);
    if (route.page === 'my') await renderMyLearning(host, ctx);
    if (route.page === 'certificates') await renderCertificates(host, ctx);
    if (route.page === 'course') await renderCourse(host, route.id, ctx);
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
  addEventListener('ws:navigate', schedule);

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