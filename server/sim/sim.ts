// The whole game world as a pure-ish module: `tick` mutates the state it is
// given and returns the sounds that happened. Nothing here knows sockets,
// rooms, or seats — that is what makes every rule below unit-testable.

import { TUNING, type GameEvent, type Role } from '../../protocol/game.js';

export type SimEvent = Extract<GameEvent, { type: 'call' | 'reply' }>;

export interface SimPlayer {
  id: string;
  role: Role;
  x: number;
  y: number;
  tx: number | null;
  ty: number | null;
  turboHeld: boolean;
  /** 0..1 */
  turbo: number;
}

export interface SimState {
  players: SimPlayer[];
  marcoId: string;
  /** Seconds since the round started. */
  elapsed: number;
  /** Seconds until MARCO may be called again; 0 = ready. */
  callCooldown: number;
  /** `elapsed` at which the forced polo replies fire, or null. */
  replyDue: number | null;
  over:
    | { reason: 'catch'; caughtId: string }
    | { reason: 'timeout'; caughtId: null }
    | null;
}

export function ringRadius(elapsed: number): number {
  const { arenaRadius, graceSeconds, roundSeconds, endRadiusFraction } = TUNING;
  if (elapsed <= graceSeconds) return arenaRadius;
  const t = Math.min(1, (elapsed - graceSeconds) / (roundSeconds - graceSeconds));
  return arenaRadius - t * arenaRadius * (1 - endRadiusFraction);
}

export function createRound(
  playerIds: readonly string[],
  marcoId: string,
  rng: () => number = Math.random,
): SimState {
  const players = playerIds.map((id): SimPlayer => {
    const base = { id, tx: null, ty: null, turboHeld: false, turbo: 1 };
    if (id === marcoId) return { ...base, role: 'marco', x: 0, y: 0 };
    const angle = rng() * 2 * Math.PI;
    const r = 0.4 + 0.5 * rng();
    return { ...base, role: 'polo', x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
  return { players, marcoId, elapsed: 0, callCooldown: 0, replyDue: null, over: null };
}

/**
 * Whatever the socket delivered, typed by wishful thinking. A partially valid
 * message is ignored wholesale rather than half-applied, so a malformed
 * client can never wedge a player into a state no honest client produces.
 */
export function applyInput(state: SimState, playerId: string, msg: unknown): void {
  if (state.over) return;
  const p = state.players.find((q) => q.id === playerId);
  if (!p || typeof msg !== 'object' || msg === null) return;
  const { tx, ty, turbo } = msg as Record<string, unknown>;
  const coord = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1.5;
  const stop = tx === null && ty === null;
  if (!(stop || (coord(tx) && coord(ty))) || typeof turbo !== 'boolean') return;
  p.tx = stop ? null : (tx as number);
  p.ty = stop ? null : (ty as number);
  p.turboHeld = turbo;
}

export function tryCall(state: SimState): SimEvent | null {
  if (state.over || state.callCooldown > 0) return null;
  const marco = state.players.find((p) => p.id === state.marcoId)!;
  state.callCooldown = TUNING.callCooldownSeconds;
  state.replyDue = state.elapsed + TUNING.replyDelaySeconds;
  return { type: 'call', x: marco.x, y: marco.y };
}

export function tick(state: SimState, dt: number): SimEvent[] {
  if (state.over) return [];
  const events: SimEvent[] = [];
  state.elapsed += dt;
  state.callCooldown = Math.max(0, state.callCooldown - dt);

  const maxLen = ringRadius(state.elapsed) - TUNING.avatarRadius;
  for (const p of state.players) {
    const boosting = p.turboHeld && p.turbo > 0;
    if (boosting) p.turbo = Math.max(0, p.turbo - dt / TUNING.turboFullSeconds);
    else if (!p.turboHeld) p.turbo = Math.min(1, p.turbo + dt / TUNING.turboRechargeSeconds);

    if (p.tx !== null && p.ty !== null) {
      const speed = TUNING.baseSpeed * (boosting ? TUNING.turboMultiplier : 1);
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = speed * dt;
      if (dist <= step) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }

    const len = Math.hypot(p.x, p.y);
    if (len > maxLen) {
      p.x *= maxLen / len;
      p.y *= maxLen / len;
    }
  }

  if (state.replyDue !== null && state.elapsed >= state.replyDue) {
    state.replyDue = null;
    for (const p of state.players) {
      if (p.role === 'polo') events.push({ type: 'reply', playerId: p.id, x: p.x, y: p.y });
    }
  }

  const marco = state.players.find((p) => p.id === state.marcoId)!;
  for (const p of state.players) {
    if (p.role !== 'polo') continue;
    if (Math.hypot(p.x - marco.x, p.y - marco.y) <= 2 * TUNING.avatarRadius) {
      state.over = { reason: 'catch', caughtId: p.id };
      return events;
    }
  }
  if (state.elapsed >= TUNING.roundSeconds) state.over = { reason: 'timeout', caughtId: null };
  return events;
}
