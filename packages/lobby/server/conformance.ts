// The lobby contract, exercised over a real socket against a real game.
//
// Every game mounts these same handlers, but until 2026-08-20 only Acquire
// tested what comes back over the wire; Rail Baron had one assertion and
// Marco Polo none (the lobby pass, task 5). This suite is the contract each
// consumer inherits — seat naming, rename, leave, rejoin with a token,
// `noSuchRoom`, version mismatch, one seat per socket, presence — written
// once, where the handlers live, and pointed at a game from a five-line
// test file in that game's own suite.
//
// Shipped source that imports vitest, deliberately, like fakeConnection.ts
// imports nothing it shouldn't: it is imported only from the games' test
// files, resolves through this package's exports map like anything else,
// and nothing that builds a production bundle ever reaches it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { JoinedMessage, RejectedMessage, RosterMessage } from '../protocol/protocol.js';

export interface LobbyConformanceTarget {
  /** Shown in the describe title: which game is under the contract. */
  name: string;
  /** The version the game's clients send; wrong-version tests send others. */
  protocolVersion: number;
  /** The game's socket.io mount, e.g. `/marcopolo/socket.io`. */
  socketPath: string;
  /** Boot the game on an ephemeral port; resolve its origin. */
  start(): Promise<{ url: string }>;
  stop(): Promise<void>;
}

