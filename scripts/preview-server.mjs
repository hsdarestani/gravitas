#!/usr/bin/env node
/* Local preview server for the Gravitas+ frontend.

   Serves this working tree the way the production nginx config in
   .github/workflows/deploy.yml does, so /workspace/my-work and /login resolve
   to the same files they do on gravitasplus.com. Requests under /api/, /admin/
   and /content/ are proxied to a real backend (production by default), which is
   what lets the dashboard and workspace load with live data while every HTML,
   CSS and JS file comes from this checkout.

   Usage:
     node scripts/preview-server.mjs
     node scripts/preview-server.mjs --port 5000 --api http://127.0.0.1:8000
     node scripts/preview-server.mjs --api off     (static only, no backend)
*/

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', 4173));
const HOST = arg('host', '127.0.0.1');
const API = arg('api', 'https://gravitasplus.com').replace(/\/$/, '');
const PROXY_ON = API !== 'off' && API !== 'none';
const UPSTREAM = PROXY_ON ? new URL(API) : null;
const CURL = arg('curl', process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe')
  : 'curl');
/* The prefixes nginx hands to Django; everything else is a file on disk. */
const PROXY_PREFIXES = ['/api/', '/admin/', '/django-static/', '/content/'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

function log(status, method, url, note) {
  const colour = status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32;
  console.log('\x1b[' + colour + 'm' + status + '\x1b[0m ' + method + ' ' + url + (note ? '  ' + note : ''));
}

async function stat(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

/* Resolves a URL path to a file, mirroring the production location blocks. */
async function resolveFile(pathname) {
  const redirects = { '/account.html': '/login', '/workspace.html': '/workspace' };
  if (redirects[pathname]) return { redirect: redirects[pathname] };
  if (pathname === '/login' || pathname === '/signup') return { file: path.join(ROOT, 'account.html') };
  if (pathname === '/workspace' || pathname.startsWith('/workspace/')) {
    return { file: path.join(ROOT, 'workspace.html') };
  }

  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return { denied: true }; }
  if (decoded.split('/').some((seg) => seg.startsWith('.'))) return { denied: true };
  const target = path.join(ROOT, decoded);
  if (!target.startsWith(ROOT)) return { denied: true };

  const info = await stat(target);
  if (info && info.isFile()) return { file: target };
  if (info && info.isDirectory()) {
    const index = path.join(target, 'index.html');
    if (await stat(index)) return { file: index };
  }
  const html = target.endsWith('.html') ? null : target + '.html';
  if (html && (await stat(html))) return { file: html };
  /* nginx: try_files $uri $uri/ /index.html */
  return { file: path.join(ROOT, 'index.html'), fallback: true };
}

function serveFile(req, res, file) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const stream = fs.createReadStream(file);
  stream.on('error', () => { res.writeHead(500); res.end('read error'); });
  /* No caching: the point of a preview is seeing the edit you just made. */
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  });
  stream.pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* gravitasplus.com resets Node's TLS connections while accepting curl's, so the
   proxy falls back to curl as its transport. Windows ships curl.exe, and the
   decision is made once on the first upstream request. */
let transport = 'fetch';

