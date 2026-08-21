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

  function persist(room: GameRoom): Promise<void> {
    const record: SavedRoom = {
      roomId: room.id,
      version: RB_SAVE_VERSION,
      protocolVersion: RB_PROTOCOL_VERSION,
      savedAt: Date.now(),
      players: room.players,
      log: room.log,
    };
    // The store queues and tracks its own writes now; `settled` below is
    // what drains them.
    return store.save(record);
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

    // The knowledge of what is in flight lives with the write chains, which
    // are the store's since 2026-08-20 — this stays on the interface because
    // shutdown's contract ("saves before sockets", index.ts) is a rooms
    // concern, wherever the bookkeeping lives.
    settled: () => store.settled(),

    async restore() {
      const { records, unreadable } = await store.loadAll();
      // Quarantined — renamed aside, kept for a human — rather than deleted,
      // and rather than warning at every boot forever, which is what this
      // loop did until 2026-08-20 (and what once buried Acquire's boot log
      // under 23 stale files). `!`, not `✗`: vitest prints `✗` for a failed
      // test, and a boot log carrying the same glyph reads as a test
      // failure to anyone skimming it.
      for (const name of unreadable) {
        console.warn(`! Quarantining unreadable save ${name} as ${name}.bad`);
        await store.quarantine(name);
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
