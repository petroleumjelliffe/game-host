/**
 * Registers the service worker. Production only — the dev server has no
 * sw.js (it is written into dist/ by the build), and a worker capturing the
 * dev server's module graph would be pure confusion.
 *
 * Registration failure is deliberately just a warning: the app without a
 * worker is exactly the app before this feature existed, and a player
 * mid-game should never pay for a caching problem.
 *
 * BASE_URL arrives verbatim from the config ('/acquire-startups-m1', no
 * trailing slash) — normalize before joining, or the browser requests
 * '/acquire-startups-m1sw.js'. The same verbatim behaviour already bit
 * index.html's placeholders; see vite.config.ts.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`)
      .catch((err) => console.warn('service worker registration failed: ', err));
  });
}
