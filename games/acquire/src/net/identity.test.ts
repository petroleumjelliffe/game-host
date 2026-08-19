import { describe, it, expect, beforeEach } from 'vitest';
import { loadIdentity, saveIdentity, rememberName, rememberedName } from './identity';

beforeEach(() => { localStorage.clear(); });

describe('a seat survives a refresh', () => {
  it('round-trips what a rejoin has to present', () => {
    saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });
  });

  it('keeps rooms apart', () => {
    saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(loadIdentity('XYZ789')).toBeNull();
  });

  it('survives a corrupted entry rather than throwing at startup', () => {
    localStorage.setItem('acquire.room.ABC123', 'not json');
    expect(loadIdentity('ABC123')).toBeNull();
  });

  it('ignores an entry missing the fields a rejoin needs', () => {
    localStorage.setItem('acquire.room.ABC123', JSON.stringify({ playerId: 'p2' }));
    expect(loadIdentity('ABC123')).toBeNull();
  });

  it('remembers a display name across rooms', () => {
    rememberName('Sam');
    expect(rememberedName()).toBe('Sam');
  });
});

/**
 * Until 2026-08-07 a new player's name was `getRandomEmojiName()` — literally
 * an emoji, stored here and reused for every later room. That code is gone and
 * the server names an unnamed seat `Player N`, but the residue outlives it:
 * everyone who has already played this game has an emoji sitting in
 * `acquire.name` and would keep it forever.
 *
 * So a remembered name with nothing name-like in it is treated as no name at
 * all. Nobody chose it — it was assigned by the defect this replaced — and the
 * cost of being wrong is one retype, against a name that is wrong every game.
 */
describe('a name nobody actually chose', () => {
  it.each(['🐶', '🦦', '🧑‍🦰', '🕊️', '  🐸  '])('ignores the emoji-only name %s', (stored) => {
    rememberName(stored);
    expect(rememberedName()).toBeNull();
  });

  it.each(['Sam', 'J', '42', 'Ada Lovelace', '🐸 Sam', 'Sam 🐸'])(
    'keeps %s, which has something name-like in it',
    (stored) => {
      rememberName(stored);
      expect(rememberedName()).toBe(stored);
    },
  );
});
