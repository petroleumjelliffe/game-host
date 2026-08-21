import type { Socket } from 'socket.io-client';
import type {
  JoinRoomMessage,
  JoinedMessage,
  RejectedMessage,
  RosterMessage,
} from '../protocol/protocol';
import type { ConnectionStatus, LobbyConnection } from './connection';

/**
 * A `LobbyConnection` that answers to a test instead of to a server.
 *
 * Written because five files across two games had each built one:
 * `RoomPage.test.tsx`, `OnlineLobbyPage.test.tsx` and `useRoom.test.ts` in
 * Acquire, `useRoom.lifecycle.test.tsx` and `connection.test.ts` in Rail
 * Baron — the last two identical to each other, line for line. The interface
 * is this package's, so the fake for it belongs here too; a rule about how
 * this connection behaves was being rediscovered by consumers and written
 * down in their suites, which is how it came to be recorded twice and
 * enforced nowhere.
 *
 * **No React, deliberately.** The drivers below fire handlers synchronously
 * and do not wrap anything in `act()`, so this file imports nothing from
 * `@testing-library/react` and works just as well from a plain Node test. A
 * caller rendering a hook wraps the driver call itself — `act(() =>
 * fake.roster(msg))` — which is one wrapper at the call site in exchange for
 * a fake that is not welded to a renderer.
 */
export interface FakeLobbyConnection {
  /** Hand this to whatever takes a `LobbyConnection`. */
  connection: LobbyConnection;
  /** What the code under test asked the connection to do, in order. */
  calls: {
    createRoom: (string | undefined)[];
    joinRoom: Omit<JoinRoomMessage, 'protocolVersion'>[];
    beginGame: number;
    renamePlayer: string[];
    leaveSeat: number;
    close: number;
  };
  /** Move the socket and tell every subscriber, the way a real one would. */
  setStatus(next: ConnectionStatus): void;
  joined(msg: JoinedMessage): void;
  roster(msg: RosterMessage): void;
  rejected(msg: RejectedMessage): void;
}

export function createFakeLobbyConnection(
  opts: { status?: ConnectionStatus } = {},
): FakeLobbyConnection {
  // Sets, not single slots, and this is the rule the fake exists to carry.
  // `useLobbyRoom` registers its own `onJoined`/`onRejected` to seat itself,
  // and a game's wrapper registers another on the same event to build a
  // session from the id — so two live handlers per channel is the ordinary
  // case, not an edge one. A fake with one slot per channel silently drops
  // whichever registered first, and the symptom is a hook that never seats.
  // Both of Acquire's suites had worked this out independently and said so in
  // a comment; it is said here once instead.
  const joinedHandlers = new Set<(m: JoinedMessage) => void>();
  const rosterHandlers = new Set<(m: RosterMessage) => void>();
  const rejectedHandlers = new Set<(m: RejectedMessage) => void>();
  const statusListeners = new Set<() => void>();

  let status: ConnectionStatus = opts.status ?? 'connecting';

  const calls: FakeLobbyConnection['calls'] = {
    createRoom: [],
    joinRoom: [],
    beginGame: 0,
    renamePlayer: [],
    leaveSeat: 0,
    close: 0,
  };

  // Enough of a socket to be held and passed on. A game hangs its own
  // transport off this in production; a test that needs that behaviour is
  // testing the game's transport, not the lobby, and should say so with its
  // own double.
  const socket = {
    on: () => {},
    off: () => {},
    emit: () => {},
    disconnect: () => {},
  } as unknown as Socket;

  const connection: LobbyConnection = {
    socket,
    status: () => status,
    subscribe(listener) {
      statusListeners.add(listener);
      return () => { statusListeners.delete(listener); };
    },
    createRoom(name) { calls.createRoom.push(name); },
    joinRoom(msg) { calls.joinRoom.push(msg); },
    beginGame() { calls.beginGame += 1; },
    renamePlayer(name) { calls.renamePlayer.push(name); },
    leaveSeat() { calls.leaveSeat += 1; },
    onJoined(handler) {
      joinedHandlers.add(handler);
      return () => { joinedHandlers.delete(handler); };
    },
    onRoster(handler) {
      rosterHandlers.add(handler);
      return () => { rosterHandlers.delete(handler); };
    },
    onRejected(handler) {
      rejectedHandlers.add(handler);
      return () => { rejectedHandlers.delete(handler); };
    },
    close() { calls.close += 1; },
  };

  return {
    connection,
    calls,
    setStatus(next) {
      status = next;
      // A copy, so a listener that unsubscribes itself mid-notify cannot
      // mutate the set being walked — `useLobbyRoom`'s cleanup does exactly
      // that when a status change unmounts the screen.
      for (const listener of [...statusListeners]) listener();
    },
    joined(msg) { for (const handler of [...joinedHandlers]) handler(msg); },
    roster(msg) { for (const handler of [...rosterHandlers]) handler(msg); },
    rejected(msg) { for (const handler of [...rejectedHandlers]) handler(msg); },
  };
}
