import { isGameEvent, type GameEvent } from './events';

/** Prefixed: this game shares the GitHub Pages origin with Acquire. */
export const STORAGE_KEY = 'railbaron:log:v1';

/**
 * 2 adds `savedAt`. Version 1 records are migrated rather than discarded —
 * the saved-game screen exists to protect the game inside them, and bouncing
 * the version would throw away exactly what it is there to offer back.
 */
export const SAVE_VERSION = 2;

export interface SavedGame {
  events: GameEvent[];
  /** null for a version 1 record, whose age was never written down. */
  savedAt: number | null;
}

const EMPTY: SavedGame = { events: [], savedAt: null };

export function saveLog(events: readonly GameEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), events })
    );
  } catch {
    // A full or disabled store loses the save, not the game in progress.
  }
}

export function loadLog(): SavedGame {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;

    const { version, events, savedAt } =
      parsed as { version?: number; events?: unknown; savedAt?: unknown };
    if (!Array.isArray(events)) return EMPTY;
    if (version !== 1 && version !== SAVE_VERSION) return EMPTY;

    // All-or-nothing, and it applies to migrated records too: age is the
    // only thing version 1 is trusted about. A log with one bad event and
    // the rest filtered out would replay into a state that never existed
    // (a seat arriving somewhere it never departed from). An empty board is
    // an honest failure; a silently-repaired one isn't.
    if (!events.every(isGameEvent)) return EMPTY;

    return {
      events,
      savedAt: version === 1 || typeof savedAt !== 'number' ? null : savedAt
    };
  } catch {
    return EMPTY;
  }
}

export function clearLog(): void {
  localStorage.removeItem(STORAGE_KEY);
}
