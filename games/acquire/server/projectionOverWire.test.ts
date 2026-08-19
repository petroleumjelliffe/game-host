import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioConnect, type Socket } from 'socket.io-client';
import { buildFixture } from '../engine/golden/fixtures.js';
import type { Coord, Row } from '../engine/gameHelpers.js';
import { startTestServer, connectPlayer, settleSocket, SOCKET_PATH, type TestServer } from './socketHarness.js';
import { project } from './projection.js';
import { GAME_CLIENT_EVENTS, PROTOCOL_VERSION } from '../session/protocol.js';
import {
  LOBBY_CLIENT_EVENTS,
  LOBBY_SERVER_EVENTS,
  type JoinedMessage,
  type RejectedMessage,
} from '../vendor/lobby/protocol/protocol.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

/** p1 can end their turn immediately (empty hand, no legal placement). */
function twoSeats(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: [] },
        { name: 'Sam', cash: 6000, hand: ['A1', 'B2'] },
      ],
      loners: ['E5'],
      bag: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10'],
    }),
  );
}

/** p1 holds a tile worth placing; p2 waits. */
function openSegment(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11'],
    }),
  );
}

/** A run of `n` coords along `letter`, starting at 1 — `row('B', 11)` is
 * `B1..B11`, a safe (≥11-tile) chain. */
function row(letter: Row, n: number): Coord[] {
  return Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as Coord);
}

/**
 * p1 holds one genuinely dead tile (`C6`, boxed in between two safe 11-tile
 * chains — the exact setup golden game G8 uses to prove it is dead). Trading
 * it in via `tradeInDeadTiles` is the *only* intent that produces a real
 * `correction` delivery: same actor, segment stays open, but the bag was
 * touched — `placeTile` never reaches this path (it is not in `DRAWS`), and
 * `endTurn`/`startGame` always close the segment instead (`server/room.ts`'s
 * own comment on `DRAWS` says so directly). A privacy test that exercises
 * `placeTile` instead, as `openSegment`'s does, cannot observe this delivery
 * kind at all.
 */
function deadTileSegment(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 4200, hand: ['C6'] },
        { name: 'Sam', cash: 5800, hand: ['A1'] },
      ],
      chains: [
        { id: 'Messla', coords: row('B', 11) },
        { id: 'ZuckFace', coords: row('D', 11) },
      ],
      bag: ['I12'],
    }),
  );
}

/**
 * Same boxed-in setup as `deadTileSegment`, but the bag holds `C7` instead
 * of `I12` — a coord sandwiched between `B7` and `D7` exactly as `C6` is
 * sandwiched between `B6` and `D6`, so the tile the trade draws is *itself*
 * dead. That makes `endTurn` legal the instant the trade completes (no
 * legal placement remains), closing the segment — a real commit, broadcast
 * to the whole table — while Alex still holds the drawn tile. That is the
 * exact shape of the confirmed log leak: a commit p2 receives, naming a
 * coordinate presently sitting in p1's actual hand.
 */
function deadReplacementSegment(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 4200, hand: ['C6'] },
        { name: 'Sam', cash: 5800, hand: ['A1'] },
      ],
      chains: [
        { id: 'Messla', coords: row('B', 11) },
        { id: 'ZuckFace', coords: row('D', 11) },
      ],
      bag: ['C7'],
    }),
  );
}

/**
 * p1's turn, `buy` stage. `doBuyShares` in `engine/intents.ts` calls
 * `requireStage(state, 'buy')` before it ever touches `intent.picks` — so a
 * malformed `picks` fired at `openSegment` (stage `play`) would be caught by
 * the stage check first and never reach the dereference this fixture exists
 * to exercise.
 */
function buyStage(roomId: string) {
  return server.rooms.fromState(
    roomId,
    ['Alex', 'Sam'],
    buildFixture({
      players: [
        { name: 'Alex', cash: 6000 },
        { name: 'Sam', cash: 6000 },
      ],
      stage: 'buy',
    }),
  );
}

