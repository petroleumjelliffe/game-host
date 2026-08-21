/**
 * Who this browser is, per room.
 *
 * The token is what makes a refresh a rejoin instead of a new seat: the server
 * issues it once at first join and checks it against the seat's own copy, so
 * presenting someone else's `playerId` without their token gets nothing.
 */
export interface RoomIdentity {
  playerId: string;
  token: string;
  name: string;
}

export interface IdentityStore {
  loadIdentity: (roomId: string) => RoomIdentity | null;
  saveIdentity: (roomId: string, identity: RoomIdentity) => void;
  clearIdentity: (roomId: string) => void;
  rememberedName: () => string | null;
  rememberName: (name: string) => void;
}

/**
 * The remembered name is one key for every game on the origin, not one per
 * app (2026-08-20, task 4 of the lobby pass). Three games, one machine, one
 * evening, one person: a name typed into Rail Baron should not leave its
 * owner anonymous in Acquire. The split was an artifact of three separate
 * repos that no longer exist.
 *
 * Only the name is shared. The *room* namespace stays derived from `appId`
 * below, deliberately: room codes collide across games on purpose (six
 * characters, three generators), and merging that namespace would hand one
 * game another game's seat token — or, in the milder framing Acquire's
 * wrapper recorded, "changing it logs every player out of every room."
 */
const SHARED_NAME_KEY = 'lobby.name';

export function createIdentityStore(appId: string): IdentityStore {
  const roomKey = (roomId: string) => `${appId}.room.${roomId}`;

  /**
   * Where the name lived until 2026-08-20. Read as a fallback forever, never
   * written again: everyone who has played holds a name under this key, no
   * test reaches a real player's browser to prove them migrated, and the
   * cost of keeping the fallback is four lines against a player losing
   * their name with no way to know why.
   */
  const LEGACY_NAME_KEY = `${appId}.name`;

  /**
   * Every read is guarded twice: `localStorage` itself throws in Safari's
   * private mode, and its contents are user-editable text that has outlived
   * whatever wrote it. A room screen that throws on mount cannot even offer to
   * start over.
   */
  function read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A browser that will not store this still plays fine; it just cannot
      // rejoin after a refresh.
    }
  }

  function loadIdentity(roomId: string): RoomIdentity | null {
    const raw = read(roomKey(roomId));
    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { playerId, token, name } = parsed as Record<string, unknown>;
      if (typeof playerId !== 'string' || typeof token !== 'string' || typeof name !== 'string') {
        return null;
      }
      return { playerId, token, name };
    } catch {
      return null;
    }
  }

  function saveIdentity(roomId: string, identity: RoomIdentity): void {
    write(roomKey(roomId), JSON.stringify(identity));
  }

  function clearIdentity(roomId: string): void {
    try {
      localStorage.removeItem(roomKey(roomId));
    } catch {
      // See `write`.
    }
  }

  /**
   * Something a person could have meant as a name: at least one letter or digit,
   * in any script. Emoji are neither, and neither is punctuation.
   */
  const HAS_A_NAME_IN_IT = /[\p{L}\p{N}]/u;

  /**
   * The reuse rule: something a person chose, or null for "let the server
   * name me".
   *
   * Null for a name made only of emoji, which is a migration rather than a
   * rule. Until 2026-08-07 a new player's name *was* an emoji — the deleted
   * `getRandomEmojiName()` generated one and stored it — so everybody who
   * had already played held one, beside the seat's own emoji chip. Nobody
   * chose it, so it is not carried forward.
   *
   * A player who genuinely wants an emoji name types it into their own row
   * and pays for it once: `rememberName` still stores whatever it is given,
   * and the room shows what the roster says. Only the *reuse* of an
   * unchosen one stops.
   */
  function asChosenName(name: string): string | null {
    if (name.trim() === '') return null;
    return HAS_A_NAME_IN_IT.test(name) ? name : null;
  }

  /** The name to reuse in the next room — any game's next room. */
  function rememberedName(): string | null {
    const shared = read(SHARED_NAME_KEY);
    // Present is authoritative, even when the rule maps it to null: an
    // emoji-only name under the shared key was typed *this* era, and falling
    // back would resurrect an older name its owner already replaced.
    if (shared !== null) return asChosenName(shared);

    // The migration: read the old per-game key, write the shared one
    // forward. An unchosen emoji name is not carried — the same judgement
    // `asChosenName` documents — so the legacy key keeps it and nothing
    // propagates.
    const legacy = read(LEGACY_NAME_KEY);
    const name = legacy === null ? null : asChosenName(legacy);
    if (name !== null) write(SHARED_NAME_KEY, name);
    return name;
  }

  function rememberName(name: string): void {
    write(SHARED_NAME_KEY, name);
  }

  return {
    loadIdentity,
    saveIdentity,
    clearIdentity,
    rememberedName,
    rememberName,
  };
}
