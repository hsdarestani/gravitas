const studio = '/api/workspace-v2/';
const taskUrl = id => `${studio}tasks/${Number(id)}/`;

const messages = {
  authentication_required: 'Sign in to GraviQuest to open this workspace.',
  core_workspace_required: 'Your account needs GraviQuest Core workspace access.',
  studio_preview_unavailable: 'Workspace Studio preview is unavailable.',
  permission_denied: 'Your workspace role does not allow this change.',
  project_edit_required: 'You need permission to edit this project.',
  task_changed_elsewhere: 'Another edit changed this task. Reload the task and try again.',
  task_prerequisites_incomplete: 'Finish the prerequisite tasks first.',
  task_checklist_incomplete: 'Complete the task checklist first.',
  task_already_started: 'A task that has already started cannot gain an unfinished prerequisite.',
  workflow_approval_required: 'Use Final approval after all QA parts are approved.',
  workflow_reviewer_required: 'This action requires a reviewer other than the submitter.',
  workflow_finish_steps: 'Finish the workflow steps before submitting QA.',
  workflow_preview_required: 'Add a preview or evidence URL before submitting.',
  workflow_changed: 'The workflow changed elsewhere. Reopen it and try again.',
  dependency_cycle: 'This dependency would create a cycle.',
  title_and_done_definition_required: 'Enter a task name and Definition of Done.',
  task_requires_due_date: 'This task needs a planned finish date in the canonical plan.',
};

let csrfToken;

export async function request(path, method = 'GET', body) {
  const headers = new Headers({Accept: 'application/json'});
  if (method !== 'GET') {
    if (!csrfToken) {
      csrfToken = (await request('/api/workspace-v2/csrf/')).csrf_token;
    }
    headers.set('X-CSRFToken', csrfToken);
    if (!(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
  }
  const response = await fetch(path, {method, headers, body, credentials:'same-origin', cache:'no-store'});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const code = payload.error || (response.status === 403 ? 'permission_denied' : 'request_failed');
    if (response.status === 403 && !payload.error) csrfToken = undefined;
    throw Object.assign(new Error(messages[code] || `Workspace request failed (${code}).`), {code, status:response.status});
  }
  return payload;
}

export const workspaceApi = {
  load: () => request(studio + 'state/'),
  detail: id => request(taskUrl(id) + 'details/'),
  create: payload => request(studio + 'tasks/', 'POST', payload),
  patch: (item, payload) => request(taskUrl(item.id), 'PATCH', {...payload, expected_updated_at:item.updatedAt}),
  canvas: (flow,canvas) => request(studio+`projects/${Number(flow.id)}/canvas/`, 'PATCH', {
    revision:flow.canvasRevision, canvas,
  }),
  dependencies: changes => request(studio + 'dependencies/', 'POST', {
    changes: changes.map(({from,to,action})=>({predecessor_id:Number(from),task_id:Number(to),action})),
  }),
  addCheck: (id, label) => request(taskUrl(id) + 'checklist/', 'POST', {title:label}),
  check: (id, entry, done) => request(taskUrl(id) + `checklist/${Number(entry)}/`, 'PATCH', {is_completed:done}),
  removeCheck: (id, entry) => request(taskUrl(id) + `checklist/${Number(entry)}/`, 'DELETE', {}),
  note: (id, body, members, parentId) => request(taskUrl(id) + 'comments/', 'POST', {
    body, mention_user_ids:members.map(Number), ...(parentId?{parent_id:Number(parentId)}:{}),
  }),
  upload: (id, file) => {
    const body = new FormData();
    body.set('file', file);
    return request(taskUrl(id) + 'attachments/', 'POST', body);
  },
  workflow: (id, payload) => request(taskUrl(id) + 'workflow/', 'POST', payload),
  workflowTemplates: () => request('/api/platform/task-workflow-templates/'),
  meeting: (id, payload) => request(studio+'meetings/'+(id?Number(id)+'/':''), id?'PATCH':'POST', payload),
  markRead: ids => request('/api/task-notifications/in-app/', 'PATCH', {ids:ids.map(Number)}),
};
