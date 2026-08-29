// packages/notify/jsonStore.test.ts
// The mechanics carried over from room-store, re-proven against this copy:
// round trip, guard refusal, write ordering, settled, key safety.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeyedJsonStore } from './jsonStore.js';

interface Stub {
  id: string;
  value: number;
}

function isStub(v: unknown): v is Stub {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Stub).id === 'string' &&
    typeof (v as Stub).value === 'number'
  );
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'json-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('save/loadAll round trip', async () => {
  const store = createKeyedJsonStore(dir, isStub);
  await store.save('a', { id: 'a', value: 1 });
  await store.save('b', { id: 'b', value: 2 });
  const { records, unreadable } = await store.loadAll();
  expect(records.map((r) => r.id).sort()).toEqual(['a', 'b']);
  expect(unreadable).toEqual([]);
});

test('guard-refused and unparseable files are reported, not returned', async () => {
  const loose = createKeyedJsonStore(dir, (v): v is Stub => typeof v === 'object' && v !== null);
  await loose.save('bad-shape', { wrong: true } as unknown as Stub);
  const strict = createKeyedJsonStore(dir, isStub);
  const { records, unreadable } = await strict.loadAll();
  expect(records).toEqual([]);
  expect(unreadable).toEqual(['bad-shape.json']);
});

test('last write wins under queued same-key saves, and settled drains them', async () => {
  const store = createKeyedJsonStore(dir, isStub);
  for (let i = 0; i < 20; i++) void store.save('a', { id: 'a', value: i });
  await store.settled();
  const { records } = await store.loadAll();
  expect(records).toEqual([{ id: 'a', value: 19 }]);
  const leftovers = (await readdir(dir)).filter((n) => n.endsWith('.tmp'));
  expect(leftovers).toEqual([]);
});

test('remove is idempotent', async () => {
  const store = createKeyedJsonStore(dir, isStub);
  await store.save('a', { id: 'a', value: 1 });
  await store.remove('a');
  await store.remove('a');
  expect((await store.loadAll()).records).toEqual([]);
});

test('an unsafe key throws instead of writing somewhere surprising', async () => {
  const store = createKeyedJsonStore(dir, isStub);
  await expect(store.save('../escape', { id: 'x', value: 1 })).resolves.toBeUndefined();
  // save never rejects — but nothing may have been written either
  expect((await store.loadAll()).records).toEqual([]);
  await expect(store.remove('a/b')).resolves.toBeUndefined();
});

test('loadAll on a directory that never existed is empty, not an error', async () => {
  const store = createKeyedJsonStore(join(dir, 'never-made'), isStub);
  expect(await store.loadAll()).toEqual({ records: [], unreadable: [] });
});
