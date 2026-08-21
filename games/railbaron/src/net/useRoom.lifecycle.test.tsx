import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The room screen must survive StrictMode's double-invoked lifecycle.
 *
 * `main.tsx` renders the whole app inside `<StrictMode>`, which in development
 * mounts, unmounts and remounts every component. A connection built during
 * render but closed in an effect cleanup is destroyed by that pass and never
 * rebuilt — the create and the destroy live in different lifecycles, so the
 * cleanup outlives the thing that would have rebuilt it. `close()` is
 * `socket.disconnect()`, which is permanent.
 *
 * The symptom is not an error anywhere: the socket is simply closed, no
 * roster ever arrives, and the board sits on "Reconnecting" showing six empty
 * seats. Found by hand at /room/GSKF56; no server is needed to reproduce it,
 * because nothing about it is the network's doing.
 *
 * The vendor module is mocked at the boundary so the test observes lifecycle
 * — how many sockets get made, whether mounting closes one — without
 * restating any socket mechanics, which is exactly the distinction the
 * lobby's own no-mock rule draws.
 */
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

import { useRoom } from './useRoom';

describe('useRoom under StrictMode', () => {
  it('opens one socket and never closes it by merely mounting', () => {
    renderHook(() => useRoom('GSKF56'), { wrapper: StrictMode });
    // One socket for the app, not one per render pass — the discarded first
    // StrictMode render must not leak a second, orphaned connection.
    expect(made, 'connections opened').toHaveLength(1);
    // And the double-invoked cleanup must not have killed it: a closed
    // socket here is the perpetual-"Reconnecting" room.
    expect(made.filter((f) => f.calls.close > 0), 'connections closed by mounting')
      .toHaveLength(0);
  });
});
