import { describe, it, expect } from 'vitest';
import type { GameState } from './gameTypes';
import { createSnapshotStore, applyIntentWithHistory, rewindTo } from './history';
import { applyIntent } from './intents';
import { buildFixture } from './golden/fixtures';

const twoPlayers = () =>
  buildFixture({
    players: [{ name: 'Alex', hand: ['A1', 'A2'] }, { name: 'Sam', hand: ['C5'] }],
    bag: ['I11', 'I12'],
  });

/**
 * The stepId an intent's snapshot is filed under is the id of the FIRST log
 * entry that intent appends — `applyIntentWithHistory` files under
 * `state.nextStepId` before applying. Some intents append more than one entry
 * (a merging placement logs both 'Merger' and 'Placed a tile'), so reading the
 * last entry's id would look up a snapshot that was never stored.
 * `buildFixture` starts with an empty log, so the first new entry is index 0.
 */
const firstNewStep = (before: GameState, after: GameState): number =>
  after.log[before.log.length]!.stepId;

describe('snapshot store', () => {
  it('rewinds to the exact state before a step ran', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });

    expect(JSON.stringify(rewindTo(store, firstNewStep(start, after)))).toBe(JSON.stringify(start));
  });

  it('is idempotent — rewinding twice to the same step gives the same state', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, after);

    expect(JSON.stringify(rewindTo(store, stepId))).toBe(JSON.stringify(rewindTo(store, stepId)));
  });

  it('drops forward entries, so a rewound store cannot resurrect the future', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    let s = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, s);
    s = applyIntentWithHistory(store, s, { type: 'endTurn', playerId: 'p1' });

    const sizeBefore = store.size;
    rewindTo(store, stepId);
    // The entry AT stepId survives — that is what keeps a repeated rewind working.
    expect(store.size).toBeLessThan(sizeBefore);
    expect([...store.keys()].every((k) => k <= stepId)).toBe(true);
    expect(store.has(stepId)).toBe(true);
  });

  it('rewind-then-replay reaches the same state as an uninterrupted run', () => {
    const intents = [
      { type: 'placeTile', playerId: 'p1', coord: 'A1' },
      { type: 'endTurn', playerId: 'p1' },
    ] as const;

    let straight = twoPlayers();
    for (const i of intents) straight = applyIntent(straight, i);

    const store = createSnapshotStore();
    const start = twoPlayers();
    let s = applyIntentWithHistory(store, start, intents[0]);
    const stepId = firstNewStep(start, s);
    s = applyIntentWithHistory(store, s, intents[1]);
    s = rewindTo(store, stepId);
    for (const i of intents) s = applyIntentWithHistory(store, s, i);

    expect(JSON.stringify(s)).toBe(JSON.stringify(straight));
  });

  it('never nests a store inside a snapshot — the recursion trap, pinned', () => {
    const store = createSnapshotStore();
    applyIntentWithHistory(store, twoPlayers(), { type: 'placeTile', playerId: 'p1', coord: 'A1' });

    for (const snapshot of store.values()) {
      for (const entry of snapshot.log) {
        expect(Object.keys(entry).sort()).toEqual(
          expect.arrayContaining(['detail', 'phase', 'stepId']),
        );
        expect(entry).not.toHaveProperty('snapshot');
      }
      expect(snapshot).not.toHaveProperty('history');
      expect(snapshot).not.toHaveProperty('snapshots');
    }
  });

  it('rejects a rewind to an unknown step rather than returning nonsense', () => {
    expect(() => rewindTo(createSnapshotStore(), 999)).toThrow(/999/);
  });

  it('a rewind followed by a rejected retry keeps the snapshot at that step intact', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, after);

    const rewound = rewindTo(store, stepId);
    expect(store.has(stepId)).toBe(true);

    // 'B2' is not in p1's hand (['A1', 'A2']) — this is a legitimate rejection,
    // not a bug in the intent. It retries at the same stepId the rewind landed on.
    expect(() =>
      applyIntentWithHistory(store, rewound, { type: 'placeTile', playerId: 'p1', coord: 'B2' }),
    ).toThrow();

    expect(store.has(stepId)).toBe(true);
    expect(JSON.stringify(rewindTo(store, stepId))).toBe(JSON.stringify(rewound));
  });

  it('mutating a rewound state does not corrupt the stored snapshot (pins the return-side clone)', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, after);

    const first = rewindTo(store, stepId);
    const untampered = JSON.stringify(first);
    first.players[0]!.cash = -999;
    first.log.push({ stepId: 9999, phase: 'tampered', detail: [] });

    const second = rewindTo(store, stepId);
    expect(JSON.stringify(second)).toBe(untampered);
  });

  it('mutating the caller state after the call does not corrupt the stored snapshot (pins the store-side clone)', () => {
    const store = createSnapshotStore();
    const start = twoPlayers();
    const beforeSnapshotJSON = JSON.stringify(start);
    const after = applyIntentWithHistory(store, start, { type: 'placeTile', playerId: 'p1', coord: 'A1' });
    const stepId = firstNewStep(start, after);

    start.players[0]!.cash = -999;
    start.log.push({ stepId: 9999, phase: 'tampered', detail: [] });

    expect(JSON.stringify(rewindTo(store, stepId))).toBe(beforeSnapshotJSON);
  });
});
