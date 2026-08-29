import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Board } from './Board';
import { emptyBoard } from '../test/fixtures';
import { BOARD_SQUARES, CENTER, PREMIUMS, parseCoord } from '../../engine/constants';
import type { Square } from '../../session/protocol';

const noop = () => {};

describe('Board', () => {
  it('renders all 225 cells', () => {
    render(<Board board={emptyBoard()} staged={[]} onCellTap={noop} />);
    for (const pos of [0, CENTER, BOARD_SQUARES - 1]) {
      expect(screen.getByTestId(`cell-${pos}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('board').children).toHaveLength(BOARD_SQUARES);
  });

  it('marks and labels premium squares where PREMIUMS says', () => {
    render(<Board board={emptyBoard()} staged={[]} onCellTap={noop} />);
    // Spot checks against the printed layout…
    expect(screen.getByTestId(`cell-${parseCoord('A1')}`)).toHaveAttribute('data-premium', 'TW');
    expect(screen.getByTestId(`cell-${parseCoord('B2')}`)).toHaveAttribute('data-premium', 'DW');
    expect(screen.getByTestId(`cell-${parseCoord('F6')}`)).toHaveAttribute('data-premium', 'TL');
    expect(screen.getByTestId(`cell-${parseCoord('A4')}`)).toHaveAttribute('data-premium', 'DL');
    expect(screen.getByTestId(`cell-${parseCoord('A2')}`)).not.toHaveAttribute('data-premium');
    expect(screen.getByTestId(`cell-${parseCoord('A1')}`)).toHaveTextContent('TW');
    // …and every square agrees with the canonical layout.
    for (let pos = 0; pos < BOARD_SQUARES; pos += 1) {
      const premium = PREMIUMS[pos];
      const cell = screen.getByTestId(`cell-${pos}`);
      if (premium == null) expect(cell).not.toHaveAttribute('data-premium');
      else expect(cell).toHaveAttribute('data-premium', premium);
    }
  });

  it('draws the star on the center square', () => {
    render(<Board board={emptyBoard()} staged={[]} onCellTap={noop} />);
    expect(screen.getByTestId(`cell-${CENTER}`)).toHaveTextContent('★');
  });

  it('shows a placed tile as its letter plus point value', () => {
    const board = emptyBoard();
    board[CENTER] = { letter: 'Q', isBlank: false };
    render(<Board board={board} staged={[]} onCellTap={noop} />);
    const cell = screen.getByTestId(`cell-${CENTER}`);
    expect(cell).toHaveTextContent('Q');
    expect(cell).toHaveTextContent('10');
  });

  it('shows a placed blank as lowercase, worth 0, visibly distinct', () => {
    const board: Square[] = emptyBoard();
    board[CENTER] = { letter: 'Z', isBlank: true };
    render(<Board board={board} staged={[]} onCellTap={noop} />);
    const cell = screen.getByTestId(`cell-${CENTER}`);
    expect(cell).toHaveTextContent('z');
    expect(cell).toHaveTextContent('0');
    expect(cell).not.toHaveTextContent('10');
    expect(cell).toHaveAttribute('data-blank');
  });

  it('highlights staged tiles and reports taps', () => {
    const onTap = vi.fn();
    render(
      <Board board={emptyBoard()} staged={[{ pos: 7, tile: 'A' }]} onCellTap={onTap} />,
    );
    const stagedCell = screen.getByTestId('cell-7');
    expect(stagedCell).toHaveAttribute('data-staged');
    expect(stagedCell).toHaveTextContent('A');
    fireEvent.click(stagedCell);
    fireEvent.click(screen.getByTestId('cell-8'));
    expect(onTap.mock.calls).toEqual([[7], [8]]);
  });
});
