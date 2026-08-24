import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayback } from './usePlayback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const PATH = ['a', 'b', 'c', 'd'];

describe('walking a committed path', () => {
  it('starts on the first node alone', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    expect(result.current.shown).toEqual(['a']);
    expect(result.current.done).toBe(false);
  });

  it('takes one node per step', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.shown).toEqual(['a', 'b']);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.shown).toEqual(PATH);
  });

  it('is done once it reaches the end, and stops there', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
  });

  it('finishes early when told to skip', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { result.current.skip(); });
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
  });

  it('has nothing to walk without a path', () => {
    const { result } = renderHook(() => usePlayback(null, 100));
    expect(result.current.shown).toEqual([]);
    expect(result.current.done).toBe(true);
  });

  it('lands complete at once when told not to animate', () => {
    // The device that made the move already watched it happen — its playback
    // must be finished on the very first render, never gating anything.
    const { result } = renderHook(() => usePlayback(PATH, 100, 'red', false));
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
  });

  it('starts over when another baron walks the very same dots', () => {
    // Two barons following one another down the same line commit identical
    // paths back-to-back. Keyed on the dots alone the second leg never
    // animates: the walk sits finished, showing the first baron's.
    const { result, rerender } = renderHook(({ seat }) => usePlayback(PATH, 100, seat), {
      initialProps: { seat: 'red' }
    });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.shown).toEqual(PATH);

    rerender({ seat: 'blue' });
    expect(result.current.shown).toEqual(['a']);
    expect(result.current.done).toBe(false);
  });

  it('starts over when a new path arrives', () => {
    const { result, rerender } = renderHook(({ p }) => usePlayback(p, 100), {
      initialProps: { p: PATH as string[] | null }
    });
    act(() => { vi.advanceTimersByTime(1000); });
    rerender({ p: ['x', 'y'] });
    expect(result.current.shown).toEqual(['x']);
  });
});
