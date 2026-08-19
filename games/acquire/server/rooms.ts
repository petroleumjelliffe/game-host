import type { GameState } from '../engine/gameTypes.js';
import { createGameRoom, type GameRoom, type RoomPlayer } from './room.js';
import { createNullStore, SAVE_VERSION, type RoomStore, type SavedRoom } from './store.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { createLobbyRegistry, seatPlayer, type SeatHolder } from '../vendor/lobby/server/rooms.js';
import { MAX_PLAYERS } from '../engine/startups.js';

/**
 * `p1`…`p6`, and the strings matter: `store.ts` persists rosters and
 * `restore()` seats them at boot, so changing them would orphan every saved
 * room. This change was to *how* a seat is chosen, never to what it is called.
 *
 * Sized by the game's own rule rather than by `PLAYER_EMOJI.length` — the
 * emoji are decoration and are meant to grow.
 */
const ACQUIRE_SEATS = {
  ids: Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i + 1}`),
};

export interface Seat {
  room: GameRoom;
  player: RoomPlayer;
}

export interface RoomRegistry {
  /** Names are optional: an unnamed seat is named by its number. */
  create(hostName?: string): Seat;
  join(roomId: string, name?: string, playerId?: string, token?: string): Seat | null;
  get(roomId: string): GameRoom | undefined;
  /** Seats a prepared state directly. Tests use this; no socket event reaches it. */
  fromState(roomId: string, names: string[], state: GameState): GameRoom;
  all(): GameRoom[];
  persist(room: GameRoom): Promise<void>;
  /**
   * Seats every saved room this store still holds. Returns how many.
   *
   * `now` is injectable so the age policy can be tested without waiting a
   * week; the server never passes it.
   *
   * Boot-only, and enforced: a second call throws. `rooms.set` here is
   * unconditional — it replaces whatever is already in the registry for a
   * given id with no check that nothing is live there — which is safe only
   * because the one production caller (`server/index.ts`) runs this before
   * `listen`, while no socket has bound to anything yet. Called again once
   * the server is serving traffic, it would silently swap a room's object
   * out from under socket bindings that still point at the old one; a loud
   * throw at the call site beats that being discovered from a dead game.
   */
  restore(now?: number): Promise<number>;
}

/**
 * How long a saved room is worth reviving.
 *
 * Long enough that a game abandoned over a weekend is still there on Monday;
 * short enough that the directory does not grow without bound and `restore`
 * does not delay `listen` behind a boot-time read of every game ever played.
 */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createRoomRegistry(store: RoomStore = createNullStore()): RoomRegistry {
  const lobby = createLobbyRegistry<GameRoom>(
    (id, players) => createGameRoom(id, players),
    ACQUIRE_SEATS,
  );
  let restored = false;

  return {
    create: (hostName) => lobby.create(hostName),

    join: (roomId, name, playerId, token) => lobby.join(roomId, name, playerId, token),

    get: (roomId) => lobby.get(roomId),

    fromState(roomId, names, state) {
      // Seated cumulatively, because each seat is chosen against the ones
      // already taken rather than from an index.
      const players: SeatHolder[] = [];
      for (const name of names) {
        const seated = seatPlayer(ACQUIRE_SEATS, players, name);
        if (!seated) {
          throw new Error(
            `dev seed asked for ${names.length} seats; the space holds ${ACQUIRE_SEATS.ids.length}`,
          );
        }
        players.push(seated);
      }
      const room = createGameRoom(roomId, players, state);
      lobby.adopt(room);
      return room;
    },

    all: () => lobby.all(),

    async persist(room) {
      // `committed()` throws before a game begins, so the lifecycle check is
      // load-bearing rather than an optimisation. Drafts are never written:
      // uncommitted work was never real, which is the segment model stated as
      // a storage fact.
      if (room.lifecycle() === 'lobby') return;
      const record: SavedRoom = {
        roomId: room.id,
        version: SAVE_VERSION,
        // The wire this state was written by. A room now outlives a deploy,
        // so a record from an older server is the same skew a stale socket
        // brings, arriving from storage — `restore` checks it below.
        protocolVersion: PROTOCOL_VERSION,
        savedAt: Date.now(),
        // Copied, not referenced: `connected` mutates under a live socket and
        // a record is a snapshot. The value written is irrelevant — `restore`
        // forces every seat disconnected — but a record that keeps changing
        // after it was handed over is a trap for the next reader.
        players: room.players.map((p) => ({ ...p })),
        state: room.committed(),
        // So a client resuming a restored room still sees the previous turn
        // in its step stack, rather than a blank until the next commit.
        previousSegmentStart: room.previousSegmentStart(),
      };
      await store.save(record);
    },

    async restore(now = Date.now()) {
      if (restored) {
        throw new Error(
          'restore() is boot-only: calling it on a serving registry would swap ' +
            'live room objects out from under their socket bindings',
        );
      }
      restored = true;

      // `loadAll` only ever looks at `*.json`, so a `.tmp` file orphaned by a
      // crash between `writeFile` and `rename` (see the temp-name comment in
      // `store.ts`) is invisible here — it is not read, not restored, and not
      // cleaned up. That is a leftover file on disk, not a restore bug; if it
      // ever needs reclaiming, boot is the natural place, but no sweep exists
      // yet and this task does not add one.
      const { records: saved, unreadable } = await store.loadAll();

      // The decision Phase 4 deferred, made here where policy lives: a file
      // that cannot be parsed is quarantined — renamed aside, kept for a
      // human — rather than deleted, and rather than warning at every boot
      // forever, which is what 23 stale files were doing.
      for (const name of unreadable) {
        console.warn(`! Quarantining unreadable save ${name} as ${name}.bad`);
        await store.quarantine(name);
      }

      let seated = 0;

      for (const record of saved) {
        if (now - record.savedAt > MAX_AGE_MS) {
          await store.remove(record.roomId);
          continue;
        }

        // A record written by a different wire is the same skew a stale
        // socket brings, arriving from storage. Skipped rather than deleted:
        // the file is not damaged, merely untrusted, and eviction will clear
        // it by age if no matching server ever comes back for it.
        if (record.protocolVersion !== PROTOCOL_VERSION) {
          console.warn(
            `! Not restoring ${record.roomId}: written by protocol ` +
              `${record.protocolVersion}, this server speaks ${PROTOCOL_VERSION}`,
          );
          continue;
        }

        try {
          // Never `connected: true`, whatever the record says. A record is a
          // snapshot of a moment when sockets were open; this process has
          // none. The roster broadcast that follows each rejoin is what turns
          // these back on, one seat at a time.
          const players = record.players.map((p) => ({ ...p, connected: false }));
          lobby.adopt(
            createGameRoom(record.roomId, players, record.state, record.previousSegmentStart),
          );
          seated++;
        } catch (e) {
          // `isSavedRoom` only checks that `state` is *an object* — it trusts
          // the shape past that, on the theory that it came from this
          // server's own engine. A record that parses and passes that guard
          // but carries a `state` the engine cannot actually drive (a stale
          // shape from before the next `GameState` change, disk corruption
          // that survived JSON.parse) throws inside `createGameRoom`. One bad
          // record must cost one room, not the boot: this matches `loadAll`'s
          // own posture of warning and skipping rather than letting a single
          // rotten file take the rest down with it.
          console.warn(`! Could not restore room ${record.roomId}, skipping:`, e);
        }
      }

      return seated;
    },
  };
}
