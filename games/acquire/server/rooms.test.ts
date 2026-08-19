import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { createRoomRegistry, MAX_AGE_MS } from './rooms.js';
import { createFileStore, SAVE_VERSION, type SavedRoom } from './store.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: [],
  });
}

describe('the registry', () => {
  it('creates a room with the host seated first', () => {
    const rooms = createRoomRegistry();
    const { room, player } = rooms.create('Alex');

    expect(player.id).toBe('p1');
    expect(player.isHost).toBe(true);
    expect(player.token).toEqual(expect.any(String));
    expect(rooms.get(room.id)).toBe(room);
  });

  it('seats joiners in order and issues each a distinct token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');

    const sam = rooms.join(room.id, 'Sam');
    const jordan = rooms.join(room.id, 'Jordan');

    expect(sam?.player.id).toBe('p2');
    expect(jordan?.player.id).toBe('p3');
    expect(sam!.player.token).not.toBe(jordan!.player.token);
    expect(sam!.player.isHost).toBe(false);
  });

  /**
   * Nobody types a name before entering a room any more — both cards seat you
   * first and let you edit your row afterwards. Only the registry knows your
   * seat number, so only the registry can name you by it, and `seatPlayer` is
   * the one place both `create` and `join` pass through.
   */
  it('names you by your seat when you do not say who you are', () => {
    const rooms = createRoomRegistry();
    const { room, player: host } = rooms.create();

    const guest = rooms.join(room.id);

    expect(host.name).toBe('Player 1');
    expect(guest?.player.name).toBe('Player 2');
  });

  it('treats a blank name as no name, rather than seating an empty row', () => {
    const rooms = createRoomRegistry();
    const { room, player: host } = rooms.create('   ');

    const guest = rooms.join(room.id, '');

    expect(host.name).toBe('Player 1');
    expect(guest?.player.name).toBe('Player 2');
  });

  it('keeps a name you did give, trimmed', () => {
    const rooms = createRoomRegistry();
    const { player } = rooms.create('  Alex  ');

    expect(player.name).toBe('Alex');
  });

  it('returns the existing seat when a known player rejoins with their token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');
    const first = rooms.join(room.id, 'Sam')!;

    const again = rooms.join(room.id, 'Sam', first.player.id, first.player.token);

    expect(again?.player.id).toBe('p2');
    expect(room.players).toHaveLength(2);
  });

  it('refuses a rejoin presenting the wrong token', () => {
    const rooms = createRoomRegistry();
    const { room } = rooms.create('Alex');
    const first = rooms.join(room.id, 'Sam')!;

    expect(rooms.join(room.id, 'Sam', first.player.id, 'not-the-token')).toBeNull();
    expect(room.players).toHaveLength(2);
  });

  it('is null for a room that does not exist', () => {
    const rooms = createRoomRegistry();
    expect(rooms.get('nope')).toBeUndefined();
    expect(rooms.join('nope', 'Sam')).toBeNull();
  });

  it('retries the room code on a collision instead of overwriting the live room', () => {
    const rooms = createRoomRegistry();

    // Force `roomCode()` to draw the same six characters for the first room
    // and for the first attempt on the second room, then a different six
    // characters on the retry. If `create` does not check for a collision,
    // it stops after the first draw, `rooms.set` clobbers the first room's
    // Map entry, and both assertions below fail.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = rooms.create('Alex');

    let calls = 0;
    random.mockImplementation(() => (calls++ < 6 ? 0 : 0.5));
    const second = rooms.create('Sam');

    random.mockRestore();

    expect(second.room.id).not.toBe(first.room.id);
    expect(rooms.get(first.room.id)).toBe(first.room);
  });

  it('seats a prepared state without going through the lobby', () => {
    const rooms = createRoomRegistry();
    const room = rooms.fromState('golden-1', ['Alex', 'Sam'], fixture());

    expect(room.lifecycle()).toBe('playing');
    expect(room.actorId()).toBe('p1');
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

/**
 * The honor-system reclaim (owner ruling, 2026-08-08): same name, same room
 * code takes the seat back. Nothing sensitive rides on a seat here, and the
 * alternative — a player locked out of their own game because their browser
 * forgot a token — was found by hand. The token is what makes a rejoin
 * *seamless*; the name is what makes it *possible*.
 */
describe('reclaiming a mid-game seat by name', () => {
  function midGame() {
    const rooms = createRoomRegistry();
    const room = rooms.fromState('golden-1', ['Alex', 'Sam'], fixture());
    return { rooms, room };
  }

  it('hands a disconnected seat back to a tokenless joiner with the same name', () => {
    const { rooms, room } = midGame();
    const before = room.players[1]!.token;
    room.players[1]!.connected = false;

    const seat = rooms.join('golden-1', 'Sam');

    expect(seat?.player.id).toBe('p2');
    // Reclaimed, not re-seated: the roster did not grow.
    expect(room.players).toHaveLength(2);
    // Rotated: the seat changed hands, so the old device's token dies with
    // the handover rather than leaving two keys to one chair.
    expect(seat!.player.token).not.toBe(before);
  });

  it('matches the name the way a human retypes it — case and spacing forgiven', () => {
    const { rooms, room } = midGame();
    room.players[1]!.connected = false;

    expect(rooms.join('golden-1', '  sam ')?.player.id).toBe('p2');
  });

  it('never hands over a seat whose player is still connected', () => {
    const { rooms } = midGame();

    expect(rooms.join('golden-1', 'Sam')).toBeNull();
  });

  it('still refuses a tokenless stranger mid-game', () => {
    const { rooms, room } = midGame();
    room.players[1]!.connected = false;

    expect(rooms.join('golden-1', 'Jordan')).toBeNull();
    expect(rooms.join('golden-1')).toBeNull();
    expect(room.players).toHaveLength(2);
  });
});

describe('restoring rooms at boot', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-restore-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  /** Saves a room through a live registry, exactly as a commit would. */
  async function seedSavedRoom(roomId: string): Promise<SavedRoom> {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    const room = rooms.fromState(roomId, ['Alex', 'Sam'], fixture());
    await rooms.persist(room);
    const [saved] = (await store.loadAll()).records;
    return saved!;
  }

  it('seats a saved room again, with its tokens intact', async () => {
    const saved = await seedSavedRoom('ABC123');

    const rooms = createRoomRegistry(createFileStore(dir));
    const count = await rooms.restore();

    expect(count).toBe(1);
    const room = rooms.get('ABC123');
    expect(room).toBeDefined();
    expect(room!.lifecycle()).toBe('playing');
    // The rejoin material survived the process, which is the whole feature.
    const token = saved.players[1]!.token;
    expect(rooms.join('ABC123', 'Sam', 'p2', token)?.player.id).toBe('p2');
  });

  it('brings every restored seat back disconnected', async () => {
    await seedSavedRoom('ABC123');

    const rooms = createRoomRegistry(createFileStore(dir));
    await rooms.restore();

    // Presence is a fact about live sockets. Nothing is connected to a
    // process that has only just started.
    expect(rooms.get('ABC123')!.players.every((p) => !p.connected)).toBe(true);
  });

  it('restores a finished game as over, not as still playing', async () => {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    const room = rooms.fromState('END123', ['Alex', 'Sam'], { ...fixture(), stage: 'end' });
    await rooms.persist(room);

    const revived = createRoomRegistry(createFileStore(dir));
    await revived.restore();

    // `createGameRoom` used to derive lifecycle as `initial ? 'playing' :
    // 'lobby'`, which would bring a finished game back as one still waiting
    // for a move nobody can make.
    expect(revived.get('END123')!.lifecycle()).toBe('over');
  });

  /**
   * The sweep item this stage closes: `previousSegmentStart` was not on
   * `SavedRoom`, so a client resuming a restored room got `undefined` and the
   * step stack's previous turn stayed blank until the next commit — the exact
   * gap the field was added to close, unclosed for the restart case.
   *
   * End to end on purpose: driven through a real segment close, persisted,
   * restored, and read back off the *room*, not the record. A store-level
   * round trip alone would pass with the registry still dropping the value on
   * the floor.
   */
  it('hands a restored room its previous segment start back', async () => {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    // Not this file's shared `fixture()`: there A1 belongs to *Sam*, so a
    // 'p1' placement is refused and no segment ever closes — the guard below
    // caught exactly that on the first run. Here Alex holds A1, which touches
    // nothing, so the placement founds no chain and `endTurn` closes cleanly.
    const room = rooms.fromState('SEG123', ['Alex', 'Sam'], buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['A1'] },
        { name: 'Sam', cash: 6000, hand: ['H8'] },
      ],
      bag: ['I11'],
    }));
    room.dispatch('p1', { type: 'placeTile', coord: 'A1' });
    room.dispatch('p1', { type: 'endTurn' });
    const closed = room.previousSegmentStart();
    expect(closed, 'no segment ever closed — the test proves nothing').toBeDefined();
    await rooms.persist(room);

    const revived = createRoomRegistry(createFileStore(dir));
    await revived.restore();

    expect(revived.get('SEG123')!.previousSegmentStart()).toBe(closed);
  });

  it('skips a record written by a different protocol, and still seats the good one', async () => {
    await seedSavedRoom('GOOD01');
    const store = createFileStore(dir);
    const [good] = (await store.loadAll()).records;
    // What a file written by last week's server looks like after a protocol
    // bump: valid in every respect except the wire its state speaks.
    await writeFile(
      join(dir, 'game-oldwire.json'),
      JSON.stringify({ ...good, roomId: 'STALE1', protocolVersion: good!.protocolVersion + 1 }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const revived = createRoomRegistry(createFileStore(dir));
    const count = await revived.restore();

    // One room, not zero and not two: the mismatch costs exactly the room
    // that cannot be trusted, and says so rather than dropping it silently.
    expect(count).toBe(1);
    expect(revived.get('GOOD01')).toBeDefined();
    expect(revived.get('STALE1')).toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('STALE1'))).toBe(true);
  });

  /**
   * Phase 4's Finding 4, closed: 23 stale files warned at every boot,
   * forever, because eviction only deleted records that were too *old*. The
   * ruling is quarantine — renamed aside for a human, never deleted — and
   * "warns once, not forever" is the observable difference, so that is what
   * is asserted: a second boot over the same directory is silent.
   */
  it('quarantines an unreadable file at boot, and the next boot is quiet', async () => {
    await seedSavedRoom('GOOD01');
    await writeFile(join(dir, 'game-rotten.json'), '{ not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = createRoomRegistry(createFileStore(dir));
    expect(await first.restore()).toBe(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('game-rotten.json'))).toBe(true);

    warn.mockClear();
    const second = createRoomRegistry(createFileStore(dir));
    expect(await second.restore()).toBe(1);

    // The load path no longer sees it, so nothing warns — but the bytes are
    // still there under `.bad`, for whoever wants to know what happened.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('game-rotten'))).toBe(false);
    expect(await readdir(dir)).toContain('game-rotten.json.bad');
  });

  /**
   * Boot-only, enforced rather than documented. `rooms.set` in `restore` is
   * unconditional — it replaces whatever object holds a room id, with no
   * check that sockets are bound to the old one. Safe before `listen`,
   * silently catastrophic after: every bound socket keeps dispatching into a
   * room object the registry no longer serves. Until now only a docstring
   * said so.
   */
  it('refuses to restore twice, because the second call would strand live sockets', async () => {
    await seedSavedRoom('ABC123');
    const rooms = createRoomRegistry(createFileStore(dir));

    await rooms.restore();

    await expect(rooms.restore()).rejects.toThrow(/boot/i);
    // The first restore's work is intact — the guard protects it rather than
    // tearing anything down.
    expect(rooms.get('ABC123')).toBeDefined();
  });

  it('drops and deletes a record older than the age limit', async () => {
    await seedSavedRoom('OLD123');
    const store = createFileStore(dir);

    const rooms = createRoomRegistry(store);
    const count = await rooms.restore(Date.now() + MAX_AGE_MS + 1);

    expect(count).toBe(0);
    expect(rooms.get('OLD123')).toBeUndefined();
    // Deleted, not merely skipped — otherwise the directory grows forever
    // and every boot re-reads records it will never use.
    expect((await store.loadAll()).records).toEqual([]);
  });

  it('is zero, not a crash, with nothing saved', async () => {
    const rooms = createRoomRegistry(createFileStore(dir));
    expect(await rooms.restore()).toBe(0);
  });

  it('skips a record whose state the engine cannot drive, and still seats the good one', async () => {
    await seedSavedRoom('GOOD01');

    // Passes `isSavedRoom`'s shape guard — it only checks that `state` is a
    // non-null object — but is not anything `createGameSession` can
    // actually drive. Written straight to disk rather than through
    // `SavedRoom`, so the type checker cannot stop us from building the
    // exact file `isSavedRoom` is too shallow to catch: a `state` this
    // server itself would never write, but the guard trusts past "is an
    // object" on the theory that it always came from this server's own
    // engine.
    const badRecord = {
      roomId: 'BAD001',
      version: SAVE_VERSION,
      savedAt: Date.now(),
      players: [
        { id: 'p1', name: 'Alex', token: 'tok1', isHost: true, connected: false },
        { id: 'p2', name: 'Sam', token: 'tok2', isHost: false, connected: false },
      ],
      state: {},
    };
    await writeFile(join(dir, 'BAD001.json'), JSON.stringify(badRecord), 'utf-8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rooms = createRoomRegistry(createFileStore(dir));
    const count = await rooms.restore();
    warn.mockRestore();

    expect(count).toBe(1);
    expect(rooms.get('GOOD01')).toBeDefined();
    expect(rooms.get('BAD001')).toBeUndefined();
  });
});