function curlRequest(target, method, headers, body) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravitas-preview-'));
    const headerFile = path.join(dir, 'head');
    const bodyFile = path.join(dir, 'body');
    const args = ['-sS', '--http1.1', '--compressed', '-m', '45',
      '-X', method, '-D', headerFile, '-o', bodyFile, target.toString()];
    for (const [key, value] of headers) args.push('-H', key + ': ' + value);
    /* The request body goes through a file rather than stdin: a stdin pipe that
       does not reach curl leaves it waiting for input until the timeout. */
    if (body && body.length) {
      const uploadFile = path.join(dir, 'upload');
      fs.writeFileSync(uploadFile, body);
      args.push('--data-binary', '@' + uploadFile);
    } else if (method !== 'GET' && method !== 'HEAD') {
      args.push('-H', 'Content-Length: 0');
    }

    execFile(CURL, args, { encoding: 'buffer', maxBuffer: 1 << 28 }, (error) => {
      try {
        if (error) throw error;
        const raw = fs.readFileSync(headerFile, 'latin1');
        /* A 100-continue or redirect chain leaves several header blocks; the
           last one is the response that produced the body. */
        const blocks = raw.split(/\r?\n\r?\n/).filter((b) => b.trim());
        const lines = blocks[blocks.length - 1].split(/\r?\n/);
        const status = Number((lines.shift().match(/\s(\d{3})\s?/) || [])[1] || 502);
        const out = [];
        for (const line of lines) {
          const at = line.indexOf(':');
          if (at > 0) out.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]);
        }
        resolve({ status, headerPairs: out, body: fs.readFileSync(bodyFile) });
      } catch (failure) {
        reject(failure);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

/* Both transports are normalised to { status, headerPairs, body }. */
/* Settled once, before the first real request, so a blocked direct connection
   costs one short probe instead of stalling several page loads. */
async function chooseTransport() {
  if (!PROXY_ON) return;
  try {
    await fetch(new URL('/api/auth/csrf/', UPSTREAM), {
      method: 'GET',
      headers: { host: UPSTREAM.host, origin: UPSTREAM.origin },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    transport = 'fetch';
  } catch {
    transport = 'curl';
  }
}

async function upstreamRequest(target, method, headers, body) {
  if (transport !== 'curl') {
    try {
      const response = await fetch(target, { method, headers, body, redirect: 'manual' });
      const pairs = [];
      for (const [key, value] of response.headers) {
        if (key === 'set-cookie') continue;
        pairs.push([key, value]);
      }
      for (const cookie of (response.headers.getSetCookie ? response.headers.getSetCookie() : [])) {
        pairs.push(['set-cookie', cookie]);
      }
      return { status: response.status, headerPairs: pairs, body: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      if (transport === 'fetch') {
        transport = 'curl';
        console.log('\x1b[36m…\x1b[0m upstream refused a direct connection, switching the proxy to curl');
      } else {
        throw error;
      }
    }
  }
  return curlRequest(target, method, headers, body);
}

/* Django checks Origin and Referer against CSRF_TRUSTED_ORIGINS and sets Secure
   cookies, both of which assume https on the real domain. Requests are rewritten
   on the way out and cookies relaxed on the way back so a normal login works. */
async function proxy(req, res, url) {
  const target = new URL(url.pathname + url.search, UPSTREAM);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) continue;
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('host', UPSTREAM.host);
  headers.set('origin', UPSTREAM.origin);
  if (req.headers.referer) {
    headers.set('referer', req.headers.referer.replace(/^https?:\/\/[^/]+/, UPSTREAM.origin));
  }

  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);

  let upstream;
  try {
    upstream = await upstreamRequest(target, method, headers, body);
  } catch (error) {
    const cause = error && error.cause ? ' cause=' + String(error.cause.message || error.cause) : '';
    const detail = '[' + transport + '] ' + String((error && error.message) || error) + cause;
    log(502, method, url.pathname, detail);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'preview_proxy_failed', detail }));
    return;
  }

  const skip = ['content-encoding', 'content-length', 'transfer-encoding', 'connection',
    'keep-alive', 'strict-transport-security'];
  const out = {};
  const cookies = [];
  for (const [key, value] of upstream.headerPairs) {
    if (skip.includes(key)) continue;
    if (key === 'set-cookie') {
      /* The browser is on http://localhost, so Secure and a production Domain
         would make the session and CSRF cookies unusable here. */
      cookies.push(value
        .replace(/;\s*Domain=[^;]*/gi, '')
        .replace(/;\s*Secure/gi, '')
        .replace(/;\s*SameSite=None/gi, '; SameSite=Lax'));
      continue;
    }
    if (key === 'location') {
      out.location = value.replace(UPSTREAM.origin, 'http://' + (req.headers.host || HOST + ':' + PORT));
      continue;
    }
    out[key] = value;
  }
  if (cookies.length) out['set-cookie'] = cookies;

  res.writeHead(upstream.status, out);
  log(upstream.status, method, url.pathname, '-> ' + UPSTREAM.host);
  if (method === 'HEAD') { res.end(); return; }
  res.end(upstream.body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const isProxied = PROXY_PREFIXES.some((p) => url.pathname === p.slice(0, -1) || url.pathname.startsWith(p));

  try {
    if (isProxied) {
      if (!PROXY_ON) {
        log(503, req.method, url.pathname, 'backend disabled');
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'preview_backend_disabled' }));
        return;
      }
      await proxy(req, res, url);
      return;
    }

    const resolved = await resolveFile(url.pathname);
    if (resolved.denied) {
      log(403, req.method, url.pathname);
      res.writeHead(403); res.end('forbidden');
      return;
    }
    if (resolved.redirect) {
      log(301, req.method, url.pathname, '-> ' + resolved.redirect);
      res.writeHead(301, { Location: resolved.redirect }); res.end();
      return;
    }
    if (!(await stat(resolved.file))) {
      log(404, req.method, url.pathname);
      res.writeHead(404); res.end('not found');
      return;
    }
    log(200, req.method, url.pathname, resolved.fallback ? '(index fallback)' : '');
    serveFile(req, res, resolved.file);
  } catch (error) {
    log(500, req.method, url.pathname, String((error && error.message) || error));
    if (!res.headersSent) res.writeHead(500);
    res.end('preview server error');
  }
});

await chooseTransport();

server.listen(PORT, HOST, () => {
  const base = 'http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT;
  console.log('\nGravitas+ preview  ' + base);
  console.log('  files      ' + ROOT);
  console.log('  backend    ' + (PROXY_ON ? UPSTREAM.origin + '  (/api/, /admin/, /content/)' : 'disabled (--api off)'));
  if (PROXY_ON) console.log('  transport  ' + transport + (transport === 'curl' ? '  (Node is refused a direct connection)' : ''));
  console.log('\n  ' + base + '/                      home');
  console.log('  ' + base + '/login                 sign in');
  console.log('  ' + base + '/workspace             workspace + dashboard');
  console.log('  ' + base + '/workspace/operating   operating workspace\n');
});
