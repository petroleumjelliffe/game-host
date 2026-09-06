// packages/notify/testChannels.ts
// Recording channel doubles for the suite. Deliberately dumb: they append to
// arrays the tests read, and fail only when told to — the service's pruning
// and error posture is what's under test, never these.

import type { EmailSender, InvitePayload, PushPayload, PushSender, TurnPayload } from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import type { PushSubscriptionRecord } from './records.js';

export interface RecordedPush {
  endpoint: string;
  payload: PushPayload;
}

export interface FakePushSender extends PushSender {
  sent: RecordedPush[];
  /** Endpoints that answer 410 — the service should prune these. */
  gone: Set<string>;
}

export function fakePushSender(): FakePushSender {
  const sent: RecordedPush[] = [];
  const gone = new Set<string>();
  return {
    publicKey: 'test-vapid-public-key',
    sent,
    gone,
    send(subscription: PushSubscriptionRecord, payload: PushPayload) {
      if (gone.has(subscription.endpoint)) {
        return Promise.reject(new PushSubscriptionGoneError(subscription.endpoint));
      }
      sent.push({ endpoint: subscription.endpoint, payload });
      return Promise.resolve();
    },
  };
}

export interface RecordedEmail {
  kind: 'confirmation' | 'turn' | 'reminder' | 'invite' | 'signin';
  to: string;
  url: string;
  unsubscribeUrl?: string;
  /** Present on invite mails: who the mail says asked. */
  inviterName?: string | null;
}

export interface FakeEmailSender extends EmailSender {
  sent: RecordedEmail[];
}

export function fakeEmailSender(): FakeEmailSender {
  const sent: RecordedEmail[] = [];
  return {
    sent,
    sendConfirmation(to: string, confirmUrl: string) {
      sent.push({ kind: 'confirmation', to, url: confirmUrl });
      return Promise.resolve();
    },
    sendTurn(to: string, _payload: TurnPayload, roomUrl: string, unsubscribeUrl: string) {
      sent.push({ kind: 'turn', to, url: roomUrl, unsubscribeUrl });
      return Promise.resolve();
    },
    sendTurnReminder(to: string, _payload: TurnPayload, roomUrl: string, unsubscribeUrl: string) {
      sent.push({ kind: 'reminder', to, url: roomUrl, unsubscribeUrl });
      return Promise.resolve();
    },
    sendInvite(to: string, payload: InvitePayload, roomUrl: string, unsubscribeUrl?: string) {
      const record: RecordedEmail = { kind: 'invite', to, url: roomUrl, inviterName: payload.inviterName };
      if (unsubscribeUrl !== undefined) record.unsubscribeUrl = unsubscribeUrl;
      sent.push(record);
      return Promise.resolve();
    },
    sendSeatSignin(to: string, _payload: TurnPayload, roomUrl: string, unsubscribeUrl?: string) {
      const record: RecordedEmail = { kind: 'signin', to, url: roomUrl };
      if (unsubscribeUrl !== undefined) record.unsubscribeUrl = unsubscribeUrl;
      sent.push(record);
      return Promise.resolve();
    },
  };
}

export function sub(endpoint: string): PushSubscriptionRecord {
  return { endpoint, keys: { p256dh: 'p', auth: 'a' }, addedAt: 0 };
}
