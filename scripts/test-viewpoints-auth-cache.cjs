/* A browser-session identity regression for GQTalk without a real account,
   production writes, or a network dependency. Exercises the shipped client. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const callbacks = {};
const events = [];
let account = 'guest';
let commentReads = 0;
let identityReads = 0;

const fakeWindow = {
  GQTalk: null,
  addEventListener(name, callback) { (callbacks[name] ||= []).push(callback); },
  dispatchEvent(event) { events.push(event.type); (callbacks[event.type] || []).forEach(fn => fn(event)); },
};
const fakeDocument = {
  cookie: '',
  hidden: false,
  addEventListener(name, callback) { (callbacks['document:' + name] ||= []).push(callback); },
};
const key = 'answer-that-looked-right-poll-where-do-you-land';
async function fakeFetch(url) {
  if (url === '/api/auth/me/') {
    identityReads++;
    return { ok: true, status: 200, json: async () =>
      account === 'guest' ? { authenticated: false } :
        { authenticated: true, user: { id: account === 'alice' ? 11 : 22, name: account } } };
  }
  if (url === '/api/community/comments/' + key + '/') {
    commentReads++;
    return { ok: true, status: 200, json: async () => ({
      ok: true, comments: account === 'alice'
        ? [{ id: 1, body: 'Alice pending', status: 'pending' }]
        : account === 'bob' ? [{ id: 2, body: 'Bob pending', status: 'pending' }] : [],
    }) };
  }
  throw Error('Unexpected request: ' + url);
}

vm.runInNewContext(fs.readFileSync('assets/topic-talk.js', 'utf8'), {
  window: fakeWindow,
  document: fakeDocument,
  fetch: fakeFetch,
  Event: class Event { constructor(type) { this.type = type; } },
  console,
  setTimeout,
  clearTimeout,
  matchMedia: () => ({ matches: false }),
});

(async () => {
  const talk = fakeWindow.GQTalk;
  assert(talk && typeof talk.me === 'function' && typeof talk.list === 'function');
  await talk.me(true);
  assert.equal((await talk.list(key)).length, 0);
  assert.equal(commentReads, 1);

  account = 'alice';
  await talk.me(true);
  assert.equal((await talk.list(key))[0].body, 'Alice pending');
  assert.equal(commentReads, 2);
  assert(events.includes('gq-talk-account-changed'));

  // Switching to Bob without reloading the original Topic must not return
  // Alice's unpublished reason from the in-memory cache.
  account = 'bob';
  await talk.me(true);
  const bobRows = await talk.list(key);
  assert.equal(bobRows.length, 1);
  assert.equal(bobRows[0].body, 'Bob pending');
  assert.equal(commentReads, 3);

  account = 'guest';
  await talk.me(true);
  assert.equal((await talk.list(key)).length, 0);
  assert.equal(commentReads, 4);
  assert(identityReads >= 4);
  assert.equal(events.filter(x => x === 'gq-talk-account-changed').length, 3);
  console.log('PASS: cached private reasons are isolated across guest -> Alice -> Bob -> guest');
})().catch(error => { console.error(error); process.exitCode = 1; });
