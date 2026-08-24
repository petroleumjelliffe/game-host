// The Total tile and the endgame furniture, driven — like every screen on
// this board — by nothing but replayed state.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine';
import type { CityId } from '../../engine';
import { replay } from '../state/game';
import type { GameEvent, SeatId } from '../state/events';
import { PUBLISHED_RULES } from '../state/rules';
import { MoneyStrip } from './MoneyStrip';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const MIAMI = id('Miami');
const PAY = payoutBetween(CHICAGO, NEW_YORK);
const START = PUBLISHED_RULES.startingCash;

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const opening = (rules: object): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'Ada' },
  { type: 'joined', seat: 'blue', name: 'Ben' },
  { type: 'started', rules: { ...PUBLISHED_RULES, ...rules } } as GameEvent,
  home('red', CHICAGO), home('blue', MIAMI),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

const trip = (rules: object): GameEvent[] => [
  ...opening(rules),
  { type: 'arrived', seat: 'red', city: NEW_YORK,
    region: cityById(NEW_YORK).region, payout: PAY },
  { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
  { type: 'moved', seat: 'red',
    path: [nodeForCity(CHICAGO), nodeForCity(NEW_YORK)], arrived: true },
];

describe('MoneyStrip', () => {
  it("shows each seated baron's banked total in dollars", () => {
    render(<MoneyStrip state={replay(trip({}))} />);
    expect(screen.getByText(`$${(START + PAY).toLocaleString('en-US')}`)).toBeInTheDocument();
    // Ben, no trips yet: the rulebook's starting cash and nothing more.
    expect(screen.getByText(`$${START.toLocaleString('en-US')}`)).toBeInTheDocument();
  });

  it('marks a declared baron with their home city', () => {
    const declared = [
      ...trip({ winTarget: 1000 }),
      { type: 'declared', seat: 'red',
        alternate: { city: MIAMI, region: cityById(MIAMI).region,
                     payout: payoutBetween(NEW_YORK, MIAMI) } },
    ] as GameEvent[];
    render(<MoneyStrip state={replay(declared)} />);
    expect(screen.getByText(/declared — racing home to Chicago/i)).toBeInTheDocument();
  });

  it('marks a seeded game', () => {
    render(<MoneyStrip state={replay(opening({ seed: 'g' }))} />);
    expect(screen.getByText(/seeded/i)).toBeInTheDocument();
  });

  it('announces the winner when the game is over', () => {
    const won = [
      ...trip({ winTarget: 1000 }),
      { type: 'declared', seat: 'red',
        alternate: { city: MIAMI, region: cityById(MIAMI).region,
                     payout: payoutBetween(NEW_YORK, MIAMI) } },
      { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
    ] as GameEvent[];
    render(<MoneyStrip state={replay(won)} />);
    expect(screen.getByText(/Ada wins/i)).toBeInTheDocument();
  });

  it('shows holdings and a signed negative balance', () => {
    // Starting cash zeroed: this test's subject is a negative balance on
    // the strip, and the published $20,000 cushion would keep it positive.
    const indebted = [
      ...opening({ winTarget: 1000, startingCash: 0 }),
      { type: 'bought', seat: 'red', railroad: 'B&M', price: 4000 },
      { type: 'bought', seat: 'red', railroad: 'WP', price: 8000 },
    ] as GameEvent[];
    render(<MoneyStrip state={replay(indebted)} />);
    expect(screen.getByText(/2 RR/)).toBeInTheDocument();
    expect(screen.getByText('−$12,000')).toBeInTheDocument();
  });
});

