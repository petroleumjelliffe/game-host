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

import type { PushSender, TurnPayload } from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import type { PushSubscriptionRecord } from './records.js';

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
    async send(subscription: PushSubscriptionRecord, payload: TurnPayload): Promise<void> {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify({
            title: `${payload.gameTitle} — your turn`,
            body: `Room ${payload.roomId} is waiting on you.`,
            url: payload.url,
          }),
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
