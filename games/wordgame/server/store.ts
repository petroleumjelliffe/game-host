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
import type { PendingSeat } from '@game-host/lobby/server/rooms.js';
import { isGameState, type GameState } from '../engine/gameTypes.js';

export const SAVE_VERSION = 1;

export interface SavedRoom extends SavedRoomEnvelope {
  /**
   * Absent while the room is still a lobby: seats are worth a file the moment
   * a shared link has been handed out (a deploy must not eat the room), but
   * there is no game yet to record. Present from `begin` onward.
   */
  state?: GameState;
  /**
   * Reserved seats, present only while some exist — which means only in a
   * lobby record, since begin clears them. Optional and additive, so every
   * pre-invite save loads untouched and SAVE_VERSION stays 1.
   */
  pending?: PendingSeat[];
}

function isPendingSeat(value: unknown): value is PendingSeat {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string'
    && typeof p.tokenHash === 'string'
    && (p.name === null || typeof p.name === 'string')
    && typeof p.invitedAt === 'number'
  );
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
  const state = (value as { state?: unknown }).state;
  if (state !== undefined && !isGameState(state)) return false;
  const pending = (value as { pending?: unknown }).pending;
  return pending === undefined || (Array.isArray(pending) && pending.every(isPendingSeat));
}

export function createFileStore(dir: string): RoomStore {
  return createGenericFileStore(dir, isSavedRoom);
}

export function createNullStore(): RoomStore {
  return createGenericNullStore<SavedRoom>();
}
