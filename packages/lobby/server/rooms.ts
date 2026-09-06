// server/lobby/rooms.ts
// Seating, tokens, join/rejoin. Generic over the room: the game's payload is
// whatever `makeRoom` builds, and this file never looks inside it.

import { randomUUID } from 'node:crypto';
import type { Lifecycle } from '../protocol/protocol.js';

export interface SeatHolder {
  id: string;
  name: string;
  /** Issued at first join, presented on rejoin. Never leaves the server twice. */
  token: string;
  isHost: boolean;
  connected: boolean;
}

/**
 * A seat held for someone who has not arrived: allocated by an invite,
 * claimable only by the invite token whose hash this carries. Never the
 * token itself, and never an email address — room records persist into
 * game saves, and an address in game state is a privacy leak waiting to
 * happen (addresses live only in notify's records).
 */
export interface PendingSeat {
  id: string;
  tokenHash: string;
  /** The invited contact's display name, or null for an email invite. */
  name: string | null;
  invitedAt: number;
}

/**
 * What the lobby needs a room to be. The game's room is a superset.
 * `pending` is optional so a game without invites changes nothing — the
 * registry creates the array on first reserve.
 */
export interface LobbyRoomLike {
  id: string;
  players: SeatHolder[];
  pending?: PendingSeat[];
  lifecycle(): Lifecycle;
}

export interface Seated<R extends LobbyRoomLike> { room: R; player: SeatHolder }

export interface LobbyRegistry<R extends LobbyRoomLike> {
  create(hostName?: string): Seated<R>;
  join(roomId: string, name?: string, playerId?: string, token?: string): Seated<R> | null;
  get(roomId: string): R | undefined;
  all(): R[];
  /**
   * Allocate a pending seat for an invite: the first seat id free of both
   * players and pending. Null when the room is full, gone, or past its
   * lobby — one shape for every refusal.
   */
  reserve(roomId: string, tokenHash: string, name: string | null): string | null;
  /**
   * Convert the pending seat matching this invite-token hash into a held
   * seat with a fresh token. `connected: false` — the claim is an HTTP
   * POST; the claimer's socket join is what flips presence. Null for
   * absent room, absent hash, already claimed: indistinguishable, so the
   * claim endpoint cannot be a probe.
   */
  claimByHash(roomId: string, tokenHash: string): Seated<R> | null;
  /** Delete a pending seat (never an occupied one). True when one matched. */
  revoke(roomId: string, playerId: string): boolean;
  /**
   * Seats a prepared room directly, replacing whatever holds its id.
   * For restore-at-boot and test seeding; the caller owns the "nothing is
   * live here" guarantee (see `RoomRegistry.restore`'s boot-only guard).
   */
  adopt(room: R): void;
}

/**
 * The seats a game has, supplied by the game. Its length is the room's
 * capacity, and an id is either free or taken — so a duplicate seat id is
 * unrepresentable rather than merely unlikely.
 *
 * Ids used to be derived from `players.length`, which shrinks when a seat is
 * given up: p1,p2,p3 → p2 leaves → the next join minted a *second* p3, and
 * rename, rejoin and socket-binding lookups all resolved to whichever the
 * find hit first.
 *
 * The lobby carries no badge — no emoji, no colour. Decoration is derived by
 * the game from the seat: Acquire reads an emoji by seat index, and Rail
 * Baron's ids *are* its colours, so there the decoration and the identity are
 * the same string. Letting a player *pick* one would be a choice rather than
 * a derivation, and would need an opaque field here plus uniqueness; that is
 * deliberately not built.
 */
export interface SeatSpace {
  readonly ids: readonly string[];
  /** Display name for an unnamed player seated at `index`. */
  defaultName?(index: number): string;
}

/**
 * The one place both `create` and `join` seat somebody, and therefore the only
 * place that can name an unnamed player: the seat is what the default is made
 * of, and the client does not know its seat until this has run.
 *
 * Nobody types a name before entering a room as of the Lobby Flow corrections
 * — both cards seat you first and let you edit your own row afterwards — so
 * an absent name is the ordinary case, not a malformed payload. A blank or
 * whitespace-only name is treated as absent rather than seating a nameless
 * row that no roster could render.
 *
 * `isHost` is "this room has no players yet", not "index zero". Once ids are
 * reused those differ: `leaveSeat` promotes `players[0]` when the host goes,
 * and a newcomer taking the freed first id would otherwise arrive believing
 * it is host as well — two hosts, one room.
 *
 * Returns null when every seat is taken. `join` already returns null for a
 * refusal, so capacity needs no new path through the handlers.
 *
 * `reservedIds` are pending seats: excluded from allocation, but a separate
 * argument rather than folded into `taken`, because `isHost` must stay
 * "players only". Folding them in would seat the next joiner of an
 * emptied-but-reserved room as a non-host, leaving a room where nobody can
 * begin *or* revoke — bricked until eviction. As written, the first person
 * to join such a room is host and can do both.
 */
