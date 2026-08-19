import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { BOARD_ROWS, blankRow, type Row, type ScreenDef } from './types';

const choice = (text: string): Row => ({
  label: 'Mode 01', status: 'Local', text, amount: '2-6', showDollar: false,
  right: 'One device', chip: '#f5c451', tone: 'normal',
  action: { kind: 'navigate', to: 'passAndPlay' }
});

const screenDef = (rows: Row[]): ScreenDef => ({
  title: 'Departures', sub: 'CHOOSE A MODE', back: null,
  cols: ['Mode', 'Where', 'Select', 'Players', 'Notes'],
  rows
});

const board = (def: ScreenDef) => (
  <Board screen={def} onRowAct={() => {}} onBack={() => {}} />
);

/** The tiles of one row's destination field, as the characters on show. */
const tilesOfRow = (container: HTMLElement, index: number) =>
  [...container.querySelectorAll('[data-board-row]')[index]!
    .querySelector('[data-column="destination"]')!.querySelectorAll('[data-flap]')]
    .map(tile => tile.getAttribute('data-flap'))
    .join('')
    .trimEnd();

afterEach(() => { vi.useRealTimers(); });

describe('the board', () => {
  it('always renders seven rows, however few the screen defines', () => {
    const { container } = render(board(screenDef([choice('PASS AND PLAY')])));
    expect(container.querySelectorAll('[data-board-row]')).toHaveLength(BOARD_ROWS);
  });

  it('still renders seven rows when the screen defines too many', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => choice(`ROW ${i}`));
    const { container } = render(board(screenDef(tooMany)));
    expect(container.querySelectorAll('[data-board-row]')).toHaveLength(BOARD_ROWS);
  });

  it('reports which row was acted on', () => {
    const onRowAct = vi.fn();
    render(
      <Board
        screen={screenDef([blankRow(), choice('PLAY ONLINE')])}
        onRowAct={onRowAct}
        onBack={() => {}}
      />
    );
    screen.getByText('PLAY ONLINE').click();
    expect(onRowAct).toHaveBeenCalledWith(expect.objectContaining({ text: 'PLAY ONLINE' }), 1);
  });

  it('shows a back control only when the screen has somewhere to go back to', () => {
    const { rerender } = render(board(screenDef([])));
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();

    rerender(board({ ...screenDef([]), back: 'home' }));
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('shows the screen title and its column headings', () => {
    render(board(screenDef([])));
    expect(screen.getByText('CHOOSE A MODE')).toBeInTheDocument();
    expect(screen.getByText('Select')).toBeInTheDocument();
  });

  it('reads out the destination throughout a flap, not the spinning tiles', () => {
    // A screen reader must not narrate two seconds of alphabet.
    vi.useFakeTimers();
    const { container, rerender } = render(board(screenDef([choice('PASS AND PLAY')])));
    rerender(board(screenDef([choice('PLAY ONLINE')])));
    act(() => { vi.advanceTimersByTime(52); });

    expect(tilesOfRow(container, 0)).not.toBe('PLAY ONLINE');
    expect(screen.getByText('PLAY ONLINE')).toBeInTheDocument();
  });

  it('turns the status panel rather than blanking it', () => {
    // It used to blank and come back, which read as a page swap. Now it is a
    // panel that flips like every other field on the board.
    vi.useFakeTimers();
    const face = (container: HTMLElement) =>
      container.querySelector('[data-column="status"] [data-flap]')!.getAttribute('data-flap');

    const { container, rerender } = render(board(screenDef([choice('PASS AND PLAY')])));
    expect(face(container)).toBe('Local');

    rerender(board(screenDef([{ ...choice('PLAY ONLINE'), status: 'Online' }])));

    // It turns a full lap rather than stepping straight across, so it passes
    // through values that are neither where it started nor where it lands —
    // including the target itself, which it does not stop on first time past.
    const seen = new Set<string | null>();
    for (let tick = 0; tick < 12; tick++) {
      act(() => { vi.advanceTimersByTime(52); });
      seen.add(face(container));
    }
    expect(seen.size).toBeGreaterThan(2);

    act(() => { vi.advanceTimersByTime(52 * 60); });
    expect(face(container)).toBe('Online');
  });
});

/**
 * The staged reveal. These drive the board the way a roll does — one row's
 * three fields all change at once — and watch what is legible at each stage.
 */
describe('the order a roll is revealed in', () => {
  const rolled = (status: string, text: string, amount: string): Row => ({
    label: 'Ada', status, text, amount, showDollar: amount !== '',
    right: '', chip: '#e02b1d', tone: 'normal',
    action: { kind: 'act', seat: 'red' }
  });

  const rollScreen = (row: Row) => screenDef([row]);

  // Each flap renders its character twice — once per leaf — so textContent
  // doubles. The arriving face is what is on show.
  const columnText = (container: HTMLElement, column: string) =>
    [...container.querySelectorAll('[data-board-row]')[0]!
      .querySelector(`[data-column="${column}"]`)!.querySelectorAll('[data-flap]')]
      .map(flap => flap.getAttribute('data-flap'))
      .join('')
      .trim();

  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('says nothing about the payout while the city is still turning', () => {
    // The defect this sequence exists to fix: the figure used to be printed
    // the instant the row was tapped, so the answer was on the board for the
    // two seconds the city spent pretending to look for it.
    vi.useFakeTimers();
    const { container, rerender } = render(board(rollScreen(rolled('Northeast', 'Boston', ''))));
    rerender(board(rollScreen(rolled('Plains', 'Denver', '21,000'))));

    tick(52 * 6);
    expect(tilesOfRow(container, 0)).not.toBe('DENVER');
    expect(columnText(container, 'amount')).not.toContain('21,000');
  });

  it('lands the region, then the city, then the payout', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(board(rollScreen(rolled('Northeast', 'Boston', ''))));
    rerender(board(rollScreen(rolled('Plains', 'Denver', '21,000'))));

    const arrived = { status: -1, text: -1, amount: -1 };
    for (let t = 1; t <= 120; t++) {
      tick(52);
      if (arrived.status < 0 && columnText(container, 'status') === 'Plains') arrived.status = t;
      if (arrived.text < 0 && tilesOfRow(container, 0) === 'DENVER') arrived.text = t;
      if (arrived.amount < 0 && columnText(container, 'amount').includes('21,000')) {
        arrived.amount = t;
      }
    }

    expect(arrived.status).toBeGreaterThan(0);
    expect(arrived.status).toBeLessThan(arrived.text);
    expect(arrived.text).toBeLessThan(arrived.amount);
  });

  it('holds the HOME note back with the payout it stands in for', () => {
    vi.useFakeTimers();
    const home: Row = { ...rolled('Plains', 'Denver', ''), right: 'Home' };
    const { container, rerender } = render(board(rollScreen(rolled('Northeast', 'Boston', '5,000'))));
    rerender(board(rollScreen(home)));

    tick(52 * 4);
    expect(columnText(container, 'right')).toBe('');

    tick(52 * 200);
    expect(columnText(container, 'right')).toBe('Home');
  });
});
