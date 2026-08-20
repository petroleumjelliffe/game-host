import { describe, expect, it, vi } from 'vitest';

/** Mocked at the vendor boundary for the same reason useRoom.lifecycle does:
 *  these tests are about identity and lifecycle, not socket mechanics. */
import type { FakeLobbyConnection } from '@game-host/lobby/client/fakeConnection';

// The fake is the lobby's own (`@game-host/lobby/client/fakeConnection`), not
// a stub written here. This block used to be twenty lines of hand-rolled
// `LobbyConnection`, identical to the one in the sibling file beside it and
// to three more in Acquire — see the fake's own comment for why five copies
// of one interface's double is a problem the interface's package should
// solve.
//
// The factory imports it rather than closing over a top-level import because
// `vi.mock` is hoisted above the import block; an async factory is the
// supported way to reach a module from inside one.
const { made } = vi.hoisted(() => ({ made: [] as FakeLobbyConnection[] }));

vi.mock('@game-host/lobby/client/connection', async () => {
  const { createFakeLobbyConnection } = await import('@game-host/lobby/client/fakeConnection');
  return {
    createLobbyConnection: () => {
      const fake = createFakeLobbyConnection();
      made.push(fake);
      return fake.connection;
    },
  };
});

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
    expect(made[made.length - 1]!.calls.close).toBeGreaterThan(0);
    // Leaving is a real disconnect; the next visit gets a new socket rather
    // than a dead one.
    expect(getConnection()).not.toBe(before);
  });
});
