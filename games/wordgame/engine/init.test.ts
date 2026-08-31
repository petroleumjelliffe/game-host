import { createInitialGame } from './init';
import { ALL_TILES, RACK_SIZE, TILE_DISTRIBUTION, type Tile } from './constants';

const roster = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cy' },
];

describe('createInitialGame', () => {
  it('is deterministic: same seed and players, identical state', () => {
    expect(createInitialGame('seed-1', roster)).toEqual(createInitialGame('seed-1', roster));
  });

  it('differs across seeds', () => {
    const a = createInitialGame('seed-1', roster);
    const b = createInitialGame('seed-2', roster);
    expect(a.bag).not.toEqual(b.bag);
  });

  it('deals a rack of 7 to every player and leaves the rest in the bag', () => {
    const state = createInitialGame('seed-1', roster);
    for (const player of state.players) {
      expect(player.rack).toHaveLength(RACK_SIZE);
      expect(player.score).toBe(0);
    }
    expect(state.bag).toHaveLength(100 - RACK_SIZE * roster.length);
  });

  it('conserves the full tile distribution across bag and racks', () => {
    const state = createInitialGame('seed-1', roster);
    const all: Tile[] = [...state.bag];
    for (const player of state.players) all.push(...player.rack);
    const counts = new Map<Tile, number>();
    for (const tile of all) counts.set(tile, (counts.get(tile) ?? 0) + 1);
    for (const tile of ALL_TILES) {
      expect(counts.get(tile) ?? 0).toBe(TILE_DISTRIBUTION[tile]);
    }
  });

  it('starts playing, board empty, at turn 0, with an empty log', () => {
    const state = createInitialGame('seed-1', roster);
    expect(state.stage).toBe('playing');
    expect(state.turnIndex).toBe(0);
    expect(state.board).toHaveLength(225);
    expect(state.board.every((square) => square === null)).toBe(true);
    expect(state.log).toEqual([]);
    expect(state.moveCount).toBe(0);
    expect(state.scorelessTurns).toBe(0);
  });

  it('throws RangeError outside 2..6 players', () => {
    const one = roster.slice(0, 1);
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(() => createInitialGame('seed', one)).toThrow(RangeError);
    expect(() => createInitialGame('seed', seven)).toThrow(RangeError);
    expect(() => createInitialGame('seed', [])).toThrow(RangeError);
  });

  it('accepts 2 and 6 players', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(createInitialGame('seed', roster.slice(0, 2)).players).toHaveLength(2);
    expect(createInitialGame('seed', six).players).toHaveLength(6);
  });

  it('shuffles the seating order from the seed', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const inputOrder = six.map((p) => p.id).join(',');
    const orders = Array.from({ length: 10 }, (_, i) =>
      createInitialGame(`seed-${i}`, six).players.map((p) => p.id),
    );
    // Every order is a permutation of the roster…
    for (const order of orders) {
      expect([...order].sort()).toEqual(six.map((p) => p.id).sort());
    }
    // …at least one seed reorders it, and the seeds don't all agree.
    expect(orders.some((order) => order.join(',') !== inputOrder)).toBe(true);
    expect(new Set(orders.map((order) => order.join(','))).size).toBeGreaterThan(1);
  });
});
