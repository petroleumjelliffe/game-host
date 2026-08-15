// Pure reducer over server messages — the hook is a thin shell around this,
// so everything the screens depend on is testable without a socket.

import type { GameEvent, StateMessage } from '../../../protocol/game';

export const RIPPLE_MS = 2000;

export interface Ripple {
  word: 'marco' | 'polo';
  x: number;
  y: number;
  at: number;
}

export interface SessionState {
  latest: StateMessage | null;
  ripples: Ripple[];
  roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null;
}

export const initialSession: SessionState = { latest: null, ripples: [], roundEnd: null };

export function onState(s: SessionState, msg: StateMessage): SessionState {
  return { ...s, latest: msg };
}

export function onEvent(s: SessionState, ev: GameEvent, now: number): SessionState {
  switch (ev.type) {
    case 'call':
      return { ...s, ripples: [...liveRipples(s.ripples, now), { word: 'marco', x: ev.x, y: ev.y, at: now }] };
    case 'reply':
      return { ...s, ripples: [...liveRipples(s.ripples, now), { word: 'polo', x: ev.x, y: ev.y, at: now }] };
    case 'roundEnd':
      return { ...s, roundEnd: ev };
    case 'roundStart':
      return { ...s, roundEnd: null, ripples: [] };
  }
}

export function liveRipples(ripples: Ripple[], now: number): Ripple[] {
  return ripples.filter((r) => now - r.at < RIPPLE_MS);
}
