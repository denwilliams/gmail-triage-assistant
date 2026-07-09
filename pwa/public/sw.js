// App-shell service worker for the /m/ PWA.
//
// Strategy: cache-first for the app shell and hashed build assets (they're
// immutable), network-only for /api and /auth. The shell entry (/m) is
// network-first so deploys show up on next launch without a manual refresh.
const CACHE = 'm-shell-v1';
const SHELL = ['/m', '/m/manifest.webmanifest', '/m/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (!(url.pathname === '/m' || url.pathname.startsWith('/m/'))) return;

  const isShellNav = event.request.mode === 'navigate';
  if (isShellNav) {
    // Network-first: fresh deploys win, cache covers offline.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/m', copy));
          return res;
        })
        .catch(() => caches.match('/m')),
    );
    return;
  }

  // Hashed assets: cache-first.
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    }),
  );
});
