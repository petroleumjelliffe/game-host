import { useSyncExternalStore } from 'react';

/**
 * Whether this device believes it has a network.
 *
 * `navigator.onLine` plus the `online`/`offline` events — the browser's own
 * signal, which is optimistic (a captive portal reads as online) but never
 * pessimistic: `false` really means no network. That asymmetry is fine for
 * what this drives — an *installed offline* app should not offer Online mode
 * as though it will work, and the false-online case is already handled one
 * layer down by the socket's own reconnect pill.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    () => navigator.onLine,
  );
}
