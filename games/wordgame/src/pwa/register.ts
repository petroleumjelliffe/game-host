/**
 * Registers the service worker. Production only — the dev server has no
 * sw.js in its module graph, and a worker over the dev server is pure
 * confusion. Failure is just a warning: the app without a worker is the app
 * before push notifications existed.
 *
 * BASE_URL arrives verbatim from the config — normalize before joining, or
 * the browser requests '/wordgamesw.js'.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`)
      .catch((err: unknown) => console.warn('service worker registration failed: ', err));
  });
}
