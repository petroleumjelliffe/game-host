import { useCallback, useEffect, useState } from 'react';

/**
 * The reload that gets past the service worker.
 *
 * StaleClient's own comment predicted this button: once a worker caches the
 * shell, a plain location.reload() can be served the same stale shell again
 * and loop. This is the recovery path for the protocol-refused client, and
 * the one piece of the PWA that can never be allowed to wedge — a broken
 * updater is the only bug that survives its own fix being deployed.
 *
 * The order exists so there is no state from which the button does nothing:
 * - unregister the whole registration — not merely clear caches. Clearing
 *   alone left the old worker active with an install that will never re-run,
 *   which meant no offline cache until the *next* deploy (observed live:
 *   caches stayed empty after reload). Unregistering makes the reload a
 *   controller-less, network-first navigation, after which register.ts runs
 *   again, fetches the current worker, and a fresh install repopulates the
 *   precache;
 * - delete every cache, so nothing stale can be served in the window before
 *   the new worker owns fetches;
 * - navigate to the app root in a `finally`, so even total failure of the
 *   above still produces a fresh network-first navigation.
 *
 * The root, not a reload of the current URL. With the worker just
 * unregistered, nothing serves SPA deep links except the host's own
 * fallback — and that is host-specific (a bare static test mount answered
 * the recovery with a 404, observed live). `index.html` at the base is a
 * real file on any host, so landing there depends on nobody. The player
 * lands on the game's entry page running the fixed client; their room seat
 * survives in localStorage and one join re-seats them.
 */
export async function forceUpdateAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.unregister().catch(() => undefined);
    }
    if ('caches' in window) {
      // Only THIS game's caches. CacheStorage is origin-scoped and the games
      // share one origin, so caches.keys() lists the siblings' live
      // precaches too — deleting those empties a cache under a still-active
      // worker whose install never re-runs, breaking that game's offline
      // shell until its next deploy. The cache names are `<prefix>-<hash>`
      // and swFromBuild enforces prefix === the base path segment, which is
      // what makes deriving it from BASE_URL sound.
      const prefix = `${import.meta.env.BASE_URL.replaceAll('/', '')}-`;
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix)) await caches.delete(key);
      }
    }
  } catch {
    // Fall through to the navigation regardless — see above.
  } finally {
    window.location.replace(import.meta.env.BASE_URL.replace(/\/?$/, '/'));
  }
}

/**
 * Whether a new build is installed and waiting, and the hand that lets it in.
 *
 * The ruling is next-launch activation, so this never fires on its own —
 * `apply` is the explicit, user-pressed exception. It messages the waiting
 * worker (the template's SKIP_WAITING handler) and reloads when control
 * actually changes hands, which is the only moment the new assets are truly
 * the ones being served.
 *
 * In any environment without a service worker (dev, jsdom, an unregistered
 * first visit) this is permanently `{ ready: false }`, and the affordance it
 * drives simply never renders.
 */
export function useUpdateReady(): { ready: boolean; apply: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;

    const check = () => {
      if (!disposed && registration?.waiting) setWaiting(registration.waiting);
    };
    const onUpdateFound = () => {
      registration?.installing?.addEventListener('statechange', check);
    };

    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || disposed) return;
      registration = reg;
      // A worker may already be waiting from a previous visit...
      check();
      // ...or arrive while this page is open.
      reg.addEventListener('updatefound', onUpdateFound);
    });

    return () => {
      disposed = true;
      // The registration outlives every mount of this hook, so the listener
      // must not: without this, each remount stacked another handler on the
      // same long-lived object. The statechange listeners die with their
      // installing worker; the disposed flag silences any that outlive us.
      registration?.removeEventListener('updatefound', onUpdateFound);
    };
  }, []);

  const apply = useCallback(() => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { ready: waiting !== null, apply };
}