/** A bare socket, connected but bound to nothing. */
async function bareSocket(): Promise<Socket> {
  const socket = ioConnect(`http://localhost:${server.port}`, {
    transports: ['websocket'],
    path: SOCKET_PATH,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never connected')), 4000);
    socket.on('connect', () => { clearTimeout(timer); resolve(); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
  return socket;
}

describe('a resume, as a projection', () => {
  it('gives a non-actor the committed state with no foreign hand, bag or seed', async () => {
    // `openSegment` is already the fixture this needs: Alex holds `E6`,
    // founding a chain on `E5` keeps the segment open exactly as
    // `server/clientOverWire.test.ts`'s drop test relies on — no new fixture
    // required here.
    const room = openSegment('resume-projection');
    const [alex, sam] = room.players;

    const a = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    await a.send({ type: 'placeTile', coord: 'E6' });

    // Sam arrives mid-segment — a rejoin, a refresh, or a first connection
    // after someone else has already started their turn.
    const s = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);
    await settleSocket(s.socket);
    const resumed = s.latest()!;

    expect(resumed.reason).toBe('resume');
    // Committed, not Alex's draft: `resume` rides `sendState`'s draft rule,
    // and Sam is not the actor.
    expect(resumed.state.board).toEqual(room.committed().board);
    expect(resumed.state.board['E6'].placed).toBe(false);
    // The literal privacy shape, asserted here rather than inferred from a
    // consistency check — `clientOverWire` compares both sides through the
    // same `project` and would not notice `project` itself leaking. Matches
    // this file's own established shape above: `seed: ''`, not `undefined`.
    expect(resumed.state.players.find((p) => p.id === alex!.id)!.hand).toEqual([]);
    expect(resumed.state.bag).toEqual([]);
    expect(resumed.state.seed).toBe('');

    a.close();
    s.close();
  });
});

describe('what a client receives', () => {
  it('carries no seed, no bag, and no hand but its own', async () => {
    const room = twoSeats('wire-projection');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      await p1.send({ type: 'endTurn' });
      // `p1.send` only orders the server's *handling* of p1's message, not
      // the *arrival* of anything the handling sent to p2's own, separate
      // connection. A round trip on p2's own channel orders behind any
      // earlier emit to p2 (socket.io delivers one connection's messages in
      // order) — without it, a stale join-time message could make the
      // p1-hand assertion below vacuous.
      await settleSocket(p2.socket);

      const received = p2.latest();
      expect(received, 'p2 received no state at all').toBeDefined();
      expect(received!.state.seed).toBe('');
      expect(received!.state.players.find((p) => p.id === 'p2')!.hand).toEqual(['A1', 'B2']);
      expect(received!.state.players.find((p) => p.id === 'p1')!.hand).toEqual([]);

      // The pair is the point: the client's copy must be empty *while* the
      // server still holds real tiles. Either alone proves nothing — an empty
      // projected bag is meaningless if the bag was empty anyway.
      expect(received!.state.bag).toEqual([]);
      expect(room.committed().bag.length).toBe(4);
      expect(room.committed().seed).not.toBe('');
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('an open segment is private', () => {
  it('sends the actor nothing and the table nothing while the draft advances', async () => {
    const room = openSegment('wire-draft');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      // Joining an already-playing room sends the joiner their own commit
      // state immediately (`server/index.ts`'s `joinRoom` handler) — over a
      // real socket that arrives asynchronously, and `connectPlayer` only
      // waits for `joined`, not for it. Drain it on p2's own channel before
      // taking the "before" count, or it can land during the `await` below
      // and be misread as a leak of p1's draft.
      await settleSocket(p2.socket);
      const p2Before = p2.states.length;

      await p1.send({ type: 'placeTile', coord: 'E6' });
      // `p1.send`'s round trip is on p1's own socket. It says nothing about
      // whether anything reached p2's separate connection — only a barrier
      // on p2's own channel, ordered behind any leak already emitted to p2,
      // can prove one didn't land.
      await settleSocket(p2.socket);

      // The placement founds a chain: same actor, segment still open.
      expect(room.actorId()).toBe('p1');
      expect(room.draft().board['E6'].placed).toBe(true);
      expect(room.committed().board['E6'].placed).toBe(false);

      expect(p2.states.length, 'p2 was shown an uncommitted draft').toBe(p2Before);
      expect(p2.states.some((m) => m.reason === 'correction')).toBe(false);
    } finally {
      p1.close();
      p2.close();
    }
  });

  it('sends a genuine mid-segment correction to the actor only', async () => {
    const room = deadTileSegment('wire-correction-privacy');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      await settleSocket(p2.socket);
      const p2Before = p2.states.length;

      await p1.send({ type: 'tradeInDeadTiles', coords: ['C6'] });
      // Same reasoning as the sibling test above: a barrier on p1's own
      // socket proves nothing about p2's channel.
      await settleSocket(p2.socket);

      // Same actor, segment stays open, but the bag was touched — this is
      // the one intent (per `server/room.ts`'s `DRAWS`) that produces a real
      // `correction` delivery rather than `none` or a `commit`.
      expect(room.actorId()).toBe('p1');
      expect(room.draft().players.find((p) => p.id === 'p1')!.hand).toEqual(['I12']);
      expect(p1.latest()!.reason).toBe('correction');

      expect(p2.states.length, 'p2 was shown a correction meant for the actor').toBe(p2Before);
      expect(p2.states.every((m) => m.reason !== 'correction')).toBe(true);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('identity is the socket, not the payload', () => {
  it('rejects an intent from the player who is not being waited on', async () => {
    const room = openSegment('wire-turn');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      await p2.send({ type: 'placeTile', coord: 'A1' });

      expect(p2.rejections).toHaveLength(1);
      expect(p2.rejections[0]!.code).toBe('notYourTurn');
      expect(room.draft().board['A1'].placed).toBe(false);
    } finally {
      p1.close();
      p2.close();
    }
  });

  it('ignores a playerId smuggled into the payload', async () => {
    const room = openSegment('wire-spoof');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      // The wire type has no `playerId`, so this does not typecheck as a
      // `WireIntent` — which is the point. A hostile client is not bound by
      // our types, so the server must ignore the field rather than trust it.
      p2.socket.emit('intent', { type: 'placeTile', coord: 'E6', playerId: 'p1' });
      await p2.send({ type: 'endTurn' });

      expect(room.draft().board['E6'].placed).toBe(false);
      expect(p2.rejections.map((r) => r.code)).toEqual(['notYourTurn', 'notYourTurn']);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('undo over the wire', () => {
  it('lets the actor rewind its own open segment', async () => {
    const room = openSegment('wire-undo');
    const [alex] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);

    try {
      const opened = room.segmentStart();
      await p1.send({ type: 'placeTile', coord: 'E6' });
      expect(room.draft().board['E6'].placed).toBe(true);

      await p1.undo(opened);

      expect(room.draft().board['E6'].placed).toBe(false);
      expect(p1.latest()!.reason).toBe('correction');
    } finally {
      p1.close();
    }
  });

  it('refuses an undo from a player who is not the actor', async () => {
    const room = openSegment('wire-undo-foreign');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      const opened = room.segmentStart();
      await p1.send({ type: 'placeTile', coord: 'E6' });

      await p2.undo(opened);

      expect(p2.rejections.map((r) => r.code)).toContain('notYourTurn');
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
      p2.close();
    }
  });

  it('refuses a step below the open segment', async () => {
    const room = openSegment('wire-undo-old');
    const [alex] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);

    try {
      await p1.send({ type: 'placeTile', coord: 'E6' });
      await p1.undo(0);

      expect(p1.rejections.map((r) => r.code)).toContain('undoOutOfSegment');
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Five additional tests, accumulated from findings in Tasks 6 and 7. Each
// covers a real defect that was found and fixed but currently ships
// untested — see task-8-brief.md for the enumeration.
// ---------------------------------------------------------------------------

describe('an intent or undo sent before the game has begun', () => {
  it('is rejected as wrongStage, and the server stays up', async () => {
    const { room, player } = server.rooms.create('Alex');
    const p1 = await connectPlayer(server.port, room.id, player.name, player.id, player.token);

    try {
      await p1.send({ type: 'endTurn' });
      expect(p1.rejections).toHaveLength(1);
      expect(p1.rejections[0]!.code).toBe('wrongStage');

      await p1.undo(0);
      expect(p1.rejections).toHaveLength(2);
      expect(p1.rejections[1]!.code).toBe('wrongStage');

      // Not merely "our script didn't throw" — the process is still
      // actually serving requests.
      const health = await fetch(`http://localhost:${server.port}/health`);
      expect(health.ok).toBe(true);
      // Shape asserted in `versioning.test.ts`; here it only has to prove the
      // process is still serving HTTP after everything above.
      expect((await health.json()).ok).toBe(true);
    } finally {
      p1.close();
    }
  });
});

describe('a malformed or absent payload', () => {
  it('createRoom rejects it instead of crashing the server', async () => {
    const socket = await bareSocket();
    const rejections: RejectedMessage[] = [];
    socket.on(LOBBY_SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));

    try {
      // An absent payload has no version either, and the version check runs
      // first — deliberately, so a client built before versioning existed is
      // told it is stale rather than told its payload is malformed. Still a
      // clean rejection rather than a crash, which is what this test is for.
      socket.emit(LOBBY_CLIENT_EVENTS.createRoom, undefined);
      await settleSocket(socket);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]!.code).toBe('versionMismatch');

      // Carries the right version, so it reaches the shape guard this case
      // is actually about. Without the version it would never get past the
      // check above and would silently stop testing what it says.
      socket.emit(LOBBY_CLIENT_EVENTS.createRoom, { name: 42, protocolVersion: PROTOCOL_VERSION });
      await settleSocket(socket);
      expect(rejections).toHaveLength(2);
      expect(rejections[1]!.code).toBe('unknownIntent');

      // The server is still serving: a well-formed createRoom on the very
      // same socket, right after two malformed ones, still works.
      const joined = await new Promise<JoinedMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('never joined')), 4000);
        socket.once(LOBBY_SERVER_EVENTS.joined, (m: JoinedMessage) => { clearTimeout(timer); resolve(m); });
        socket.emit(LOBBY_CLIENT_EVENTS.createRoom, {
          name: 'Real Name', protocolVersion: PROTOCOL_VERSION,
        });
      });
      expect(joined.roomId).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });

  it('joinRoom rejects it instead of crashing the server', async () => {
    const { room } = server.rooms.create('Host');
    const socket = await bareSocket();
    const rejections: RejectedMessage[] = [];
    socket.on(LOBBY_SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));

    try {
      // See the note in the `createRoom` case above: no payload, so no
      // version, so the version check answers first.
      socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, undefined);
      await settleSocket(socket);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]!.code).toBe('versionMismatch');

      // Versioned, so this genuinely reaches the shape guard. A name of the
      // wrong *type*, not an absent one: absence is legal as of the Lobby Flow
      // corrections (the server names an unnamed seat by its number), so
      // omitting the field here would seat this socket and quietly stop
      // testing the guard — and would break the well-formed join below, which
      // the one-seat-per-socket rule would then refuse.
      socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, {
        roomId: room.id, name: 42, protocolVersion: PROTOCOL_VERSION,
      });
      await settleSocket(socket);
      expect(rejections).toHaveLength(2);
      expect(rejections[1]!.code).toBe('unknownIntent');

      const joined = await new Promise<JoinedMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('never joined')), 4000);
        socket.once(LOBBY_SERVER_EVENTS.joined, (m: JoinedMessage) => { clearTimeout(timer); resolve(m); });
        socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, {
          roomId: room.id, name: 'Guest', protocolVersion: PROTOCOL_VERSION,
        });
      });
      expect(joined.roomId).toBe(room.id);
    } finally {
      socket.disconnect();
    }
  });

  it('undo rejects a non-numeric stepId instead of crashing the server', async () => {
    const room = openSegment('wire-undo-malformed');
    const [alex] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);

    try {
      p1.socket.emit(GAME_CLIENT_EVENTS.undo, {});
      await settleSocket(p1.socket);
      expect(p1.rejections).toHaveLength(1);
      expect(p1.rejections[0]!.code).toBe('undoOutOfSegment');

      p1.socket.emit(GAME_CLIENT_EVENTS.undo, undefined);
      await settleSocket(p1.socket);
      expect(p1.rejections).toHaveLength(2);
      expect(p1.rejections[1]!.code).toBe('undoOutOfSegment');

      // The server is still serving: a real intent on the same connection
      // still works.
      await p1.send({ type: 'placeTile', coord: 'E6' });
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
    }
  });

  it('intent rejects a malformed payload instead of crashing the server', async () => {
    // Two rooms, because the two families of malformed field need different
    // stages to actually reach the dereference: `doBuyShares` requires `buy`,
    // `doTradeInDeadTiles` requires `play` (`openSegment`'s stage).
    const buyRoom = buyStage('wire-intent-malformed-buy');
    const [buyAlex] = buyRoom.players;
    const buyer = await connectPlayer(server.port, buyRoom.id, buyAlex!.name, buyAlex!.id, buyAlex!.token);

    const tradeRoom = openSegment('wire-intent-malformed-trade');
    const [tradeAlex] = tradeRoom.players;
    const trader = await connectPlayer(server.port, tradeRoom.id, tradeAlex!.name, tradeAlex!.id, tradeAlex!.token);

    try {
      // Each of these has a *valid* `type` and a malformed field — the case
      // the old comment at the `intent` send site argued away by only
      // considering an absent payload. Every one of them dereferences before
      // validation in `engine/intents.ts` (`.length`, a `for...of`, a spread
      // into `Set`) and previously took the whole process down.
      const buyMalformed: unknown[] = [
        { type: 'buyShares' },              // picks undefined -> .length
        { type: 'buyShares', picks: null }, // picks null -> .length
        { type: 'buyShares', picks: 5 },    // picks not iterable
      ];
      for (const [i, payload] of buyMalformed.entries()) {
        buyer.socket.emit(GAME_CLIENT_EVENTS.intent, payload);
        await settleSocket(buyer.socket);
        expect(buyer.rejections, `buyShares payload ${i} (${JSON.stringify(payload)})`)
          .toHaveLength(i + 1);
        expect(buyer.rejections[i]!.code).toBe('unknownIntent');
      }

      trader.socket.emit(GAME_CLIENT_EVENTS.intent, { type: 'tradeInDeadTiles', coords: 5 });
      await settleSocket(trader.socket);
      expect(trader.rejections).toHaveLength(1);
      expect(trader.rejections[0]!.code).toBe('unknownIntent');

      // The server stayed up: a well-formed intent on each connection, right
      // after the malformed ones, still works — and so does an unrelated
      // liveness check.
      await buyer.send({ type: 'endTurn' });
      expect(buyRoom.committed().stage).not.toBe('buy');

      await trader.send({ type: 'placeTile', coord: 'E6' });
      expect(tradeRoom.draft().board['E6'].placed).toBe(true);

      const health = await fetch(`http://localhost:${server.port}/health`);
      expect(health.ok).toBe(true);
      // Shape asserted in `versioning.test.ts`; here it only has to prove the
      // process is still serving HTTP after everything above.
      expect((await health.json()).ok).toBe(true);
    } finally {
      buyer.close();
      trader.close();
    }
  });
});

