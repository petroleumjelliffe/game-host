// The service worker template. `dist/sw.js` is generated from this by
// vite.config.ts's sw-from-build plugin, which substitutes the three
// double-underscore placeholders below — never edit dist/sw.js, and never
// hand-maintain the precache list: it is derived from the files the build
// actually emitted, so a renamed chunk cannot rot it. (This comment does not
// name the placeholders, deliberately: substitution has already hit a
// placeholder in a comment twice today, once for the theme colour and once
// here. Prose stays placeholder-free.)
/* eslint-disable no-undef */

const CACHE = '__CACHE_NAME__';
const BASE = '__BASE__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  // Deliberately NO self.skipWaiting() here. The ruling (owner, 2026-08-08)
  // is next-launch activation: a new worker installs in the background and
  // waits; it takes over when the app is next opened, never under a live
  // game. The one exception is the explicit Update-now path below.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // One cache per build; activating prunes every other build's cache.
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The Update-now button's half of the handshake (StaleClient, Task 5): the
// page asks the *waiting* worker to take over immediately. This is the only
// path to skipWaiting, and it is user-initiated by construction.
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
  // first version of this handler passed that 404 straight through — caught
  // when the test mount (python http.server) did exactly that. On GitHub
  // Pages the 404.html redirect script papers over it when online; serving
  // the cached shell here is faster than that dance and works on any host.
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
