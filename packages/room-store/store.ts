// Where a room lives between processes — the mechanics, shared.
//
// Until 2026-08-20 this file existed twice, 111 lines in Rail Baron and 262
// in Acquire, each carrying a hard-won behaviour the other lacked: Acquire
// chained same-room writes and staged each through its own temp name, but
// never drained the chains at shutdown; Rail Baron drained (`settled`) but
// staged every same-room write through one shared temp name — the exact
// collision Acquire's comment dissects. This package is the union. See
// docs/plans/2026-08-20-room-store.md for the survey.
//
// Storage mechanics only, and the store decides nothing and *says* nothing:
// what a record means, how old is too old, and what to tell the boot log
// about a file it could not read are the game registry's business — both
// existing registries already keep one warn line per file, and the store
// keeping a second was the one redundancy the merge removed. The single
// exception is a failed save, logged here because nobody else can: handlers
// save fire-and-forget, so no caller is waiting on the rejection.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeatHolder } from '@game-host/lobby/server/rooms.js';

/**
 * What every game's record shares, whatever its payload. Rail Baron persists
 * a `log` of events and Acquire a committed `state`; both wrap it in exactly
 * this envelope, down to the player type — Acquire's `RoomPlayer` was
 * already an alias of the lobby's `SeatHolder`.
 */
export interface SavedRoomEnvelope {
  roomId: string;
  /** The game's own SAVE_VERSION. The store never interprets it. */
  version: number;
  /**
   * The wire that wrote it. A room outlives a deploy, so a record written
   * by an older server is the same version skew a stale socket brings,
   * arriving from storage. The *policy* is the registry's; the store hands
   * back anything the guard accepts and decides nothing.
   */
  protocolVersion: number;
  /** Epoch ms. Eviction policy reads this; the store does not. */
  savedAt: number;
  /** Including `token`, which is the whole reason a restored room is rejoinable. */
  players: SeatHolder[];
}

/** What a load found: the records it could parse, and the files it could not. */
export interface LoadResult<R> {
  records: R[];
  /** Filenames, not room ids — an unreadable file's room id is unknowable. */
  unreadable: string[];
}

export interface RoomStore<R extends SavedRoomEnvelope> {
  /** Queued per room; the returned promise settles when *this* write lands. */
  save(record: R): Promise<void>;
  loadAll(): Promise<LoadResult<R>>;
  remove(roomId: string): Promise<void>;
  /**
   * Sets a file this store could not read aside, out of the load path.
   *
   * A rename, deliberately not an unlink: deleting a file you could not
   * parse is destructive, and Acquire's Phase 4 carry-forward ruled it
   * deserves a decision rather than a reflex. The rename preserves the
   * bytes for a human and stops the file warning at every boot forever.
   * Whether to call it is the registry's decision; this is only the
   * mechanics.
   */
  quarantine(name: string): Promise<void>;
  /**
   * Resolves when no save is in flight.
   *
   * Handlers deliberately do not await `save` — a player should not wait on
   * a disk to see their own move — so at any instant there may be a write
   * in flight. Shutdown has to wait for those, or the last move of every
   * game is lost exactly when it matters most: a deploy stopping the
   * process mid-turn, which is the case recovery exists for.
   */
  settled(): Promise<void>;
}

export function isSeatHolder(value: unknown): value is SeatHolder {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.token === 'string' && typeof p.isHost === 'boolean'
    && typeof p.connected === 'boolean';
}

/**
 * The shared half of every game's record guard: the envelope, at the
 * caller's own save version. Each game's `isSavedRoom` is this plus its
 * payload — which is exactly the split in the record type itself.
 */
export function hasEnvelope(value: unknown, version: number): value is SavedRoomEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.roomId === 'string'
    && r.version === version
    && typeof r.protocolVersion === 'number'
    && typeof r.savedAt === 'number'
    && Array.isArray(r.players) && r.players.every(isSeatHolder);
}

/**
 * Process-wide, not per-store: two `createFileStore` instances in one
 * process (as tests build repeatedly) must still never hand out the same
 * temp name. Paired with `process.pid` so two *processes* sharing a
 * directory — the ordinary case for a redeploy overlapping the process it
 * replaces — can't collide either.
 */
let tempSeq = 0;

