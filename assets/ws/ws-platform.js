/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  PLATFORM DATA
   The five product layers share one account and one backend. Product-layer
   access is independent from community role; the server remains authoritative
   for every request and every object ACL.
   ========================================================================== */

const API = '/api';

function cookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

export class AuthRequired extends Error {}

export async function call(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRFToken'] = cookie('csrftoken');
  }

  const res = await fetch(API + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) throw new AuthRequired('authentication_required');

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `http_${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const platform = {
  boot: null,
  user: null,
  error: null,
  remembered: null,
  settled: false,
};

const ACCESS_MEMO = 'gravitas.ws.access.v2';

function rememberAccess(access) {
  platform.remembered = access
    ? {
        dashboard: !!access.dashboard,
        lms: !!access.lms,
        research: !!access.research,
        core: !!access.core,
        core_role: access.core_role || '',
        community_role: access.community_role || 'member',
      }
    : null;
  try {
    if (platform.remembered) localStorage.setItem(ACCESS_MEMO, JSON.stringify(platform.remembered));
    else localStorage.removeItem(ACCESS_MEMO);
  } catch { /* storage denied */ }
}

try {
  const saved = JSON.parse(localStorage.getItem(ACCESS_MEMO) || 'null');
  if (saved && typeof saved === 'object') platform.remembered = saved;
} catch { /* storage denied or corrupt */ }

export async function loadBootstrap() {
  const [me, boot] = await Promise.allSettled([call('/auth/me/'), call('/platform/bootstrap/')]);
  platform.user = me.status === 'fulfilled' ? me.value : null;

  try {
    if (boot.status === 'rejected') throw boot.reason;
    platform.boot = boot.value;
    platform.error = null;
  } catch (err) {
    platform.boot = null;
    platform.error = err instanceof AuthRequired ? 'signed-out' : 'unreachable';
  }

  platform.settled = true;
  if (platform.boot) rememberAccess(platform.boot.access);
  else if (platform.error === 'signed-out') rememberAccess(null);
  return platform.boot;
}

function accessValue(key) {
  if (platform.boot) return !!platform.boot.access?.[key];
  if (platform.settled) return false;
  return !!platform.remembered?.[key];
}

export const canOpenDashboard = () => accessValue('dashboard');
export const canOpenLms = () => accessValue('lms');
export const canOpenResearch = () => accessValue('research');
export const canOpenCore = () => accessValue('core');

export function communityRole() {
  const source = platform.boot?.access || (platform.settled ? null : platform.remembered);
  return source?.community_role || 'member';
}

export function isCoreAdmin() {
  const source = platform.boot?.access || (platform.settled ? null : platform.remembered);
  const role = source?.core_role;
  return role === 'owner' || role === 'admin';
}

/* ---- Shared platform endpoints ----------------------------------------- */
export const memberDashboard = () => call('/member/dashboard/');
export const readerLibrary = () => call('/reader/library/');
export const dashboard = (workspace) => call(`/platform/dashboard/?workspace=${workspace}`);
export const projects = () => call('/platform/projects/');
export const project = (id) => call(`/platform/projects/${id}/`);
export const projectCockpit = (id) => call(`/platform/projects/${id}/cockpit/`);
export const spaceTree = () => call('/platform/space/tree/');
export const spaceItems = () => call('/platform/space/items/');
export const spaceNotes = () => call('/platform/space/notes/');
export const syncSpace = ({ force = false, confirmed = false } = {}) => call('/platform/space/sync/', {
  method: 'POST', body: { force, confirmed },
});
export const reconcileSpace = () => call('/platform/space/reconcile/', {
  method: 'POST', body: { confirmed: true },
});
export const createSpaceFolder = ({ title, parentId = null }) => call('/platform/space/tree/', {
  method: 'POST', body: { title, kind: 'category', parent_id: parentId },
});
export const renameSpaceFolder = (id, title) => call(`/platform/space/nodes/${id}/`, {
  method: 'PATCH', body: { title },
});
export const createSpaceItem = (payload) => call('/platform/space/items/', { method: 'POST', body: payload });
export const updateSpaceItem = (id, payload) => call(`/platform/space/items/${id}/`, {
  method: 'PATCH', body: payload,
});
export const deleteSpaceItem = (id) => call(`/platform/space/items/${id}/`, { method: 'DELETE' });
export const content = () => call('/platform/content/');
export const resources = (kind) => call(`/platform/resources/?kind=${encodeURIComponent(kind)}`);
export const searchResources = (query) => call(`/platform/resources/?workspace=research&q=${encodeURIComponent(query)}`);
export const mindmaps = () => call('/platform/mindmaps/');
export const researchers = () => call('/platform/researchers/');
export const myProfile = () => call('/platform/researchers/me/');
export const sharedWithMe = () => call('/platform/shared-with-me/');
export const team = () => call('/platform/team/');
export const teamStorage = () => call('/platform/team/storage/');
export const nextcloud = () => call('/platform/nextcloud/');
export const researchRequests = () => call('/platform/research-requests/');
export const operatingDashboard = () => call('/operating/dashboard/');
export const operatingInitiatives = () => call('/operating/initiatives/');
export const operatingTasks = () => call('/operating/tasks/');
export const operatingCycles = () => call('/operating/cycles/');

/* ---- Layer 3 / LMS ------------------------------------------------------ */
export const lmsCourses = ({ all = false } = {}) => call(`/lms/courses/${all ? '?all=1' : ''}`);
export const lmsCourse = (id) => call(`/lms/courses/${id}/`);
export const lmsEnroll = (id, body = {}) => call(`/lms/courses/${id}/enroll/`, { method: 'POST', body });
export const lmsMe = () => call('/lms/me/');
export const lmsLessonProgress = (id, body) => call(`/lms/lessons/${id}/progress/`, { method: 'PUT', body });
export const lmsAssessmentAttempt = (id, answers) => call(`/lms/assessments/${id}/attempt/`, {
  method: 'POST', body: { answers },
});
export const lmsCreateCourse = (body) => call('/lms/courses/', { method: 'POST', body });
export const lmsUpdateCourse = (id, body) => call(`/lms/courses/${id}/`, { method: 'PATCH', body });

/* ---- Layer 5 administration -------------------------------------------- */
export const adminOverview = () => call('/platform/admin/overview/');
export const adminUsers = (query = '') => call(`/platform/admin/users/${query ? `?q=${encodeURIComponent(query)}` : ''}`);
export const adminUser = (id) => call(`/platform/admin/users/${id}/`);
export const adminUpdateUser = (id, body) => call(`/platform/admin/users/${id}/`, { method: 'PATCH', body });
export const adminActivity = ({ layer = '', userId = '' } = {}) => {
  const params = new URLSearchParams();
  if (layer) params.set('layer', layer);
  if (userId) params.set('user_id', userId);
  const suffix = params.toString();
  return call(`/platform/admin/activity/${suffix ? `?${suffix}` : ''}`);
};

export const adminSiteContent = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
  return call(`/platform/admin/site/content/${query ? `?${query}` : ''}`);
};
export const adminCreateSiteContent = (body) => call('/platform/admin/site/content/', { method: 'POST', body });
export const adminSiteContentItem = (id) => call(`/platform/admin/site/content/${id}/`);
export const adminUpdateSiteContent = (id, body) => call(`/platform/admin/site/content/${id}/`, { method: 'PATCH', body });
export const adminSiteComments = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
  return call(`/platform/admin/site/comments/${query ? `?${query}` : ''}`);
};
export const adminModerateComment = (id, status) => call(`/platform/admin/site/comments/${id}/`, {
  method: 'PATCH', body: { status },
});

export const adminResearchProjects = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
  return call(`/platform/admin/research/projects/${query ? `?${query}` : ''}`);
};
export const adminResearchProject = (id) => call(`/platform/admin/research/projects/${id}/`);
export const adminUpdateResearchProject = (id, body) => call(`/platform/admin/research/projects/${id}/`, {
  method: 'PATCH', body,
});

export const adminLmsEnrollments = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
  return call(`/platform/admin/lms/enrollments/${query ? `?${query}` : ''}`);
};
export const adminUpdateLmsEnrollment = (id, body) => call(`/platform/admin/lms/enrollments/${id}/`, {
  method: 'PATCH', body,
});
export const adminDeck = () => call('/platform/admin/deck/');
export const adminDeckSync = () => call('/platform/admin/deck/sync/', { method: 'POST', body: {} });

/* ---- Display helpers ---------------------------------------------------- */
export function label(value) {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function meta(parts) {
  return parts.filter(Boolean).join(' · ');
}

globalThis.taskRow = function taskRow(task) {
  const node = document.createElement('div');
  node.className = 'v-row';

  const main = document.createElement('div');
  main.className = 'v-row__main';

  const title = document.createElement('strong');
  title.textContent = task?.title || 'Untitled task';
  main.append(title);

  const initiative = typeof task?.initiative === 'string'
    ? task.initiative
    : task?.initiative?.title || task?.trace?.initiative?.title || '';
  const owner = typeof task?.owner === 'string'
    ? task.owner
    : task?.owner?.name || task?.owner?.email || '';
  const detail = meta([initiative, owner, formatDate(task?.due_date)]);
  if (detail) {
    const sub = document.createElement('small');
    sub.textContent = detail;
    main.append(sub);
  }

  const badges = [label(task?.priority), label(task?.status)].filter(Boolean);
  if (badges.length) {
    const strip = document.createElement('div');
    strip.className = 'v-badges';
    for (const text of badges) {
      const badge = document.createElement('span');
      badge.className = 'v-badge';
      badge.textContent = text;
      strip.append(badge);
    }
    main.append(strip);
  }

  node.append(main);
  return node;
};
