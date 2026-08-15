import { describe, expect, it } from 'vitest';
import type { GameEvent, StateMessage } from '../../../protocol/game';
import { initialSession, liveRipples, onEvent, onState, RIPPLE_MS } from './sessionState';

const snap = { round: 1, phase: 'grace' } as StateMessage;

describe('session reducer', () => {
  it('keeps the latest snapshot', () => {
    expect(onState(initialSession, snap).latest).toBe(snap);
  });

  it('turns calls and replies into ripples with the right word', () => {
    let s = onEvent(initialSession, { type: 'call', x: 0.1, y: 0.2 }, 1000);
    s = onEvent(s, { type: 'reply', playerId: 'p2', x: 0.3, y: 0.4 }, 2000);
    expect(s.ripples).toEqual([
      { word: 'marco', x: 0.1, y: 0.2, at: 1000 },
      { word: 'polo', x: 0.3, y: 0.4, at: 2000 },
    ]);
  });

  it('records roundEnd and clears it (and ripples) on roundStart', () => {
    const end: GameEvent = {
      type: 'roundEnd', reason: 'catch', caughtId: 'p2', nextMarcoId: 'p2', scores: { p1: 0 },
    };
    let s = onEvent(initialSession, { type: 'call', x: 0, y: 0 }, 0);
    s = onEvent(s, end, 1);
    expect(s.roundEnd).toMatchObject({ caughtId: 'p2' });
    s = onEvent(s, { type: 'roundStart', round: 2, marcoId: 'p2' }, 2);
    expect(s.roundEnd).toBeNull();
    expect(s.ripples).toEqual([]);
  });

  it('ages ripples out after RIPPLE_MS', () => {
    const ripples = [{ word: 'polo' as const, x: 0, y: 0, at: 1000 }];
    expect(liveRipples(ripples, 1000 + RIPPLE_MS - 1)).toHaveLength(1);
    expect(liveRipples(ripples, 1000 + RIPPLE_MS + 1)).toHaveLength(0);
  });
});
