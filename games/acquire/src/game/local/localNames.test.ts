import { describe, it, expect, beforeEach } from 'vitest';
import { loadNames, saveNames } from './localNames';

const KEY = 'acquire.local.names';

beforeEach(() => localStorage.clear());

describe('localNames', () => {
  it('round-trips a roster', () => {
    saveNames(['Ada', 'Grace', 'Alan']);
    expect(loadNames()).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('returns null when nothing was ever saved', () => {
    expect(loadNames()).toBeNull();
  });

  it('refuses unparseable bytes rather than throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadNames()).toBeNull();
  });

  it('refuses a roster that is not all real names', () => {
    // A partial prefill — some seats real, some invented — would be worse
    // than none, so anything malformed is treated as absent wholesale.
    localStorage.setItem(KEY, JSON.stringify(['Ada', 42]));
    expect(loadNames()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify(['Ada', '  ']));
    expect(loadNames()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify(['Ada']));
    expect(loadNames()).toBeNull();
  });
});
