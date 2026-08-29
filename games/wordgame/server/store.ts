// server/store.ts
// What a saved room looks like on disk, and nothing else — the mechanics
// (atomic staging, per-room write chains, settled) are @game-host/room-store.
//
// The payload is the committed GameState wholesale, Acquire-style, rather
// than an event log: the engine's state is fully serialisable plain data by
// construction (that is a design rule of this game, because multi-day games
// make persistence a P0), so the state *is* the record.

import {
  createFileStore as createGenericFileStore,
  createNullStore as createGenericNullStore,
  hasEnvelope,
  type RoomStore as GenericRoomStore,
  type SavedRoomEnvelope,
} from '@game-host/room-store/store.js';
import { isGameState, type GameState } from '../engine/gameTypes.js';

export const SAVE_VERSION = 1;

export interface SavedRoom extends SavedRoomEnvelope {
  state: GameState;
}

export type RoomStore = GenericRoomStore<SavedRoom>;

/**
 * Deeper than Acquire's guard (which trusts `state` past "is an object"),
 * shallower than Rail Baron's every-event check: `isGameState` validates the
 * board's length, the players' shape and every tile, which is what a
 * months-old record most plausibly gets wrong after an engine change.
 */
export function isSavedRoom(value: unknown): value is SavedRoom {
  if (!hasEnvelope(value, SAVE_VERSION)) return false;
  return isGameState((value as { state?: unknown }).state);
}

export function createFileStore(dir: string): RoomStore {
  return createGenericFileStore(dir, isSavedRoom);
}

export function createNullStore(): RoomStore {
  return createGenericNullStore<SavedRoom>();
}
