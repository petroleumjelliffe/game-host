// server/store.test.ts
// The record guard, at its one new seam: a lobby-stage record has every
// envelope field and no `state` yet, and must read back as valid — while a
// record whose `state` is present-but-wrong stays refused.

import { PROTOCOL_VERSION } from '../session/protocol.js';
import { isSavedRoom } from './store.js';
import { twoPlayerState } from './testState.js';

const envelope = {
  roomId: 'ABC123',
  version: 1,
  protocolVersion: PROTOCOL_VERSION,
  savedAt: Date.now(),
  players: [{ id: 'p1', name: 'Ada', token: 't1', isHost: true, connected: false }],
};

test('a lobby-stage record — no state yet — is a valid save', () => {
  expect(isSavedRoom({ ...envelope })).toBe(true);
});

test('a record with a state is held to the full state guard', () => {
  expect(isSavedRoom({ ...envelope, state: twoPlayerState() })).toBe(true);
  expect(isSavedRoom({ ...envelope, state: { stage: 'nonsense' } })).toBe(false);
});
