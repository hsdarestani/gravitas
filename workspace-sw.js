const STATIC_CACHE = 'gravitas-workspace-static-v10';
const SHELL = [
  '/workspace/',
  '/workspace.html',
  '/assets/favicon.svg',
  '/assets/local-fonts.css',
  '/assets/gravitas.css',
  '/assets/ws/ws.css',
  '/assets/ws/ws-member-lms.js',
  '/assets/ws/ws-platform.js',
  '/assets/ws/ws-meetings.js',
  '/assets/ws/ws-core-assets.js',
  '/assets/ws/ws-math.js',
  '/assets/ws/ws-math.css',
  '/assets/gravitas-icons.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      for (const url of SHELL) {
        try { await cache.add(url); } catch { /* one optional asset must not block install */ }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('gravitas-workspace-') && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Authenticated API responses are deliberately never cached. Course
    // snapshots that the learner explicitly saves for offline use live in
    // user-scoped browser storage instead.
    return;
  }

  if (url.pathname.startsWith('/workspace')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/workspace/', copy));
          return response;
        })
        .catch(() => caches.match('/workspace/').then((cached) => cached || caches.match('/workspace.html')))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
