import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Board } from './Board';
import { createEmptyBoard } from '../../engine/gameInit';
import type { Coord } from '../../engine/gameHelpers';
import type { TileCell } from '../../engine/gameTypes';

const boardWith = (cells: { [K in Coord]?: TileCell }): Record<Coord, TileCell> => {
  const board = createEmptyBoard();
  for (const [c, cell] of Object.entries(cells)) {
    if (cell) board[c as Coord] = cell;
  }
  return board;
};

/**
 * jsdom cannot see the animation — it has no frames — so what is pinned here
 * is *which* cell gets it, which is the part that was easy to get wrong: a
 * commit can carry a whole turn, and animating every changed cell would flash
 * the entire chain the placement just grew. The motion itself is settled by
 * eye.
 */
describe('a tile landing', () => {
  it('marks only the newest placement', () => {
    const board = boardWith({ E5: { placed: true }, E6: { placed: true } });
    const { container } = render(<Board board={board} landed="E6" />);

    const landed = container.querySelectorAll('[data-landed]');
    expect(landed).toHaveLength(1);
    expect(landed[0]!.querySelector('[title="E6"]')).not.toBeNull();
  });

  it('marks nothing when no tile has been placed', () => {
    const { container } = render(<Board board={boardWith({})} landed={null} />);
    expect(container.querySelectorAll('[data-landed]')).toHaveLength(0);
  });

  it('does not mark a cell that is not on the board yet', () => {
    // A hand tile is a coordinate too. Landing is about what arrived on the
    // board, not about what someone is holding.
    const { container } = render(<Board board={boardWith({})} hand={['E6']} landed="E6" />);
    expect(container.querySelectorAll('[data-landed]')).toHaveLength(0);
  });
});

describe('Board', () => {
  it('labels cells A1-style, never r-c', () => {
    render(<Board board={createEmptyBoard()} />);
    expect(screen.getByTitle('A1')).toBeInTheDocument();
    expect(screen.queryByText('0-0')).not.toBeInTheDocument();
    expect(screen.queryByText('1-1')).not.toBeInTheDocument();
  });

  // The initial is `Z` rather than `A` on purpose, a habit from when row
  // headers rendered A–I beside the grid (removed 2026-08-07) — and `Z` still
  // cannot collide with any coordinate letter, so it stays the safer probe. It matches the
  // badge and throws on the duplicate. Scoping to the cell pins what the test
  // is actually about — the badge is an initial, and it is on that tile.
  it('badges the last-placed tile with an initial, not a full name', () => {
    render(
      <Board
        board={boardWith({ E5: { placed: true } })}
        owners={{ E5: 'Z' } as Record<Coord, string>}
      />,
    );
    expect(within(screen.getByTitle('E5').parentElement!).getByText('Z')).toBeInTheDocument();
    expect(screen.queryByText('Zoe')).not.toBeInTheDocument();
  });

  it('gives chain members a brand ring so neighbours read as one outline', () => {
    const { container } = render(
      <Board board={boardWith({
        E3: { placed: true, startupId: 'Messla' },
        E4: { placed: true, startupId: 'Messla' },
      })} />,
    );
    const rings = container.querySelectorAll('[class*="ring-purple-500"]');
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });

  it('offers no control for a hand tile with nothing to do', () => {
    // Watching someone else's turn online, your own tiles are still yours —
    // but they are not controls, because there is nothing to press them for.
    // Reported by hand as "I'm allowed to click but nothing happens".
    const { container } = render(<Board board={createEmptyBoard()} hand={['C6'] as Coord[]} />);
    expect(container.querySelector('button[title="C6"]')).toBeNull();
    expect(screen.getByTitle('C6').className).not.toMatch(/cursor-pointer/);
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'hand');
  });

  it('is a control once there is something to do with it', () => {
    const { container } = render(
      <Board board={createEmptyBoard()} hand={['C6'] as Coord[]} onCellClick={() => {}} />,
    );
    expect(container.querySelector('button[title="C6"]')).not.toBeNull();
    expect(screen.getByTitle('C6').className).toMatch(/cursor-pointer/);
  });

  it('lights the whole hand by default — online, this is your own screen', () => {
    render(<Board board={createEmptyBoard()} hand={['C6', 'D8'] as Coord[]} />);
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'hand');
    expect(screen.getByTitle('D8')).toHaveAttribute('data-tile-state', 'hand');
  });

  it('marks blocked hand tiles and makes them unclickable', () => {
    const { container } = render(
      <Board board={createEmptyBoard()} hand={['C6'] as Coord[]} blocked={['C6'] as Coord[]} />,
    );
    expect(screen.getByTitle('C6').className).toMatch(/cursor-not-allowed/);
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'blocked');
    // No handler was given, so it is not a control at all — not merely a
    // disabled one. With a handler it renders as a disabled button instead.
    expect(container.querySelector('[title="C6"] button, button[title="C6"]')).toBeNull();
  });

  /**
   * The owner's hotseat ruling — pass-and-play only, which is what
   * `autoHighlight={false}` means: on a shared board nothing is highlighted
   * automatically. A hand tile lights up only while its twin in the panel is
   * pointed at — one at a time — but it stays tappable either way, because
   * the highlight is a hint, not the affordance.
   */
  it('keeps hand tiles unhighlighted until one is pointed at, when told to', () => {
    const { container } = render(
      <Board
        board={createEmptyBoard()}
        hand={['C6', 'D8'] as Coord[]}
        autoHighlight={false}
        onCellClick={() => {}}
      />,
    );
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'empty');
    expect(screen.getByTitle('D8')).toHaveAttribute('data-tile-state', 'empty');
    // Unhighlighted is not inert: both are still the move.
    expect(container.querySelectorAll('button[title="C6"], button[title="D8"]')).toHaveLength(2);
  });

  it('highlights exactly the pointed-at tile, nothing else in the hand', () => {
    render(
      <Board
        board={createEmptyBoard()}
        hand={['C6', 'D8'] as Coord[]}
        autoHighlight={false}
        highlight="C6"
      />,
    );
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'hand');
    expect(screen.getByTitle('D8')).toHaveAttribute('data-tile-state', 'empty');
  });

  it('ignores a highlight that is not in the hand', () => {
    // A stale hover — the tile was just placed, say — must not paint a cell
    // that is no longer anyone's to play.
    render(
      <Board board={createEmptyBoard()} hand={['C6'] as Coord[]} autoHighlight={false} highlight="D8" />,
    );
    expect(screen.getByTitle('D8')).toHaveAttribute('data-tile-state', 'empty');
  });

  it('marks a blocked hand tile only while pointed at, on the shared board', () => {
    render(
      <Board
        board={createEmptyBoard()}
        hand={['C6'] as Coord[]}
        blocked={['C6'] as Coord[]}
        autoHighlight={false}
      />,
    );
    expect(screen.getByTitle('C6')).toHaveAttribute('data-tile-state', 'empty');
  });

  it('shows the ticker on an HQ tile and keeps the coordinate reachable on hover', () => {
    render(<Board board={boardWith({ E3: { placed: true, startupId: 'Messla' } })} hqTiles={['E3'] as Coord[]} />);
    const hq = screen.getByTitle('E3');
    expect(hq.textContent).toContain('$M');
    expect(hq).toHaveAttribute('title', 'E3');
  });

  it('renders 108 cells and nothing else — the headers are gone', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    expect(container.querySelectorAll('[title]').length).toBe(108);
  });
});
