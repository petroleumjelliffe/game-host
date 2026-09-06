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
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:game-host@localhost';
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
        throw error;
      }
    },
  };
}
