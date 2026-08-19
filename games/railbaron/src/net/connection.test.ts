import { describe, expect, it, vi } from 'vitest';

/** Mocked at the vendor boundary for the same reason useRoom.lifecycle does:
 *  these tests are about identity and lifecycle, not socket mechanics. */
const { made } = vi.hoisted(() => ({ made: [] as { closed: number }[] }));

vi.mock('../../vendor/lobby/client/connection', () => ({
  createLobbyConnection: () => {
    const record = { closed: 0 };
    made.push(record);
    return {
      socket: { on: () => {}, off: () => {}, emit: () => {} },
      status: () => 'connecting' as const,
      subscribe: () => () => {},
      onJoined: () => () => {},
      onRoster: () => () => {},
      onRejected: () => () => {},
      createRoom: () => {},
      joinRoom: () => {},
      beginGame: () => {},
      renamePlayer: () => {},
      leaveSeat: () => {},
      close: () => { record.closed += 1; },
    };
  },
}));

import { closeConnection, getConnection } from './connection';

describe('the shared connection', () => {
  it('is one object however many callers ask', () => {
    // The create screen and the room screen are two views of one connection:
    // a second socket would drop the seat the first just bound — the server's
    // rejoin shortcut keys on the socket's own binding.
    expect(getConnection()).toBe(getConnection());
    expect(made).toHaveLength(1);
  });

  it('closes on request and opens fresh afterwards', () => {
    const before = getConnection();
    closeConnection();
    expect(made[made.length - 1]!.closed).toBeGreaterThan(0);
    // Leaving is a real disconnect; the next visit gets a new socket rather
    // than a dead one.
    expect(getConnection()).not.toBe(before);
  });
});
