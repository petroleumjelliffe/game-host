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
 * The one place both `create` and `join` seat somebody, and therefore the only
 * place that can name an unnamed player: the seat number is what the default
 * is made of, and the client does not know its seat until this has run.
 *
 * Nobody types a name before entering a room as of the Lobby Flow corrections
 * — both cards seat you first and let you edit your own row afterwards — so
 * an absent name is the ordinary case, not a malformed payload. A blank or
 * whitespace-only name is treated as absent rather than seating a nameless
 * row that no roster could render.
 */
export function seatPlayer(seat: number, name?: string): SeatHolder {
  const given = name?.trim();
  return {
    id: `p${seat + 1}`,
    name: given ? given : `Player ${seat + 1}`,
    token: randomUUID(),
    isHost: seat === 0,
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

      const host = seatPlayer(0, hostName);
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
      const player = seatPlayer(room.players.length, name);
      room.players.push(player);
      return { room, player };
    },

    get: (roomId) => rooms.get(roomId),
    all: () => [...rooms.values()],
    adopt(room) { rooms.set(room.id, room); },
  };
}
