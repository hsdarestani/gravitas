/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  PLATFORM DATA
   The two real workspaces, Core and Research, and everything the backend
   serves for them.

   These endpoints are all registered in backend/core/urls.py and answer
   today, which is the difference between this file and the page endpoints
   in ws-api.js. So there is no local fallback here and there should not be:
   a Core dashboard invented in the browser would be a fabricated report on
   a real team's work. When a call fails, the view says what failed and
   offers a retry.
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

  // The old workspace redirected to /login from inside its fetch wrapper, so
  // a single stale request could throw away unsaved work in another pane.
  // This throws instead and lets the shell decide.
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

/* ---- The shape of the platform ------------------------------------------
   bootstrap answers who the reader is, which workspaces they may open, and
   what is assigned to them. Everything else in the shell keys off it, so it
   is fetched once and held. */

export const platform = {
  boot: null,
  user: null,
  error: null,
  /* What the last successful bootstrap on this machine said about access, and
     whether this one has answered yet. Together they let the shell draw the
     rail once instead of twice.

     Without the memo the first paint has no access rules, so Core is missing
     from the rail and from the index, and the reader watches it appear a
     round trip later and push every other workspace down. Remembering it is
     not the same thing as inventing data: it is last week's answer to the
     same question, it is replaced the moment the real one lands, and the
     server still authorizes every route behind it. A revoked membership loses
     the button one paint late; a member stops seeing the shell rearrange
     itself on every refresh. */
  remembered: null,
  settled: false,
};

const ACCESS_MEMO = 'gravitas.ws.access.v1';

function rememberAccess(access) {
  platform.remembered = access
    ? { core: !!access.core, core_role: access.core_role || '' }
    : null;
  try {
    if (platform.remembered) localStorage.setItem(ACCESS_MEMO, JSON.stringify(platform.remembered));
    else localStorage.removeItem(ACCESS_MEMO);
  } catch { /* storage denied: the shell just paints twice, as it used to */ }
}

// Read at module load, before the first paint asks.
try {
  const saved = JSON.parse(localStorage.getItem(ACCESS_MEMO) || 'null');
  if (saved && typeof saved === 'object') platform.remembered = saved;
} catch { /* storage denied or corrupt */ }

export async function loadBootstrap() {
  // Both at once. The greeting needs the name and the shell needs the access
  // rules, and running them in series would put a second round trip in front
  // of the first paint for no reason.
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
  // A signed-out answer clears the memo rather than keeping it: the next
  // reader of this browser is not necessarily the same person.
  if (platform.boot) rememberAccess(platform.boot.access);
  else if (platform.error === 'signed-out') rememberAccess(null);
  return platform.boot;
}

/* Both of these are asked during the first paint, before bootstrap has
   answered. Until it does they answer from the memo; after it does they
   answer only from the server. */

export function canOpenCore() {
  if (platform.boot) return !!platform.boot.access?.core;
  if (platform.settled) return false;
  return !!platform.remembered?.core;
}

/* Team and Access is owner and admin only. The server enforces this too;
   hiding the entry here is so nobody is offered a door that will not open. */
export function isCoreAdmin() {
  const source = platform.boot?.access || (platform.settled ? null : platform.remembered);
  const role = source?.core_role;
  return role === 'owner' || role === 'admin';
}

/* ---- Endpoints ----------------------------------------------------------
   Thin wrappers, named for what the reader asked for rather than for the
   URL, so a route change is one edit here. */

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

/* ---- Display helpers ----------------------------------------------------
   Shared so a status reads the same in the sidebar, a card and a row. The
   backend sends snake_case enum values; nothing else should be turning them
   into English in six different places. */

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

/* Joins the parts of a metadata line, dropping the empty ones. Without the
   filter an item with no due date renders as "High · Open ·  · " and the
   stray separators read as missing data rather than as absent fields. */
export function meta(parts) {
  return parts.filter(Boolean).join(' · ');
}

/* Compatibility renderer for the Core Tasks screen.
   The canonical V4 view calls taskRow(task), but the helper was accidentally
   dropped during the frontend sync. Because ws-views.js imports this module
   before rendering, publishing the helper on the global environment restores
   the missing binding without fabricating any task data. Keep the adapter
   tolerant of both dashboard and operating API shapes. */
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
