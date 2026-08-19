import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useRoom } from './useRoom';
import type { Connection, ConnectionStatus } from './connection';
import type { StateMessage } from '../../session/protocol';
import type { JoinedMessage, RejectedMessage, RosterMessage } from '../../vendor/lobby/protocol/protocol';
import { buildFixture } from '../../engine/golden/fixtures';

/**
 * The same fake `RoomPage.test.tsx` builds — controllable status,
 * capture-and-fire handlers for onJoined/onRoster/onState/onRejected.
 */
function fakeConnection() {
  let roster: ((m: RosterMessage) => void) | null = null;
  // A Set, not a single slot: `useLobbyRoom` and the game's `useRoom` both
  // register their own `onJoined` listener on the same event (the lobby to
  // seat itself, the wrapper to track the id it needs to build a session
  // ahead of the next render) — a single overwritten slot would silently
  // drop one of them.
  const joinedHandlers = new Set<(m: JoinedMessage) => void>();
  const stateHandlers = new Set<(m: StateMessage) => void>();
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const statusListeners = new Set<() => void>();
  let status: ConnectionStatus = 'open';

  const connection: Connection = {
    socket: {} as unknown as Socket,
    transport: {
      sendIntent: () => {},
      sendUndo: () => {},
      onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
      onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
      isOpen: () => status === 'open',
    },
    status: () => status,
    subscribe: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    createRoom: () => {},
    joinRoom: () => {},
    beginGame: () => {},
    renamePlayer: () => {},
    leaveSeat: () => {},
    onJoined: (h) => { joinedHandlers.add(h); return () => { joinedHandlers.delete(h); }; },
    onRoster: (h) => { roster = h; return () => { roster = null; }; },
    onRejected: (h) => { rejectedHandlers.add(h); return () => { rejectedHandlers.delete(h); }; },
    close: () => {},
  };

  return {
    connection,
    open: () => act(() => { status = 'open'; for (const l of statusListeners) l(); }),
    joined: (m: JoinedMessage) => act(() => { for (const h of joinedHandlers) h(m); }),
    roster: (m: RosterMessage) => act(() => { roster?.(m); }),
    state: (m: StateMessage) => act(() => { for (const h of stateHandlers) h(m); }),
    rejected: (m: RejectedMessage) => act(() => { for (const h of rejectedHandlers) h(m); }),
  };
}

/** A minimal opening state, the same way `RoomPage.test.tsx` builds one. */
function minimalStateMessage(): StateMessage {
  const state = buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
  return { state, reason: 'commit', segmentStart: state.nextStepId };
}

describe('phase ranking over a live session', () => {
  it('noSuchRoom outranks playing in the very same render', () => {
    const fake = fakeConnection();
    const { result } = renderHook(() => useRoom('ABC123', () => fake.connection));
    act(() => { fake.open(); fake.joined({ roomId: 'ABC123', playerId: 'p1', token: 't' }); });
    act(() => { fake.state(minimalStateMessage()); });
    expect(result.current.phase).toBe('playing');

    act(() => { fake.rejected({ code: 'noSuchRoom', message: 'Room ABC123 is no longer available' }); });
    expect(result.current.phase).toBe('gone');
    expect(result.current.session).toBeNull();
  });

  it('versionMismatch outranks playing the same way', () => {
    const fake = fakeConnection();
    const { result } = renderHook(() => useRoom('ABC123', () => fake.connection));
    act(() => { fake.open(); fake.joined({ roomId: 'ABC123', playerId: 'p1', token: 't' }); });
    act(() => { fake.state(minimalStateMessage()); });
    expect(result.current.phase).toBe('playing');

    act(() => { fake.rejected({ code: 'versionMismatch', message: 'This client speaks protocol 0' }); });
    expect(result.current.phase).toBe('stale');
    expect(result.current.session).toBeNull();
  });
});
