import { describe, expect, it } from 'vitest';
import { parseRules, PUBLISHED_RULES } from './rules.js';
import { isGameEvent } from './events.js';

describe('parseRules', () => {
  it('fills defaults for an empty object and for absent fields', () => {
    expect(parseRules({})).toEqual({ ok: true, rules: PUBLISHED_RULES });
    expect(parseRules({ winTarget: 50000 }))
      .toEqual({ ok: true, rules: { ...PUBLISHED_RULES, winTarget: 50000 } });
  });

  it('accepts a full house-rules object, seed included', () => {
    const result = parseRules(
      { winTarget: 100000, startingCash: 5000, startingTrain: 'express', seed: 'g' });
    expect(result).toEqual({
      ok: true,
      rules: { winTarget: 100000, startingCash: 5000, startingTrain: 'express', seed: 'g' },
    });
  });

  it('names the field it refuses', () => {
    expect(parseRules({ winTarget: -5 })).toEqual({ ok: false, field: 'winTarget' });
    expect(parseRules({ winTarget: 'lots' })).toEqual({ ok: false, field: 'winTarget' });
    expect(parseRules({ startingCash: -5 })).toEqual({ ok: false, field: 'startingCash' });
    expect(parseRules({ startingCash: 'lots' })).toEqual({ ok: false, field: 'startingCash' });
    expect(parseRules({ startingTrain: 'fast freight' }))
      .toEqual({ ok: false, field: 'startingTrain' });
    expect(parseRules({ seed: 12 })).toEqual({ ok: false, field: 'seed' });
    expect(parseRules(null)).toEqual({ ok: false, field: 'rules' });
    expect(parseRules([])).toEqual({ ok: false, field: 'rules' });
  });
});

describe('started.rules on the wire', () => {
  it('accepts started bare, with valid rules, and refuses bad rules', () => {
    expect(isGameEvent({ type: 'started' })).toBe(true);
    expect(isGameEvent({ type: 'started', rules: PUBLISHED_RULES })).toBe(true);
    expect(isGameEvent({ type: 'started', rules: { winTarget: 'lots' } })).toBe(false);
  });
});
