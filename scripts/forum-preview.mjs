#!/usr/bin/env node
/* Local preview of the Forum theme against the live forum.

   The Forum is a stock Discourse install; its look lives in
   discourse/theme/ and only reaches forum.graviquest.com through the
   forum-theme workflow, which means every CSS change used to cost a deploy
   before anyone could see it. This server sits in front of the live forum and
   swaps exactly one thing: the theme's compiled stylesheets (common, desktop,
   mobile) are replaced with the files in this checkout, read fresh on every
   request. Everything else (HTML, Ember bundles, JSON, uploads) is the real
   forum's, so what you see is the real forum with your CSS.

   What it cannot show:
   - Signed-in screens. Sign-in is DiscourseConnect through graviquest.com and
     will not hand a session to localhost. Anonymous pages only.
   - Changes to the theme's .gjs components or head_tag.html exactly; those
     are compiled server-side by Discourse and arrive with the live HTML.
     scripts/forum-preview-shim.js imitates the visible result of the current
     ones and is injected into every page; keep it in step with the theme.

   The theme source is .scss but uses no Sass beyond nesting and three
   upload variables. Nesting is served as native CSS nesting, which every
   current engine supports, and the three font variables are filled with the
   URLs the live compiled theme already uses.

   Usage:
     node scripts/forum-preview.mjs                 (http://127.0.0.1:4420)
     node scripts/forum-preview.mjs --port 4500
*/

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME = path.join(ROOT, 'discourse', 'theme');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', 4420));
const HOST = arg('host', '127.0.0.1');
const UPSTREAM = 'https://forum.graviquest.com';
const CACHE = new Map();
const LOCAL = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;

