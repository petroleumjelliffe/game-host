// The hook through a probe component: press, cross the 8px threshold, drop.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useTileDrag } from './useTileDrag';
import type { DragSource } from './dragPlan';

const SOURCE: DragSource = { kind: 'rack', index: 0, tile: 'A' };

function Probe({ onDrop }: { onDrop: (s: DragSource, p: { x: number; y: number }) => void }) {
  const { drag, start, consumeDragClick } = useTileDrag(onDrop);
  return (
    <div>
      <button
        type="button"
        data-testid="tile"
        onPointerDown={(e) => { start(SOURCE, e); }}
        onClick={() => { if (consumeDragClick()) return; document.title = 'tapped'; }}
      >
        A
      </button>
      {drag?.active === true && <div data-testid="dragging" />}
    </div>
  );
}

describe('useTileDrag', () => {
  it('activates after 8px and calls onDrop with the release point', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    fireEvent.pointerDown(screen.getByTestId('tile'), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.queryByTestId('dragging')).toBeNull();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(screen.getByTestId('dragging')).toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 41, clientY: 42 });
    expect(onDrop).toHaveBeenCalledWith(SOURCE, { x: 41, y: 42 });
    expect(screen.queryByTestId('dragging')).toBeNull();
  });

  it('a sub-threshold release is not a drop, and the click stays a tap', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    document.title = '';
    const tile = screen.getByTestId('tile');
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 13, clientY: 12 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 13, clientY: 12 });
    fireEvent.click(tile);
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.title).toBe('tapped');
  });

  it('swallows exactly one click after a completed drag', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    document.title = '';
    const tile = screen.getByTestId('tile');
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.click(tile); // the browser's post-drag click — swallowed
    expect(document.title).toBe('');
    fireEvent.click(tile); // a real tap afterwards — lands
    expect(document.title).toBe('tapped');
  });

  it('a second pointer starting mid-drag cancels it (a pinch is beginning)', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    fireEvent.pointerDown(screen.getByTestId('tile'), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.pointerDown(window, { pointerId: 2, clientX: 200, clientY: 200 });
    expect(screen.queryByTestId('dragging')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
