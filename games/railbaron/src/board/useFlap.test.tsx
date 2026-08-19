import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlap } from './useFlap';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

/**
 * The probe builds its texts array inline, on purpose. `Board` derives its
 * texts from a `ScreenDef` its page recomputes every render, so the hook
 * really does receive a fresh array each time — including on the renders
 * its own ticks cause. Taking a ready-made array as a prop would hand the
 * hook a stable reference that the real caller never has, and would hide
 * exactly the bug the "keeps spinning" test is here to catch.
 */
function Probe({ text, status = '', amount = '', panel }:
  { text: string; status?: string; amount?: string; panel?: string[] }) {
  const { rows, settled, flapping, snap } =
    useFlap([{ status, text, amount, turn: 0 }], panel);
  const column = (faces: { top: string }[]) =>
    faces.map(face => face.top).join('').trimEnd();
  return (
    <div>
      <span data-testid="row0">{column(rows[0]!.text)}</span>
      <span data-testid="status0">{column(rows[0]!.status)}</span>
      <span data-testid="amount0">{column(rows[0]!.amount)}</span>
      <span data-testid="settled0">
        {`${settled[0]!.status}/${settled[0]!.text}/${settled[0]!.amount}`}
      </span>
      <span data-testid="flapping">{String(flapping)}</span>
      <button onClick={snap}>snap</button>
    </div>
  );
}

const row0 = () => screen.getByTestId('row0').textContent;
const status0 = () => screen.getByTestId('status0').textContent;
const amount0 = () => screen.getByTestId('amount0').textContent;
const settled0 = () => screen.getByTestId('settled0').textContent;
const flapping = () => screen.getByTestId('flapping').textContent;

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('the flap hook', () => {
  it('shows the text straight away when nothing has changed yet', () => {
    render(<Probe text="DENVER" />);
    expect(row0()).toBe('DENVER');
    expect(flapping()).toBe('false');
  });

  it('spins through intermediate characters before arriving', () => {
    const { rerender } = render(<Probe text="A" />);
    rerender(<Probe text="D" />);

    act(() => { vi.advanceTimersByTime(52); });
    expect(row0()).toBe('B');            // en route, not yet arrived
    expect(flapping()).toBe('true');

    // Two more ticks to arrive, then one for the trailing leaf to fall.
    act(() => { vi.advanceTimersByTime(52 * 2); });
    expect(row0()).toBe('D');
    act(() => { vi.advanceTimersByTime(52); });
    expect(flapping()).toBe('false');
  });

  it('keeps spinning across the re-renders its own ticks cause', () => {
    // Each tick sets state, which re-renders, which hands the hook a fresh
    // `texts` array. If the hook keys its effect on that array's identity
    // rather than its contents, the animation cancels itself after one tick.
    const { rerender } = render(<Probe text="A" />);
    rerender(<Probe text="J" />);

    act(() => { vi.advanceTimersByTime(52 * 3); });
    expect(row0()).toBe('D');            // still moving, three ticks in
    expect(flapping()).toBe('true');
  });

  it('turns the panel through the vocabulary its screen declares', () => {
    // The screen names what the panel may say; the rows only say what they
    // are saying now. A panel built from the rows alone has nothing to turn
    // through on the first roll of a game, when no region is on the board.
    const panel = ['Northeast', 'Southeast', 'North Central', 'Plains'];
    const { rerender } = render(<Probe text="DENVER" status="" panel={panel} />);
    rerender(<Probe text="DENVER" status="Plains" panel={panel} />);

    const seen = new Set<string>();
    for (let tick = 0; tick < 40; tick++) {
      seen.add(status0()!);
      act(() => { vi.advanceTimersByTime(52); });
    }
    expect(seen).toContain('Southeast');   // on neither row, yet it goes past
    expect(status0()).toBe('Plains');
  });

  it('snaps instantly and never spins when reduced motion is asked for', () => {
    setReducedMotion(true);
    const { rerender } = render(<Probe text="A" />);
    rerender(<Probe text="D" />);

    // No timer advance at all: it must already be there.
    expect(row0()).toBe('D');
    expect(flapping()).toBe('false');
  });

  it('abandons a transition in flight when a new one starts', () => {
    const { rerender } = render(<Probe text="A" />);
    rerender(<Probe text="Z" />);
    act(() => { vi.advanceTimersByTime(52 * 3); });
    expect(row0()).not.toBe('Z');

    rerender(<Probe text="B" />);
    act(() => { vi.advanceTimersByTime(52 * 30); });
    expect(row0()).toBe('B');           // the abandoned run did not win
  });

  it('settles immediately when tapped mid-flap', () => {
    const { rerender } = render(<Probe text="A" />);
    rerender(<Probe text="Z" />);
    act(() => { vi.advanceTimersByTime(52 * 2); });
    expect(row0()).not.toBe('Z');

    act(() => { screen.getByText('snap').click(); });
    expect(row0()).toBe('Z');
    expect(flapping()).toBe('false');
  });

  it('stops its timers when unmounted', () => {
    const { rerender, unmount } = render(<Probe text="A" />);
    rerender(<Probe text="Z" />);
    act(() => { vi.advanceTimersByTime(52); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
