const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE);

const origin = 'https://staging.graviquest.com';
let phase = 'start_browser';
let routes = new Set();
const roles = ['owner', 'member', 'research'];

async function signIn(browser, role) {
  phase = `sign_in_${role}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#in-mail').fill(`workspace-staging-qa-${role}@example.test`);
  await page.locator('#in-pass').fill(process.env[`QA_${role.toUpperCase()}_PASSWORD`]);
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url() === origin + '/api/auth/login/' && res.request().method() === 'POST'),
    page.locator('#p-in button[type="submit"]').click(),
  ]);
  assert.equal(response.status(), 200);
  await page.waitForURL(url => url.origin === origin && /^\/workspace(?:-v2)?\/?$/.test(url.pathname));
  const cookie = (await context.cookies()).find(item => item.name === 'gravitas_staging_sessionid');
  assert(cookie?.secure && cookie.httpOnly);
  assert.equal(cookie.domain, 'staging.graviquest.com');
  await page.goto(origin + '/workspace-v2', { waitUntil: 'domcontentloaded' });
  const state = await context.request.get(origin + '/api/workspace-v2/state/');
  assert.equal(state.status(), role === 'research' ? 403 : 200);
  if (role === 'research') return { page, context };
  const identity = (await state.json()).actor;
  assert(identity.id);
  return { page, context, identity };
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME });
  try {
    const oidcOnly = process.env.QA_OIDC_ONLY === '1';
    const loggedIn = { owner: await signIn(browser, 'owner') };
    if (!oidcOnly) {
      const anonymous = await browser.newContext();
      assert.equal((await anonymous.request.get(origin + '/api/workspace-v2/state/')).status(), 401);
      await anonymous.close();
      for (const role of roles.slice(1)) loggedIn[role] = await signIn(browser, role);
    }
    const owner = loggedIn.owner;
    await owner.page.getByText('Focus', { exact: true }).first().waitFor();
    if (!oidcOnly) {
      assert.notEqual(owner.identity.id, loggedIn.member.identity.id);
      console.log('public_workspace_browser_sign_in_roles=pass');
    }

    phase = 'select_native_project_file';
    const base = `${origin}/api/platform/projects/${Number(process.env.QA_CANONICAL_PROJECT)}/structure/`;
    const listing = await owner.context.request.get(base);
    assert.equal(listing.status(), 200);
    if (!oidcOnly) assert.equal((await loggedIn.research.context.request.get(base)).status(), 403);
    const data = await listing.json();
    const file = data.items.find(item => item.name === 'staging-evidence.txt' && !item.folder);
    assert(/^\d+$/.test(file?.file_id));
    const href = new URL(data.native_url);
    assert.equal(href.origin, origin);
    href.pathname = '/nextcloud/index.php/f/' + file.file_id;
    href.search = '';

    phase = 'nextcloud_oidc_browser_round_trip';
    owner.page.on('request', request => {
      const destination = new URL(request.url());
      if (destination.origin === origin) routes.add(destination.pathname);
    });
    const landing = await owner.page.goto(origin + '/api/platform/nextcloud/sso/?next=' + encodeURIComponent(href.href),
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    const finalUrl = new URL(owner.page.url());
    console.log(`nextcloud_browser_landing status=${landing?.status()} origin=${finalUrl.origin} path=${finalUrl.pathname}`);
    const profile = await owner.context.request.get(origin + '/nextcloud/ocs/v2.php/cloud/user?format=json', {
      headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    });
    console.log(`nextcloud_authenticated_profile_http=${profile.status()}`);
    assert.equal(profile.status(), 200);
    assert.equal((await profile.json()).ocs.data.id, 'gravitas-u-' + owner.identity.id);
    assert(routes.has('/api/oidc/authorize/'));
    assert([...routes].some(path => path.endsWith('/apps/user_oidc/code')));
    assert([...routes].some(path => path === href.pathname || path === '/nextcloud/f/' + file.file_id));
    await owner.page.waitForURL(url => url.origin === origin && /\/nextcloud\/(?:index\.php\/)?apps\/files(?:\/|$)/.test(url.pathname));
    console.log('public_nextcloud_browser_sso_exact_file_id=pass');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  const checkpoints = [...routes].filter(path => /\/api\/oidc\/|\/apps\/user_oidc\/|\/f\/|\/apps\/files/.test(path));
  const actual = Number.isInteger(error.actual) ? ` http_status=${error.actual}` : '';
  console.error(`public_staging_acceptance=failed phase=${phase} error=${error.name}${actual} checkpoints=${checkpoints.join(',')}`);
  process.exitCode = 1;
});
