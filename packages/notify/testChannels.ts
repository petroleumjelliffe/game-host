// packages/notify/testChannels.ts
// Recording channel doubles for the suite. Deliberately dumb: they append to
// arrays the tests read, and fail only when told to — the service's pruning
// and error posture is what's under test, never these.

import type { EmailSender, PushSender, TurnPayload } from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import type { PushSubscriptionRecord } from './records.js';

export interface RecordedPush {
  endpoint: string;
  payload: TurnPayload;
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
    send(subscription: PushSubscriptionRecord, payload: TurnPayload) {
      if (gone.has(subscription.endpoint)) {
        return Promise.reject(new PushSubscriptionGoneError(subscription.endpoint));
      }
      sent.push({ endpoint: subscription.endpoint, payload });
      return Promise.resolve();
    },
  };
}

export interface RecordedEmail {
  kind: 'confirmation' | 'turn';
  to: string;
  url: string;
  unsubscribeUrl?: string;
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
  };
}

export function sub(endpoint: string): PushSubscriptionRecord {
  return { endpoint, keys: { p256dh: 'p', auth: 'a' }, addedAt: 0 };
}
