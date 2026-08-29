// packages/notify/channels.ts
// The two delivery channels, as the service sees them. Kept as interfaces so
// the service and its tests never touch web-push or nodemailer — the real
// implementations (webPush.ts, email.ts) are built from env at boot and are
// absent, not stubbed, when unconfigured. Adding a channel (ntfy, a Discord
// webhook) is implementing one of these and handing it to the service.

import type { PushSubscriptionRecord } from './records.js';

/** What every turn notification says, on any channel. */
export interface TurnPayload {
  gameTitle: string;
  roomId: string;
  /** Origin-relative deep link back into the room. */
  url: string;
}

/** Thrown by a PushSender when the subscription is dead (404/410) — the caller prunes it. */
export class PushSubscriptionGoneError extends Error {
  constructor(endpoint: string) {
    super(`Push subscription gone: ${endpoint}`);
    this.name = 'PushSubscriptionGoneError';
  }
}

export interface PushSender {
  /** The VAPID public key the client needs to subscribe. */
  readonly publicKey: string;
  send(subscription: PushSubscriptionRecord, payload: TurnPayload): Promise<void>;
}

export interface EmailSender {
  sendConfirmation(to: string, confirmUrl: string): Promise<void>;
  sendTurn(to: string, payload: TurnPayload, roomUrl: string, unsubscribeUrl: string): Promise<void>;
}

export interface NotifyChannels {
  push?: PushSender | null;
  email?: EmailSender | null;
}
