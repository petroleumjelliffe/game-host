import { describe, expect, it } from 'vitest';
import type { GameEvent, StateMessage } from '../../../protocol/game';
import {
  initialSession,
  liveRipples,
  onEvent,
  onState,
  RIPPLE_MS,
  SPLASH_MS,
  type Ripple,
} from './sessionState';

const snap = { round: 1, phase: 'grace' } as StateMessage;

describe('session reducer', () => {
  it('keeps the latest snapshot', () => {
    expect(onState(initialSession, snap).latest).toBe(snap);
  });

  it('turns pings into ripples — the word only on the lead ping of a burst', () => {
    let s = onEvent(
      initialSession,
      { type: 'call', playerId: 'p1', x: 0.1, y: 0.2, lead: true },
      1000,
    );
    s = onEvent(s, { type: 'call', playerId: 'p1', x: 0.15, y: 0.2, lead: false }, 1250);
    s = onEvent(s, { type: 'reply', playerId: 'p2', x: 0.3, y: 0.4, lead: true }, 2000);
    s = onEvent(s, { type: 'reply', playerId: 'p2', x: 0.35, y: 0.4, lead: false }, 2250);
    expect(s.ripples).toEqual([
      { kind: 'call', playerId: 'p1', word: 'marco', x: 0.1, y: 0.2, at: 1000 },
      { kind: 'call', playerId: 'p1', word: null, x: 0.15, y: 0.2, at: 1250 },
      { kind: 'reply', playerId: 'p2', word: 'polo', x: 0.3, y: 0.4, at: 2000 },
      { kind: 'reply', playerId: 'p2', word: null, x: 0.35, y: 0.4, at: 2250 },
    ]);
  });

  it('turns splashes into wordless ripples', () => {
    const s = onEvent(initialSession, { type: 'splash', playerId: 'p3', x: 0.5, y: 0.6 }, 3000);
    expect(s.ripples).toEqual([
      { kind: 'splash', playerId: 'p3', word: null, x: 0.5, y: 0.6, at: 3000 },
    ]);
  });

  it('records roundEnd and clears it (and ripples) on roundStart', () => {
    const end: GameEvent = {
      type: 'roundEnd', reason: 'catch', caughtId: 'p2', nextMarcoId: 'p2', scores: { p1: 0 },
    };
    let s = onEvent(initialSession, { type: 'call', playerId: 'p1', x: 0, y: 0, lead: true }, 0);
    s = onEvent(s, end, 1);
    expect(s.roundEnd).toMatchObject({ caughtId: 'p2' });
    s = onEvent(s, { type: 'roundStart', round: 2, marcoId: 'p2' }, 2);
    expect(s.roundEnd).toBeNull();
    expect(s.ripples).toEqual([]);
  });

  it('ages voice ripples out after RIPPLE_MS and splashes after the shorter SPLASH_MS', () => {
    const voice: Ripple = { kind: 'reply', playerId: 'p2', word: 'polo', x: 0, y: 0, at: 1000 };
    const splash: Ripple = { kind: 'splash', playerId: 'p2', word: null, x: 0, y: 0, at: 1000 };
    expect(liveRipples([voice, splash], 1000 + SPLASH_MS - 1)).toHaveLength(2);
    expect(liveRipples([voice, splash], 1000 + SPLASH_MS + 1)).toEqual([voice]);
    expect(liveRipples([voice, splash], 1000 + RIPPLE_MS + 1)).toHaveLength(0);
  });
});
