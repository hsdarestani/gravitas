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

function csrfCookie() {
  return cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
}

async function csrfToken() {
  let token = csrfCookie();
  if (token) return token;

  const res = await fetch(`${API}/auth/csrf/`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const error = new Error(`csrf_http_${res.status}`);
    error.status = res.status;
    throw error;
  }

  token = csrfCookie();
  if (!token) throw new Error('csrf_token_missing');
  return token;
}

export class AuthRequired extends Error {}

export async function upload(path, formData, { method = 'POST' } = {}) {
  const token = await csrfToken();
  const res = await fetch(API + path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'X-CSRFToken': token },
    body: formData,
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

export async function call(path, { method = 'GET', body } = {}) {
  const verb = String(method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(verb);
  const headers = { Accept: 'application/json' };

  // CSRF protects the HTTP verb, not the presence of a JSON body. The old
  // client only sent X-CSRFToken when `body` existed, which made body-less
  // POSTs such as /auth/logout/ fail with Django's CSRF rejection while the
  // UI redirected anyway. Every unsafe request now gets a real token, and a
  // direct workspace visit can bootstrap the cookie when it is absent.
  if (unsafe) headers['X-CSRFToken'] = await csrfToken();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, {
    method: verb,
    headers,
    credentials: 'same-origin',
    cache: verb === 'GET' ? 'default' : 'no-store',
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

// ws-app and the five-layer rail historically imported this file with
// different query-string versions. Browsers correctly treat those URLs as
// distinct ES modules, which used to create two independent entitlement
// states: the shell could have a successful bootstrap while the rail still
// believed LMS/Research/Core were unavailable. Keep one shared state object
// on globalThis so every versioned import observes the same authoritative
// bootstrap result.
const PLATFORM_STATE_KEY = '__gravitasWorkspacePlatformStateV3';
const sharedPlatform = globalThis[PLATFORM_STATE_KEY] || {
  boot: null,
  user: null,
  error: null,
  remembered: null,
  settled: false,
};
globalThis[PLATFORM_STATE_KEY] = sharedPlatform;
export const platform = sharedPlatform;

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
  if (saved && typeof saved === 'object' && !platform.remembered) platform.remembered = saved;
} catch { /* storage denied or corrupt */ }

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function bootstrapWithRetry() {
  const delays = [0, 250, 750];
  let lastError = null;

  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      return await call('/platform/bootstrap/');
    } catch (err) {
      lastError = err;
      if (err instanceof AuthRequired) throw err;
      // Retry only transport/5xx failures. A real 4xx entitlement response is
      // authoritative and must not be hidden behind repeated requests.
      if (err?.status && err.status < 500) throw err;
    }
  }

  throw lastError || new Error('bootstrap_unreachable');
}

export async function loadBootstrap() {
  const [me, boot] = await Promise.allSettled([call('/auth/me/'), bootstrapWithRetry()]);
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

export async function signOut() {
  await call('/auth/logout/', { method: 'POST' });
  platform.boot = null;
  platform.user = null;
  platform.error = 'signed-out';
  platform.settled = true;
  rememberAccess(null);
}

function accessSource() {
  if (platform.boot) return platform.boot.access || null;
  if (platform.error === 'signed-out') return null;
  // A cached entitlement only controls which navigation entry is rendered;
  // every API request is still authorized server-side. Keeping the last known
  // access during a transient outage avoids making whole product layers vanish
  // from the rail while the backend is recovering.
  return platform.remembered;
}

function accessValue(key) {
  return !!accessSource()?.[key];
}

export const canOpenDashboard = () => accessValue('dashboard');
export const canOpenLms = () => accessValue('lms');
export const canOpenResearch = () => accessValue('research');
export const canOpenCore = () => accessValue('core');

export function communityRole() {
  return accessSource()?.community_role || 'member';
}

export function isCoreAdmin() {
  const role = accessSource()?.core_role;
  return role === 'owner' || role === 'admin';
}

/* ---- Shared platform endpoints ----------------------------------------- */
export const memberDashboard = () => call('/member/dashboard/');
export const readerLibrary = () => call('/reader/library/');
export const removeLibraryItem = (relation, itemKey) => call('/reader/library/', {
  method: 'DELETE', body: { relation, item_key: itemKey },
});
export const memberTickets = () => call('/member/tickets/');
export const createMemberTicket = (body) => call('/member/tickets/', { method: 'POST', body });
export const memberTicket = (id) => call(`/member/tickets/${id}/`);
export const replyMemberTicket = (id, message) => call(`/member/tickets/${id}/`, { method: 'POST', body: { message } });
export const updateMemberTicket = (id, body) => call(`/member/tickets/${id}/`, { method: 'PATCH', body });
export const dashboard = (workspace) => call(`/platform/dashboard/?workspace=${workspace}`);
export const projects = () => call('/platform/projects/');
export const researchCalendar = () => call('/platform/research-calendar/');
export const project = (id) => call(`/platform/projects/${id}/`);
export const projectCockpit …3041 tokens truncated… false } = {}) => call(`/lms/paths/${all ? '?all=1' : ''}`);
export const lmsCreateLearningPath = (body) => call('/lms/paths/', { method: 'POST', body });
export const lmsUpdateLearningPath = (id, body) => call(`/lms/paths/${id}/`, { method: 'PATCH', body });
export const lmsDeleteLearningPath = (id) => call(`/lms/paths/${id}/`, { method: 'DELETE' });
export const lmsPersonalizedPaths = () => call('/lms/paths/personalize/');
export const lmsPersonalizePath = (body) => call('/lms/paths/personalize/', { method: 'POST', body });
export const lmsIntegrations = () => call('/lms/integrations/');
export const lmsSaveIntegration = (body) => call('/lms/integrations/', { method: 'POST', body });
export const lmsDeleteIntegration = (provider) => call('/lms/integrations/', { method: 'DELETE', body: { provider } });
export const lmsCheckout = (id) => call(`/lms/courses/${id}/checkout/`);
export const lmsStartCheckout = (id) => call(`/lms/courses/${id}/checkout/`, { method: 'POST', body: {} });
export const lmsCourseDiscussion = (id) => call(`/lms/courses/${id}/discussion/`);
export const lmsPostCourseDiscussion = (id, body) => call(`/lms/courses/${id}/discussion/`, { method: 'POST', body });
export const lmsEditCourseDiscussion = (courseId, messageId, body) => call(`/lms/courses/${courseId}/discussion/${messageId}/`, { method: 'PATCH', body });
export const lmsDeleteCourseDiscussion = (courseId, messageId) => call(`/lms/courses/${courseId}/discussion/${messageId}/`, { method: 'DELETE' });
export const lmsLiterature = (id, { q = '', providers = '', limit = 6, lessonId = '' } = {}) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (providers) params.set('providers', providers);
  if (lessonId) params.set('lesson_id', String(lessonId));
  params.set('limit', String(limit));
  return call(`/lms/courses/${id}/literature/?${params.toString()}`);
};
export const lmsNotebooks = (id) => call(`/lms/courses/${id}/notebooks/`);
export const lmsSaveNotebook = (id, body) => call(`/lms/courses/${id}/notebooks/`, { method: 'POST', body });
export const lmsExecuteNotebook = (notebookId) => call(`/lms/notebooks/${notebookId}/execute/`, { method: 'POST', body: {} });
export const lmsGit = (id) => call(`/lms/courses/${id}/git/`);
export const lmsGitPush = (id, body) => call(`/lms/courses/${id}/git/`, { method: 'POST', body });
export const lmsPublishAchievement = (id, body) => call(`/lms/courses/${id}/publish/`, { method: 'POST', body });
export const adminLmsMeta = () => call('/platform/admin/lms/meta/');
export const adminSaveLmsMeta = (body) => call('/platform/admin/lms/meta/', { method: 'POST', body });
export const adminDeleteLmsMeta = (kind, id) => call('/platform/admin/lms/meta/', { method: 'DELETE', body: { kind, id } });
export const adminLmsAnalytics = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
  return call(`/platform/admin/lms/analytics/${query ? `?${query}` : ''}`);
};
export const adminOpenEdxStatus = () => call('/platform/admin/lms/openedx/');
export const adminValidateOpenEdxCourse = (courseId) => call('/platform/admin/lms/openedx/', { method: 'POST', body: { course_id: courseId } });
export const adminCoursePayments = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
  return call(`/platform/admin/lms/payments/${query ? `?${query}` : ''}`);
};
export const adminUpdateCoursePayment = (paymentId, body) => call('/platform/admin/lms/payments/', {
  method: 'PATCH',
  body: { payment_id: paymentId, ...body },
});

