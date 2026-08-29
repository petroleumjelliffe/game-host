// server/rooms.ts
// The registry: the lobby's seating generics wrapped around this game's
// rooms, plus persistence policy. The store says nothing about what a
// record means; everything discretionary — when to save, when to evict,
// what protocol skew costs — is decided here.

import { createLobbyRegistry, type LobbyRegistry, type SeatSpace } from '@game-host/lobby/server/rooms.js';
import type { Dictionary } from '../engine/dictionary.js';
import { MAX_PLAYERS } from '../engine/constants.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { createGameRoom, type GameRoom } from './room.js';
import { SAVE_VERSION, type RoomStore, type SavedRoom } from './store.js';

/** Seat ids are engine player ids, by construction — no mapping layer. */
export const WORDGAME_SEATS: SeatSpace = {
  ids: Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i + 1}`),
};

/**
 * Eviction is two policies, not one, because this game exists for multi-day
 * play: Acquire's 7 days would evict a real game mid-week.
 *
 * - A finished room is a scoreboard; 30 days is plenty, then the code frees.
 * - A live room gets 60 days of nobody moving before it counts as abandoned.
 *
 * Both run at restore (boot is when the directory is read anyway), and a
 * finished game is also removed when its 30 days pass — so "no mid-game
 * eviction surprise" never becomes "grows forever", which is Rail Baron's
 * open problem.
 */
export const FINISHED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const ACTIVE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export interface RoomRegistry extends LobbyRegistry<GameRoom> {
  persist(room: GameRoom): Promise<void>;
  restore(now?: number): Promise<number>;
  settled(): Promise<void>;
}

export function createRoomRegistry(store: RoomStore, dictionary: Dictionary): RoomRegistry {
  const lobby = createLobbyRegistry<GameRoom>(
    (id, players) => createGameRoom(id, players, dictionary),
    WORDGAME_SEATS,
  );
  let restored = false;

  return {
    ...lobby,

    async persist(room: GameRoom): Promise<void> {
      const state = room.state();
      // Drafts don't exist and lobbies aren't worth a file: no game, no record.
      if (state === null) return;
      const record: SavedRoom = {
        roomId: room.id,
        version: SAVE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        savedAt: Date.now(),
        // Copied: `connected` mutates under a live socket.
        players: room.players.map((p) => ({ ...p })),
        state,
      };
      await store.save(record);
    },

    async restore(now = Date.now()): Promise<number> {
      if (restored) {
        throw new Error(
          'restore() is boot-only: calling it on a serving registry would swap '
          + 'live room objects out from under their socket bindings',
        );
      }
      restored = true;
      const { records, unreadable } = await store.loadAll();
      for (const name of unreadable) {
        console.warn(`! Quarantining unreadable save: ${name}`);
        await store.quarantine(name);
      }
      let count = 0;
      for (const record of records) {
        try {
          const maxAge = record.state.stage === 'over' ? FINISHED_MAX_AGE_MS : ACTIVE_MAX_AGE_MS;
          if (now - record.savedAt > maxAge) {
            await store.remove(record.roomId);
            continue;
          }
          // Skew is a skip, not a delete: the record outlives this build's
          // opinion of it, and a rollback gets the room back.
          if (record.protocolVersion !== PROTOCOL_VERSION) continue;
          lobby.adopt(
            createGameRoom(
              record.roomId,
              record.players.map((p) => ({ ...p, connected: false })),
              dictionary,
              record.state,
            ),
          );
          count += 1;
        } catch (error) {
          // One bad record costs one room, never the boot.
          console.warn(`! Could not restore room ${record.roomId}:`, error);
        }
      }
      return count;
    },

    settled: () => store.settled(),
  };
}
