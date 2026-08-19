// src/game/local/localSave.ts
// The one active local game this device holds.
//
// `src/`, not `session/`, and the placement is load-bearing: this file touches
// `localStorage`, which does not exist in the server process where `session/`
// runs. `session/nodeEnvironment.test.ts` is the tripwire for getting this
// wrong.
//
// The conventions are `src/net/identity.ts`'s, on purpose — same guarded
// read/write (Safari private mode throws on the storage calls themselves;
// contents are user-editable text that has outlived whatever wrote it), same
// key prefix, same posture: a browser that refuses storage plays fine, it
// just cannot resume after a refresh. Not shared code: identity is three
// strings, this is a `GameState`, and an abstraction over two three-function
// modules would be bigger than both.

import type { GameState } from '../../../engine/gameTypes';

const KEY = 'acquire.local.game';

/**
 * Bumped by hand when `SavedLocalGame`'s shape changes — and, like the
 * server's `SAVE_VERSION` and the wire's `PROTOCOL_VERSION`, it therefore
 * does not catch a `GameState` change that lands without a bump. The `state`
 * is trusted past "is an object" for the same reason `isSavedRoom` trusts
 * it: re-validating a whole `GameState` here would be a second copy of the
 * engine's types that could drift from the first.
 *
 * Deliberately not the server's `SAVE_VERSION`: they version different
 * records (a `SavedRoom` carries a roster and rejoin tokens this save has no
 * use for), and importing `server/store.ts` into `src/` is the wrong
 * direction on the one boundary this repo polices.
 */
export const LOCAL_SAVE_VERSION = 1;

export interface SavedLocalGame {
  version: number;
  /** Epoch ms. The Continue card's "Last played" reads this. */
  savedAt: number;
  /** Committed only — a segment close, or the end of the game. */
  state: GameState;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Never throws: a commit lost to a refused write costs the resume, not the game. */
export function save(state: GameState): void {
  const record: SavedLocalGame = { version: LOCAL_SAVE_VERSION, savedAt: Date.now(), state };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage refused (private mode, quota). The game in memory is untouched.
  }
}

/** The saved game, or null on absence, parse failure, or version mismatch. */
export function load(): SavedLocalGame | null {
  const raw = read();
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    if (
      r.version !== LOCAL_SAVE_VERSION ||
      typeof r.savedAt !== 'number' ||
      typeof r.state !== 'object' ||
      r.state === null
    ) {
      return null;
    }
    return { version: r.version, savedAt: r.savedAt, state: r.state as GameState };
  } catch {
    return null;
  }
}

/**
 * Whether a save exists that `load()` refused.
 *
 * The lobby uses this to *say so* — the failure mode being designed out is a
 * save that quietly vanished, indistinguishable from never having existed.
 * The bytes are deliberately kept until `New Game` overwrites them: reading a
 * save you could not use must never delete it.
 */
export function loadFailure(): 'stale' | null {
  if (read() === null) return null;
  return load() === null ? 'stale' : null;
}

/** Only two callers may exist: End game, and New Game's confirmed discard. */
export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See `save`.
  }
}
