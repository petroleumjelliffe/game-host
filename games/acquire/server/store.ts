// server/store.ts
// Where a room lives between processes — Acquire's half of the contract.
//
// The mechanics (atomic temp-and-rename staging, per-room write chains,
// settled(), quarantine) moved to @game-host/room-store on 2026-08-20,
// merged with Rail Baron's copy — see docs/plans/2026-08-20-room-store.md.
// What stays here is exactly what is Acquire's: the record's payload, the
// version that names its format, and the guard that checks both.

import {
  createFileStore as createStore,
  createNullStore as createEmptyStore,
  hasEnvelope,
  type RoomStore as Store,
  type SavedRoomEnvelope,
} from '@game-host/room-store/store.js';
import type { GameState } from '../engine/gameTypes.js';

/**
 * Bumped to 5 for Stage 1: a record now carries `protocolVersion` and
 * `previousSegmentStart`. Neither can be invented for an older file — one is
 * unknowable and the other was never recorded — so a version-4 file is not
 * upgradable, only discardable, exactly as version 3 was before it.
 *
 * This is the *record format*, not the wire. The two move independently: a
 * change to how a room is stored need not touch the protocol, and a protocol
 * bump does not necessarily change the file's shape.
 */
export const SAVE_VERSION = 5;

export interface SavedRoom extends SavedRoomEnvelope {
  /** Committed only. A draft is never written — it was never real. */
  state: GameState;
  /**
   * Where the segment before the open one began, if one has closed.
   *
   * Genuinely absent until a first segment closes, so `undefined` is a real
   * value here rather than a missing field. Without it a client resuming a
   * restored room gets a blank previous turn in the step stack.
   */
  previousSegmentStart?: number;
}

export type RoomStore = Store<SavedRoom>;

/**
 * The envelope, plus Acquire's payload — and deliberately not deeper.
 *
 * The `state` is trusted past "is an object": it came from this server's
 * own engine, and re-validating a whole `GameState` here would be a second
 * copy of the engine's types that could drift from the first.
 *
 * Neither `SAVE_VERSION` nor `protocolVersion` closes that hole. Both are
 * bumped by hand, so a `GameState` change that lands without one is still
 * uncaught here and surfaces as a throw inside `createGameRoom` — which is
 * why `restore` treats one bad record as costing one room, never the boot.
 * Phase 4's boot-fragility bug came through exactly this gap.
 */
export function isSavedRoom(value: unknown): value is SavedRoom {
  if (!hasEnvelope(value, SAVE_VERSION)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.state === 'object' &&
    r.state !== null &&
    // Optional, but not any shape: absent is a record from before the first
    // segment closed, a number is a real position, and anything else is a
    // file that has been edited.
    (r.previousSegmentStart === undefined || typeof r.previousSegmentStart === 'number')
  );
}

export function createFileStore(dir: string): RoomStore {
  return createStore(dir, isSavedRoom);
}

/** The registry default: holds nothing, forgets everything, never fails. */
export function createNullStore(): RoomStore {
  return createEmptyStore();
}
