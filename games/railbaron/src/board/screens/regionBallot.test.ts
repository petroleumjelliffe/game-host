import { describe, expect, it } from 'vitest';
import { regionBallot } from './regionBallot';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';
import { BOARD_ROWS } from '../types';
import { REGIONS } from '../../../engine';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
  { type: 'regionRequested', seat: 'red', rolled: 'NC' }
];

const seat = () => replay(log).seats.red;
const rows = () => regionBallot(seat()).rows;

describe('the region ballot', () => {
  it('fills the board exactly — seven regions, seven rows', () => {
    // Not a coincidence worth relying on silently: if a region were ever
    // added, this is where it would show up.
    expect(REGIONS).toHaveLength(BOARD_ROWS);
    expect(rows()).toHaveLength(BOARD_ROWS);
    expect(rows().every(row => row.text.length > 0)).toBe(true);
  });

  it('offers every region as a choice', () => {
    const texts = rows().map(row => row.text);
    expect(texts).toContain('Northeast');
    expect(texts).toContain('Southwest');
    expect(texts).toContain('North Central');
  });

  it('dims the region just rolled, which is why the ballot opened', () => {
    const northCentral = rows().find(row => row.text === 'North Central')!;
    expect(northCentral.tone).toBe('dim');
  });

  it('leaves the other regions choosable', () => {
    const northeast = rows().find(row => row.text === 'Northeast')!;
    expect(northeast.tone).toBe('normal');
    expect(northeast.action).toEqual({ kind: 'act', seat: 'red' });
  });

  it('carries the choosing baron’s colour on every row', () => {
    expect(rows().every(row => row.chip === '#e02b1d')).toBe(true);
  });

  it('names the baron who has to choose', () => {
    expect(regionBallot(seat()).sub).toContain('ADA');
  });
});