/* The live font upload URLs, read once from the deployed theme. */
let fontVars = null;
async function fonts(themeCssUrl) {
  if (fontVars) return fontVars;
  fontVars = {};
  try {
    const css = await (await fetch(UPSTREAM + themeCssUrl)).text();
    const urls = [...css.matchAll(/@font-face\{font-family:"?([^";]+)"?;src:url\(([^)]+)\)/g)];
    for (const [, family, url] of urls) {
      if (family === 'DM Sans') fontVars.gq_dm_sans = url;
      if (family === 'DM Mono') fontVars.gq_dm_mono = url;
      if (family === 'Literata') fontVars.gq_literata = url;
    }
  } catch (e) { console.warn('Could not read live font URLs:', e.message); }
  return fontVars;
}

async function themeCss(target, liveUrl) {
  const file = { common_theme: 'common/common.scss', desktop_theme: 'desktop/desktop.scss', mobile_theme: 'mobile/mobile.scss' }[target];
  const vars = await fonts(liveUrl.replace(/(desktop|mobile)_theme/, 'common_theme'));
  let src = await fs.readFile(path.join(THEME, file), 'utf8');
  /* The live font uploads refuse a localhost origin (no CORS header), so
     the preview serves the same files from assets/fonts, which is where
     ops/discourse/assemble_theme.py takes them from. */
  const local = { gq_dm_sans: 'DMSans.ttf', gq_dm_mono: 'DMMono-Regular.ttf', gq_literata: 'Literata-latin.woff2' };
  src = src.replace(/\$(gq_[a-z_]+)/g, (m, name) => (local[name] ? '/__gq/fonts/' + local[name] : vars[name] || m));
  return src;
}

function rewriteText(text) {
  return text
    .replaceAll('https://forum.graviquest.com', LOCAL)
    .replaceAll('https:\\/\\/forum.graviquest.com', LOCAL.replaceAll('/', '\\/'))
    .replaceAll('//forum.graviquest.com', LOCAL.replace('http:', ''));
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  if (process.env.GQ_DEBUG) console.log('>>', req.method, url, JSON.stringify(req.headers));
  try {
    /* The forum's service worker would cache the live theme under this
       origin and outlive the proxy; the preview runs without it. */
    const font = url.match(/^\/__gq\/fonts\/([A-Za-z0-9.-]+\.(ttf|woff2))$/);
    if (font) {
      res.writeHead(200, { 'content-type': font[2] === 'ttf' ? 'font/ttf' : 'font/woff2', 'cache-control': 'max-age=3600' });
      res.end(await fs.readFile(path.join(ROOT, 'assets', 'fonts', font[1])));
      return;
    }
    if (url === '/__gq/preview-shim.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await fs.readFile(path.join(ROOT, 'scripts', 'forum-preview-shim.js')));
      return;
    }
    /* The rooms list the theme and backend share (backend/core/forum_rooms.json),
       so the shim can draw rooms that rooms.rb has not created yet. */
    if (url === '/__gq/forum-rooms.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await fs.readFile(path.join(ROOT, 'backend', 'core', 'forum_rooms.json')));
      return;
    }
    if (url.startsWith('/service-worker')) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return; }
    const m = url.match(/^\/stylesheets\/(common_theme|desktop_theme|mobile_theme)_\d+_[0-9a-f]+\.css/);
    if (m) {
      const css = await themeCss(m[1], url.split('?')[0]);
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      res.end(css);
      console.log('\x1b[35mtheme\x1b[0m ' + m[1] + ' (local)');
      return;
    }

    /* Digested bundles never change under the same URL; keeping them in
       memory makes every load after the first one quick. */
    const cacheable = req.method === 'GET' && /^\/(assets|stylesheets|extra-locales|theme-javascripts|svg-sprite)\//.test(url);
    if (cacheable && CACHE.has(url)) {
      const hit = CACHE.get(url);
      res.writeHead(200, hit.headers);
      res.end(hit.body);
      return;
    }

    /* Compressed upstream, decoded by fetch (content-encoding is dropped from
       the reply below). Uncompressed, every response over about 40KB froze
       after its first 32KB on some networks (seen 2026-11-17, Discourse pages
       included), and every page then failed as "upstream too slow". */
    const headers = { ...req.headers, host: 'forum.graviquest.com', 'accept-encoding': 'gzip, deflate, br' };
    delete headers.connection;
    /* Anonymous on purpose: a stale _forum_session from a half-finished
       sign-in made the forum stall every page for that browser. */
    delete headers.cookie;
    if (headers.origin) headers.origin = UPSTREAM;
    if (headers.referer) headers.referer = headers.referer.replace(LOCAL, UPSTREAM);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => {
      const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => ok(Buffer.concat(parts)));
    });
    /* A page load fires ~60 requests at once and the upstream now and then
       refuses a connection or resets one mid-body (undici "fetch failed" /
       "terminated"). Idempotent requests are read whole inside the retry,
       so a reset costs a retry instead of a broken page. Only uploads and
       other media are streamed through. */
    const idempotent = ['GET', 'HEAD'].includes(req.method);
    const buffered = (type) => cacheable || /text\/html|application\/json/.test(type);
    let up, payload;
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error('upstream too slow')), url.startsWith('/message-bus/') ? 65000 : 30000);
      try {
        up = await fetch(UPSTREAM + url, { method: req.method, headers, body, redirect: 'manual', signal: ctl.signal });
        payload = buffered(up.headers.get('content-type') || '') || !idempotent ? Buffer.from(await up.arrayBuffer()) : null;
        clearTimeout(timer);
        break;
      } catch (e) {
        clearTimeout(timer);
        if (attempt >= 3 || !idempotent) throw new Error(e.message + ' ' + (e.cause?.code || e.cause?.message || ''));
        await new Promise((ok) => setTimeout(ok, 250 * (attempt + 1)));
      }
    }

    const out = {};
    up.headers.forEach((v, k) => {
      if (['content-security-policy', 'content-encoding', 'content-length', 'transfer-encoding', 'strict-transport-security', 'connection'].includes(k)) return;
      out[k] = v;
    });
    if (out.location) out.location = rewriteText(out.location);
    delete out['set-cookie'];

    const type = up.headers.get('content-type') || '';
    if (/text\/html|application\/json/.test(type) && !url.startsWith('/message-bus/')) {
      let text = rewriteText(payload.toString('utf8'));
      /* The theme's .gjs changes cannot be compiled here; the shim imitates
         their result (see scripts/forum-preview-shim.js). */
      if (/text\/html/.test(type)) text = text.replace('</head>', '<script src="/__gq/preview-shim.js" defer></script></head>');
      if (/text\/html/.test(type)) out['cache-control'] = 'no-store';
      res.writeHead(up.status, out);
      res.end(text);
    } else if (payload) {
      if (cacheable && up.status === 200) CACHE.set(url, { headers: out, body: payload });
      res.writeHead(up.status, out);
      res.end(payload);
    } else {
      res.writeHead(up.status, out);
      if (up.body) for await (const chunk of up.body) res.write(chunk);
      res.end();
    }
    if (!/^\/(assets|stylesheets|theme-javascripts|extra-locales|message-bus|uploads|user_avatar|letter_avatar|svg-sprite)/.test(url)) {
      console.log(up.status + ' ' + req.method + ' ' + url);
    }
  } catch (e) {
    console.error('proxy error', url, e.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Forum preview proxy error: ' + e.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Forum preview: ${LOCAL}/  (live forum.graviquest.com with discourse/theme from this checkout)`);
});
