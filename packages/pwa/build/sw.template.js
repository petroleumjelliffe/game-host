// The shared service worker template. Each game's `dist/sw.js` is generated
// from this by the swFromBuild plugin (plugins.ts), which substitutes the
// double-underscore placeholders below — never edit a dist/sw.js, and never
// hand-maintain the precache list: it is derived from the files the build
// actually emitted, so a renamed chunk cannot rot it. (This comment does not
// name the placeholders, deliberately: substitution has hit a placeholder in
// a comment twice before. Prose stays placeholder-free.)
//
// One scope gets one worker, so this worker does both jobs: the offline
// shell (precache, update flow) and push. The push handlers are inert in a
// game where nothing ever subscribes — they cost nothing to always include.
/* eslint-disable no-undef */

const CACHE = '__CACHE_NAME__';
const CACHE_PREFIX = '__CACHE_PREFIX__';
const BASE = '__BASE__';
const APP_NAME = __APP_NAME__;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  // Deliberately NO self.skipWaiting() here. The ruling (owner, 2026-08-08;
  // re-affirmed for the shared template by the PWA spec's merge decision) is
  // next-launch activation: a new worker installs in the background and
  // waits; it takes over when the app is next opened, never under a live
  // game. The one exception is the explicit Update-now path below.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // One cache per build; activating prunes every other build's cache —
    // but only *this game's* builds. CacheStorage is origin-scoped and all
    // the games share one origin, so the keys listed here include the other
    // games' live precaches; deleting everything but our own CACHE would
    // empty a sibling's cache under its still-active worker (whose install
    // never re-runs, so its offline shell stays broken until its next
    // deploy). The prefix is the ownership boundary.
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith(`${CACHE_PREFIX}-`)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The Update-now button's half of the handshake (useUpdateReady): the page
// asks the *waiting* worker to take over immediately. This is the only path
// to skipWaiting, and it is user-initiated by construction.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Same-origin GETs only. The socket to the game server, and anything else
  // cross-origin, passes through untouched — the worker must never sit
  // between the client and the authority.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // Navigations: network-first, so a deploy is picked up on the next load
  // when online, falling back to the cached shell when not. The SPA has one
  // shell; every route falls back to the same document.
  //
  // The fallback covers a *response* failure, not only a thrown fetch: a
  // static host with no SPA fallback answers a deep link with 404, and the
  // first version of this handler passed that 404 straight through. Serving
  // the cached shell works on any host.
  if (event.request.mode === 'navigate') {
    const shell = () => caches.match(`${BASE}index.html`);
    event.respondWith(
      fetch(event.request)
        .then((res) => (res.ok ? res : shell().then((hit) => hit ?? res)))
        .catch(() => shell()),
    );
    return;
  }

  // Everything else (hashed assets, manifest, icons): cache-first. Vite's
  // content-hashed filenames make this safe by construction — a changed file
  // is a new URL, and stale entries die with their build's cache above.
  event.respondWith(
    caches.match(event.request).then((hit) => hit ?? fetch(event.request)),
  );
});

// Push. The server (packages/notify) always sends {title, body, url}; the
// fallbacks are for a malformed payload, not a code path. Rendering is
// generic so new payload kinds need no worker change.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || APP_NAME, {
      body: data.body || '',
      data: { url: data.url || BASE },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (url) event.waitUntil(self.clients.openWindow(url));
});
