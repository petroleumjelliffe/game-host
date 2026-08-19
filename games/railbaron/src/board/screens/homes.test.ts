import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../state/events';
import { replay } from '../../state/game';
import { homes } from './homes';

const started: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' }
];

const withRedHome: GameEvent[] = [...started,
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }];

const bothHomed: GameEvent[] = [...withRedHome,
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null }];

describe('the homes screen', () => {
  it('is always seven rows', () => {
    expect(homes(replay(started)).rows).toHaveLength(7);
  });

  it('offers the roll to the first baron without a home, and no one else', () => {
    const rows = homes(replay(started)).rows;
    expect(rows[0]!.action).toEqual({ kind: 'act', seat: 'red' });
    expect(rows[1]!.action).toBeNull();
  });

  it('moves the offer along in seat order', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.action).toBeNull();
    expect(rows[1]!.action).toEqual({ kind: 'act', seat: 'green' });
  });

  it('shows a home city once it is rolled', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.text).toBe('Minneapolis');
    expect(rows[0]!.status).toBe('Plains');
  });

  it('shows no payout for a home town — it pays nothing', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.amount).toBe('');
    expect(rows[0]!.right).toBe('Home');
  });

  it('offers the roll for first player only once every home is in', () => {
    const before = homes(replay(withRedHome)).rows;
    expect(before.some(row => row.action?.kind === 'order')).toBe(false);
    const after = homes(replay(bothHomed)).rows;
    expect(after.some(row => row.action?.kind === 'order')).toBe(true);
  });

  it('shows only the rolling baron the region while it is still turning', () => {
    const rows = homes(replay(started), { seat: 'red', region: 'NE' }).rows;
    expect(rows[0]!.status).toBe('Northeast');
    expect(rows[0]!.text).toBe('');
  });
});
