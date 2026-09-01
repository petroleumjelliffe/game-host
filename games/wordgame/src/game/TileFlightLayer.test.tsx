// The flight layer's contract: mount at `from`, retire on the timer, and —
// through useTileFlights — refuse to launch at all for zero rects (jsdom's
// default) so no state ever waits on an animation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { TileFlightLayer, useTileFlights, type Flight } from './TileFlightLayer';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const FROM = { left: 10, top: 400, width: 44, height: 50 };
const TO = { left: 100, top: 30, width: 20, height: 20 };

describe('useTileFlights', () => {
  it('refuses zero-size rects — callers treat the tile as already landed', () => {
    const { result } = renderHook(() => useTileFlights());
    let accepted = true;
    act(() => {
      accepted = result.current.launch('A', { left: 0, top: 0, width: 0, height: 0 }, TO, 220);
    });
    expect(accepted).toBe(false);
    expect(result.current.flights).toHaveLength(0);
  });

  it('launches with real rects and finishes by id', () => {
    const { result } = renderHook(() => useTileFlights());
    act(() => {
      expect(result.current.launch('A', FROM, TO, 220)).toBe(true);
    });
    expect(result.current.flights).toHaveLength(1);
    act(() => {
      result.current.finish(result.current.flights[0]!.id);
    });
    expect(result.current.flights).toHaveLength(0);
  });
});

describe('TileFlightLayer', () => {
  it('mounts the flight at its origin and retires it on the timer', () => {
    const onDone = vi.fn();
    const onFinished = vi.fn();
    const flight: Flight = { id: 1, tile: 'Q', from: FROM, to: TO, durationMs: 220, onDone };
    render(<TileFlightLayer flights={[flight]} onFinished={onFinished} />);
    const el = screen.getByTestId('tile-flight');
    expect(el).toHaveStyle({ left: '10px', top: '400px' });
    expect(el).toHaveTextContent('Q');
    act(() => {
      vi.advanceTimersByTime(220 + 100);
    });
    expect(onDone).toHaveBeenCalledOnce();
    expect(onFinished).toHaveBeenCalledWith(1);
  });
});
