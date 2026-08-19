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

import { useRoom } from './useRoom';

describe('useRoom under StrictMode', () => {
  it('opens one socket and never closes it by merely mounting', () => {
    renderHook(() => useRoom('GSKF56'), { wrapper: StrictMode });
    // One socket for the app, not one per render pass — the discarded first
    // StrictMode render must not leak a second, orphaned connection.
    expect(made, 'connections opened').toHaveLength(1);
    // And the double-invoked cleanup must not have killed it: a closed
    // socket here is the perpetual-"Reconnecting" room.
    expect(made.filter((c) => c.closed > 0), 'connections closed by mounting')
      .toHaveLength(0);
  });
});
