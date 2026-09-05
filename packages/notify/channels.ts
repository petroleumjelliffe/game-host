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

/**
 * An invite is a doorway, not a turn: delivered immediately (no debounce,
 * no presence check — an invitee has no room to be looking at), naming who
 * asked. The `kind` discriminates it from TurnPayload for the one sender
 * that carries both.
 */
export interface InvitePayload {
  kind: 'invite';
  gameTitle: string;
  roomId: string;
  /** Origin-relative deep link carrying `?invite=<token>` — the claim. */
  url: string;
  /** The inviter's profile name — the last name they played under — or null. */
  inviterName: string | null;
}

export type PushPayload = TurnPayload | InvitePayload;

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
  send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<void>;
}

export interface EmailSender {
  sendConfirmation(to: string, confirmUrl: string): Promise<void>;
  sendTurn(to: string, payload: TurnPayload, roomUrl: string, unsubscribeUrl: string): Promise<void>;
  /** The 24h nudge: same content as the turn mail, subject marked as a reminder. */
  sendTurnReminder(
    to: string,
    payload: TurnPayload,
    roomUrl: string,
    unsubscribeUrl: string,
  ): Promise<void>;
  /**
   * The invite mail. `unsubscribeUrl` is absent for first contact — the
   * unsubscribe token is minted at confirmation, and for an email invite
   * confirmation *is* the claim, which happens after this mail is sent —
   * so the footer there is a static "ignore this and nothing more will be
   * sent" line, with the per-address daily cap as the real enforcement. An
   * invite to an already-confirmed address carries the real link.
   */
  sendInvite(
    to: string,
    payload: InvitePayload,
    roomUrl: string,
    unsubscribeUrl?: string,
  ): Promise<void>;
}

export interface NotifyChannels {
  push?: PushSender | null;
  email?: EmailSender | null;
}
