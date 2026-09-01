// server/room.stamp.test.ts
// The stamp room.dispatch adds at commit: `at` is the server's clock (the
// engine must stay deterministic under a seed, so it cannot stamp its own
// record) and `positions` is where a play's tiles landed, which the client
// needs back to highlight the last word. Room construction copied from
// wire.test.ts / testState.ts — same fixture dictionary, same fixed racks.

import { describe, expect, it } from 'vitest';
import { createDictionary } from '../engine/dictionary.js';
import { CENTER } from '../engine/constants.js';
import type { Placement } from '../engine/intents.js';
import { createGameRoom } from './room.js';
import { seat, twoPlayerState } from './testState.js';

const DICT = createDictionary(['CAT', 'CATS', 'DOG', 'AB']);

function startedRoom() {
  return createGameRoom(
    'TESTRM',
    [seat('p1', 'Ada', 'token-1', true), seat('p2', 'Ben', 'token-2')],
    DICT,
    twoPlayerState(),
  );
}

// p1's fixed rack (testState.ts) holds C, A, T, S — CAT through the centre,
// the same first play wire.test.ts makes off this fixture.
function firstLegalPlay(): Placement[] {
  return [
    { pos: CENTER - 1, tile: 'C' },
    { pos: CENTER, tile: 'A' },
    { pos: CENTER + 1, tile: 'T' },
  ];
}

describe('commit stamping', () => {
  it('stamps at and positions on a committed play', () => {
    const room = startedRoom();
    const before = Date.now();
    const delivery = room.dispatch('p1', { type: 'play', placements: firstLegalPlay() });
    expect(delivery.kind).toBe('commit');
    const last = room.state()!.log.at(-1)!;
    expect(last.at).toBeGreaterThanOrEqual(before);
    expect(last.positions).toEqual(firstLegalPlay().map((p) => p.pos).sort((a, b) => a - b));
  });

  it('stamps at (but no positions) on a pass', () => {
    const room = startedRoom();
    room.dispatch('p1', { type: 'pass' });
    const last = room.state()!.log.at(-1)!;
    expect(typeof last.at).toBe('number');
    expect(last.positions).toBeUndefined();
  });
});
