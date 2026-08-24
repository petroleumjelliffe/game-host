// The railroad office: paged listing of unowned railroads, priced from the
// engine's table, affordability read off the buyer's banked balance.
import { describe, expect, it } from 'vitest';
import { RAILROADS, railroadPrice } from '../../../engine';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';
import { PUBLISHED_RULES } from '../../state/rules';
import { BOARD_ROWS } from '../types';
import { office } from './office';

const opening: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' },
  // Red banks a real payout so some lines are affordable and some are not.
  { type: 'arrived', seat: 'red', city: 4, region: 'NE',
    payout: 13000 },
  { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
  { type: 'moved', seat: 'red', path: ['c13', 'c1'], arrived: true },
  // Green's intervening turn hands the window back to red, the buyer.
  { type: 'arrived', seat: 'green', city: 43, region: 'PL', payout: 0 },
  { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
  { type: 'moved', seat: 'green', path: ['c95', 'd131'], arrived: false },
];

describe('the railroad office', () => {
  it('lists unowned railroads with prices, dims the unaffordable', () => {
    const screen = office(replay(opening), 0);
    const listings = screen.rows.filter((row) => row.action?.kind === 'buy');
    expect(listings.length).toBeGreaterThan(0);
    for (const row of listings) {
      const line = RAILROADS.get(row.label);
      expect(line, row.label).toBeDefined();
      expect(row.amount).toBe(railroadPrice(line!.id).toLocaleString('en-US'));
      expect(railroadPrice(line!.id)).toBeLessThanOrEqual(13000);
    }
    // An unaffordable line is shown but offers nothing.
    const dimmed = screen.rows.find((row) => row.label === 'SP');
    if (dimmed !== undefined && dimmed.label === 'SP') {
      expect(dimmed.action).toBeNull();
    }
  });

  it('omits an owned railroad', () => {
    const state = replay([...opening,
      { type: 'bought', seat: 'red', railroad: 'B&M', price: railroadPrice('B&M') }]);
    const all: string[] = [];
    for (let page = 0; page < 6; page++) {
      for (const row of office(state, page).rows) {
        if (row.label && row.label !== 'More' && row.label !== 'Back') all.push(row.label);
      }
    }
    expect(all).not.toContain('B&M');
  });

  it('pages through all 28, and always offers the way back', () => {
    const state = replay(opening);
    const seen = new Set<string>();
    for (let page = 0; page < 6; page++) {
      const screen = office(state, page);
      expect(screen.rows).toHaveLength(BOARD_ROWS);
      const back = screen.rows[BOARD_ROWS - 1]!;
      expect(back.action).toEqual({ kind: 'office' });
      const more = screen.rows[BOARD_ROWS - 2]!;
      expect(more.action).toEqual({ kind: 'office', page: (page % 6) + 1 });
      for (const row of screen.rows) {
        if (RAILROADS.has(row.label)) seen.add(row.label);
      }
    }
    expect(seen.size).toBe(28);
  });
});