export const adminLearningRepositories = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
  return call(`/platform/admin/lms/repositories/${query ? `?${query}` : ''}`);
};
export const adminReviewLearningRepository = (repositoryId, reviewStatus, reviewNote = '') => call('/platform/admin/lms/repositories/', {
  method: 'PATCH',
  body: { repository_id: repositoryId, review_status: reviewStatus, review_note: reviewNote },
});
export const adminLearningAssets = (courseId) => call(`/platform/admin/lms/courses/${courseId}/assets/`);
export const adminUploadLearningAsset = (courseId, formData) => upload(`/platform/admin/lms/courses/${courseId}/assets/`, formData);
export const adminUpdateLearningAsset = (assetId, body) => call(`/lms/assets/${assetId}/`, { method: 'PATCH', body });
export const adminDeleteLearningAsset = (assetId) => call(`/lms/assets/${assetId}/`, { method: 'DELETE' });

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
export const adminNewsletter = () => call('/platform/admin/newsletter/');
export const adminSendNewsletter = (body) => call('/platform/admin/newsletter/', { method: 'POST', body });
export const adminUpdateNewsletterSubscriber = (id, active) => call(`/platform/admin/newsletter/subscribers/${id}/`, { method: 'PATCH', body: { active } });
export const adminTickets = (status = '') => call(`/platform/admin/tickets/${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const adminTicket = (id) => call(`/platform/admin/tickets/${id}/`);
export const adminReplyTicket = (id, message) => call(`/platform/admin/tickets/${id}/`, { method: 'POST', body: { message } });
export const adminUpdateTicket = (id, body) => call(`/platform/admin/tickets/${id}/`, { method: 'PATCH', body });
export const adminLabs = () => call('/platform/admin/labs/');
export const adminCreateLab = (body) => call('/platform/admin/labs/', { method: 'POST', body });
export const adminUpdateLab = (id, body) => call(`/platform/admin/labs/${id}/`, { method: 'PATCH', body });
export const adminDeleteLab = (id) => call(`/platform/admin/labs/${id}/`, { method: 'DELETE' });
export const contentComments = (id) => call(`/platform/content/${id}/comments/`);
export const addContentComment = (id, body) => call(`/platform/content/${id}/comments/`, { method: 'POST', body: { body } });
export const contentAttachments = (id) => call(`/platform/content/${id}/attachments/`);
export const uploadContentAttachment = (id, file) => {
  const form = new FormData(); form.append('file', file);
  return upload(`/platform/content/${id}/attachments/`, form);
};
export const coreAssets = () => call('/platform/core-assets/');
export const uploadCoreAsset = (form) => upload('/platform/core-assets/', form);
export const updateCoreAsset = (id, body) => call(`/platform/core-assets/${id}/`, { method: 'PATCH', body });
export const deleteCoreAsset = (id) => call(`/platform/core-assets/${id}/`, { method: 'DELETE' });
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
  // Date-only deadlines are calendar days, not UTC instants. Parsing them as
  // UTC midnight displays the previous day in western browser time zones.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);
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
