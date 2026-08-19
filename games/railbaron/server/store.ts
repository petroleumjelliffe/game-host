// server/store.ts
// Where a room lives between processes. Storage mechanics only — nothing here
// knows what a legal game is, just what a well-formed record looks like.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RB_SAVE_VERSION } from '../session/protocol';
import { isGameEvent, type GameEvent } from '../src/state/events';
import type { SeatHolder } from '@game-host/lobby/server/rooms';

export interface SavedRoom {
  roomId: string;
  /** RB_SAVE_VERSION — the record format. */
  version: number;
  /** The wire that wrote it. Kept for diagnosis; policy is the registry's. */
  protocolVersion: number;
  /** Epoch ms. */
  savedAt: number;
  /** The token is included, and that is precisely what makes rejoin work. */
  players: SeatHolder[];
  log: GameEvent[];
}

export interface LoadResult { records: SavedRoom[]; skipped: string[] }

export interface RoomStore {
  save(record: SavedRoom): Promise<void>;
  loadAll(): Promise<LoadResult>;
  remove(roomId: string): Promise<void>;
}

function isSeatHolder(value: unknown): value is SeatHolder {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.token === 'string' && typeof p.isHost === 'boolean'
    && typeof p.connected === 'boolean';
}

/**
 * Field-level, *and* event-level for the log. Deeper than it looks necessary,
 * on purpose: `isGameEvent` already exists and is cheap, and a log is data
 * that outlives whatever wrote it — a deploy that changes an event shape will
 * meet records written by the old one.
 *
 * A record whose log fails is a skip, named in `skipped`. Never a boot crash,
 * and never a room that quietly replays to an empty board because `replay`
 * ignored events it did not recognise.
 */
function isSavedRoom(value: unknown): value is SavedRoom {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.roomId === 'string'
    && r.version === RB_SAVE_VERSION
    && typeof r.protocolVersion === 'number'
    && typeof r.savedAt === 'number'
    && Array.isArray(r.players) && r.players.every(isSeatHolder)
    && Array.isArray(r.log) && r.log.every(isGameEvent);
}

export function createFileStore(dir: string): RoomStore {
  const file = (roomId: string) => join(dir, `${roomId}.json`);

  return {
    /**
     * Atomic and best-effort: write a temp file and rename it, so a crash
     * mid-write cannot leave half a record where a whole one was. Never
     * rejects — a failed save loses the record, not the live room, and the
     * game in memory carries on.
     */
    async save(record) {
      try {
        await mkdir(dir, { recursive: true });
        const tmp = `${file(record.roomId)}.tmp`;
        await writeFile(tmp, JSON.stringify(record));
        await rename(tmp, file(record.roomId));
      } catch {
        // Deliberately swallowed; see above.
      }
    },

    async loadAll() {
      const records: SavedRoom[] = [];
      const skipped: string[] = [];
      let names: string[] = [];
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
      } catch {
        // No directory yet: nothing has been saved, and nothing is wrong.
        return { records, skipped };
      }
      for (const name of names) {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'));
          if (isSavedRoom(parsed)) records.push(parsed);
          else skipped.push(name);
        } catch {
          skipped.push(name);
        }
      }
      return { records, skipped };
    },

    async remove(roomId) {
      try {
        await unlink(file(roomId));
      } catch {
        // Already gone is gone.
      }
    },
  };
}
