'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE);

const origin = 'https://staging.graviquest.com';
const base = '/api/release-center/';

async function verify() {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const goto = path => page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await goto('/');
    await page.getByRole('heading', { name: /Science, AI and the Gravity of Questions/ }).waitFor();
    assert.equal((await context.request.get(origin + base + 'visual/')).status(), 401);
    assert.equal(await page.getByRole('link', { name: 'Edit Page', exact: true }).count(), 0);
    await goto('/login');
    await page.locator('#in-mail').fill(process.env.STAGE_OWNER_EMAIL);
    await page.locator('#in-pass').fill(process.env.STAGE_OWNER_PASSWORD);
    const login = page.waitForResponse(response => response.url() === origin + '/api/auth/login/' && response.request().method() === 'POST');
    await page.locator('#p-in button[type="submit"]').click();
    assert.equal((await login).status(), 200);
    await page.waitForURL(url => url.origin === origin && /^\/workspace(?:-v2)?\/?$/.test(url.pathname));
    const cookie = (await context.cookies()).find(item => item.name === 'gravitas_staging_sessionid');
    assert(cookie?.secure && cookie.httpOnly && cookie.domain === 'staging.graviquest.com');
    await goto('/workspace-v2');
    await page.getByText('Focus', { exact: true }).first().waitFor();
    console.log('Staging Workspace V2 Focus and named owner session verified.');

    await goto('/');
    await page.getByRole('link', { name: 'Edit Page', exact: true }).click();
    await page.getByRole('heading', { name: 'Visual Editor', exact: true }).waitFor();
    const frame = page.frameLocator('iframe[title="Editable page preview"]');
    const heading = frame.getByRole('heading', { level: 1 });
    await heading.click();
    const original = await heading.innerText();
    const proposed = 'Synthetic preview check';
    await page.getByLabel('Proposed value').fill(proposed);
    await frame.getByRole('heading', { name: proposed, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await frame.getByRole('heading', { name: original, exact: true }).waitFor();
    await page.getByLabel('Preview width').selectOption('390');
    await page.getByLabel('Preview theme').selectOption('light');
    await goto('/workspace/core/releases');
    await page.getByRole('heading', { name: 'Release Center', exact: true }).waitFor();
    await page.getByText(/Staging .*revision 6337c23256f70480595e33fd4b3bc4d896243374/).waitFor();
    await page.getByText('Register development change', { exact: true }).waitFor();
    console.log('Live Change Registry, Edit Page, direct element selection, Undo, and responsive preview verified.');
  } finally {
    await browser.close();
  }
}

verify().catch(error => {
  console.error(`${error.name}: ${String(error.message).split('\n')[0]}`);
  process.exitCode = 1;
});
