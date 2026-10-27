/* Real Chromium, real Django and SQLite persistence. Only disposable local
 * fixtures may be edited. Production navigation is inspected separately. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const fixture = JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, 'utf8'));
const base = process.env.E2E_BASE || 'http://127.0.0.1:4173';
assert.equal(new URL(base).hostname, '127.0.0.1', 'This write suite is local-only');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addCookies(fixture.cookies);
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__taskObservers = 0;
      const Native = window.IntersectionObserver;
      window.IntersectionObserver = class extends Native {
        observe(target) {
          if (!this.taskObserved && target.closest('.task-card-dialog')) {
            this.taskObserved = true; window.__taskObservers++;
          }
          return super.observe(target);
        }
        disconnect() {
          if (this.taskObserved) { this.taskObserved = false; window.__taskObservers--; }
          return super.disconnect();
        }
      };
    });
    const errors = []; const mutations = []; const timings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', async response => {
      const req = response.request();
      if (!response.url().startsWith(base + '/api/')) return;
      const pathname = new URL(response.url()).pathname;
      if (response.status() >= 500) errors.push(`${req.method()} ${pathname}: ${response.status()}`);
      if (req.method() === 'PATCH') mutations.push({ path: pathname, body: req.postDataJSON(), status: response.status() });
      timings.push({ path: pathname, status: response.status(), duration: req.timing().responseEnd });
    });
    try {
    const taskPath = `/workspace/core/tasks?task=${fixture.task_id}`;
    async function editor() {
      await page.goto(base + taskPath);
      const modal = page.getByRole('dialog');
      if (viewport.width < 800) await modal.getByRole('button', { name: 'Edit task', exact: true }).click();
      await modal.getByRole('textbox', { name: 'Task title', exact: true }).waitFor();
      return modal;
    }
    let modal = await editor();
    const card = modal.locator('.task-card-dialog__frame');
    // Geometry must be stable as optional comments and files arrive.
    const frame = await card.boundingBox();
    const comment = modal.getByPlaceholder('Comment… @ to mention');
    await comment.waitFor(); await comment.fill('Draft only: focus must remain stable');
    assert.equal(await comment.inputValue(), 'Draft only: focus must remain stable');
    const after = await card.boundingBox();
    assert(Math.abs(frame.y - after.y) <= 1 && Math.abs(frame.height - after.height) <= 1, 'modal frame moved');
    await comment.fill('');
    const title = modal.getByRole('textbox', { name: 'Task title', exact: true });
    const savedTitle = `Verified ${viewport.width} server persistence`;
    await title.fill(savedTitle);
    const before = performance.now();
    const patched = page.waitForResponse(r => r.url().endsWith(`/api/operating/task-board/${fixture.task_id}/`) && r.request().method() === 'PATCH');
    await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
    const response = await patched;
    assert.equal(response.status(), 200, await response.text());
    await modal.getByText(/Saved\./).waitFor();
    const elapsed = performance.now() - before;
    const mutation = mutations.at(-1);
    assert.deepEqual(Object.keys(mutation.body).sort(), ['expected_updated_at', 'title']);
    // Open a new document and read the server again. No optimistic state survives.
    modal = await editor();
    assert.equal(await modal.getByRole('textbox', { name: 'Task title', exact: true }).inputValue(), savedTitle);
    await modal.getByRole('button', { name: 'Close task', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__taskObservers), 0, 'task observers leaked after close');
    // A second editor commits on the server while the first form stays open.
    modal = await editor();
    const taskURL = base + `/api/operating/task-board/${fixture.task_id}/`;
    const currentTask = (await (await context.request.get(taskURL)).json()).task;
    const csrf = (await context.cookies()).find(cookie => cookie.name === 'csrftoken').value;
    const concurrentTitle = `Verified concurrent ${viewport.width}`;
    const changed = await context.request.patch(taskURL, {
      headers: { 'X-CSRFToken': csrf, Referer: base + taskPath },
      data: { title: concurrentTitle, expected_updated_at: currentTask.updated_at },
    });
    assert.equal(changed.status(), 200, await changed.text());
    await modal.getByRole('textbox', { name: 'Task title', exact: true }).fill('Retained conflict draft');
    const conflict = page.waitForResponse(r => r.url() === taskURL && r.request().method() === 'PATCH');
    await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal((await conflict).status(), 409);
    await modal.getByText(/This task changed elsewhere/).waitFor();
    assert.equal(await modal.getByRole('textbox', { name: 'Task title', exact: true }).inputValue(), 'Retained conflict draft');
    assert.equal((await (await context.request.get(taskURL)).json()).task.title, concurrentTitle);
    await modal.getByRole('button', { name: 'Close task', exact: true }).click();
    modal = await editor();
    // Delay only the actual server response; never fabricate a save payload.
    await page.route(taskURL, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.fulfill({ response });
    });
    const delayedTitle = `Verified delayed ${viewport.width}`;
    await modal.getByRole('textbox', { name: 'Task title', exact: true }).fill(delayedTitle);
    await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
    await modal.getByRole('textbox', { name: 'Task title', exact: true }).fill('New unsaved typing during confirmation');
    await modal.getByText(/Saved\./).waitFor();
    assert.equal(await modal.getByRole('textbox', { name: 'Task title', exact: true }).inputValue(), 'New unsaved typing during confirmation');
    assert.equal((await (await context.request.get(taskURL)).json()).task.title, delayedTitle);
    await page.unroute(taskURL);
    await modal.getByRole('button', { name: 'Close task', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__taskObservers), 0);
    // Project screens and all command-center modes must retain focused filters.
    await page.goto(base + `/workspace/research/projects/${fixture.project_id}/management`);
    const search = page.getByPlaceholder('Search tasks', { exact: true });
    await search.waitFor(); await search.pressSequentially('Verified');
    assert(await search.evaluate(e => document.activeElement === e), 'search focus was lost');
    for (const name of ['List','Timeline','Week','Team','Work logs','Matrix','Review','Board']) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await search.inputValue(), 'Verified');
    }
    const dimensions = await page.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth }));
    assert(dimensions.doc <= dimensions.width + 24, JSON.stringify(dimensions));
    for (const route of ['dashboard','core','core/meetings','core/work-reports','core/content','core/assets','core/planning','core/team','research','research/projects','learning','learning/catalog','learning/my']) {
      await page.goto(base + '/workspace/' + route);
      await page.locator('#ws-view h1').first().waitFor();
    }
    assert.deepEqual(errors, [], errors.join('\n'));
    results.push({ viewport, modalShiftPx: Math.abs(frame.y-after.y), saveConfirmationMs: Math.round(elapsed), patchCount: mutations.length, conflictDraftRetained: true, inFlightDraftRetained: true, leakedTaskObservers: await page.evaluate(() => window.__taskObservers), apiRequests: timings.length });
    await page.screenshot({ path: `${process.env.E2E_ARTIFACTS}/${viewport.width}.png`, fullPage: true });
    } catch (error) {
      await page.screenshot({ path: `${process.env.E2E_ARTIFACTS}/${viewport.width}-failure.png`, fullPage: true });
      fs.writeFileSync(`${process.env.E2E_ARTIFACTS}/${viewport.width}-failure.json`, JSON.stringify({ error: error.message, errors, mutations, timings }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
fs.writeFileSync(`${process.env.E2E_ARTIFACTS}/results.json`, JSON.stringify(results, null, 2));