describe('a rejection is addressed to a non-actor', () => {
  it('carries the committed state, never the actor draft — and the actor still gets their own draft back', async () => {
    const room = openSegment('wire-reject-draft-leak');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      await p1.send({ type: 'placeTile', coord: 'E6' });
      expect(room.actorId()).toBe('p1');
      expect(room.draft().board['E6'].placed).toBe(true);
      expect(room.committed().board['E6'].placed).toBe(false);

      // p2 is not the actor: their out-of-turn intent is rejected, and the
      // 'reset' that follows must be the committed state — not the open
      // draft holding p1's uncommitted board, cash and log.
      //
      // `placeTile` would not do it here: the founding placement already
      // moved the stage to 'foundStartup', so a `placeTile` intent fails
      // `requireStage` before identity is ever checked, giving `wrongStage`
      // instead of `notYourTurn`. `chooseFoundingBrand` matches the actual
      // stage, so it reaches — and fails — the identity check instead.
      await p2.send({ type: 'chooseFoundingBrand', startupId: 'Gobble' });
      expect(p2.rejections.map((r) => r.code)).toEqual(['notYourTurn']);
      expect(p2.latest()!.state).toEqual(project(room.committed(), 'p2'));
      expect(p2.latest()!.state.board['E6'].placed).toBe(false);

      // p1 IS the actor: `endTurn` while mid-founding is a genuine rejection
      // (wrongStage), and *their own* 'reset' must still show them their own
      // open draft, not a reset all the way back to committed.
      await p1.send({ type: 'endTurn' });
      expect(p1.rejections.map((r) => r.code)).toEqual(['wrongStage']);
      expect(p1.latest()!.state).toEqual(project(room.draft(), 'p1'));
      expect(p1.latest()!.state.board['E6'].placed).toBe(true);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('a player id that was never seated', () => {
  it('is rejected as notYourTurn, not a crash, and the server stays up', async () => {
    const room = openSegment('wire-unseated');
    const [alex] = room.players;

    // No socket can ever bind to this id — `rooms.join` requires it to match
    // an existing seat's token — so this calls `room.dispatch`/`room.undo`
    // directly, exactly as the socket handlers do once a socket is bound.
    const dispatched = room.dispatch('totally-unseated-id', { type: 'endTurn' });
    expect(dispatched).toMatchObject({ kind: 'rejected', code: 'notYourTurn' });

    const undone = room.undo('totally-unseated-id', 0);
    expect(undone).toMatchObject({ kind: 'rejected', code: 'notYourTurn' });

    // The server this room lives in is still serving real players.
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    try {
      await p1.send({ type: 'placeTile', coord: 'E6' });
      expect(room.draft().board['E6'].placed).toBe(true);
    } finally {
      p1.close();
    }
  });
});

describe('a rejected intent leaves the draft unchanged', () => {
  it('is byte-for-byte identical, asserted over the wire', async () => {
    const room = openSegment('wire-unchanged-draft');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      const before = JSON.stringify(room.draft());

      await p2.send({ type: 'placeTile', coord: 'A1' }); // not p2's turn

      expect(p2.rejections.map((r) => r.code)).toEqual(['notYourTurn']);
      expect(JSON.stringify(room.draft())).toBe(before);
    } finally {
      p1.close();
      p2.close();
    }
  });
});

describe('the log never leaks a hand through project()', () => {
  it('names no tile coordinate that sits in another player\'s actual hand', async () => {
    const room = deadReplacementSegment('wire-log-leak');
    const [alex, sam] = room.players;
    const p1 = await connectPlayer(server.port, room.id, alex!.name, alex!.id, alex!.token);
    const p2 = await connectPlayer(server.port, room.id, sam!.name, sam!.id, sam!.token);

    try {
      await p1.send({ type: 'tradeInDeadTiles', coords: ['C6'] });
      expect(room.draft().players.find((p) => p.id === 'p1')!.hand).toEqual(['C7']);

      // `C7` is itself dead (see `deadReplacementSegment`), so no legal
      // placement remains — `endTurn` closes the segment right away. A real
      // commit, broadcast to the whole table, while p1 still holds `C7`.
      await p1.send({ type: 'endTurn' });
      expect(room.actorId()).toBe('p2');
      await settleSocket(p2.socket);

      const seenBySam = p2.latest()!.state;
      expect(seenBySam.players.find((p) => p.id === 'p1')!.hand).toEqual([]);

      // The general invariant, not just this one case: no tile coordinate
      // named anywhere in a projection Sam actually received may sit in a
      // hand that isn't Sam's — checked against the room's real,
      // unprojected state, which is the ground truth `seenBySam` must not
      // leak. Written this way, it also catches any future intent that logs
      // a drawn tile, not just `tradeInDeadTiles`.
      const actualHand = new Map(room.committed().players.map((p) => [p.id, p.hand]));
      for (const entry of seenBySam.log) {
        for (const token of entry.detail) {
          if (token.kind !== 'tile') continue;
          for (const [ownerId, hand] of actualHand) {
            if (ownerId === 'p2') continue; // Sam's own hand is not a leak
            expect(
              hand,
              `log entry "${entry.phase}" names ${token.coord}, which is in ${ownerId}'s hand`,
            ).not.toContain(token.coord);
          }
        }
      }
    } finally {
      p1.close();
      p2.close();
    }
  });
});
