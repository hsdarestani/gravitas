/* Exercise the real platform module with controllable transport promises. These
 * tests cover response ordering, not source-code markers or optimistic state. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(process.env.WORKSPACE_PLATFORM_SOURCE || new URL('../assets/ws/ws-platform.js', import.meta.url), 'utf8');
globalThis.document = { cookie: 'csrftoken=test' };
globalThis.localStorage = { getItem: () => null };
const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const a = await import(url + '#a');
const b = await import(url + '#b');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const reset = () => { const s = globalThis.__gravitasWorkspaceRequestsV1; s.fastReads.clear(); s.readFlights.clear(); s.generation++; };
let passed = 0;
async function test(name, fn) { reset(); await fn(); console.log('PASS', name); passed++; }
await test('versioned imports coalesce the same read', async () => {
  const pending = deferred(); let count = 0;
  globalThis.fetch = () => { count++; return pending.promise; };
  const first = a.call('/operating/task-board/'); const second = b.call('/operating/task-board/');
  pending.resolve(json({ tasks: [] })); await Promise.all([first, second]);
  assert.equal(count, 1);
});
await test('read during write cannot poison post-commit navigation', async () => {
  const write = deferred(); let reads = 0;
  globalThis.fetch = (_, options) => options.method === 'PATCH' ? write.promise : Promise.resolve(json({ version: ++reads }));
  const saving = a.call('/operating/task-board/1/', { method: 'PATCH', body: { title: 'new' } });
  await b.call('/operating/task-board/');
  write.resolve(json({ ok: true })); await saving;
  assert.equal((await b.call('/operating/task-board/')).version, 2);
});
await test('late pre-write GET cannot repopulate cache', async () => {
  const old = deferred(); let reads = 0;
  globalThis.fetch = (_, options) => options.method === 'PATCH' ? Promise.resolve(json({ ok: true })) : (++reads === 1 ? old.promise : Promise.resolve(json({ version: 2 })));
  const reading = a.call('/operating/task-board/');
  await b.call('/operating/task-board/1/', { method: 'PATCH', body: {} });
  old.resolve(json({ version: 1 })); await reading;
  assert.equal((await a.call('/operating/task-board/')).version, 2);
});
await test('uploads invalidate the shared navigation cache', async () => {
  let reads = 0;
  globalThis.fetch = (_, options) => Promise.resolve(json(options.method === 'GET' ? { version: ++reads } : { ok: true }));
  await a.call('/operating/task-board/');
  await b.upload('/operating/tasks/1/attachments/', new FormData());
  assert.equal((await a.call('/operating/task-board/')).version, 2);
});
await test('malformed success is never a save confirmation or replayed', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('<html>proxy</html>'); };
  await assert.rejects(a.call('/operating/task-board/1/', { method: 'PATCH', body: {} }), e => e.code === 'invalid_confirmation');
  assert.equal(calls, 1);
});
await test('HTTP 409 details survive without automatic retry', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: 'task_changed_elsewhere' }), { status: 409 }); };
  await assert.rejects(a.call('/operating/task-board/1/', { method: 'PATCH', body: {} }), e => e.status === 409 && e.data.error === 'task_changed_elsewhere');
  assert.equal(calls, 1);
});
await test('stalled response body reaches deadline; write is not replayed', async () => {
  let calls = 0; const realTimer = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => realTimer(fn, ms === 25000 ? 15 : ms);
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: () => new Promise(() => {}) }; };
  try { await assert.rejects(a.call('/operating/task-board/1/', { method: 'PATCH', body: {} }), e => e.code === 'request_timeout'); }
  finally { globalThis.setTimeout = realTimer; }
  assert.equal(calls, 1);
});
await test('concurrent unsafe requests bootstrap CSRF only once', async () => {
  document.cookie = ''; let boot = 0; const ready = deferred();
  globalThis.fetch = async path => {
    if (path.endsWith('/auth/csrf/')) { boot++; await ready.promise; document.cookie = 'csrftoken=fresh'; }
    return json({ ok: true });
  };
  const first = a.call('/write/', { method: 'POST' }); const second = b.call('/write/', { method: 'POST' });
  ready.resolve(); await Promise.all([first, second]); assert.equal(boot, 1);
});
console.log(`${passed} request-runtime regressions passed`);
