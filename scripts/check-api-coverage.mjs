/* ==========================================================================
   CONTRACT CHECKER  ·  does the new UI actually consume the backend's content?

   Two people are working on this repo at once: one puts content into the
   Django backend, one rebuilds the workspace UI. Nothing in the toolchain
   currently notices when those two drift apart, so a push can look clean and
   still hide a page the content author filled in and the reader never sees.

   This answers the three ways that drift shows up:

     1. DEAD CALL      the UI asks for a path no Django route serves -> 404.
     2. ORPHAN ROUTE   a route serves content and no UI file ever calls it.
     3. DROPPED FIELD  a key the backend serializes that the UI never mentions.

   Deliberately textual: no Django boot, no database, no network. It reads the
   two urls.py files and assets/ws/*.js, so it runs anywhere in a second.

   Usage:  node scripts/check-api-coverage.mjs
           node scripts/check-api-coverage.mjs --strict   (orphans fail too)

   Exit 1 on a dead call. Orphans and dropped fields are reported but do not
   fail by default: "not surfaced yet" is a plan, while a 404 is a bug.
   ========================================================================== */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'backend', 'core');
const WS = join(ROOT, 'assets', 'ws');
const STRICT = process.argv.includes('--strict');

const read = (p) => readFileSync(p, 'utf8');

/* ---- Registered routes --------------------------------------------------
   Both files matter, and this is the part that is easy to get wrong by hand.
   core/urls.py is mounted under /api/ by the root urls.py, which ALSO
   registers routes of its own directly under /api/ and deliberately places
   some of them ahead of the include so they win. Reading only core/urls.py is
   exactly how the space/* routes came to be believed missing when they are
   live. */

function registered() {
  const out = new Map();
  const grab = (file, prefix) => {
    const text = read(file);
    text.split('\n').forEach((line, i) => {
      const m = line.match(/path\(\s*['"]([^'"]+)['"]/);
      if (!m) return;
      const p = prefix === null
        ? (m[1].startsWith('api/') ? '/' + m[1] : null)
        : prefix + m[1];
      if (p) out.set(norm(p), `${file.split(/[\/]/).pop()}:${i + 1}`);
    });
  };
  grab(join(CORE, 'urls.py'), '/api/');
  grab(join(ROOT, 'backend', 'gravitas_backend', 'urls.py'), null);
  return out;
}

/* Collapse every dynamic segment to '*' so a Django converter and a JS
   template literal compare equal. */
function norm(path) {
  let p = path
    .replace(/<[^>]+>/g, '*')       // <int:project_id>
    .replace(/\$\{[^}]*\}/g, '*')   // ${id}
    .split('?')[0];
  if (!p.endsWith('/')) p += '/';
  return p;
}

/* ---- Frontend calls ----------------------------------------------------
   Every network call in the workspace goes through request(), call() or a
   bare fetch(), and each takes the path as its first argument. Paths are
   written relative to /api except the few spelled out in full. */

function called() {
  const hits = new Map();
  for (const name of readdirSync(WS).filter((f) => f.endsWith('.js'))) {
    read(join(WS, name)).split('\n').forEach((line, i) => {
      const re = /(?:request|call|fetch)\(\s*[`'"]([^`'"]+)/g;
      let m;
      while ((m = re.exec(line))) {
        const raw = m[1];
        if (!raw.startsWith('/')) continue;
        const full = raw.startsWith('/api/') ? raw : '/api' + raw;
        const key = norm(full);
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push(`${name}:${i + 1}`);
      }
    });
  }
  return hits;
}

/* ---- Serialized fields -------------------------------------------------
   The backend's _*_json() helpers are the content contract. A key they emit
   that appears nowhere in the workspace JS is content the new UI drops on the
   floor: the author sees it in Django admin, the reader never does.

   Keys that are plumbing rather than content are excluded, since nothing is
   lost by not rendering a foreign key. */

const PLUMBING = new Set([
  'ok', 'error', 'id', 'workspace_id', 'owner_id', 'created_by_id',
  'parent_id', 'project_id', 'category_id', 'resource_id', 'item_id',
  'content_work_item_id', 'research_project_id', 'parent_note_id',
  'node_id', 'map_id', 'link_id', 'task_id',
]);

function serializedFields() {
  const out = new Map();
  for (const name of readdirSync(CORE).filter((f) => f.endsWith('.py') && !f.startsWith('test_'))) {
    const text = read(join(CORE, name));
    const re = /def (_\w*json\w*)\([^)]*\):([\s\S]*?)(?=\ndef |\n@|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const keys = new Set();
      const kre = /['"](\w+)['"]\s*:/g;
      let k;
      while ((k = kre.exec(m[2]))) if (!PLUMBING.has(k[1])) keys.add(k[1]);
      if (keys.size) out.set(`${name}:${m[1]}`, keys);
    }
  }
  return out;
}

/* ---- Report ------------------------------------------------------------ */

const routes = registered();
const calls = called();
/* Every identifier appearing anywhere in the workspace sources. A Set of word
   tokens rather than a regex per field: nothing to escape wrong, and one pass
   over 270KB instead of one per key. */
const wsWords = new Set(
  readdirSync(WS).filter((f) => f.endsWith('.js'))
    .map((f) => read(join(WS, f))).join(String.fromCharCode(10))
    .match(/[A-Za-z0-9_]+/g) || []
);

const dead = [...calls].filter(([p]) => !routes.has(p));
const orphan = [...routes].filter(([p]) => !calls.has(p));

const rule = '='.repeat(74);
console.log(rule);
console.log('API COVERAGE  ·  frontend calls vs backend routes');
console.log(rule);
console.log(`registered routes : ${routes.size}`);
console.log(`frontend calls    : ${calls.size}`);
console.log('');

console.log(`--- DEAD CALLS (${dead.length})  the UI asks, no route serves it`);
if (!dead.length) console.log('    none');
for (const [p, where] of dead.sort()) {
  console.log(`    ${p}`);
  where.forEach((w) => console.log(`        ${w}`));
}
console.log('');

console.log(`--- ORPHAN ROUTES (${orphan.length})  backend serves, no UI call site`);
if (!orphan.length) console.log('    none');
for (const [p, at] of orphan.sort()) console.log(`    ${p.padEnd(52)} ${at}`);
console.log('');

console.log('--- DROPPED FIELDS  serialized by backend, absent from assets/ws/*.js');
let dropped = 0;
for (const [fn, keys] of [...serializedFields()].sort()) {
  const missing = [...keys].filter((k) => !wsWords.has(k)).sort();
  if (missing.length) {
    dropped += missing.length;
    console.log(`    ${fn}`);
    console.log(`        ${missing.join(', ')}`);
  }
}
if (!dropped) console.log('    none');
console.log('');

if (dead.length) {
  console.log(`FAIL: ${dead.length} dead call(s). The UI will 404 on these.`);
  process.exit(1);
}
if (STRICT && orphan.length) {
  console.log(`FAIL (--strict): ${orphan.length} orphan route(s).`);
  process.exit(1);
}
console.log('OK: every frontend call resolves to a registered route.');
