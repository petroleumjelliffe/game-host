// The push-subscription mechanics, extracted from wordgame's settings
// panel so the enrollment card at the invite landing (P4) and every game's
// settings surface share one implementation. Headless: no React, no UI —
// callers render the states these return.

import { notifyPost } from './api.js';
import { pushSupported, urlBase64ToUint8Array } from './push.js';

export type EnrollResult = 'enabled' | 'denied' | 'failed';

/**
 * Ask permission, subscribe this browser, tell the server. The caller has
 * already established that push is supported and configured (a vapid key
 * exists) — those are display states, not outcomes.
 */
export async function enrollPush(playerKey: string, vapidPublicKey: string): Promise<EnrollResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    });
    const res = await notifyPost('/subscriptions', {
      playerKey,
      subscription: subscription.toJSON(),
    });
    return res.ok ? 'enabled' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Unsubscribe the browser and tell the server. True when cleanly off. */
export async function unsubscribePush(playerKey: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub !== null) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await notifyPost('/subscriptions/remove', { playerKey, endpoint });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this browser's subscription one the server knows? Re-registers
 * silently when the browser holds one the server lost. Returns whether
 * push is effectively on for this device.
 */
export async function syncSubscription(
  playerKey: string,
  pushEndpoints: readonly string[],
  vapidPublicKey: string | null,
): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub === null) return false;
    if (pushEndpoints.includes(sub.endpoint)) return true;
    if (vapidPublicKey === null) return false;
    const res = await notifyPost('/subscriptions', { playerKey, subscription: sub.toJSON() });
    return res.ok;
  } catch {
    // No worker (dev), or the query failed: off.
    return false;
  }
}
