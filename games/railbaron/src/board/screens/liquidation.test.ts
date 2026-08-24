// The forced sale as a takeover screen: the short baron's holdings at the
// bank's half price, and nothing else to do.
import { describe, expect, it } from 'vitest';
import { bankSalePrice, railroadPrice } from '../../../engine';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';
import { PUBLISHED_RULES } from '../../state/rules';
import { shortSeat } from '../../state/turns';
import { liquidation } from './liquidation';

/** Red buys beyond their means (scripted — the fold is tolerant), so the
 *  balance sits below zero with railroads still held. */
const shortLog: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' },
  { type: 'bought', seat: 'red', railroad: 'B&M', price: railroadPrice('B&M') },
  { type: 'bought', seat: 'red', railroad: 'WP', price: railroadPrice('WP') },
];

describe('the liquidation screen', () => {
  it('offers each holding at the bank\'s half price, and names the debt', () => {
    const state = replay(shortLog);
    expect(shortSeat(state)).toBe('red');
    const screen = liquidation(state, state.seats.red);
    expect(screen.sub).toMatch(/ADA/);
    expect(screen.sub).toMatch(/12,000/);   // $4,000 + $8,000 under water

    const sales = screen.rows.filter((row) => row.action?.kind === 'sell');
    expect(sales.map((row) => row.label)).toEqual(['B&M', 'WP']);
    expect(sales[0]!.amount).toBe(bankSalePrice('B&M').toLocaleString('en-US'));
    expect(sales[1]!.amount).toBe(bankSalePrice('WP').toLocaleString('en-US'));
  });
});
