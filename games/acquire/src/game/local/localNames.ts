// src/game/local/localNames.ts
// The names this device last started a pass-and-play game with.
//
// Same conventions as `localSave.ts` beside it, for the same reasons: guarded
// read/write (Safari private mode throws on the storage calls; the contents
// are user-editable text), same key prefix, and a browser that refuses
// storage still plays fine — it just types the names again next game.
//
// Deliberately not `src/net/identity.ts`'s remembered name: that is one name
// — who *you* are, on your own device, online. This is the whole table, and
// merging the two would make renaming yourself online rewrite seat one of a
// shared device's roster.

const KEY = 'acquire.local.names';

/** Never throws: a refused write costs the prefill, not the game. */
export function saveNames(names: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    // Storage refused (private mode, quota). Nothing to do.
  }
}

/**
 * The last roster, or null on absence or anything malformed — a partial
 * prefill (some seats real, some invented) would be worse than none.
 */
export function loadNames(): string[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    if (!parsed.every((n): n is string => typeof n === 'string' && n.trim().length > 0)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
