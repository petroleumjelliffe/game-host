import { describe, expect, it } from 'vitest';
import { confirm } from './confirm';
import { BOARD_ROWS } from '../types';

describe('the discard confirmation', () => {
  it('offers discard and keep, in that order', () => {
    expect(confirm().rows[0]!.text).toBe('YES, DISCARD');
    expect(confirm().rows[1]!.text).toBe('KEEP PLAYING');
  });

  it('says plainly that discarding cannot be undone', () => {
    expect(confirm().rows[0]!.right).toBe('Cannot undo');
  });

  it('goes back to the saved game rather than to the setup board', () => {
    expect(confirm().back).toBe('saved');
    expect(confirm().rows[1]!.action).toEqual({ kind: 'navigate', to: 'saved' });
  });

  it('fills the board like every other screen', () => {
    expect(confirm().rows).toHaveLength(BOARD_ROWS);
  });
});
