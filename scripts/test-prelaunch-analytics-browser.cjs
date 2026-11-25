'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const route = '/workspace/core/admin/feedback';
const endpoint = '/api/platform/admin/prelaunch-feedback/';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function ready(url, process) {
  for (let attempt = 0; attempt < 100 && process.exitCode === null; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* Wait for the local listener. */ }
    await delay(100);
  }
  throw new Error('Local QA server unavailable at ' + url);
}

async function testDashboard(browser, base, session, width, colorScheme) {
  const page = await browser.newPage({
    viewport: { width, height: 850 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block'
  });
  const faults = [];
  page.on('pageerror', error => faults.push(error.message));
  await page.context().addCookies([{ name: 'sessionid', value: session, url: base }]);
  try {
    await page.goto(base + route);
    await page.getByRole('heading', { name: 'Pre-launch Survey', exact: true }).waitFor();
    const dashboard = page.locator('.gq-feedback__dashboard').first();
    const cohort = page.locator('.gq-feedback__stats .wc-tile__value').first();
    await page.waitForFunction(() => document.querySelector('.gq-feedback__stats .wc-tile__value')?.textContent === '3');
    assert.equal(await page.locator('.gq-feedback__coverage-item').count(), 10);
    assert.equal(await page.locator('.gq-feedback__donut').count(), 1);
    assert.match(await page.locator('[data-question="persona"]').innerText(), /Working Scientist\s+2 · 100%/);
    assert.match(await page.locator('[data-question="persona"]').innerText(), /2 of 3 answered · 1 blank/);

    const select = page.getByLabel('Survey section');
    await select.selectOption('overall');
    const score = page.locator('[data-question="recommend_likelihood"]');
    assert.match(await score.innerText(), /5 average · 0–10 scale/);
    await score.getByText('Score counts and percentages').click();
    assert.match(await score.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '0', exact: true }) }).innerText(), /0\s+1\s+50%/);
    await select.selectOption('topic01');
    assert.match(await page.locator('[data-question="video_content_quality"]').innerText(), /0 of 1 answered · 1 blank · 2 outside/);
    const fit = await page.locator('#ws-view').evaluate(node => ({
      width: node.clientWidth, content: node.scrollWidth
    }));
    assert.ok(fit.content <= fit.width + 1, 'Horizontal overflow at ' + width + 'px: ' + JSON.stringify(fit));

    await page.getByLabel('Persona', { exact: true }).selectOption('a3');
    await page.waitForFunction(() => document.querySelector('.gq-feedback__stats .wc-tile__value')?.textContent === '2');
    await page.getByLabel('Watched the video').selectOption('all');
    await page.waitForFunction(() => document.querySelector('.gq-feedback__stats .wc-tile__value')?.textContent === '1');
    await dashboard.getByRole('heading', { name: 'Participation over time' }).waitFor();
    assert.equal(await cohort.innerText(), '1');
    assert.match(await page.locator('[data-question="video_content_quality"]').innerText(), /0 of 1 answered · 1 blank · 0 outside/);
    const csvLink = await page.getByRole('link', { name: 'Export filtered CSV' }).getAttribute('href');
    const params = new URL(csvLink, base).searchParams;
    assert.equal(params.get('persona'), 'a3');
    assert.equal(params.get('video_watched'), 'all');
    const csv = await page.request.get(base + csvLink);
    assert.equal(csv.status(), 200);
    assert.match(await csv.text(), /Wind tunnel/);
    assert.doesNotMatch(await csv.text(), /Telescope/);

    await page.getByRole('button', { name: 'Written answers', exact: true }).click();
    await page.getByText('Wind tunnel').waitFor();
    await page.getByLabel('Search text').fill('TELESCOPE');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText('No written answers match.').waitFor();
    assert.equal(await cohort.innerText(), '1');

    await page.getByLabel('From', { exact: true }).fill('2026-11-26');
    await page.getByText('No submissions match these filters.').waitFor();
    assert.equal(await cohort.innerText(), '0');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.getByRole('button', { name: 'Individual submissions' }).click();
    await page.locator('summary').getByText('QA Respondent', { exact: true }).click();
    assert.equal(await page.getByText('Wind tunnel', { exact: true }).isVisible(), true);
    assert.deepEqual(faults, [], 'Unexpected browser errors');
    console.log('Survey admin route passed at ' + width + 'px (' + colorScheme + ')');
  } finally {
    await page.close();
  }
}

(async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gq-survey-qa-'));
  const children = [];
  let browser;
  try {
    const djangoPort = await freePort();
    const previewPort = await freePort();
    const base = 'http://127.0.0.1:' + previewPort;
    const backend = 'http://127.0.0.1:' + djangoPort;
    const python = process.env.PYTHON || 'python';
    const bootstrap = `
from datetime import datetime
import sys
import django
from django.conf import settings
settings.DATABASES['default']['NAME'] = sys.argv[1]
settings.ALLOWED_HOSTS = ['127.0.0.1', 'testserver']
django.setup()
from django.core.management import call_command
`;
    const fixtures = `
from django.contrib.auth import get_user_model
from django.test import Client
from core.models import PrelaunchFeedback
call_command('migrate', verbosity=0, interactive=False)
for stamp, name, answers in [
    ('2026-11-22T00:00:00+00:00', 'QA Respondent', {'persona': 'a3', 'video_watched': 'all',
       'recommend_likelihood': 0, 'one_change': 'Wind tunnel'}),
    ('2026-11-24T00:00:00+00:00', '', {'persona': 'a3', 'video_watched': 'no',
       'recommend_likelihood': 10, 'one_change': 'Telescope'}),
    ('2026-11-25T00:00:00+00:00', '', {}),
]:
    row = PrelaunchFeedback.objects.create(name=name, answers=answers)
    PrelaunchFeedback.objects.filter(pk=row.pk).update(created_at=datetime.fromisoformat(stamp))
client = Client()
client.force_login(get_user_model().objects.create_superuser('survey-browser-qa'))
print('QA_SESSION=' + client.cookies['sessionid'].value)
`;
    const env = { ...process.env, PYTHONPATH: path.join(root, 'backend'),
      DJANGO_SETTINGS_MODULE: 'gravitas_backend.test_settings' };
    const database = path.join(tmp, 'qa.sqlite3');
    const seeded = spawnSync(python, ['-c', bootstrap + fixtures, database], { cwd: root, env, encoding: 'utf8' });
    assert.equal(seeded.status, 0, seeded.stderr || String(seeded.error || ''));
    const session = seeded.stdout.match(/^QA_SESSION=(\S+)$/m)[1];
    const django = spawn(python, ['-c', bootstrap +
      "call_command('runserver', sys.argv[2], use_reloader=False, verbosity=0)", database, '127.0.0.1:' + djangoPort],
    { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(django);
    const preview = spawn(process.execPath, ['scripts/preview-server.mjs', '--port', String(previewPort), '--api', backend],
      { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(preview);
    await Promise.all([ready(backend + '/api/health/', django), ready(base + '/workspace', preview)]);
    assert.equal((await fetch(base + endpoint)).status, 401);
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    for (const [width, theme] of [[340, 'dark'], [390, 'light'], [768, 'dark'], [1363, 'light']]) {
      await testDashboard(browser, base, session, width, theme);
    }
  } finally {
    if (browser) await browser.close();
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill();
    })));
    rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
