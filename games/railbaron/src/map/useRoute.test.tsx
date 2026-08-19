import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { nodeById, nodeForCity, path as pathOf } from '../../engine';
import type { GameEvent } from '../state/events';
import { replay } from '../state/game';
import { useRoute } from './useRoute';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);

/** Red is up, heading for St. Paul from Minneapolis, with a roll of two. */
const midTurn: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 29, region: 'SC', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' },
  { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
  { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
];

describe('the draft route on the map', () => {
  it('offers nothing before the dice are rolled', () => {
    const state = replay(midTurn.slice(0, 7));
    const { result } = renderHook(() => useRoute(state, vi.fn()));
    expect(result.current.draft).toBeNull();
    expect(result.current.legal.size).toBe(0);
  });

  it('lights the legal next nodes once they are', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    expect(result.current.legal.has(ST_PAUL)).toBe(true);
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('extends the route on a tap and moves the head', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap(ST_PAUL); });
    expect(result.current.at).toBe(ST_PAUL);
  });

  it('reports why a tap was refused rather than swallowing it', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap('d0'); });
    expect(result.current.refused).toBe('not-a-neighbour');
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('takes a step back on undo', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap(ST_PAUL); });
    act(() => { result.current.undo(); });
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('offers commit only once the route is complete', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    expect(result.current.canCommit).toBe(false);
    act(() => { result.current.tap(ST_PAUL); });
    expect(result.current.canCommit).toBe(true);
  });

  it('hands the whole leg over on commit, once', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useRoute(replay(midTurn), onMove));
    act(() => { result.current.tap(ST_PAUL); });
    act(() => { result.current.commit(); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('red', [MINNEAPOLIS, ST_PAUL], true);
  });

  it('refuses to commit an unfinished route', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useRoute(replay(midTurn), onMove));
    act(() => { result.current.commit(); });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('gives a bonus leg only the bonus die to spend', () => {
    // A log from before the Bonus Roll moved to after the white movement:
    // the face is already in `turnRolled`. Kept because such logs still load.
    const bonus: GameEvent[] = [...midTurn.slice(0, 7),
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 3 },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: 0 }];
    const { result } = renderHook(() => useRoute(replay(bonus), vi.fn()));
    expect(result.current.remaining).toBe(3);
  });

  /**
   * The same leg, staged as it is now played. The white leg is walked on the
   * white pair alone — twelve, not eighteen — and the bonus leg has nothing
   * at all to spend until the die is thrown and `bonusRolled` lands.
   */
  describe('a Bonus Roll taken after the white leg', () => {
    const walked: GameEvent[] = [...midTurn.slice(0, 7),
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null }];

    it('spends the white pair on the first leg, and not a dot more', () => {
      const { result } = renderHook(() => useRoute(replay(walked), vi.fn()));
      expect(result.current.remaining).toBe(12);
    });

    /**
     * The white leg stops in open country — no arrival, so no new
     * destination, and the bonus leg carries straight on from d66.
     */
    const owed: GameEvent[] = [...walked,
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }];

    it('has nothing to spend while the die is still in the cup', () => {
      const { result } = renderHook(() => useRoute(replay(owed), vi.fn()));
      expect(result.current.remaining).toBe(0);
      expect(result.current.legal.size, 'and so nothing to tap').toBe(0);
    });

    it('gets the face, and only the face, once the Bonus Roll lands', () => {
      const thrown: GameEvent[] = [...owed,
        { type: 'bonusRolled', seat: 'red', face: 3 }];
      const { result } = renderHook(() => useRoute(replay(thrown), vi.fn()));
      expect(result.current.remaining).toBe(3);
      expect(result.current.at, 'carrying on from where the white leg stopped').toBe('d66');
      expect(result.current.legal.size).toBeGreaterThan(0);
    });
  });

  /**
   * Columbus — d185 — j10 — Pittsburgh. `j10` is a bend in the printed line,
   * not a place: no lamp is drawn there, so it is never offered and never
   * tapped. The tap on Pittsburgh has to walk the whole chain in one go.
   */
  const acrossAJunction: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: 23, region: 'NC', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'arrived', seat: 'red', city: 6, region: 'NE', payout: 2000 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
  ];

  it('walks a whole chain through a junction on one tap', () => {
    const { result } = renderHook(() => useRoute(replay(acrossAJunction), vi.fn()));
    act(() => { result.current.tap('d185'); });
    expect(result.current.at).toBe('d185');

    // Pittsburgh is two steps away, the first of them onto j10.
    expect(result.current.legal.has(nodeForCity(6))).toBe(true);
    act(() => { result.current.tap(nodeForCity(6)); });

    // The pawn is on the city, not parked on the bend it went through...
    expect(result.current.at).toBe(nodeForCity(6));
    // ...and the bend is in the route, so the leg records the line it rode.
    expect(pathOf(result.current.draft!)).toEqual(
      [nodeForCity(23), 'd185', 'j10', nodeForCity(6)]);
    expect(result.current.canCommit).toBe(true);
  });

  it('never offers a junction, even standing right beside one', () => {
    const { result } = renderHook(() => useRoute(replay(acrossAJunction), vi.fn()));
    act(() => { result.current.tap('d185'); });
    // d185's neighbours are Columbus and j10, so the head is beside a junction.
    expect(result.current.at).toBe('d185');
    expect(result.current.legal.size).toBeGreaterThan(0);
    for (const id of result.current.legal) {
      expect(nodeById(id).kind).not.toBe('junction');
    }
  });
});
