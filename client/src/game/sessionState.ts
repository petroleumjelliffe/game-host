// Pure reducer over server messages — the hook is a thin shell around this,
// so everything the screens depend on is testable without a socket.

import type { GameEvent, StateMessage } from '../../../protocol/game';

export const RIPPLE_MS = 2000;
/** Splashes are quieter than voices: smaller rings, faster fade. */
export const SPLASH_MS = 1000;

export interface Ripple {
  kind: 'call' | 'reply' | 'splash';
  /** Who made the sound — the client colors the voice by it. */
  playerId: string;
  /** Drawn only on a burst's lead ping; trailing pings are bare rings. */
  word: 'marco' | 'polo' | null;
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

function addRipple(s: SessionState, ripple: Ripple, now: number): SessionState {
  return { ...s, ripples: [...liveRipples(s.ripples, now), ripple] };
}

export function onEvent(s: SessionState, ev: GameEvent, now: number): SessionState {
  switch (ev.type) {
    case 'call':
      return addRipple(
        s,
        { kind: 'call', playerId: ev.playerId, word: ev.lead ? 'marco' : null, x: ev.x, y: ev.y, at: now },
        now,
      );
    case 'reply':
      return addRipple(
        s,
        { kind: 'reply', playerId: ev.playerId, word: ev.lead ? 'polo' : null, x: ev.x, y: ev.y, at: now },
        now,
      );
    case 'splash':
      return addRipple(
        s,
        { kind: 'splash', playerId: ev.playerId, word: null, x: ev.x, y: ev.y, at: now },
        now,
      );
    case 'roundEnd':
      return { ...s, roundEnd: ev };
    case 'roundStart':
      return { ...s, roundEnd: null, ripples: [] };
  }
}

export function liveRipples(ripples: Ripple[], now: number): Ripple[] {
  return ripples.filter((r) => now - r.at < (r.kind === 'splash' ? SPLASH_MS : RIPPLE_MS));
}
