// @vitest-environment jsdom
//
// Per-file, matching `identity.test.ts`, rather than a jsdom *project*. This
// package runs under Node by default and only two of its files want a
// browser; a projects array here would be a fourth spelling of a split that
// is already spelled three ways across the three games, which the lobby pass
// exists partly to argue against.
import { act, renderHook } from '@testing-library/react';
import type { IdentityStore, RoomIdentity } from './identity';
import { createFakeLobbyConnection } from './fakeConnection';
import { useLobbyRoom } from './useLobbyRoom';

/**
 * The 235 lines of `useLobbyRoom.ts` had no test in this package until now.
 * Its rules were written down in its own comments and enforced only through
 * two games' `src/net/useRoom.test.ts` wrappers — so Marco Polo, which calls
 * the hook directly, inherited none of them, and the rule that matters most
 * (rejoin on reconnect) was verified once by hand in a browser.
 *
 * Nothing here needs a socket, a server or a `localStorage`: the hook takes
 * its connection and its identity store as arguments. That is worth saying
 * out loud, because "it needs a server" is the likeliest reason nobody wrote
 * this file earlier, and it was never true.
 */

function fakeIdentity(stored: RoomIdentity | null = null): IdentityStore & {
  saved: [string, RoomIdentity][];
  cleared: string[];
  namesRemembered: string[];
} {
  let current = stored;
  let remembered: string | null = null;
  const saved: [string, RoomIdentity][] = [];
  const cleared: string[] = [];
  const namesRemembered: string[] = [];
  return {
    saved,
    cleared,
    namesRemembered,
    loadIdentity: () => current,
    saveIdentity: (roomId, identity) => { current = identity; saved.push([roomId, identity]); },
    clearIdentity: (roomId) => { current = null; cleared.push(roomId); },
    rememberedName: () => remembered,
    rememberName: (name) => { remembered = name; namesRemembered.push(name); },
    listRooms: () => [],
  };
}

const SEAT: RoomIdentity = { playerId: 'p2', token: 'tok-abc', name: 'Ada' };

function roster(overrides: Partial<{ connected: boolean }> = {}) {
  return {
    roomId: 'ABC123',
    lifecycle: 'lobby' as const,
    players: [{ id: 'p2', name: 'Ada', isHost: false, connected: overrides.connected ?? true }],
  };
}

describe('joining', () => {
  it('sends nothing until the socket is open', () => {
    const fake = createFakeLobbyConnection({ status: 'connecting' });
    const identity = fakeIdentity();
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    expect(fake.calls.joinRoom).toHaveLength(0);
    expect(result.current.phase).toBe('connecting');
  });

  it('joins with no name at all when nothing is remembered, letting the server name the seat', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity()));

    expect(fake.calls.joinRoom).toEqual([{ roomId: 'ABC123' }]);
    // Not `{ roomId, name: undefined }`: an absent name is the wire's way of
    // asking to be named, and an explicit undefined would only serialise to
    // the same thing by luck.
    expect('name' in fake.calls.joinRoom[0]!).toBe(false);
  });

  it('presents the stored seat when there is one, which is what makes a refresh a rejoin', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity(SEAT)));

    expect(fake.calls.joinRoom).toEqual([
      { roomId: 'ABC123', name: 'Ada', playerId: 'p2', token: 'tok-abc' },
    ]);
  });

  it('joins once, not once per render', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const { rerender } = renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity()));
    rerender();
    rerender();

    expect(fake.calls.joinRoom).toHaveLength(1);
  });
});

/**
 * The reason this file exists.
 *
 * `packages/host/close.ts` closes the engine and not the sockets, so a
 * deploy drops every client's transport and socket.io reconnects it. That
 * only restores a *connection*; what restores a **seat** is this hook
 * noticing the drop, clearing `sent`, and re-sending `joinRoom` with the
 * stored token when the socket returns.
 *
 * Until 2026-08-20 the close path used `disconnectSockets(true)` instead,
 * which socket.io's client treats as final — so this sequence could not
 * happen at all and every deploy left every open page dead. That was found
 * by watching a browser. This is the test that would have found it.
 */
