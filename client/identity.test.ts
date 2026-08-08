import { createIdentityStore } from './identity';

describe('identity namespace', () => {
  beforeEach(() => { localStorage.clear(); });

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
