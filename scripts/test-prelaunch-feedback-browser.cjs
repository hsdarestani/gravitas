'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const captured = [];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/auth/csrf/') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'csrftoken=qa-test-token; Path=/; SameSite=Lax');
    res.end(JSON.stringify({ ok: true })); return;
  }
  if (url.pathname === '/api/auth/me/') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ authenticated: false })); return;
  }
  if (url.pathname === '/api/prelaunch/feedback/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, submission: null })); return;
  }
  if (url.pathname === '/api/prelaunch/feedback/' && req.method === 'POST') {
    let body = '';
    req.on('data', part => { body += part; });
    req.on('end', () => {
      if (req.headers['x-csrftoken'] !== 'qa-test-token') {
        res.writeHead(403); res.end('{}'); return;
      }
      captured.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, submission: { ...captured.at(-1), created_at: new Date().toISOString() } }));
    }); return;
  }
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404); res.end('Missing fixture asset'); return;
  }
  res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
  res.end(fs.readFileSync(filename));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const width of [340, 390, 768, 1363]) {
      const page = await browser.newPage({ viewport: { width, height: 840 }, reducedMotion: 'reduce' });
      try {
        await page.goto('http://127.0.0.1:' + server.address().port + '/prelaunch-feedback.html', { waitUntil: 'domcontentloaded' });
        await page.locator('#prelaunch-form').waitFor();
        assert.equal(await page.locator('#prelaunch-form [required]').count(), 0, 'All survey questions must be optional');
        assert.equal(await page.locator('input[type="password"]').count(), 0, 'No sign-in on the feedback page');
        const dimensions = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          windowWidth: window.innerWidth,
        }));
        assert.ok(dimensions.scrollWidth <= dimensions.windowWidth + 1,
          width + 'px viewport overflow: ' + JSON.stringify(dimensions));
        if (width === 340) {
          await page.locator('label.fb-persona').first().click();
          assert.equal(await page.locator('input[name="persona"]:checked').count(), 1);
          await page.locator('[data-clear-radio="persona"]').click();
          assert.equal(await page.locator('input[name="persona"]:checked').count(), 0);
          await page.locator('label.fb-choice').nth(6).click();
          await page.locator('[data-clear-radio="overall_rating"]').click();
          assert.equal(await page.locator('input[name="overall_rating"]:checked').count(), 0);
          await page.locator('input[name="usability"]').evaluate(input => {
            input.value = '5';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await page.locator('[data-clear-range="usability"]').click();
          await page.locator('textarea[name="video_feedback"]').fill('Interesting opening and clear narrative.');
          await page.locator('select[name="section_video"]').selectOption('9');
          await page.locator('#fb-submit-button').click();
          await page.waitForFunction(() =>
            document.querySelector('#fb-status')?.dataset.state === 'success'
          );
          assert.equal(captured.length, 1);
          assert.equal(captured[0].name, '');
          assert.equal(captured[0].answers.video_feedback, 'Interesting opening and clear narrative.');
          assert.equal(captured[0].answers.section_ratings.video, 9);
          assert.ok(!('persona' in captured[0].answers));
          assert.ok(!('overall_rating' in captured[0].answers));
          assert.ok(!('usability' in captured[0].answers));
          assert.equal(page.url().includes('prelaunch-feedback.html'), true, 'Must not redirect to login');
        }
      } finally { await page.close(); }
      process.stdout.write('Prelaunch feedback browser QA: ' + width + 'px passed\n');
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
