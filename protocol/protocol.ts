// The lobby half of the wire: room management, seats, presence.
// Game-agnostic and self-contained — imports nothing from this repo.

export type Lifecycle = 'lobby' | 'playing' | 'over';

/**
 * The refusals the lobby itself issues and branches on. Everything else on the
 * `rejected` channel (engine refusals, `undoOutOfSegment`) passes through this
 * layer opaquely for the game to interpret — which is how `useRoom` always
 * behaved; this type names it.
 */
export type LobbyRejectionCode =
  | 'noSuchRoom'
  | 'seatRefused'
  /**
   * The client and the server do not speak the same protocol.
   *
   * Its own code, deliberately. A stale client told `noSuchRoom` goes hunting
   * for a room that is perfectly fine, and the player has no way to learn that
   * reloading is the fix.
   */
  | 'versionMismatch'
  | 'notConnected';

/**
 * Typed generically — `code: string`, not a union — because the lobby only
 * branches on `LobbyRejectionCode` and forwards the rest.
 */
export interface RejectedMessage { code: string; message: string }

export interface JoinedMessage {
  roomId: string;
  playerId: string;
  /** Presented on rejoin. Issued once, at first join, and never re-issued. */
  token: string;
}

export interface RosterMessage {
  roomId: string;
  lifecycle: Lifecycle;
  players: { id: string; name: string; isHost: boolean; connected: boolean }[];
}

/**
 * `name` is optional on both, and that is a correction to v2 rather than a v3:
 * v2 has never been deployed — prod still speaks v1 — so no client in the
 * world sends the required-name shape. Adding a name later would have cost a
 * cutover; adding it now costs nothing. Do not read the absent bump as a
 * missed one.
 *
 * An absent name means "you name me": the server seats you and names you by
 * your seat number, which is the only thing that knows it. See
 * `server/rooms.ts`'s `seatPlayer`.
 */
export interface CreateRoomMessage { name?: string; protocolVersion: number }
export interface JoinRoomMessage {
  roomId: string;
  name?: string;
  playerId?: string;
  token?: string;
  protocolVersion: number;
}
export interface RenamePlayerMessage { name: string }

export const LOBBY_CLIENT_EVENTS = {
  createRoom: 'createRoom',
  joinRoom: 'joinRoom',
  beginGame: 'beginGame',
  /**
   * Change your own seat's name, in the lobby only. Identity comes from the
   * socket binding, never the payload — there is no way to rename anyone
   * else. Lobby-only because the engine copies names into `GameState` at
   * startGame; a mid-game rename would leave the roster and the log
   * disagreeing about who did what.
   */
  renamePlayer: 'renamePlayer',
  /**
   * Vacate your own seat, in the lobby only — your own and nobody else's,
   * since identity comes from the socket binding. Sent by the lobby's `Leave`.
   * Distinct from a disconnect, which keeps the seat and marks it away: this
   * one gives it up.
   */
  leaveSeat: 'leaveSeat',
} as const;

export const LOBBY_SERVER_EVENTS = {
  joined: 'joined',
  roster: 'roster',
  rejected: 'rejected',
} as const;
