// server/lobby/rooms.ts
// Seating, tokens, join/rejoin. Generic over the room: the game's payload is
// whatever `makeRoom` builds, and this file never looks inside it.

import { randomUUID } from 'node:crypto';
import type { Lifecycle } from '../../lobby/protocol.js';

export interface SeatHolder {
  id: string;
  name: string;
  /** Issued at first join, presented on rejoin. Never leaves the server twice. */
  token: string;
  isHost: boolean;
  connected: boolean;
}

/** What the lobby needs a room to be. The game's room is a superset. */
export interface LobbyRoomLike {
  id: string;
  players: SeatHolder[];
  lifecycle(): Lifecycle;
}

export interface Seated<R extends LobbyRoomLike> { room: R; player: SeatHolder }

export interface LobbyRegistry<R extends LobbyRoomLike> {
  create(hostName?: string): Seated<R>;
  join(roomId: string, name?: string, playerId?: string, token?: string): Seated<R> | null;
  get(roomId: string): R | undefined;
  all(): R[];
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
 */
export function seatPlayer(
  space: SeatSpace,
  taken: readonly SeatHolder[],
  name?: string,
): SeatHolder | null {
  const held = new Set(taken.map((p) => p.id));
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
        // The honor-system reclaim (owner ruling, 2026-08-08): same name,
        // same room code takes the seat back — but only a seat nobody is
        // sitting in. A token is still the seamless path; this is for the
        // player whose browser forgot theirs, and it matches the name the
        // way a human retypes it. Rotated token, because the seat changed
        // hands and the old key should die with the handover.
        const given = name?.trim().toLowerCase();
        if (!given) return null;
        const abandoned = room.players.find(
          (p) => !p.connected && p.name.trim().toLowerCase() === given,
        );
        if (!abandoned) return null;
        abandoned.token = randomUUID();
        abandoned.connected = true;
        return { room, player: abandoned };
      }
      const player = seatPlayer(space, room.players, name);
      if (!player) return null; // every seat is taken
      room.players.push(player);
      return { room, player };
    },

    get: (roomId) => rooms.get(roomId),
    all: () => [...rooms.values()],
    adopt(room) { rooms.set(room.id, room); },
  };
}
