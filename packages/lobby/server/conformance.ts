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
  /**
   * In-process handles on the game's registry, for machinery that has no
   * wire verb: reserving is a host-contract capability reached through
   * notify's HTTP, not a socket event, so a wire-only target cannot create
   * the pending seat the reserved-seat tests need. Optional: a game that
   * does not host invites (Marco Polo) omits both and runs only the
   * unconditional tests. Valid only after `start()` resolves.
   */
  reserve?(roomId: string, tokenHash: string, name: string | null): string | null;
  claim?(roomId: string, tokenHash: string): { playerId: string; token: string } | null;
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

    it('a viewer sees the roster and its updates without ever taking a seat', async () => {
      const host = client();
      const seat = await create(host, 'Ada');

      // The pre-join chooser's data: viewRoom answers with the roster and
      // keeps the updates coming — and never a `joined`, because nothing
      // was seated.
      const viewer = client();
      let seated = false;
      viewer.once('joined', () => { seated = true; });
      const first = once<RosterMessage>(viewer, 'roster');
      viewer.emit('viewRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
      expect((await first).players).toHaveLength(1);

      host.emit('renamePlayer', { name: 'Grace' });
      const renamed = await rosterWhere(viewer, (r) =>
        r.players.some((p) => p.name === 'Grace'),
      );
      // Watched, not joined: the roster still holds one player.
      expect(renamed.players).toHaveLength(1);
      expect(seated).toBe(false);

      const gone = client();
      gone.emit('viewRoom', { roomId: 'ZZZZZZ', protocolVersion: target.protocolVersion });
      expect((await once<RejectedMessage>(gone, 'rejected')).code).toBe('noSuchRoom');
    });

    it('the roster names its reserved seats, empty when there are none', async () => {
      const host = client();
      const rosterAtCreate = once<RosterMessage>(host, 'roster');
      await create(host, 'Ada');
      expect((await rosterAtCreate).pending).toEqual([]);
    });

    // Reserved-seat behaviour needs a pending seat, and reserving has no
    // wire verb (it is a host-contract capability reached through notify's
    // HTTP) — so these run only for a target that lends its registry.
    describe.runIf(target.reserve !== undefined)('reserved seats', () => {
      it('a reserved seat shows in the roster, hash never, and joiners go elsewhere', async () => {
        const host = client();
        const seat = await create(host, 'Ada');
        const reservedId = target.reserve!(seat.roomId, 'hash-a', 'Sam');
        expect(reservedId).toBeTruthy();

        const guest = client();
        guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
        const guestSeat = await once<JoinedMessage>(guest, 'joined');
        // Ordinary seating never hands out the reserved seat.
        expect(guestSeat.playerId).not.toBe(reservedId);

        const withReserved = await rosterWhere(host, (r) =>
          (r.pending ?? []).some((p) => p.id === reservedId),
        );
        expect(withReserved.pending).toEqual([{ id: reservedId, name: 'Sam' }]);
        // The wire proof, not the intent: no hash anywhere in the broadcast.
        expect(JSON.stringify(withReserved)).not.toContain('hash-a');
      });

      it('a claim mints a token that rejoins over the wire', async () => {
        const host = client();
        const seat = await create(host, 'Ada');
        const reservedId = target.reserve!(seat.roomId, 'hash-b', 'Kit');
        const claimed = target.claim!(seat.roomId, 'hash-b');
        expect(claimed?.playerId).toBe(reservedId);
        // Claimed is spent: the same hash never claims twice.
        expect(target.claim!(seat.roomId, 'hash-b')).toBeNull();

        const claimer = client();
        claimer.emit('joinRoom', {
          roomId: seat.roomId,
          playerId: claimed!.playerId,
          token: claimed!.token,
          protocolVersion: target.protocolVersion,
        });
        const joined = await once<JoinedMessage>(claimer, 'joined');
        expect(joined.playerId).toBe(reservedId);
        const after = await rosterWhere(host, (r) =>
          r.players.some((p) => p.id === reservedId && p.connected),
        );
        expect(after.pending).toEqual([]);
        expect(after.players.find((p) => p.id === reservedId)?.name).toBe('Kit');
      });

      it('only the host may revoke, and revoking frees the seat', async () => {
        const host = client();
        const seat = await create(host, 'Ada');
        const guest = client();
        guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
        await once<JoinedMessage>(guest, 'joined');
        const reservedId = target.reserve!(seat.roomId, 'hash-c', 'Sam');

        guest.emit('revokeSeat', { playerId: reservedId });
        expect((await once<RejectedMessage>(guest, 'rejected')).code).toBe('notYourTurn');

        host.emit('revokeSeat', { playerId: reservedId });
        const after = await rosterWhere(host, (r) => (r.pending ?? []).length === 0);
        expect(after.players).toHaveLength(2);
      });

      it('beginning the game clears every unclaimed reservation', async () => {
        const host = client();
        const seat = await create(host, 'Ada');
        const guest = client();
        guest.emit('joinRoom', { roomId: seat.roomId, protocolVersion: target.protocolVersion });
        await once<JoinedMessage>(guest, 'joined');
        target.reserve!(seat.roomId, 'hash-d', 'Sam');

        host.emit('beginGame');
        const begun = await rosterWhere(host, (r) => r.lifecycle !== 'lobby');
        // Claims are lobby-only: an unclaimed seat must not enter the game.
        expect(begun.pending).toEqual([]);
        expect(begun.players).toHaveLength(2);
      });
    });
  });
}