export function createFileStore<R extends SavedRoomEnvelope>(
  dir: string,
  /**
   * The game's whole-record guard. Field-level is the intended depth: a
   * file on disk is text that has outlived whatever wrote it, so the shape
   * is checked before anything dereferences it — but how far past the
   * envelope to look (Rail Baron re-validates every log event; Acquire
   * trusts its own engine's `state` past "is an object") is the game's
   * call, made where the payload is defined.
   */
  isRecord: (value: unknown) => value is R,
): RoomStore<R> {
  const file = (roomId: string) => join(dir, `${roomId}.json`);

  /**
   * One promise per room, so two commits landing in the same tick queue
   * rather than race. "Two writes in flight for one room" is the ordinary
   * case, not an edge one — and the loser of that race is the *newer*
   * state.
   *
   * This chain is what makes the two writes apply in order at all — but
   * order alone isn't enough to make the *outcome* right; see the temp-name
   * comment below for the other half of that.
   */
  const chains = new Map<string, Promise<void>>();

  /** Saves started but not yet finished. See `settled`. */
  const inFlight = new Set<Promise<void>>();

  async function writeRecord(record: R): Promise<void> {
    const target = file(record.roomId);
    // `.tmp` then rename: `rename` is atomic on POSIX, so a crash mid-write
    // leaves either the old record or the new one, never half of either.
    // Truncated JSON is exactly what a restart-recovery feature must not
    // produce for itself.
    //
    // The name is unique per *write*, not per room: a temp file is private
    // staging, and two writes for the same room sharing one temp name is a
    // second collision hazard on top of the ordering the promise chain
    // above already guards. Without this, two same-room writes racing past
    // the chain (a bug in the chain, a future caller that bypasses `save`,
    // a save issued before the chain existed) can still destroy each other:
    // the second write's `writeFile` overwrites the first's in-flight temp
    // file before the first has renamed it away, so the first's later
    // `rename` either moves the *second* write's content under the first's
    // stale promise, or — if the first renames first — throws ENOENT once
    // the temp file it expected is already gone. A unique name means the
    // two are ordered *and* isolated: whichever `rename` runs last is
    // simply the one that wins, which is exactly what "last write wins" is
    // supposed to mean. (Rail Baron shipped the shared-name version of
    // this for its whole standalone life; the merge is what fixed it.)
    const temp = `${target}.${process.pid}.${tempSeq++}.tmp`;
    try {
      // `recursive: true` makes this idempotent, so there is no boot-time
      // setup step left to forget.
      await mkdir(dir, { recursive: true });
      await writeFile(temp, JSON.stringify(record), 'utf-8');
      await rename(temp, target);
    } catch (e) {
      // Never rejects — a failed save loses the record, not the live room,
      // and the game in memory carries on. Logged here because handlers
      // save fire-and-forget: no caller is waiting to hear about it.
      console.error(`! Could not save room ${record.roomId}:`, e);
    }
  }

  return {
    save(record) {
      const queued = (chains.get(record.roomId) ?? Promise.resolve())
        .then(() => writeRecord(record));
      chains.set(record.roomId, queued);
      const tracked: Promise<void> = queued.finally(() => { inFlight.delete(tracked); });
      inFlight.add(tracked);
      return queued;
    },

    async loadAll() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        // No directory yet is the ordinary first-boot case, not a fault.
        return { records: [], unreadable: [] };
      }

      const records: R[] = [];
      const unreadable: string[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf-8'));
          if (isRecord(parsed)) records.push(parsed);
          else unreadable.push(name);
        } catch {
          unreadable.push(name);
        }
      }
      return { records, unreadable };
    },

    async remove(roomId) {
      try {
        await unlink(file(roomId));
      } catch {
        // Already gone is the outcome asked for.
      }
    },

    async quarantine(name) {
      try {
        await rename(join(dir, name), join(dir, `${name}.bad`));
      } catch {
        // Already quarantined by a sibling process, or removed by hand in
        // the window since it was listed. Either way it is out of the load
        // path, which is all this promises.
      }
    },

    async settled() {
      // Looped, not a single Promise.all: awaiting one batch yields to the
      // event loop, and a handler that ran in the meantime may have started
      // another save.
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}

/**
 * Holds nothing, forgets everything, never fails.
 *
 * The registry default, so every caller that does not care about durability
 * — and every test that does not — keeps working without a store to hand it.
 */
export function createNullStore<R extends SavedRoomEnvelope>(): RoomStore<R> {
  return {
    save: async () => {},
    loadAll: async () => ({ records: [], unreadable: [] }),
    remove: async () => {},
    quarantine: async () => {},
    settled: async () => {},
  };
}
