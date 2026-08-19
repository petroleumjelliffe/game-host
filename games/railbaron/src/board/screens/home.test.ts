import { describe, expect, it } from 'vitest';
import { home } from './home';
import { BOARD_ROWS } from '../types';

describe('the home screen', () => {
  it('states both modes as destinations', () => {
    const rows = home().rows;
    expect(rows[0]!.text).toBe('PASS AND PLAY');
    expect(rows[1]!.text).toBe('PLAY ONLINE');
  });

  it('fills the board to seven rows like every other screen', () => {
    expect(home().rows).toHaveLength(BOARD_ROWS);
  });

  it('sends pass-and-play somewhere real', () => {
    expect(home().rows[0]!.action).toEqual({ kind: 'navigate', to: 'passAndPlay' });
  });

  it('sends online somewhere real too', () => {
    // The mode select's whole statement is that both modes exist. Online was
    // shown disabled while it was being built rather than hidden, for that
    // reason; the row kept its place and has gained its action.
    const online = home().rows[1]!;
    expect(online.tone).toBe('normal');
    expect(online.action).toEqual({ kind: 'navigate', to: 'joinRoom' });
  });

  it('has nowhere to go back to', () => {
    expect(home().back).toBeNull();
  });
});
