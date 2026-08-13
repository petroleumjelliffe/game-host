import { describe, expect, it } from 'vitest';
import { lobbyView, type LobbyLimits, type LobbySnapshot } from './view';

const LIMITS: LobbyLimits = { capacity: 4, minPlayers: 2 };

const base = (over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  phase: 'lobby',
  status: 'open',
  roster: {
    roomId: 'ABC123',
    lifecycle: 'lobby',
    players: [
      { id: 'p1', name: 'Ada', isHost: true, connected: true },
      { id: 'p2', name: 'Margo', isHost: false, connected: true },
    ],
  },
  playerId: 'p2',
  ...over,
});

describe('seats', () => {
  it('pads to capacity, so an empty seat is expressible at all', () => {
    const view = lobbyView(base(), LIMITS);
    expect(view.seats).toHaveLength(4);
    expect(view.seats.map((s) => s.id)).toEqual(['p1', 'p2', null, null]);
    expect(view.seats.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('marks an empty seat as nobody, not as a nameless somebody', () => {
    const empty = lobbyView(base(), LIMITS).seats[3]!;
    expect(empty.name).toBeNull();
    expect(empty.isYou).toBe(false);
    expect(empty.isHost).toBe(false);
    expect(empty.canRename).toBe(false);
  });

  it('knows which seat is yours, so no consumer repeats the find', () => {
    const view = lobbyView(base(), LIMITS);
    expect(view.you?.id).toBe('p2');
    expect(view.seats.filter((s) => s.isYou)).toHaveLength(1);
  });

  it('has no you when the roster does not hold your id', () => {
    expect(lobbyView(base({ playerId: 'p9' }), LIMITS).you).toBeNull();
  });

  it('lets you rename only your own seat, and only in the lobby', () => {
    const inLobby = lobbyView(base(), LIMITS);
    expect(inLobby.seats.filter((s) => s.canRename).map((s) => s.id)).toEqual(['p2']);

    const playing = lobbyView(
      base({ roster: { ...base().roster!, lifecycle: 'playing' } }),
      LIMITS,
    );
    expect(playing.seats.filter((s) => s.canRename)).toHaveLength(0);
  });

  it('reports the room code for the share element, and no URL', () => {
    // Base paths are per-repo, so the game builds the link.
    expect(lobbyView(base(), LIMITS).code).toBe('ABC123');
  });
});

describe('beginning', () => {
  it('lets the host begin once there are enough players', () => {
    const view = lobbyView(base({ playerId: 'p1' }), LIMITS);
    expect(view.canBegin).toBe(true);
    expect(view.beginBlocked).toBeNull();
  });

  it('refuses a non-host, and says why', () => {
    const view = lobbyView(base(), LIMITS); // playerId p2, not the host
    expect(view.canBegin).toBe(false);
    expect(view.beginBlocked).toBe('notHost');
  });

  it('refuses below the minimum, and says why', () => {
    const solo = base({
      playerId: 'p1',
      roster: {
        roomId: 'ABC123',
        lifecycle: 'lobby',
        players: [{ id: 'p1', name: 'Ada', isHost: true, connected: true }],
      },
    });
    expect(lobbyView(solo, LIMITS).beginBlocked).toBe('notEnoughPlayers');
  });

  it('refuses once the game has already begun', () => {
    const playing = base({ playerId: 'p1', roster: { ...base().roster!, lifecycle: 'playing' } });
    expect(lobbyView(playing, LIMITS).beginBlocked).toBe('alreadyBegun');
  });

  it('reports not-host before not-enough, because it is the more useful answer', () => {
    // A guest in a short room should be told the thing that is theirs to
    // know, not the thing that is merely also true.
    expect(lobbyView(base(), { capacity: 4, minPlayers: 3 }).beginBlocked).toBe('notHost');
  });
});

describe('connection and terminal state', () => {
  it('maps the socket status to something a screen can say', () => {
    expect(lobbyView(base({ status: 'connecting' }), LIMITS).connection).toBe('connecting');
    expect(lobbyView(base({ status: 'open' }), LIMITS).connection).toBe('live');
    expect(lobbyView(base({ status: 'closed' }), LIMITS).connection).toBe('dropped');
  });

  it('has no terminal state in the ordinary case', () => {
    expect(lobbyView(base(), LIMITS).terminal).toBeNull();
  });

  it('reads the terminal state off the phase rather than re-ranking it', () => {
    // Both useLobbyRoom and useRoom already decide that stale outranks gone.
    // A third copy of that ordering would be a third place for it to drift.
    expect(lobbyView(base({ phase: 'stale' }), LIMITS).terminal).toBe('stale');
    expect(lobbyView(base({ phase: 'gone' }), LIMITS).terminal).toBe('gone');
  });

  it('treats a phase it does not recognise as not terminal', () => {
    // Acquire adds 'playing'; a game may add others.
    expect(lobbyView(base({ phase: 'playing' }), LIMITS).terminal).toBeNull();
  });

  it('reports a refusal from the error phase', () => {
    expect(lobbyView(base({ phase: 'error', roster: null }), LIMITS).terminal).toBe('refused');
  });

  it('survives having no roster yet', () => {
    const early = base({ phase: 'connecting', roster: null, playerId: null });
    const view = lobbyView(early, LIMITS);
    expect(view.seats).toHaveLength(4);
    expect(view.seats.every((s) => s.id === null)).toBe(true);
    expect(view.you).toBeNull();
    expect(view.code).toBe('');
  });
});
