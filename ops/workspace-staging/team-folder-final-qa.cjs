const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE);

const origin = 'https://staging.graviquest.com';
let phase = 'launch';

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
    const owner = await signIn(browser, 'qa_owner', 'workspace-staging-qa-owner@example.test', process.env.QA_OWNER_PASSWORD);
    const request = owner.context.request;
    const token = await request.get(origin + '/api/workspace-v2/csrf/');
    assert.equal(token.status(), 200);
    const headers = { Origin: origin, 'X-CSRFToken': (await token.json()).csrf_token };
    const studio = origin + '/api/workspace-v2/';
    async function action(method, suffix, status, data) {
      const response = await request.fetch(studio + suffix, { method, headers, data });
      assert.equal(response.status(), status);
      return response.json();
    }

    phase = 'refer_and_promote_idea';
    const key = randomUUID().slice(0, 8);
    const title = 'Staging QA promoted idea ' + key;
    const area = await action('POST', 'areas/', 201, { action: 'area', title: 'Staging QA area ' + key, owner_id: owner.actor.id });
    const idea = await action('POST', 'ideas/', 201, { action: 'create', title, body: 'Synthetic promotion for staging.' });
    await action('PATCH', `ideas/${idea.id}/`, 200, { action: 'refer', process_id: area.id });
    const promoted = await action('PATCH', `ideas/${idea.id}/`, 200, { action: 'promote', title });
    assert.equal(promoted.project_id, idea.project_id);
    const storageUrl = `${origin}/api/platform/projects/${promoted.project_id}/structure/`;
    const pending = await request.get(storageUrl);
    assert.equal(pending.status(), 409);
    assert.equal((await pending.json()).error, 'studio_project_storage_pending');

    const named = await signIn(browser, 'named_owner', process.env.TEAM_EMAIL.trim(), process.env.TEAM_PASSWORD);
    phase = 'team_member_controls_as_named_owner';
    await named.page.goto(origin + '/workspace/core/team', { waitUntil: 'domcontentloaded' });
    await named.page.getByRole('heading', { name: 'Team & Access', exact: true }).waitFor();
    await named.page.getByRole('button', { name: 'Add member', exact: true }).click();
    await named.page.locator('input[type="password"]:visible').waitFor();
    await named.context.close();
    console.log('staging_named_owner_team_enrollment_controls=pass');

    phase = 'live_read_only_revision_dialog_desktop_and_mobile';
    const id = Number(process.env.QA_CANONICAL_PROJECT);
    assert(id > 0);
    const state = await request.get(studio + 'state/');
    const project = (await state.json()).projects.find(row => row.id === id);
    assert(project?.title);
    for (const width of [1440, 390]) {
      await owner.page.setViewportSize({ width, height: 900 });
      await owner.page.goto(`${origin}/workspace-v2?qa=revision-${width}#page=area&project=${id}`,
        { waitUntil: 'domcontentloaded' });
      await owner.page.getByRole('heading', { name: project.title, exact: true }).waitFor();
      await owner.page.getByRole('button', { name: 'Project files in Nextcloud' }).click();
      const dialog = owner.page.getByRole('dialog');
      await dialog.locator('li').filter({ hasText: 'project.md' }).getByRole('button', { name: 'Version history' }).click();
      await dialog.locator('li').getByRole('button').first().click();
      const snapshot = dialog.getByRole('textbox', { name: 'Historical file content' });
      await snapshot.waitFor();
      assert((await snapshot.inputValue()).includes(project.title));
      assert(await snapshot.evaluate(input => input.readOnly));
      assert((await dialog.boundingBox()).width <= width);
    }
    console.log('staging_live_read_only_revision_dialog_1440_390=pass');

    phase = 'auto_provision_promoted_idea';
    const deadline = Date.now() + 135000;
    let response;
    do {
      response = await request.get(storageUrl);
      if (response.status() === 200) break;
      assert.equal(response.status(), 409);
      assert.equal((await response.json()).error, 'studio_project_storage_pending');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } while (Date.now() < deadline);
    assert.equal(response.status(), 200);
    const storage = await response.json();
    assert(storage.enabled && storage.can_edit);
    console.log('staging_promoted_idea_keeps_project_id_and_gets_team_folder=pass');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const actual = Number.isInteger(error.actual) ? ` status=${error.actual}` : '';
  console.error(`workspace_staging_final_qa=failed phase=${phase} error=${error.name}${actual}`);
  process.exitCode = 1;
});

