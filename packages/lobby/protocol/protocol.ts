// The lobby half of the wire: room management, seats, presence.
// Game-agnostic and self-contained — imports nothing from this repo.

export type Lifecycle = 'lobby' | 'playing' | 'over';

/**
 * The refusals the lobby itself issues and branches on. Everything else on the
 * `rejected` channel (engine refusals, `undoOutOfSegment`) passes through this
 * layer opaquely for the game to interpret — which is how `useRoom` always
 * behaved; this type names it.
 *
 * `notConnected` is not a refusal at all in the protocol sense — the server
 * never sends it — it is the client's own signal that the transport is down,
 * given a real member here rather than borrowing an unrelated wire code.
 *
 * `noSuchRoom` and `seatRefused` are one refusal split in two, because they
 * have different remedies. Nothing reaches a room that is not there, so that
 * is an ending: the game may have finished, or the server may have restarted
 * with an ephemeral disk. A room that is there but refuses this seat means the
 * stored identity is stale, and joining fresh works. Sending one code for both
 * made every wiped game read as `cannot join ABC123`.
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
  /**
   * Reserved seats: invited, not yet claimed. Optional and additive — absent
   * reads as none — deliberately, so that no game's protocol version moves:
   * an old client ignores the extra key, and a version bump here would orphan
   * every persisted room in a game whose restore skips on protocol skew.
   * `name` is the invited contact's display name, or null for an email
   * invite, where no address (and so no name) may appear. Never the invite
   * token or its hash.
   */
  pending?: { id: string; name: string | null }[];
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
/** Host-only: delete the reserved (pending) seat with this id. */
export interface RevokeSeatMessage { playerId: string }
/** Watch a room's roster without taking a seat — the pre-join chooser's data. */
export interface ViewRoomMessage { roomId: string; protocolVersion: number }

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
  /**
   * Host-only, lobby-only: delete a reserved seat that nobody has claimed.
   * Rides the lobby socket rather than a notify endpoint because host-ness
   * lives here (`SeatHolder.isHost`) and notify cannot see it. The invite
   * record left behind in notify becomes a token that can never claim, which
   * is exactly the indistinguishable refusal the non-probe rule wants; the
   * game's `onSeatVacated` hook is how notify hears and marks it dead.
   */
  revokeSeat: 'revokeSeat',
  /**
   * Receive a room's roster, and its future updates, without being seated.
   * What the pre-join chooser renders: names and seat states are exactly as
   * public as the table already is (the invite specs' privacy stance), and
   * nothing game-shaped ever reaches an unseated socket — game sends go
   * through the seat bindings, which a viewer does not have. Joining is a
   * separate, explicit act from here ("Sit here"), which is what retired
   * the silent auto-join and its accidental double seats.
   */
  viewRoom: 'viewRoom',
} as const;

export const LOBBY_SERVER_EVENTS = {
  joined: 'joined',
  roster: 'roster',
  rejected: 'rejected',
} as const;