function once<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no '${event}' before timeout`)),
      timeoutMs,
    );
    socket.once(event, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

/** The next roster matching `pred` — rosters rebroadcast on every change. */
function rosterWhere(
  socket: Socket,
  pred: (r: RosterMessage) => boolean,
  timeoutMs = 4000,
): Promise<RosterMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('roster', on);
      reject(new Error('no matching roster before timeout'));
    }, timeoutMs);
    const on = (r: RosterMessage) => {
      if (!pred(r)) return;
      clearTimeout(timer);
      socket.off('roster', on);
      resolve(r);
    };
    socket.on('roster', on);
  });
}

export function describeLobbyConformance(target: LobbyConformanceTarget): void {
  describe(`the lobby contract, over ${target.name}'s wire`, () => {
    let url = '';
    const clients: Socket[] = [];

    beforeAll(async () => {
      url = (await target.start()).url;
    });

    afterAll(async () => {
      for (const c of clients) c.disconnect();
      await target.stop();
    });

    function client(): Socket {
      const c = connect(url, { path: target.socketPath, transports: ['websocket'] });
      clients.push(c);
      return c;
    }

    function create(socket: Socket, name?: string): Promise<JoinedMessage> {
      const joined = once<JoinedMessage>(socket, 'joined');
      socket.emit('createRoom', { name, protocolVersion: target.protocolVersion });
      return joined;
    }

    it('seats a named creator as host, and an unnamed joiner by seat number', async () => {
      const host = client();
      const rosterAtCreate = once<RosterMessage>(host, 'roster');
      const seat = await create(host, 'Ada');
      expect(seat.roomId).toBeTruthy();
      expect(seat.playerId).toBeTruthy();
      expect(seat.token).toBeTruthy();

      const first = await rosterAtCreate;
      expect(first.lifecycle).toBe('lobby');
      expect(first.players).toEqual([
        { id: seat.playerId, name: 'Ada', isHost: true, connected: true },
      ]);

      // The joiner sends no name: the server names the seat, because only it
      // knows the seat number.
      const guest = client();
      const guestSeat = once<JoinedMessage>(guest, 'joined');
      guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      const second = await guestSeat;
      const both = await rosterWhere(host, (r) => r.players.length === 2);
      const guestRow = both.players.find((p) => p.id === second.playerId);
      // The word is the game's (`SeatSpace.defaultName` — Marco Polo says
      // Swimmer, the default says Player); the *numbering by seat* is the
      // contract, because only the server knows the seat number.
      expect(guestRow?.name).toMatch(/ 2$/);
      expect(guestRow?.isHost).toBe(false);
    });

    it('renames only the seat behind the socket, and everyone sees it', async () => {
      const host = client();
      const seat = await create(host, 'Ada');
      const guest = client();
      guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      const guestSeat = await once<JoinedMessage>(guest, 'joined');

      guest.emit('renamePlayer', { name: 'Grace' });
      const renamed = await rosterWhere(host, (r) =>
        r.players.some((p) => p.name === 'Grace'),
      );
      // The payload names no player: the socket binding decides whose seat.
      expect(renamed.players.find((p) => p.id === guestSeat.playerId)?.name).toBe('Grace');
      expect(renamed.players.find((p) => p.id === seat.playerId)?.name).toBe('Ada');
    });

    it('a vacated host seat passes hostship rather than orphaning the lobby', async () => {
      const host = client();
      const seat = await create(host, 'Ada');
      const guest = client();
      guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      const guestSeat = await once<JoinedMessage>(guest, 'joined');

      host.emit('leaveSeat');
      const after = await rosterWhere(guest, (r) => r.players.length === 1);
      expect(after.players[0]).toMatchObject({ id: guestSeat.playerId, isHost: true });
    });

    it('a rejoin presents the token and gets the same seat back', async () => {
      const host = client();
      const seat = await create(host, 'Ada');
      const guest = client();
      guest.emit('joinRoom', {
        roomId: seat.roomId,
        name: 'Grace',
        protocolVersion: target.protocolVersion,
      });
      const guestSeat = await once<JoinedMessage>(guest, 'joined');

      guest.disconnect();
      const back = client();
      back.emit('joinRoom', {
        roomId: seat.roomId,
        playerId: guestSeat.playerId,
        token: guestSeat.token,
        protocolVersion: target.protocolVersion,
      });
      const rejoined = await once<JoinedMessage>(back, 'joined');
      expect(rejoined.playerId).toBe(guestSeat.playerId);

      // Same seat, not a second one.
      const roster = await rosterWhere(host, (r) =>
        r.players.some((p) => p.id === guestSeat.playerId && p.connected),
      );
      expect(roster.players).toHaveLength(2);
    });

    it('someone else\'s playerId without their token is refused, not seated', async () => {
      const host = client();
      const seat = await create(host, 'Ada');

      const impostor = client();
      impostor.emit('joinRoom', {
        roomId: seat.roomId,
        playerId: seat.playerId,
        token: 'not-the-token',
        protocolVersion: target.protocolVersion,
      });
      const refusal = await once<RejectedMessage>(impostor, 'rejected');
      expect(refusal.code).toBe('seatRefused');
    });

    it('one socket holds one seat per room, even asking twice', async () => {
      // The bug every game inherited the fix for: a joinRoom before the
      // client's own `joined` lands has no token to present, and used to
      // seat a stranger. The server's socket binding answers instead.
      const host = client();
      const seat = await create(host, 'Ada');

      const again = once<JoinedMessage>(host, 'joined');
      // Subscribed before the ask: the roster lands right behind `joined`.
      const rosterAgain = rosterWhere(host, () => true);
      host.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      expect((await again).playerId).toBe(seat.playerId);
      expect((await rosterAgain).players).toHaveLength(1);
    });

    it('a room that is not there is an ending, said as noSuchRoom', async () => {
      const c = client();
      c.emit('joinRoom', { roomId: 'ZZZZZZ', protocolVersion: target.protocolVersion });
      const refusal = await once<RejectedMessage>(c, 'rejected');
      expect(refusal.code).toBe('noSuchRoom');
    });

    it('a client speaking another protocol is told exactly that', async () => {
      // Equality, not at-least: the client can be the newer side. And it must
      // come before the room lookup, so a stale client is not sent hunting
      // for a room that is perfectly fine.
      const stale = client();
      stale.emit('createRoom', { protocolVersion: target.protocolVersion + 1 });
      expect((await once<RejectedMessage>(stale, 'rejected')).code).toBe('versionMismatch');

      const host = client();
      const seat = await create(host, 'Ada');
      const staleJoin = client();
      staleJoin.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion + 1 });
      expect((await once<RejectedMessage>(staleJoin, 'rejected')).code).toBe('versionMismatch');

      // Absent is a mismatch too: clients built before versioning existed
      // send nothing, and they are precisely what the check is for.
      const ancient = client();
      ancient.emit('createRoom', {});
      expect((await once<RejectedMessage>(ancient, 'rejected')).code).toBe('versionMismatch');
    });

    it('only the host may begin', async () => {
      const host = client();
      const seat = await create(host, 'Ada');
      const guest = client();
      guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      await once<JoinedMessage>(guest, 'joined');

      guest.emit('beginGame');
      expect((await once<RejectedMessage>(guest, 'rejected')).code).toBe('notYourTurn');
    });

    it('a dropped socket marks the seat away, and keeps it', async () => {
      const host = client();
      const seat = await create(host, 'Ada');
      const guest = client();
      guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      const guestSeat = await once<JoinedMessage>(guest, 'joined');

      guest.disconnect();
      const away = await rosterWhere(host, (r) =>
        r.players.some((p) => p.id === guestSeat.playerId && !p.connected),
      );
      // Presence, not removal: the seat waits for its player.
      expect(away.players).toHaveLength(2);
    });
  });
}
