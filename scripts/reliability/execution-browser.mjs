/* Full-stack acceptance: real Django database, real Chromium, no mocked task
 * payloads. Credentials/cookies belong only to the isolated local fixture. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const base = process.env.E2E_BASE || 'http://127.0.0.1:4173';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Execution write acceptance is local-only');
const fixture = JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, 'utf8'));
const artifacts = process.env.E2E_ARTIFACTS;
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addCookies(fixture.cookies);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(base + '/api/operating/execution/') && response.status() >= 500) errors.push('Analytics HTTP ' + response.status()); });
    await page.goto(base + '/workspace/core/tasks?ei_view=timeline');
    await page.getByRole('heading', { name: 'Execution Intelligence', exact: true }).waitFor();
    const payload = await (await context.request.get(base + '/api/operating/execution/')).json();
    assert(payload.tasks.length >= 1000);
    const milestone = payload.milestones.find(m => m.title === 'Acceptance fixture · release readiness');
    assert(milestone && milestone.delivery_status === 'at_risk');
    const blocked = payload.tasks.find(t => t.title === 'Acceptance fixture · blocked validation');
    const lifecycle = payload.tasks.find(t => t.title === 'Acceptance fixture · segmented lifecycle');
    if (viewport.width > 600) {
      const chart = page.locator('.ei-chart'); await chart.waitFor();
      await chart.focus(); await chart.press('End');
      await page.waitForFunction(() => document.querySelector('.ei-chart').scrollTop > 40000);
      assert(await page.locator('.ei-row').count() < 35);
      const sticky = await chart.evaluate(e => ({ top: e.getBoundingClientRect().top, header: e.querySelector('.ei-header').getBoundingClientRect().top }));
      assert(Math.abs(sticky.header - sticky.top - 1) < 2, JSON.stringify(sticky));
      await page.getByLabel('Timeline zoom', { exact: true }).selectOption('daily');
      await chart.focus(); await chart.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.ei-chart').scrollLeft > 0);
      const fixed = await chart.evaluate(e => ({ left: e.getBoundingClientRect().left, label: e.querySelector('.ei-identity').getBoundingClientRect().left }));
      assert(Math.abs(fixed.label - fixed.left - 1) < 2, JSON.stringify(fixed));
      await page.screenshot({ path: artifacts + '/timeline-sticky-desktop.png' });
    }
    await page.getByLabel('All milestones', { exact: true }).selectOption(String(milestone.id));
    if (viewport.width > 600) {
      await page.getByRole('button', { name: 'Fit all', exact: true }).click();
      await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
      assert.equal(await page.locator('.ei-row').count(), 1);
      await page.getByRole('button', { name: 'Expand all', exact: true }).click();
      assert.equal(await page.locator('.ei-row').count(), 4);
      await page.getByRole('button', { name: lifecycle.title, exact: true }).click();
    } else {
      await page.locator('.ei-mobile-card').getByRole('button', { name: '#' + lifecycle.id + ' ' + lifecycle.title, exact: true }).click();
    }
    let drawer = page.locator('.ei-drawer'); await drawer.waitFor();
    const text = await drawer.innerText();
    assert(text.includes('10.0 d') && text.includes('5.0 d') && text.includes('15.0 d'), text);
    await page.screenshot({ path: artifacts + `/task-insight-${viewport.width}.png` });
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.ei-milestone').click();
    await page.locator('.ei-drawer').getByRole('button', { name: '#' + blocked.id + ' ' + blocked.title, exact: true }).click();
    drawer = page.locator('.ei-drawer');
    const reason = `Fixture persistence verified at ${viewport.width}px`;
    await drawer.getByLabel('Blocker reason', { exact: true }).fill(reason);
    const confirmation = page.waitForResponse(r => r.url().endsWith(`/api/operating/task-board/${blocked.id}/`) && r.request().method() === 'PATCH');
    await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal((await confirmation).status(), 200);
    await page.locator('.ei-drawer').getByLabel('Blocker reason', { exact: true }).waitFor();
    const persisted = await (await context.request.get(base + `/api/operating/task-board/${blocked.id}/`)).json();
    assert.equal(persisted.task.blocked_reason, reason);
    await page.locator('.ei-drawer').getByRole('button', { name: 'Close', exact: true }).click();
    // Mobile has an explicit card view with pagination, rather than tiny bars.
    if (viewport.width < 600) {
      assert(await page.locator('.ei-mobile-card').count() > 0);
      assert.equal(await page.locator('.ei-chart').count(), 0);
    }
    await page.screenshot({ path: artifacts + `/timeline-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Bottleneck Analysis', exact: true }).click();
    await page.getByRole('heading', { name: 'Prioritize today · explainable score', exact: true }).waitFor();
    await page.screenshot({ path: artifacts + `/bottlenecks-${viewport.width}.png` });
    const geometry = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
    assert(geometry.document <= geometry.width + 2, JSON.stringify(geometry));
    assert.deepEqual(errors, []);
    results.push({ viewport, tasks: payload.tasks.length, lifecycle: 'verified', milestone: 'verified', persistence: 'verified', geometry });
    await context.close();
  }
} finally {
  await browser.close(); fs.writeFileSync(artifacts + '/execution-results.json', JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
