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

  it('keeps the exact room key for appId acquire', () => {
    const store = createIdentityStore('acquire');
    store.saveIdentity('ABC123', { playerId: 'p1', token: 't', name: 'Ada' });
    // Pinned as a raw string: a changed key silently logs every player out.
    // This pin went red on 2026-08-20 when the *name* key moved to the
    // shared `lobby.name` — predicted by the plan, and answered by the
    // migration below rather than by loosening anything. The room key did
    // not move and must not.
    expect(localStorage.getItem('acquire.room.ABC123')).not.toBeNull();
  });

  it('writes the remembered name to the shared key, exactly', () => {
    createIdentityStore('acquire').rememberName('Ada');
    expect(localStorage.getItem('lobby.name')).toBe('Ada');
    expect(localStorage.getItem('acquire.name')).toBeNull();
  });
});

/**
 * One person, one machine, three games: the name is shared across apps as of
 * 2026-08-20, and everyone who played before then holds one under the old
 * `<appId>.name`. The fallback is permanent — no test reaches a real
 * player's browser, so nobody can ever prove every old key migrated.
 */
describe('one remembered name for the household', () => {
  it('a name typed in one game answers in another', () => {
    createIdentityStore('railbaron').rememberName('Pete');
    expect(createIdentityStore('acquire').rememberedName()).toBe('Pete');
    expect(createIdentityStore('marco-polo').rememberedName()).toBe('Pete');
  });

  it('finds a pre-migration name under the old key and writes it forward', () => {
    localStorage.setItem('railbaron.name', 'Pete');
    expect(createIdentityStore('railbaron').rememberedName()).toBe('Pete');
    // Written forward: the other games see it without knowing the old key.
    expect(localStorage.getItem('lobby.name')).toBe('Pete');
    expect(createIdentityStore('acquire').rememberedName()).toBe('Pete');
  });

  it('does not carry forward an unchosen emoji name', () => {
    localStorage.setItem('acquire.name', '🦦');
    expect(createIdentityStore('acquire').rememberedName()).toBeNull();
    expect(localStorage.getItem('lobby.name')).toBeNull();
  });

  it('a shared-key name outranks any legacy leftover', () => {
    localStorage.setItem('acquire.name', 'Old Ada');
    createIdentityStore('railbaron').rememberName('Pete');
    expect(createIdentityStore('acquire').rememberedName()).toBe('Pete');
  });

  it('an emoji name chosen this era stays null without resurrecting the old one', () => {
    // Present is authoritative: the emoji under the shared key was *typed*,
    // and the legacy text name it replaced must not come back every room.
    localStorage.setItem('acquire.name', 'Ada');
    createIdentityStore('acquire').rememberName('🦦');
    expect(createIdentityStore('acquire').rememberedName()).toBeNull();
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