describe('a deploy, from the client side', () => {
  it('rejoins with the stored token when the socket comes back', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity(SEAT)));
    expect(fake.calls.joinRoom).toHaveLength(1);

    act(() => { fake.setStatus('closed'); });
    act(() => { fake.setStatus('open'); });

    expect(fake.calls.joinRoom).toHaveLength(2);
    // The token, not a fresh join: the server's rejoin path keys on it, and a
    // nameless second join would take a second seat beside the first.
    expect(fake.calls.joinRoom[1]).toEqual({
      roomId: 'ABC123', name: 'Ada', playerId: 'p2', token: 'tok-abc',
    });
  });

  it('does not re-send on the connecting pulses a reconnect makes on the way back', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity(SEAT)));

    act(() => { fake.setStatus('closed'); });
    act(() => { fake.setStatus('connecting'); });
    act(() => { fake.setStatus('connecting'); });
    act(() => { fake.setStatus('open'); });

    // One drop is one rejoin, however many times the socket said
    // `reconnect_attempt` on the way — the hook tracks the transition, not
    // every pulse.
    expect(fake.calls.joinRoom).toHaveLength(2);
  });
});

describe('a refusal', () => {
  it('is terminal for a room that is gone, and takes the dead token with it', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { fake.rejected({ code: 'noSuchRoom', message: 'no such room' }); });

    expect(result.current.phase).toBe('gone');
    expect(identity.cleared).toEqual(['ABC123']);
  });

  it('is terminal for a stale client and deliberately KEEPS the seat', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { fake.rejected({ code: 'versionMismatch', message: 'reload' }); });

    expect(result.current.phase).toBe('stale');
    // The room is fine and the seat is still theirs; it is this page that
    // cannot talk. Clearing here would turn a reload — which fixes it — into
    // a lost seat, which nothing fixes.
    expect(identity.cleared).toEqual([]);
  });

  it('clears a stored seat that is refused before we were ever seated', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { fake.rejected({ code: 'seatRefused', message: 'that seat is not yours' }); });

    // A stale token guarantees every future visit repeats the same doomed
    // rejoin. Clearing it is what lets the next load offer a clean join.
    expect(identity.cleared).toEqual(['ABC123']);
  });

  it('keeps the seat when the refusal lands after we are seated', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { fake.roster(roster()); });
    act(() => { fake.rejected({ code: 'notHost', message: 'only the host may begin' }); });

    // Seated, so this is a note about something tried *inside* the lobby, not
    // a join being turned away. Ranking it above the roster would throw a
    // seated player back to a join form over a button they could not press.
    expect(identity.cleared).toEqual([]);
    expect(result.current.phase).toBe('lobby');
    expect(result.current.message).toBe('only the host may begin');
  });
});

describe('phase', () => {
  it('ranks stale above gone, so a reload is what a doubly-refused page is told to do', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity()));

    act(() => { fake.rejected({ code: 'noSuchRoom', message: 'gone' }); });
    act(() => { fake.rejected({ code: 'versionMismatch', message: 'reload' }); });

    expect(result.current.phase).toBe('stale');
  });

  it('is joining, not connecting, once the socket is open and the join is away', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, fakeIdentity()));

    expect(result.current.phase).toBe('joining');
  });
});

describe('seat management', () => {
  it('stores the seat the server issues, so the next load can rejoin', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity();
    renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { fake.joined({ roomId: 'ABC123', playerId: 'p2', token: 'tok-abc' }); });

    expect(identity.saved).toEqual([['ABC123', { playerId: 'p2', token: 'tok-abc', name: '' }]]);
  });

  it('keeps the stored name current on a rename, so a refresh does not show the old one', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { result.current.rename('Grace'); });

    expect(fake.calls.renamePlayer).toEqual(['Grace']);
    expect(identity.saved.at(-1)?.[1].name).toBe('Grace');
    expect(identity.namesRemembered).toEqual(['Grace']);
  });

  it('drops the token when the seat is given up, because the seat is gone', () => {
    const fake = createFakeLobbyConnection({ status: 'open' });
    const identity = fakeIdentity(SEAT);
    const { result } = renderHook(() => useLobbyRoom('ABC123', fake.connection, identity));

    act(() => { result.current.leaveSeat(); });

    expect(fake.calls.leaveSeat).toBe(1);
    // Keeping it would make the next visit attempt a rejoin the server must
    // refuse.
    expect(identity.cleared).toEqual(['ABC123']);
  });
});
