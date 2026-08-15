import { describe, expect, it } from 'vitest';
import { TUNING } from '../../protocol/game.js';
import { applyInput, createRound, tick, ringRadius } from './sim.js';

const ids = ['p1', 'p2', 'p3'];

describe('createRound', () => {
  it('spawns marco at the center and polos inside the arena', () => {
    const state = createRound(ids, 'p2', () => 0.5);
    const marco = state.players.find((p) => p.id === 'p2')!;
    expect(marco.role).toBe('marco');
    expect([marco.x, marco.y]).toEqual([0, 0]);
    for (const p of state.players.filter((q) => q.role === 'polo')) {
      expect(Math.hypot(p.x, p.y)).toBeLessThan(TUNING.arenaRadius);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0.1);
    }
    expect(state.players.every((p) => p.turbo === 1)).toBe(true);
  });
});

describe('movement', () => {
  it('moves toward the target at base speed', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: false });
    tick(state, 1);
    const marco = state.players[0]!;
    expect(marco.x).toBeCloseTo(TUNING.baseSpeed, 5);
    expect(marco.y).toBeCloseTo(0, 5);
  });

  it('arrives exactly at a near target instead of overshooting', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.1, ty: 0, turbo: false });
    tick(state, 1);
    expect(state.players[0]!.x).toBeCloseTo(0.1, 5);
  });

  it('stands still with a null target', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    tick(state, 1);
    expect(state.players[0]!.x).toBe(0);
  });

  it('clamps inside the arena edge', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 1.4, ty: 0, turbo: false });
    for (let i = 0; i < 200; i++) tick(state, 0.05);
    const marco = state.players[0]!;
    expect(Math.hypot(marco.x, marco.y)).toBeLessThanOrEqual(
      TUNING.arenaRadius - TUNING.avatarRadius + 1e-9,
    );
  });
});

describe('applyInput validation', () => {
  it('ignores malformed messages wholesale', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: Number.NaN, ty: 0, turbo: false });
    applyInput(state, 'p1', { tx: 99, ty: 0, turbo: false });
    applyInput(state, 'p1', { tx: 0.5, ty: 0.5, turbo: 'yes' });
    applyInput(state, 'p1', 'garbage');
    applyInput(state, 'nobody', { tx: 0.5, ty: 0.5, turbo: false });
    expect(state.players[0]!.tx).toBeNull();
    expect(state.players[0]!.turboHeld).toBe(false);
  });

  it('accepts a stop (both null)', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.5, ty: 0.5, turbo: false });
    applyInput(state, 'p1', { tx: null, ty: null, turbo: false });
    expect(state.players[0]!.tx).toBeNull();
  });
});

describe('turbo', () => {
  it('doubles speed and drains while held', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: true });
    tick(state, 0.5);
    const marco = state.players[0]!;
    expect(marco.x).toBeCloseTo(TUNING.baseSpeed * TUNING.turboMultiplier * 0.5, 5);
    expect(marco.turbo).toBeCloseTo(1 - 0.5 / TUNING.turboFullSeconds, 5);
  });

  it('falls back to base speed once empty, and does not recharge while held', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: true });
    for (let i = 0; i < 40; i++) tick(state, 0.05); // 2s > turboFullSeconds
    const marco = state.players[0]!;
    expect(marco.turbo).toBe(0);
    const before = marco.x;
    tick(state, 0.1);
    expect(marco.x - before).toBeCloseTo(TUNING.baseSpeed * 0.1, 5);
    expect(marco.turbo).toBe(0);
  });

  it('recharges to full over turboRechargeSeconds when released', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const marco = state.players[0]!;
    marco.turbo = 0;
    applyInput(state, 'p1', { tx: null, ty: null, turbo: false });
    tick(state, TUNING.turboRechargeSeconds / 2);
    expect(marco.turbo).toBeCloseTo(0.5, 5);
    tick(state, TUNING.turboRechargeSeconds);
    expect(marco.turbo).toBe(1);
  });
});

describe('ring shrink', () => {
  it('holds full size through the grace period', () => {
    expect(ringRadius(0)).toBe(TUNING.arenaRadius);
    expect(ringRadius(TUNING.graceSeconds)).toBe(TUNING.arenaRadius);
  });

  it('shrinks linearly to the end fraction', () => {
    const mid = (TUNING.graceSeconds + TUNING.roundSeconds) / 2;
    const expectedMid =
      TUNING.arenaRadius - 0.5 * TUNING.arenaRadius * (1 - TUNING.endRadiusFraction);
    expect(ringRadius(mid)).toBeCloseTo(expectedMid, 5);
    expect(ringRadius(TUNING.roundSeconds)).toBeCloseTo(
      TUNING.arenaRadius * TUNING.endRadiusFraction,
      5,
    );
    expect(ringRadius(TUNING.roundSeconds + 60)).toBeCloseTo(
      TUNING.arenaRadius * TUNING.endRadiusFraction,
      5,
    );
  });

  it('pushes a parked player inward as it passes them', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const polo = state.players.find((p) => p.role === 'polo')!;
    polo.x = 0.9;
    polo.y = 0;
    state.elapsed = TUNING.roundSeconds - 10; // deep in the shrink
    tick(state, 0.05);
    expect(Math.hypot(polo.x, polo.y)).toBeLessThanOrEqual(
      ringRadius(state.elapsed) - TUNING.avatarRadius + 1e-9,
    );
  });
});

describe('timeout', () => {
  it('ends the round at roundSeconds', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    state.elapsed = TUNING.roundSeconds - 0.01;
    tick(state, 0.05);
    expect(state.over).toEqual({ reason: 'timeout', caughtId: null });
    tick(state, 0.05); // ticking a finished round is a no-op
    expect(state.over).toEqual({ reason: 'timeout', caughtId: null });
  });
});
