// packages/notify/jsonStore.ts
// One JSON file per key, atomically staged. The write mechanics — unique
// temp name, rename, per-key promise chain, looped settled() — are carried
// over from packages/room-store/store.ts, where each carries the analysis
// of why it is shaped that way. This is the "second consumer" the room-store
// plan declined to guess about: its records are keyed by profile and by
// room-binding, not by `roomId`, and carry none of the room envelope, which
// is why this is a sibling rather than a widening of that store's contract.
//
// Same posture as the room store: the store says nothing about what a record
// means, a failed save logs once and never rejects (a notification profile
// that fails to persist must not take a turn handler down with it), and an
// unreadable file is reported by name for the caller to decide about.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface KeyedJsonStore<R> {
  /** Queued per key; the returned promise settles when *this* write lands. Never rejects. */
  save(key: string, record: R): Promise<void>;
  loadAll(): Promise<{ records: R[]; unreadable: string[] }>;
  remove(key: string): Promise<void>;
  /** Resolves when every save issued so far (and any queued behind them) has landed. */
  settled(): Promise<void>;
}

/**
 * Keys become filenames, so the alphabet is closed: hex digests and
 * `game--ROOMID` compounds both fit, and nothing a client typed ever
 * reaches this function unhashed or unvalidated.
 */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,200}$/;

let tempSeq = 0;

export function createKeyedJsonStore<R>(
  dir: string,
  isRecord: (value: unknown) => value is R,
): KeyedJsonStore<R> {
  const fileFor = (key: string): string => {
    if (!SAFE_KEY.test(key)) throw new Error(`Unsafe store key: ${JSON.stringify(key)}`);
    return join(dir, `${key}.json`);
  };

  const chains = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();

  async function writeRecord(key: string, record: R): Promise<void> {
    try {
      // Inside the try, deliberately: a key that fails validation must land
      // in the same log-and-swallow path as a failed write. Thrown here it
      // would reject the chain promise this write sits on, and every later
      // save for the key would chain onto a rejection and silently no-op.
      const target = fileFor(key);
      await mkdir(dir, { recursive: true });
      // Unique per write (pid + process-wide counter): two stores in one
      // process and two processes sharing a directory both stay isolated.
      const temp = `${target}.${process.pid}.${tempSeq++}.tmp`;
      await writeFile(temp, JSON.stringify(record, null, 2));
      await rename(temp, target);
    } catch (error) {
      console.error(`! Could not save ${key}:`, error);
    }
  }

  return {
    save(key, record) {
      const queued = (chains.get(key) ?? Promise.resolve()).then(() => writeRecord(key, record));
      chains.set(key, queued);
      const tracked: Promise<void> = queued.finally(() => {
        inFlight.delete(tracked);
      });
      inFlight.add(tracked);
      return queued;
    },

    async loadAll() {
      const records: R[] = [];
      const unreadable: string[] = [];
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return { records, unreadable }; // no directory yet: nothing saved yet
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'));
          if (isRecord(parsed)) records.push(parsed);
          else unreadable.push(name);
        } catch {
          unreadable.push(name);
        }
      }
      return { records, unreadable };
    },

    async remove(key) {
      try {
        await rm(fileFor(key), { force: true });
      } catch (error) {
        console.error(`! Could not remove ${key}:`, error);
      }
    },

    async settled() {
      // Loop, not one batch: awaiting a batch yields, and a handler may
      // start another save meanwhile.
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}
