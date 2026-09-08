// packages/notify/webPush.ts
// The real Web Push channel: the `web-push` package and VAPID keys from env.
// No third-party push service — VAPID is the whole authentication story.
//
// Imported dynamically and only when configured, so an unconfigured
// deployment (every dev boot, and the LAN host until someone mints keys)
// never loads the dependency at all. Generate a key pair once with
// `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY (and VAPID_SUBJECT, a mailto: or https: contact URI —
// push services use it to reach whoever runs this if the traffic misbehaves).

import type { PushPayload, PushSender } from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import type { PushSubscriptionRecord } from './records.js';

/**
 * The wire copy per payload kind. The worker (each game's sw.js) renders
 * `{title, body, url}` generically, so new kinds need no worker change.
 * Invite copy is the design's: "Pete invited you to a game in room KTWQ.
 * Your seat is saved — tap to claim it."
 */
function wireContent(payload: PushPayload): { title: string; body: string; url: string } {
  if ('kind' in payload) {
    const who = payload.inviterName ?? 'A friend';
    return {
      title: payload.gameTitle,
      body: `${who} invited you to a game in room ${payload.roomId}. Your seat is saved — tap to claim it.`,
      url: payload.url,
    };
  }
  return {
    title: `${payload.gameTitle} — your turn`,
    body: `Room ${payload.roomId} is waiting on you.`,
    url: payload.url,
  };
}

export async function pushSenderFromEnv(
  env: Record<string, string | undefined>,
  log: (line: string) => void,
): Promise<PushSender | null> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    log('· Push notifications off (no VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
    return null;
  }
  // The fallback subject keeps Chrome/FCM working with just the two keys,
  // but Apple's push service VALIDATES the sub claim and answers every send
  // with 403 BadJwtToken for a localhost mail domain — observed live
  // 2026-09-07, Safari on macOS. Push to Apple devices needs a real
  // VAPID_SUBJECT, so an unset one is warned about at boot, not discovered
  // one silent Safari failure at a time.
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:game-host@localhost';
  if (!env.VAPID_SUBJECT?.trim()) {
    log('! VAPID_SUBJECT is not set — Apple\'s push service (Safari, installed iOS apps) rejects the placeholder subject; set it to a real mailto: or https: contact');
  }
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(subject, publicKey, privateKey);

  return {
    publicKey,
    async send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<void> {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(wireContent(payload)),
          { TTL: 24 * 60 * 60 },
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        // 404/410 mean the subscription is dead at the push service; the
        // service prunes it on this signal, per the Web Push spec.
        if (statusCode === 404 || statusCode === 410) {
          throw new PushSubscriptionGoneError(subscription.endpoint);
        }
        // web-push's WebPushError stringifies to "Received unexpected
        // response code" with the code and the push service's explanation
        // hidden in fields the service's log line never reaches — observed
        // live 2026-09-07, an undiagnosable failure until this rewrap. The
        // body is where FCM says things like "VapidPkHashMismatch".
        const body = (error as { body?: string }).body?.trim();
        if (statusCode !== undefined) {
          throw new Error(
            `push service answered ${statusCode}${body ? ` — ${body.slice(0, 300)}` : ''} (endpoint ${new URL(subscription.endpoint).host})`,
          );
        }
        throw error;
      }
    },
  };
}
