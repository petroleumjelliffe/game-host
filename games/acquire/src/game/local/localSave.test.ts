import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildFixture } from '../../../engine/golden/fixtures';
import { LOCAL_SAVE_VERSION, save, load, loadFailure, clear } from './localSave';

const KEY = 'acquire.local.game';

function state() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: [],
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the local save', () => {
  it('round-trips the state with a timestamp', () => {
    const s = state();
    save(s);

    const loaded = load();

    expect(loaded).not.toBeNull();
    expect(loaded!.state.board).toEqual(s.board);
    expect(loaded!.state.players.map((p) => p.name)).toEqual(['Alex', 'Sam']);
    // The Continue card's "Last played" — a real timestamp, not a placeholder.
    expect(loaded!.savedAt).toEqual(expect.any(Number));
    expect(loaded!.version).toBe(LOCAL_SAVE_VERSION);
  });

  it('is absent, not stale, when nothing was ever saved', () => {
    expect(load()).toBeNull();
    expect(loadFailure()).toBeNull();
  });

  it('clears', () => {
    save(state());
    clear();
    expect(load()).toBeNull();
    expect(loadFailure()).toBeNull();
  });
});

/**
 * The failure mode the design names: a save that quietly vanished, reported
 * by nobody, indistinguishable from never having existed. `load()` returning
 * null keeps callers safe; `loadFailure()` is what lets the lobby *say so*.
 */
describe('a save that cannot be used', () => {
  it('reads as stale when its version is not this one', () => {
    save(state());
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    localStorage.setItem(KEY, JSON.stringify({ ...raw, version: LOCAL_SAVE_VERSION + 1 }));

    expect(load()).toBeNull();
    expect(loadFailure()).toBe('stale');
  });

  it('reads as stale when it does not parse at all', () => {
    localStorage.setItem(KEY, '{ not json');

    expect(load()).toBeNull();
    expect(loadFailure()).toBe('stale');
  });

  it('reads as stale when it parses into the wrong shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ hello: 'world' }));

    expect(load()).toBeNull();
    expect(loadFailure()).toBe('stale');
  });

  it('is kept, not destroyed — New Game is the only thing that overwrites it', () => {
    localStorage.setItem(KEY, '{ not json');

    load();
    loadFailure();

    // The Stage 1 quarantine posture, minus the rename localStorage cannot
    // express: reading a save you could not use must never delete it.
    expect(localStorage.getItem(KEY)).toBe('{ not json');
  });
});

describe('a browser that refuses storage', () => {
  it('makes save a no-op, never a crash', () => {
    // Safari private mode: localStorage exists and every write throws.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => save(state())).not.toThrow();
  });

  it('makes load an absence, never a crash', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(load()).toBeNull();
    expect(loadFailure()).toBeNull();
  });
});
