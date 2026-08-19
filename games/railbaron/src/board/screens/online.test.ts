import { describe, expect, it } from 'vitest';
import { lobbyView, type LobbySnapshot } from '../../../vendor/lobby/client/view';
import { BOARD_ROWS } from '../types';
import { joinRoom, onlineLobby, roomGone } from './online';

const LIMITS = { capacity: 6, minPlayers: 2 };

const snapshot = (over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  phase: 'lobby',
  status: 'open',
  playerId: 'red',
  roster: {
    roomId: 'ABC234',
    lifecycle: 'lobby',
    players: [
      { id: 'red', name: 'ADA', isHost: true, connected: true },
      { id: 'green', name: 'BEN', isHost: false, connected: true },
    ],
  },
  ...over,
});

const view = (over: Partial<LobbySnapshot> = {}) => lobbyView(snapshot(over), LIMITS);

describe('the online lobby board', () => {
  it('is seven rows like every other screen', () => {
    expect(onlineLobby(view()).rows).toHaveLength(BOARD_ROWS);
  });

  it('renders a row per seat, with the empty ones dim and open', () => {
    const { rows } = onlineLobby(view());
    expect(rows.slice(0, 2).map((r) => r.text)).toEqual(['ADA', 'BEN']);
    // Six seats: two taken, four open.
    expect(rows.slice(2, 6).map((r) => r.text)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN']);
    expect(rows[2]!.tone).toBe('dim');
    expect(rows[2]!.action).toBeNull();
  });

  it('colours each seat by the colour its id already is', () => {
    const { rows } = onlineLobby(view());
    expect(rows[0]!.chip).toBe('#e02b1d');   // red
    expect(rows[1]!.chip).toBe('#5fbb2e');   // green
  });

  it('marks a dropped baron away rather than removing them', () => {
    const { rows } = onlineLobby(view({
      roster: {
        roomId: 'ABC234', lifecycle: 'lobby',
        players: [
          { id: 'red', name: 'ADA', isHost: true, connected: true },
          { id: 'green', name: 'BEN', isHost: false, connected: false },
        ],
      },
    }));
    expect(rows[1]!.status).toBe('Away');
    expect(rows[1]!.text).toBe('BEN');
  });

  it('offers DEPART to the host once there are enough barons', () => {
    const departure = onlineLobby(view()).rows[6]!;
    expect(departure.text).toBe('DEPART');
    expect(departure.action).toEqual({ kind: 'begin' });
    expect(departure.right).toBe('ABC234');
  });

  it('says why it cannot depart, and offers the code to share instead', () => {
    const alone = onlineLobby(view({
      roster: {
        roomId: 'ABC234', lifecycle: 'lobby',
        players: [{ id: 'red', name: 'ADA', isHost: true, connected: true }],
      },
    })).rows[6]!;
    expect(alone.status).toBe('Need 2 barons');
    expect(alone.action).toEqual({ kind: 'share' });
  });

  it('does not offer DEPART to a player who is not the host', () => {
    const guest = onlineLobby(view({ playerId: 'green' })).rows[6]!;
    expect(guest.status).toBe('Host starts');
    expect(guest.action).toEqual({ kind: 'share' });
  });

  it('lets you edit your own seat and nobody else’s', () => {
    const { rows } = onlineLobby(view());
    expect(rows[0]!.action).toEqual({
      kind: 'edit', field: 'seat:red', placeholder: 'Type a name, press Enter',
    });
    expect(rows[1]!.action).toBeNull();
  });
});

describe('the join board', () => {
  it('will not join until the code is six characters', () => {
    expect(joinRoom('ABC').rows[1]!.action).toBeNull();
    expect(joinRoom('ABC234').rows[1]!.action).toEqual({ kind: 'joinRoom' });
  });

  it('always offers a room of your own', () => {
    expect(joinRoom('').rows[2]!.action).toEqual({ kind: 'createRoom' });
  });

  it('is seven rows', () => {
    expect(joinRoom('').rows).toHaveLength(BOARD_ROWS);
  });
});

describe('the terminals', () => {
  it('say what happened and offer a way out', () => {
    const gone = roomGone();
    expect(gone.rows[0]!.text).toBe('THAT ROOM IS NO LONGER RUNNING');
    expect(gone.rows[1]!.action).toEqual({ kind: 'navigate', to: 'home' });
    expect(gone.rows).toHaveLength(BOARD_ROWS);
  });
});

describe('the join board when the server refuses', () => {
  it('says so rather than sitting there', () => {
    // The bug this guards: JoinRoomApp ignored the rejected channel, so a
    // version mismatch or a dead server produced no change on screen at all.
    const refused = joinRoom('', 'Server speaks a different protocol');
    expect(refused.sub).toBe('SERVER SPEAKS A DIFFERENT PROTOCOL');
    expect(refused.rows[2]!.status).toBe('Failed');
    expect(refused.rows[2]!.right).toBe('Try again');
    // And NEW ROOM stays tappable, because retrying is the remedy.
    expect(refused.rows[2]!.action).toEqual({ kind: 'createRoom' });
  });

  it('reads normally when nothing has gone wrong', () => {
    const fine = joinRoom('');
    expect(fine.sub).toBe('JOIN A ROOM');
    expect(fine.rows[2]!.status).toBe('Or');
  });
});

describe('the lobby board when the server refuses something', () => {
  it('carries the refusal, and keeps the room code beside it', () => {
    // The lobby hook ranks the roster above refusal messages so a seated
    // player is never thrown back to a join form — which means the message
    // reaches nobody unless this board shows it.
    const refused = onlineLobby(view(), 'only the host may begin the game');
    expect(refused.sub).toBe('ROOM ABC234 · ONLY THE HOST MAY BEGIN THE GAME');
  });

  it('reads as the connection state when nothing has been refused', () => {
    expect(onlineLobby(view()).sub).toBe('ROOM ABC234 · LIVE');
  });
});
