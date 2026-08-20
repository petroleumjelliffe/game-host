// @vitest-environment jsdom
import { createIdentityStore } from './identity';

beforeEach(() => { localStorage.clear(); });

describe('identity namespace', () => {

  it('two apps on one origin do not collide on the same room code', () => {
    const acquire = createIdentityStore('acquire');
    const other = createIdentityStore('gamebee');
    acquire.saveIdentity('ABC123', { playerId: 'p1', token: 't-acquire', name: 'Ada' });
    other.saveIdentity('ABC123', { playerId: 'p2', token: 't-other', name: 'Bee' });

    expect(acquire.loadIdentity('ABC123')?.token).toBe('t-acquire');
    expect(other.loadIdentity('ABC123')?.token).toBe('t-other');
  });

  it('keeps the exact legacy keys for appId acquire', () => {
    const store = createIdentityStore('acquire');
    store.saveIdentity('ABC123', { playerId: 'p1', token: 't', name: 'Ada' });
    store.rememberName('Ada');
    // Pinned as raw strings: a changed key silently logs every player out.
    expect(localStorage.getItem('acquire.room.ABC123')).not.toBeNull();
    expect(localStorage.getItem('acquire.name')).toBe('Ada');
  });
});

/**
 * Everything below arrived from `games/acquire/src/net/identity.test.ts` on
 * 2026-08-20 (the lobby pass, task 0). It was 57 lines exercising *this*
 * module through Acquire's five-line re-export, which meant the only
 * substantive coverage of a shared store lived inside one of its three
 * consumers — Rail Baron and Marco Polo call the same code and inherited none
 * of it. The `appId` is now a parameter rather than Acquire's, which is the
 * one change made in the move: these rules were never Acquire's.
 */
describe('a seat survives a refresh', () => {
  const store = () => createIdentityStore('acquire');

  it('round-trips what a rejoin has to present', () => {
    store().saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(store().loadIdentity('ABC123')).toEqual({ playerId: 'p2', token: 'tok', name: 'Sam' });
  });

  it('keeps rooms apart', () => {
    store().saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    expect(store().loadIdentity('XYZ789')).toBeNull();
  });

  it('survives a corrupted entry rather than throwing at startup', () => {
    localStorage.setItem('acquire.room.ABC123', 'not json');
    expect(store().loadIdentity('ABC123')).toBeNull();
  });

  it('ignores an entry missing the fields a rejoin needs', () => {
    localStorage.setItem('acquire.room.ABC123', JSON.stringify({ playerId: 'p2' }));
    expect(store().loadIdentity('ABC123')).toBeNull();
  });

  it('remembers a display name across rooms', () => {
    store().rememberName('Sam');
    expect(store().rememberedName()).toBe('Sam');
  });

  it('forgets a seat on request, which is what leaving a lobby does', () => {
    const s = store();
    s.saveIdentity('ABC123', { playerId: 'p2', token: 'tok', name: 'Sam' });
    s.clearIdentity('ABC123');
    expect(s.loadIdentity('ABC123')).toBeNull();
  });
});

/**
 * Until 2026-08-07 a new player's name was `getRandomEmojiName()` — literally
 * an emoji, stored here and reused for every later room. That code is gone and
 * the server names an unnamed seat `Player N`, but the residue outlives it:
 * everyone who has already played has an emoji sitting in `<app>.name` and
 * would keep it forever.
 *
 * So a remembered name with nothing name-like in it is treated as no name at
 * all. Nobody chose it — it was assigned by the defect this replaced — and the
 * cost of being wrong is one retype, against a name that is wrong every game.
 */
describe('a name nobody actually chose', () => {
  const store = () => createIdentityStore('acquire');

  it.each(['🐶', '🦦', '🧑‍🦰', '🕊️', '  🐸  '])('ignores the emoji-only name %s', (stored) => {
    store().rememberName(stored);
    expect(store().rememberedName()).toBeNull();
  });

  it.each(['Sam', 'J', '42', 'Ada Lovelace', '🐸 Sam', 'Sam 🐸'])(
    'keeps %s, which has something name-like in it',
    (stored) => {
      store().rememberName(stored);
      expect(store().rememberedName()).toBe(stored);
    },
  );
});
