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

test('a pre-invite record — no pending field — is a valid save', () => {
  // The no-bump pin: invites added an optional field, not a version. A
  // record written before they existed loads untouched, and the next
  // protocol change re-fights this consciously.
  expect(isSavedRoom({ ...envelope })).toBe(true);
});

test('a record with reserved seats is held to their shape', () => {
  const reserved = { id: 'p2', tokenHash: 'abc', name: 'Sam', invitedAt: 123 };
  expect(isSavedRoom({ ...envelope, pending: [reserved] })).toBe(true);
  expect(isSavedRoom({ ...envelope, pending: [{ ...reserved, name: null }] })).toBe(true);
  expect(isSavedRoom({ ...envelope, pending: [{ id: 'p2' }] })).toBe(false);
  expect(isSavedRoom({ ...envelope, pending: 'p2' })).toBe(false);
});