describe('what persist writes to disk', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-persist-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the committed state, not a still-open draft', async () => {
    // `persist` and a commit run in the same synchronous tick in production,
    // where `draft()` and `committed()` are the same object — so this is the
    // one place `rooms.persist` can be called with the two genuinely
    // different, to prove which one it actually writes. Calling it directly,
    // mid-segment, is the only way to tell "writes committed" from "writes
    // draft, which happens to equal committed by the time anyone calls
    // persist for real" apart.
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    const room = rooms.fromState('X', ['Alex', 'Sam'], buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['I5'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: [],
    }));

    // I5 is adjacent to nothing on this board — H5, I4 and I6 are all empty,
    // and the only other tiles in play are E5 and A1 — so placing it neither
    // founds nor joins a chain. The turn does not pass: the segment stays
    // open, with the actor still `p1`.
    room.dispatch('p1', { type: 'placeTile', coord: 'I5' });
    expect(room.draft().board).not.toEqual(room.committed().board);

    await rooms.persist(room);

    const [saved] = (await store.loadAll()).records;
    expect(saved!.state.board).toEqual(room.committed().board);
  });

  it('stamps the record with the wire it was written by', async () => {
    const store = createFileStore(dir);
    const rooms = createRoomRegistry(store);
    await rooms.persist(rooms.fromState('X', ['Alex', 'Sam'], fixture()));

    const [saved] = (await store.loadAll()).records;
    expect(saved!.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