export function seatPlayer(
  space: SeatSpace,
  taken: readonly SeatHolder[],
  name?: string,
  reservedIds: readonly string[] = [],
): SeatHolder | null {
  const held = new Set([...taken.map((p) => p.id), ...reservedIds]);
  const index = space.ids.findIndex((id) => !held.has(id));
  if (index === -1) return null;

  const given = name?.trim();
  return {
    id: space.ids[index]!,
    name: given ? given : (space.defaultName?.(index) ?? `Player ${index + 1}`),
    token: randomUUID(),
    isHost: taken.length === 0,
    connected: true,
  };
}

/** Six characters, unambiguous: no O/0 or I/1 to read out loud incorrectly. */
function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function createLobbyRegistry<R extends LobbyRoomLike>(
  makeRoom: (id: string, players: SeatHolder[]) => R,
  space: SeatSpace,
): LobbyRegistry<R> {
  const rooms = new Map<string, R>();

  return {
    create(hostName) {
      // Six random characters collide rarely, but "rarely" over a Map holding
      // live games means silently orphaning one — every socket bound to the
      // overwritten room stops resolving through `get()`, with no error raised
      // anywhere. Retry rather than trust the odds.
      let id = roomCode();
      while (rooms.has(id)) id = roomCode();

      const host = seatPlayer(space, [], hostName);
      // An empty room always has a free seat unless the game supplied none.
      if (!host) throw new Error('SeatSpace has no ids: a room could seat nobody');
      const room = makeRoom(id, [host]);
      rooms.set(id, room);
      return { room, player: host };
    },

    join(roomId, name, playerId, token) {
      const room = rooms.get(roomId);
      if (!room) return null;

      if (playerId) {
        const existing = room.players.find((p) => p.id === playerId);
        // A rejoin must prove itself. Without this, presenting someone else's
        // id would bind their seat to your socket and project their hand to
        // you — which is the whole guarantee projection exists to provide.
        if (!existing || existing.token !== token) return null;
        existing.connected = true;
        return { room, player: existing };
      }

      if (room.lifecycle() !== 'lobby') {
        // No token, game already running: refused. The honor-system
        // name-match reclaim that used to live here (owner ruling
        // 2026-08-08) was retired 2026-09-06: it was the one seat transfer
        // that proved nothing — any device that had ever set the shared
        // lobby.name could silently take over a same-named disconnected
        // seat and rotate its token, logging the real owner out. Its
        // recovery job belongs to the emailed sign-in link now (notify's
        // seat-signin, which proves mailbox possession); its rotation job
        // is retired with it, so a leaked emailed link lives until its
        // room dies — recorded in docs/plans/2026-09-06-prejoin-and-room-signin.md
        // rather than left silent.
        return null;
      }
      const player = seatPlayer(space, room.players, name, reservedIds(room));
      if (!player) return null; // every seat is taken
      room.players.push(player);
      return { room, player };
    },

    get: (roomId) => rooms.get(roomId),
    all: () => [...rooms.values()],
    adopt(room) { rooms.set(room.id, room); },

    reserve(roomId, tokenHash, name) {
      const room = rooms.get(roomId);
      // Lobby-only in this slice: `beginGame` clears pending seats, so a
      // reservation after begin would be a seat nothing can ever claim.
      if (!room || room.lifecycle() !== 'lobby') return null;
      const pending = (room.pending ??= []);
      const held = new Set([...room.players.map((p) => p.id), ...pending.map((p) => p.id)]);
      const index = space.ids.findIndex((id) => !held.has(id));
      if (index === -1) return null;
      const given = name?.trim();
      pending.push({
        id: space.ids[index]!,
        tokenHash,
        name: given ? given : null,
        invitedAt: Date.now(),
      });
      return space.ids[index]!;
    },

    claimByHash(roomId, tokenHash) {
      const room = rooms.get(roomId);
      const pending = room?.pending;
      if (!room || !pending) return null;
      const at = pending.findIndex((p) => p.tokenHash === tokenHash);
      if (at === -1) return null;
      const [reserved] = pending.splice(at, 1);
      const index = space.ids.indexOf(reserved!.id);
      const player: SeatHolder = {
        id: reserved!.id,
        // An email invite has no name; the claimer arrives under the seat
        // default and renames in the lobby like anyone else.
        name: reserved!.name ?? (space.defaultName?.(index) ?? `Player ${index + 1}`),
        token: randomUUID(),
        // Players only, same rule as seatPlayer: a claimer into an
        // emptied-but-reserved room is its first player, and its host.
        isHost: room.players.length === 0,
        // The claim is an HTTP POST with no socket behind it; presence
        // flips when the claimer's joinRoom lands.
        connected: false,
      };
      room.players.push(player);
      return { room, player };
    },

    revoke(roomId, playerId) {
      const pending = rooms.get(roomId)?.pending;
      if (!pending) return false;
      const at = pending.findIndex((p) => p.id === playerId);
      if (at === -1) return false;
      pending.splice(at, 1);
      return true;
    },
  };
}

function reservedIds(room: LobbyRoomLike): readonly string[] {
  return room.pending?.map((p) => p.id) ?? [];
}
