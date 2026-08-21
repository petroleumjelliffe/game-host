import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CITIES, cityAt, cityById, nodeForCity, payoutBetween, type NodeId } from '../engine/index.js';
import { GAMES } from '../engine/golden/games.js';
import { runGoldenGame } from '../engine/golden/runner.js';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, RB_PROTOCOL_VERSION,
  type LogMessage,
} from '../session/protocol.js';
import type { GameEvent } from '../src/state/events.js';
import { replay } from '../src/state/game.js';
import type { JoinedMessage } from '@game-host/lobby/protocol/protocol';
import { SOCKET_PATH, startServer, type RunningServer } from './index.js';

/**
 * The keystone. Task 4's tests prove the authority refuses illegal appends;
 * this proves it accepts every legal game, which is the direction that can
 * only be shown by playing real ones. Each golden game's story is replayed as
 * a sequence of `append`s from a real client over a real socket, and the log
 * the server broadcasts back must replay to the state the runner finished in.
 *
 * Both halves are needed before the table is trusted: a legality table that
 * refuses everything passes every rejection test in the suite.
 */

/** Both spent-section tallies in one comparable shape — as replay.golden does. */
const sections = (used: ReadonlyMap<string, number>): [string, number][] =>
  [...used].sort(([a], [b]) => a.localeCompare(b));

let server: RunningServer;
const open: ClientSocket[] = [];

beforeAll(async () => {
  const gamesDir = await mkdtemp(join(tmpdir(), 'rb-golden-'));
  server = await startServer({ port: 0, gamesDir });
});

afterEach(() => {
  for (const s of open) s.disconnect();
  open.length = 0;
});

afterAll(async () => { await server.close(); });

function client(): ClientSocket {
  const socket = connect(`http://localhost:${server.port}`, {
    path: SOCKET_PATH, transports: ['websocket'],
  });
  open.push(socket);
  return socket;
}

function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => { socket.once(event, resolve as (v: T) => void); });
}

/**
 * Append one event, and resolve only on the broadcast carrying *it*. A
 * refusal rejects the promise instead of letting the test time out, so a
 * disagreement between the runner and the legality table reports itself with
 * the server's own words rather than as "timed out in 5000ms".
 */
function append(socket: ClientSocket, event: GameEvent): Promise<GameEvent[]> {
  const landed = JSON.stringify(event);
  return new Promise<GameEvent[]>((resolve, reject) => {
    const onLog = (msg: LogMessage): void => {
      if (JSON.stringify(msg.events[msg.events.length - 1]) !== landed) return;
      cleanup();
      resolve(msg.events);
    };
    const onRejected = (r: { code: string; message: string }): void => {
      cleanup();
      reject(new Error(`server refused ${event.type}: ${r.code} — ${r.message}`));
    };
    function cleanup(): void {
      socket.off(GAME_SERVER_EVENTS.log, onLog);
      socket.off('rejected', onRejected);
    }
    socket.on(GAME_SERVER_EVENTS.log, onLog);
    socket.on('rejected', onRejected);
    socket.emit(GAME_CLIENT_EVENTS.append, { event });
  });
}

/**
 * A city this game's pawn will never stand on, to serve as the destination a
 * baron must hold before it may roll the dice.
 *
 * The golden fixtures are movement fixtures: they script rolls and legs and
 * never roll a destination, because that is not what they are for. A real
 * game always has one, and `appendLegality` says so — "roll a destination
 * first" — so the wire needs one supplied. Choosing a city off the game's own
 * route means the pawn never arrives on it, so the destination stays owed-to
 * for the whole story and one announcement covers it.
 */
function destinationOffTheRoute(touched: ReadonlySet<NodeId>, home: number): number {
  const city = CITIES.find(
    (c) => c.id !== home && !touched.has(nodeForCity(c.id)),
  );
  if (city === undefined) {
    throw new Error('every city sits on this game\'s route — no destination to name');
  }
  return city.id;
}

describe('every golden game plays through the wire', () => {
  for (const game of GAMES) {
    it(`${game.id}: the server accepts the whole story`, async () => {
      const finished = runGoldenGame(game);

      // Every golden fixture starts on a city — a home roll needs one to land
      // on. Throw rather than silently skip, exactly as replay.golden does.
      const home = cityAt(game.setup.at);
      if (home === null) {
        throw new Error(
          `${game.id}: fixture starts on a dot (${game.setup.at}), not a city — `
          + 'no home city to build a log from',
        );
      }

      const socket = client();
      const joined = next<JoinedMessage>(socket, 'joined');
      socket.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name: 'ADA' });
      await joined;

      const begun = next<LogMessage>(socket, GAME_SERVER_EVENTS.log);
      socket.emit('beginGame');
      expect((await begun).events).toEqual([
        { type: 'joined', seat: 'red', name: 'ADA' },
        { type: 'started' },
      ]);

      // The region must be the one the city really belongs to: isGameEvent
      // checks cityById(city).region and the server refuses the event
      // otherwise.
      await append(socket, {
        type: 'arrived', seat: 'red', city: home,
        region: cityById(home).region, payout: null,
      });
      await append(socket, { type: 'orderRolled', seat: 'red', first: 'red' });

      const touched = new Set<NodeId>([game.setup.at]);
      for (const record of finished.story) {
        if (record.kind === 'leg') for (const node of record.path) touched.add(node);
      }
      const destination = destinationOffTheRoute(touched, home);
      await append(socket, {
        type: 'arrived', seat: 'red', city: destination,
        region: cityById(destination).region,
        // A real figure, and 0 is a real figure — two journeys on this board
        // pay nothing, and they are legal destinations, not absent ones.
        payout: payoutBetween(home, destination),
      });

      let events: GameEvent[] = [];
      for (const record of finished.story) {
        if (record.kind === 'roll') {
          events = await append(socket, {
            type: 'turnRolled', seat: 'red',
            white: [record.white[0]!, record.white[1]!], bonus: null,
          });
        } else if (record.kind === 'bonus') {
          events = await append(socket,
            { type: 'bonusRolled', seat: 'red', face: record.face });
        } else {
          events = await append(socket, {
            type: 'moved', seat: 'red', path: [...record.path], arrived: record.arrived,
          });
        }
      }

      // The broadcast log, not a local copy: what every other client would be
      // handed is what has to replay to the right game.
      const seat = replay(events).seats.red;
      expect(seat.at, 'where the pawn ended').toBe(finished.at);
      expect(sections(seat.used), 'sections the trip has spent')
        .toEqual(sections(finished.used));
    }, 20_000);
  }
});
