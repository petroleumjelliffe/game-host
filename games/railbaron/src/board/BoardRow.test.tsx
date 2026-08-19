import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardRow, BOARD_COLUMN_WIDTHS, BOARD_TILE } from './BoardRow';
import { FLAP_WIDTH } from './alphabet';
import { staticFaces, staticPanel } from './drum';
import { AMOUNT_WIDTH } from './choreography';
import { blankRow, type Row } from './types';

const row: Row = {
  label: 'Seat 1', status: 'Ready', text: 'ADA',
  amount: '42,000', showDollar: true, right: 'Tap to edit',
  chip: '#e02b1d', tone: 'normal',
  action: { kind: 'navigate', to: 'play' }
};

/** Settled in every column: the flap sequence has its own tests. */
const settledProps = (r: Row) => ({
  row: r,
  faces: staticFaces(r.text),
  status: staticPanel(r.status),
  amount: staticFaces(r.amount, AMOUNT_WIDTH),
  amountSettled: true
});

const render1 = (r: Row, onAct = () => {}) =>
  render(<BoardRow {...settledProps(r)} onAct={onAct} />);

/**
 * jsdom runs no layout, so it cannot see tiles spilling out of a column —
 * the way a human looking at the running app did, in the bug that produced
 * the original column budgets. But a per-character field's occupied width
 * is knowable by arithmetic from what actually rendered, and both numbers
 * come from the live DOM and the component's own exported constants rather
 * than being restated here.
 */
function occupiedWidth(container: Element): number {
  const tiles = container.querySelectorAll('[data-flap]');
  return tiles.length * BOARD_TILE.width + Math.max(0, tiles.length - 1) * BOARD_TILE.gap;
}

const dollar = (container: HTMLElement) => container.querySelector('[data-dollar]');

describe('a board row', () => {
  it('renders one tile per character position of the destination field', () => {
    const { container } = render1(row);
    const column = container.querySelector('[data-column="destination"]')!;
    expect(column.querySelectorAll('[data-flap]')).toHaveLength(FLAP_WIDTH);
  });

  it('renders the payout as flaps too, one per character it can hold', () => {
    const { container } = render1(row);
    const column = container.querySelector('[data-column="amount"]')!;
    expect(column.querySelectorAll('[data-flap]')).toHaveLength(AMOUNT_WIDTH);
  });

  it('fits the destination field inside its declared column', () => {
    const { container } = render1(row);
    const column = container.querySelector('[data-column="destination"]')!;
    expect(occupiedWidth(column)).toBeLessThanOrEqual(BOARD_COLUMN_WIDTHS.destination);
  });

  it('reads out as plain text for anything not looking at pixels', () => {
    render1(row);
    expect(screen.getByText('ADA')).toBeInTheDocument();
  });

  it('is a button when it has an action', () => {
    render1(row);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls back when tapped', () => {
    const onAct = vi.fn();
    render1(row, onAct);
    screen.getByRole('button').click();
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it('is not a button when it has no action', () => {
    render1({ ...row, action: null });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not call back when disabled, even though it still shows an action', () => {
    const onAct = vi.fn();
    render1({ ...row, tone: 'disabled' }, onAct);
    screen.getByRole('button').click();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('prints the dollar sign where the column is money, and nowhere else', () => {
    // The menu screens borrow this column for a player count, and a dollar
    // sign in front of "2-6" is a different claim entirely. The space is
    // still reserved, so the tiles line up down the whole board.
    expect(dollar(render1(row).container)).not.toBeNull();

    const { container } = render1({ ...row, showDollar: false });
    expect(container.querySelector('[data-dollar]')).toBeNull();
  });

  it('leaves the dollar sign alone while the payout is turning', () => {
    // It is printed on the board, not flapped onto it. A sign that came and
    // went would say something about the figure before the figure landed.
    const turning = render(
      <BoardRow {...settledProps(row)} amountSettled={false} onAct={() => {}} />
    );
    expect(getComputedStyle(dollar(turning.container)!).visibility).toBe('visible');
  });

  it('renders a blank row with no action and a full set of blank tiles', () => {
    const { container } = render1(blankRow());
    expect(container.querySelector('button')).toBeNull();
    const column = container.querySelector('[data-column="destination"]')!;
    expect(column.querySelectorAll('[data-flap]')).toHaveLength(FLAP_WIDTH);
  });

  it('puts an input in the destination column without displacing the rest of the row', () => {
    // Typing a name happens *in* the board, not in place of a row of it:
    // the chip, seat label, state and note all stay put.
    const { container } = render(
      <BoardRow {...settledProps(row)} onAct={() => {}} input={<input />} />
    );
    const destination = container.querySelector('[data-column="destination"]')!;
    expect(destination.querySelector('input')).not.toBeNull();
    expect(destination.querySelectorAll('[data-flap]')).toHaveLength(0);
    expect(screen.getByText('SEAT 1')).toBeInTheDocument();
    // The panel's own leaves, not its rendered text — each leaf carries the
    // value, so textContent holds it twice.
    expect(container.querySelector('[data-column="status"] [data-flap]')!
      .getAttribute('data-flap')).toBe('Ready');
  });

  it('does not act on a tap while it is being typed into', () => {
    const onAct = vi.fn();
    const { container } = render(
      <BoardRow {...settledProps(row)} onAct={onAct} input={<input />} />
    );
    container.querySelector('button')?.click();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('keeps every column inside the width the board budgets for a row', () => {
    // The five columns, their gaps and the row's own padding have to fit
    // the board's inner width. The design has three pixels of slack, so
    // this is worth asserting rather than assuming.
    const gaps = 5 * BOARD_TILE.columnGap;
    const total =
      Object.values(BOARD_COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0) +
      gaps +
      2 * BOARD_TILE.rowPadding;
    expect(total).toBeLessThanOrEqual(BOARD_TILE.rowWidth);
  });
});
