// A file the store cannot read should cost one boot-log line, once — not
// one line at every boot forever, which is what Rail Baron did until
// 2026-08-20 (and what Acquire did until its Stage 1 called the ruling:
// quarantine, do not delete, do not nag). Renaming the file aside keeps
// the bytes for a human and takes it out of the load path; deleting it
// would be destructive, and warning forever is how 23 stale files once
// buried Acquire's boot log.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRooms } from './rooms';
import { createFileStore } from './store';

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'rb-quarantine-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('an unreadable save file across two boots', () => {
  it('is named once, set aside, and never mentioned again', async () => {
    await writeFile(join(dir, 'ROTTEN.json'), '{ not json', 'utf8');

    // One spy across both boots: spying twice on the same method hands
    // back the same mock, first boot's calls included.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First boot: the file is unreadable, the registry says so and sets it
    // aside — renamed, not unlinked, so the bytes survive for a human.
    await createRooms(createFileStore(dir)).restore();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(' ')).toContain('ROTTEN.json');
    expect(await readdir(dir)).toEqual(['ROTTEN.json.bad']);

    // Second boot, same directory — a fresh process, as a restart is. The
    // file is out of the load path and out of the log.
    warn.mockClear();
    await createRooms(createFileStore(dir)).restore();
    expect(warn).not.toHaveBeenCalled();
  });
});
