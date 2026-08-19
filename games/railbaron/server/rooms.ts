// server/rooms.ts
// The game's room: the lobby's seats plus the one thing the game owns — the
// log. Everything else about a room is derived from it, including the
// lifecycle the lobby asks for, using the same fact the app's own phase reads:
// a `started` event is what moves a room out of the lobby.
import { RB_PROTOCOL_VERSION, RB_SAVE_VERSION } from '../session/protocol';
import { SEATS, type GameEvent, type SeatId } from '../src/state/events';
import type { Lifecycle } from '@game-host/lobby/protocol/protocol';
import {
  createLobbyRegistry, type LobbyRegistry, type SeatHolder, type SeatSpace,
} from '@game-host/lobby/server/rooms';
import type { RoomStore, SavedRoom } from './store';

export interface GameRoom {
  id: string;
  players: SeatHolder[];
  log: GameEvent[];
  lifecycle(): Lifecycle;
}

/**
 * The lobby's seat ids ARE the game's colours, so there is no mapping layer
 * anywhere: a lobby `playerId` of 'red' is the `SeatId` 'red'. Capacity is
 * however many seats Rail Baron has.
 */
const SEAT_SPACE: SeatSpace = {
  ids: SEATS,
  defaultName: (index) => `BARON ${index + 1}`,
};

function makeRoom(id: string, players: SeatHolder[], log: GameEvent[] = []): GameRoom {
  // Closed over rather than reached through `this`, so the lobby can hold the
  // method on its own and still get the right answer.
  const room: GameRoom = {
    id,
    players,
    log,
    // 'over' is unreachable: the game has no end rule yet. When the money spec
    // lands one, it will be derived from the log right here, exactly as
    // 'playing' is.
    lifecycle: (): Lifecycle =>
      room.log.some((e) => e.type === 'started') ? 'playing' : 'lobby',
  };
  return room;
}

export interface Rooms {
  registry: LobbyRegistry<GameRoom>;
  /** Begin: seed a `joined` per seat and one `started`, in roster order. */
  seedOnBegin(room: GameRoom): void;
  persist(room: GameRoom): Promise<void>;
  /**
   * Resolves once every save started so far has finished.
   *
   * Handlers deliberately do not await `persist` — a player should not wait on
   * a disk to see their own move — so at any instant there may be a write in
   * flight. Shutdown has to wait for those, or the last move of every game is
   * lost exactly when it matters most: a Render deploy stopping the process
   * mid-turn, which is the case recovery exists for.
   */
  settled(): Promise<void>;
  /** Boot-only, before listen. Returns how many rooms came back. */
  restore(): Promise<number>;
  remove(roomId: string): Promise<void>;
}

export function createRooms(store: RoomStore): Rooms {
  const registry = createLobbyRegistry<GameRoom>(
    (id, players) => makeRoom(id, players),
    SEAT_SPACE,
  );

  /** Saves started but not yet finished. See `settled`. */
  const inFlight = new Set<Promise<void>>();

  function persist(room: GameRoom): Promise<void> {
    const record: SavedRoom = {
      roomId: room.id,
      version: RB_SAVE_VERSION,
      protocolVersion: RB_PROTOCOL_VERSION,
      savedAt: Date.now(),
      players: room.players,
      log: room.log,
    };
    const saving = store.save(record).finally(() => { inFlight.delete(saving); });
    inFlight.add(saving);
    return saving;
  }

  return {
    registry,

    seedOnBegin(room) {
      // Begun already. The lobby checks the lifecycle before calling, and this
      // pins it: seeding twice would put a second `started` in the log and
      // hand every seat a duplicate `joined`.
      if (room.log.length > 0) return;
      for (const p of room.players) {
        // The id is a SeatId by construction — SEAT_SPACE.ids is SEATS — but
        // narrow honestly rather than assert, so a future SeatSpace change
        // cannot smuggle a non-seat into the log.
        const seat = SEATS.find((s) => s === p.id);
        if (seat === undefined) continue;
        room.log.push({ type: 'joined', seat, name: p.name });
      }
      room.log.push({ type: 'started' });
    },

    persist,

    async settled() {
      // Looped, not a single Promise.all: awaiting one batch yields to the
      // event loop, and a handler that ran in the meantime may have started
      // another save.
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },

    async restore() {
      const { records, skipped } = await store.loadAll();
      for (const name of skipped) {
        console.warn(`✗ Skipped unreadable or stale save: ${name}`);
      }
      for (const r of records) {
        // Every restored seat starts disconnected: the sockets that held them
        // died with the old process, and presence is re-established by the
        // rejoins that follow.
        const room = makeRoom(
          r.roomId,
          r.players.map((p) => ({ ...p, connected: false })),
          r.log,
        );
        registry.adopt(room);
      }
      return records.length;
    },

    remove: (roomId) => store.remove(roomId),
  };
}
