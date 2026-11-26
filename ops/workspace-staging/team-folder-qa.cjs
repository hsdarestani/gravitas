const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE);

const origin = 'https://staging.graviquest.com';
let phase = 'launch';
const paths = new Set();

async function signIn(browser, role, email, password) {
  phase = `sign_in_${role}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#in-mail').fill(email);
  await page.locator('#in-pass').fill(password);
  const [login] = await Promise.all([
    page.waitForResponse(res => res.url() === origin + '/api/auth/login/' && res.request().method() === 'POST'),
    page.locator('#p-in button[type="submit"]').click(),
  ]);
  assert.equal(login.status(), 200);
  await page.waitForURL(url => url.origin === origin && /^\/workspace(?:-v2)?\/?$/.test(url.pathname));
  const cookie = (await context.cookies()).find(item => item.name === 'gravitas_staging_sessionid');
  assert(cookie?.secure && cookie.httpOnly && cookie.domain === 'staging.graviquest.com');
  const state = await context.request.get(origin + '/api/workspace-v2/state/');
  assert.equal(state.status(), role === 'research' ? 403 : 200);
  return { page, context, actor: (await state.json()).actor };
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME });
  try {
    const named = await signIn(browser, 'named_owner', process.env.TEAM_EMAIL.trim(), process.env.TEAM_PASSWORD);
    assert.equal(named.actor.role, 'owner');
    await named.context.close();
    console.log('named_staging_core_owner_browser_sign_in=pass');

    const owner = await signIn(browser, 'qa_owner', 'workspace-staging-qa-owner@example.test', process.env.QA_OWNER_PASSWORD);
    const request = owner.context.request;
    const csrf = await request.get(origin + '/api/workspace-v2/csrf/');
    assert.equal(csrf.status(), 200);
    const headers = { Origin: origin, 'X-CSRFToken': (await csrf.json()).csrf_token };
    phase = 'create_studio_project';
    const title = 'Staging QA Team Folder ' + randomUUID().slice(0, 8);
    const created = await request.post(origin + '/api/workspace-v2/projects/', { headers, data: {
      action: 'create', title, owner_id: owner.actor.id, start_date: new Date().toISOString().slice(0, 10),
    } });
    assert.equal(created.status(), 201);
    const id = (await created.json()).id;
    assert(Number.isInteger(id));
    const projectApi = `${origin}/api/platform/projects/${id}/`;
    const pending = await request.get(projectApi + 'structure/');
    assert.equal(pending.status(), 409);
    assert.equal((await pending.json()).error, 'studio_project_storage_pending');
    console.log('new_studio_project_queued_automatic_setup=pass');

    phase = 'wait_for_team_folder_in_studio';
    await owner.page.goto(`${origin}/workspace-v2?qa=team-folder#page=area&project=${id}`, { waitUntil: 'domcontentloaded' });
    await owner.page.getByRole('heading', { name: title, exact: true }).waitFor();
    await owner.page.getByRole('button', { name: 'Project files in Nextcloud' }).click();
    const form = owner.page.locator('#native-file-form');
    await form.waitFor({ timeout: 125000 });
    const listing = await request.get(projectApi + 'structure/');
    assert.equal(listing.status(), 200);
    const storage = await listing.json();
    assert(storage.enabled && storage.can_edit);
    assert(storage.native_url.startsWith(origin + '/nextcloud/'));
    console.log('studio_automatic_team_folder_and_writer_ready=pass');

    phase = 'upload_and_verify_exact_project_file';
    const name = 'staging-team-folder-evidence.txt';
    const bytes = Buffer.from('Workspace V2 automatic Nextcloud Team Folder QA\n');
    await form.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: bytes });
    const [upload] = await Promise.all([
      owner.page.waitForResponse(res => res.url().startsWith(projectApi + 'structure/') && res.request().method() === 'POST',
        { timeout: 90000 }),
      form.getByRole('button', { name: 'Upload to Nextcloud' }).click(),
    ]);
    assert.equal(upload.status(), 200);
    const native = await request.get(projectApi + 'file-content/?path=' + encodeURIComponent(name));
    assert.equal(native.status(), 200);
    assert((await native.body()).equals(bytes));
    const dialog = owner.page.getByRole('dialog');
    const evidenceUrl = await dialog.getByRole('link', { name, exact: true }).getAttribute('href');
    const launch = new URL(evidenceUrl, origin);
    const file = new URL(launch.searchParams.get('next'));
    assert.equal(launch.pathname, '/api/platform/nextcloud/sso/');
    assert.equal(file.origin, origin);
    assert(/^\/nextcloud\/index\.php\/f\/\d+$/.test(file.pathname));

    phase = 'revision_dialog_and_cross_role_denial';
    const revision = await request.get(projectApi + 'file-revisions/?path=project.md');
    assert.equal(revision.status(), 200);
    const revisionId = (await revision.json()).revisions[0].id;
    const snapshot = await request.get(projectApi + 'file-revisions/?path=project.md&revision_id=' + revisionId);
    assert.equal(snapshot.status(), 200);
    assert((await snapshot.json()).revision.content.includes(title));
    const research = await signIn(browser, 'research', 'workspace-staging-qa-research@example.test', process.env.QA_RESEARCH_PASSWORD);
    assert.equal((await research.context.request.get(projectApi + 'structure/')).status(), 403);
    assert.equal((await research.context.request.get(projectApi + 'file-content/?path=' + name)).status(), 403);
    await research.context.close();
    console.log('studio_native_upload_bytes_revision_and_denial=pass');

    phase = 'canonical_task_keeps_same_id_across_workspaces';
    const taskTitle = 'Check the automatically provisioned project';
    const task = await request.post(origin + '/api/workspace-v2/tasks/', { headers, timeout: 90000, data: {
      title: taskTitle, definition_of_done: 'Evidence verified', project_id: id, owner_id: owner.actor.id,
      status: 'ready', client_create_id: randomUUID(), duration_days: 1,
    } });
    assert.equal(task.status(), 201);
    const taskId = (await task.json()).id;
    const v1 = await request.get(`${origin}/api/operating/task-board/${taskId}/`);
    assert.equal(v1.status(), 200);
    assert.equal((await v1.json()).task.title, taskTitle);
    console.log('auto_provisioned_project_v1_v2_task_readback=pass');

    phase = 'open_uploaded_file_through_staging_sso';
    owner.page.on('request', req => {
      const url = new URL(req.url());
      if (url.origin === origin) paths.add(url.pathname);
    });
    const landing = await owner.page.goto(launch.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.equal(landing.status(), 200);
    await owner.page.waitForURL(url => url.origin === origin && /\/nextcloud\/(?:index\.php\/)?apps\/files(?:\/|$)/.test(url.pathname));
    assert(paths.has('/api/oidc/authorize/') && paths.has(file.pathname));
    const profile = await request.get(origin + '/nextcloud/ocs/v2.php/cloud/user?format=json', {
      headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    });
    assert.equal(profile.status(), 200);
    assert.equal((await profile.json()).ocs.data.id, 'gravitas-u-' + owner.actor.id);
    console.log('auto_provisioned_project_exact_file_sso=pass');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const actual = Number.isInteger(error.actual) ? ` status=${error.actual}` : '';
  console.error(`workspace_staging_team_folder_qa=failed phase=${phase} error=${error.name}${actual}`);
  process.exitCode = 1;
});
