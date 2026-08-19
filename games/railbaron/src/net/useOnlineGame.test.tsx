import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { GameEvent } from '../state/events';
import type { GameTransport } from './transport';
import { useOnlineGame } from './useOnlineGame';

interface SpyTransport extends GameTransport {
  append: Mock<(event: GameEvent) => void>;
  undo: Mock<() => void>;
}

const transport = (): SpyTransport => ({
  append: vi.fn<(event: GameEvent) => void>(),
  undo: vi.fn<() => void>(),
  onLog: () => () => {},
});

/** The prefix the server seeds at Begin, as in src/state/legal.test.ts. */
const seeded = (...rest: GameEvent[]): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'BEN' },
  { type: 'started' },
  ...rest,
];

// Chicago (20, NC) and Atlanta (9, SE), as verified against engine/cities.ts.
const redHome: GameEvent =
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };
const blueHome: GameEvent =
  { type: 'arrived', seat: 'blue', city: 9, region: 'SE', payout: null };

/** Homes in, order rolled, red holding a destination: red owes the dice. */
const redRolling = seeded(
  redHome, blueHome,
  { type: 'orderRolled', seat: 'red', first: 'red' },
  { type: 'arrived', seat: 'red', city: 9, region: 'SE', payout: 45 },
);

describe('useOnlineGame', () => {
  it('derives its state from the log it is handed', () => {
    const { result } = renderHook(() =>
      useOnlineGame(seeded(), transport(), 'red', () => 0.5));
    expect(result.current.state.phase).toBe('homes');
    expect(result.current.state.seats.red.name).toBe('ADA');
  });

  it('commitDice appends over the transport, and nothing locally', () => {
    const t = transport();
    const { result } = renderHook(() => useOnlineGame(redRolling, t, 'red', () => 0.5));
    const before = result.current.state;
    act(() => { result.current.commitDice('red', { white: [3, 4], bonus: null }); });

    expect(t.append).toHaveBeenCalledWith(
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null });
    // No optimistic apply: the log is a prop, so the board does not move until
    // the server's echo arrives.
    expect(result.current.state).toEqual(before);
  });

  it('refuses to roll for a seat this device does not hold', () => {
    const { result } = renderHook(() =>
      useOnlineGame(seeded(), transport(), 'blue', () => 0.5));
    // Red is the actor, but blue holds this device.
    expect(result.current.roll('red')).toBeNull();
    // And blue may hold the device without it being blue's move.
    expect(result.current.roll('blue')).toBeNull();
  });

  it('lets the seat this device holds roll when it is that seat’s move', () => {
    const { result } = renderHook(() =>
      useOnlineGame(seeded(), transport(), 'red', () => 0.5));
    expect(result.current.roll('red')).not.toBeNull();
  });

  it('will not roll the dice for another seat, even on its turn', () => {
    const { result } = renderHook(() =>
      useOnlineGame(redRolling, transport(), 'blue', () => 0.5));
    // It is red's turn and red owes a roll — but this device is blue's.
    expect(result.current.rollDice('red')).toBeNull();
  });

  it('sends undo without pre-judging it', () => {
    const t = transport();
    const { result } = renderHook(() => useOnlineGame(redRolling, t, 'blue', () => 0.5));
    act(() => { result.current.undoLast(); });
    // Whose undo it is belongs to the server; guessing here would be a second
    // copy of that rule waiting to disagree.
    expect(t.undo).toHaveBeenCalled();
  });

  it('lets any seated baron report the roll for first player', () => {
    const t = transport();
    // A constant rng ties every seat forever and the reroll guard throws —
    // correctly, and exactly as useGame does. Turn order needs dice that
    // differ, so red rolls high and blue rolls low.
    const faces = [0.9, 0.9, 0.1, 0.1];
    let at = 0;
    const rng = (): number => faces[at++ % faces.length]!;
    const { result } = renderHook(() =>
      useOnlineGame(seeded(redHome, blueHome), t, 'blue', rng));
    act(() => { result.current.rollOrder(); });
    expect(t.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'orderRolled' }));
  });

  it('will not report the order roll from a seat nobody holds', () => {
    const t = transport();
    const { result } = renderHook(() =>
      useOnlineGame(seeded(redHome, blueHome), t, null, () => 0.5));
    act(() => { result.current.rollOrder(); });
    expect(t.append).not.toHaveBeenCalled();
  });
});
