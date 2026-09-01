// The rack's drag rendering: fixed 48px slots so an insertion gap can open
// and neighbours slide aside; the dragged tile is removed outright — the
// ghost under the finger is its only representation (decided 2026-08-31).
// A null entry is a reserved slot: its tile is on the board this turn.
// Tap behaviour and the bag tile are covered through GameScreen.test.tsx.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Rack } from './Rack';
import type { Tile } from '../../engine/constants';

function entriesOf(tiles: (Tile | null)[]) {
  return tiles.map((tile, id) => ({ id, tile }));
}

describe('Rack — drag rendering', () => {
  const tiles = entriesOf(['A', 'B', 'C', 'D']);

  it('removes the dragged tile from the row — no dimmed placeholder', () => {
    render(<Rack entries={tiles} selected={[]} onTileTap={() => {}} bagCount={10} draggingIndex={1} insertionSlot={null} />);
    expect(screen.queryByTestId('rack-tile-1')).toBeNull();
    expect(screen.getByTestId('rack-tile-0')).toHaveStyle({ left: '0px' });
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '48px' });
  });

  it('opens an insertion gap: tiles at and after the slot slide one slot right', () => {
    render(<Rack entries={tiles} selected={[]} onTileTap={() => {}} bagCount={10} draggingIndex={1} insertionSlot={1} />);
    expect(screen.getByTestId('rack-tile-0')).toHaveStyle({ left: '0px' });
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '96px' }); // slid past the gap
    expect(screen.getByTestId('rack-tile-3')).toHaveStyle({ left: '144px' });
  });

  it('renders exactly as before when no drag props are given', () => {
    render(<Rack entries={tiles} selected={[2]} onTileTap={() => {}} bagCount={10} />);
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '96px' });
    expect(screen.getByTestId('bag-tile')).toBeInTheDocument();
  });
});

describe('Rack — reserved slots', () => {
  it('renders a staged tile\'s slot as a dashed reservation holding its place', () => {
    render(<Rack entries={entriesOf(['A', null, 'C'])} selected={[]} onTileTap={() => {}} bagCount={10} />);
    const reserved = screen.getByTestId('rack-slot-reserved-1');
    expect(reserved).toHaveStyle({ left: '48px' }); // occupies its slot
    expect(reserved.tagName).toBe('DIV'); // not tappable
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '96px' }); // no slot collapse
  });
});
