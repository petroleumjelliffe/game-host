import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS, PROTOCOL_VERSION, SEAT_IDS, TUNING } from './game.js';

describe('game protocol constants', () => {
  it('has one seat id per possible player', () => {
    expect(SEAT_IDS).toHaveLength(MAX_PLAYERS);
    expect(new Set(SEAT_IDS).size).toBe(MAX_PLAYERS);
    expect(MIN_PLAYERS).toBeLessThanOrEqual(MAX_PLAYERS);
  });

  it('has coherent tuning', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TUNING.graceSeconds).toBeLessThan(TUNING.roundSeconds);
    expect(TUNING.endRadiusFraction).toBeGreaterThan(0);
    expect(TUNING.endRadiusFraction).toBeLessThan(1);
    expect(TUNING.avatarRadius * 2).toBeLessThan(TUNING.arenaRadius * TUNING.endRadiusFraction);
  });
});
