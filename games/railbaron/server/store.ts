// server/store.ts
// Where a room lives between processes — Rail Baron's half of the contract.
//
// The mechanics (atomic temp-and-rename staging, per-room write chains,
// settled(), quarantine) moved to @game-host/room-store on 2026-08-20,
// merged with Acquire's copy — see docs/plans/2026-08-20-room-store.md. The
// merge is also a fix: this file used to stage every same-room write
// through one shared `.tmp` name, the exact collision Acquire's store had
// already dissected and solved with per-write names. What stays here is
// exactly what is Rail Baron's: the record's payload, the version that
// names its format, and the guard that checks both.

import {
  createFileStore as createStore,
  hasEnvelope,
  type RoomStore as Store,
  type SavedRoomEnvelope,
} from '@game-host/room-store/store.js';
import { RB_SAVE_VERSION } from '../session/protocol';
import { isGameEvent, type GameEvent } from '../src/state/events';

export interface SavedRoom extends SavedRoomEnvelope {
  log: GameEvent[];
}

export type RoomStore = Store<SavedRoom>;

/**
 * The envelope, plus the log — event by event. Deeper than Acquire goes
 * with its `state`, on purpose: `isGameEvent` already exists and is cheap,
 * and a log is data that outlives whatever wrote it — a deploy that changes
 * an event shape will meet records written by the old one. A record whose
 * log fails is handed back in `unreadable`, named. Never a boot crash, and
 * never a room that quietly replays to an empty board because `replay`
 * ignored events it did not recognise.
 */
export function isSavedRoom(value: unknown): value is SavedRoom {
  const r = value as Record<string, unknown>;
  return hasEnvelope(value, RB_SAVE_VERSION)
    && Array.isArray(r.log) && r.log.every(isGameEvent);
}

export function createFileStore(dir: string): RoomStore {
  return createStore(dir, isSavedRoom);
}
