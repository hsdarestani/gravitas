#!/usr/bin/env node
/* Validate that public page URLs, redirects, assets and reserved routes work
   together. The preview server intentionally mirrors production nginx routing.
   No third-party packages or live backend are needed. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const port = 41871;
const base = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['scripts/preview-server.mjs', '--port', String(port), '--api', 'off'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', chunk => { logs += chunk.toString(); });
server.stderr.on('data', chunk => { logs += chunk.toString(); });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) break;
    try { if ((await fetch(base + '/')).ok) { ready = true; break; } }
    catch {}
    await sleep(100);
  }
  assert.ok(ready, 'preview did not start: ' + logs);

  const pages = ['/', '/about', '/topics', '/topic-answer-that-looked-right',
    '/topic', '/lab', '/learn', '/community', '/newsletter', '/privacy',
    '/impressum', '/education', '/education-de', '/prelaunch-feedback', '/brand',
    '/lab-prompt-bias', '/lab-protein-stability', '/lab-scientific-visualization',
    '/login', '/signup', '/workspace', '/workspace/operating'];
  for (const url of pages) {
    const result = await fetch(base + url, { redirect: 'manual' });
    assert.equal(result.status, 200, url + ' must render HTML');
    assert.match(result.headers.get('content-type') || '', /text\/html/, url + ' content type');
    const html = await result.text();
    assert.match(html, /<html\b/i, url + ' response must not be an empty shell');
    if (['/', '/about', '/topics', '/lab', '/learn', '/community', '/newsletter'].includes(url)) {
      assert.ok(!/\bhref=["'][^"']+\.html(?:[?#]|["'])/.test(html), url + ' still exposes old HTML links');
    }
  }

  const redirects = [
    ['/index.html', '/'], ['/about.html', '/about'], ['/topics.html', '/topics'],
    ['/lab.html', '/lab'], ['/topic-answer-that-looked-right.html', '/topic-answer-that-looked-right'],
    ['/account.html', '/login'], ['/workspace.html', '/workspace'],
    ['/dossiers.html', '/topics'], ['/dossiers', '/topics'],
    ['/science-evidence.html', '/lab?lab=science-universe'],
    ['/forum.html', 'https://forum.graviquest.com/'],
  ];
  for (const [oldRoute, newRoute] of redirects) {
    const result = await fetch(base + oldRoute, { redirect: 'manual' });
    assert.equal(result.status, 301, oldRoute + ' must be a permanent redirect');
    assert.equal(result.headers.get('location'), newRoute, oldRoute + ' redirect destination');
  }
  const withQuery = await fetch(base + '/topics.html?view=all', { redirect: 'manual' });
  assert.equal(withQuery.headers.get('location'), '/topics?view=all');

  const stylesheet = await fetch(base + '/assets/site.css', { redirect: 'manual' });
  assert.equal(stylesheet.status, 200, 'shared assets stay reachable');
  assert.match(stylesheet.headers.get('content-type') || '', /text\/css/);
  const robots = await fetch(base + '/robots.txt');
  assert.equal(robots.status, 200, 'robots remains a static file');
  const api = await fetch(base + '/api/content/');
  assert.equal(api.status, 503, 'backend API requests must not fall through to HTML');

  const sitemap = await (await fetch(base + '/sitemap.xml')).text();
  assert.ok(sitemap.includes('<loc>https://graviquest.com/topics</loc>'));
  assert.ok(!/\.html<\/loc>/.test(sitemap), 'no legacy .html URLs in sitemap');

  const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.equal((deploy.match(/try_files \\$uri \\$uri\.html \\$uri\/ \/index\.html;/g) || []).length, 2,
    'both HTTP and HTTPS nginx blocks need clean URL resolution');
  assert.equal((deploy.match(/location ~ \^\/\(\[A-Za-z0-9_-\]\+\)\\\.html\$/g) || []).length, 2,
    'both HTTP and HTTPS nginx blocks need legacy .html redirects');

  console.log('Clean URL smoke checks passed: pages, 301s, queries, CSS, API and sitemap');
} finally {
  server.kill('SIGTERM');
}
