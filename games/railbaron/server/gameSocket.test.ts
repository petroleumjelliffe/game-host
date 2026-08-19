import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, RB_PROTOCOL_VERSION,
  type LogMessage,
} from '../session/protocol';
import type { GameEvent } from '../src/state/events';
import type { JoinedMessage } from '../vendor/lobby/protocol/protocol';
import { SOCKET_PATH, startServer, type RunningServer } from './index';

// Real board data, as in src/state/legal.test.ts: Chicago is 20 (NC, node
// c24), Atlanta is 9 (SE), and d122 neighbours Chicago.
//
// The second seat is GREEN, not blue: SEATS runs red, green, blue, … and the
// lobby fills the first free id, so a two-player room is red and green. The
// seat ids being the colours is the whole point of the SeatSpace, and this is
// where that stops being an abstraction.
const redHome: GameEvent =
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };
const greenHome: GameEvent =
  { type: 'arrived', seat: 'green', city: 9, region: 'SE', payout: null };

let server: RunningServer;
const open: ClientSocket[] = [];

beforeEach(async () => {
  const gamesDir = await mkdtemp(join(tmpdir(), 'rb-wire-'));
  server = await startServer({ port: 0, gamesDir });
});

afterEach(async () => {
  // Sockets first: a live client keeps reconnecting at a port the next test
  // is about to reuse.
  for (const s of open) s.disconnect();
  open.length = 0;
  await server.close();
});

/** One waiter for the next message of a kind. */
function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => { socket.once(event, resolve as (v: T) => void); });
}

function client(): ClientSocket {
  const socket = connect(`http://localhost:${server.port}`, {
    path: SOCKET_PATH, transports: ['websocket'],
  });
  open.push(socket);
  return socket;
}

/** Collects every refusal this socket is sent, so absence is assertable too. */
function refusals(socket: ClientSocket): { code: string; message: string }[] {
  const seen: { code: string; message: string }[] = [];
  socket.on('rejected', (r: { code: string; message: string }) => seen.push(r));
  return seen;
}

function createRoom(socket: ClientSocket): Promise<JoinedMessage> {
  const joined = next<JoinedMessage>(socket, 'joined');
  socket.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name: 'ADA' });
  return joined;
}

function joinRoom(
  socket: ClientSocket, roomId: string, extra: Record<string, unknown> = {},
): Promise<JoinedMessage> {
  const joined = next<JoinedMessage>(socket, 'joined');
  socket.emit('joinRoom', { roomId, protocolVersion: RB_PROTOCOL_VERSION, ...extra });
  return joined;
}

/** Wait for the first message of a kind that satisfies a predicate. */
function waitFor<T>(socket: ClientSocket, event: string, ok: (value: T) => boolean): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (value: T): void => {
      if (!ok(value)) return;
      socket.off(event, handler as (...args: unknown[]) => void);
      resolve(value);
    };
    socket.on(event, handler as (...args: unknown[]) => void);
  });
}

/**
 * Append one event and wait for the broadcast that confirms *it* landed.
 *
 * The predicate is not belt-and-braces. Every socket in the room receives
 * every broadcast, so a plain "next log message" waiter on one socket happily
 * resolves on the *other* socket's append still in flight — which reads as an
 * append that silently did nothing, one event short, several steps later.
 */
async function append(socket: ClientSocket, event: GameEvent): Promise<GameEvent[]> {
  const landed = JSON.stringify(event);
  const echo = waitFor<LogMessage>(socket, GAME_SERVER_EVENTS.log,
    (m) => JSON.stringify(m.events[m.events.length - 1]) === landed);
  socket.emit(GAME_CLIENT_EVENTS.append, { event });
  return (await echo).events;
}

interface Begun {
  host: ClientSocket;
  guest: ClientSocket;
  roomId: string;
  guestSeat: JoinedMessage;
  log: GameEvent[];
}

/** A two-seat room, begun. */
async function begunRoom(): Promise<Begun> {
  const host = client();
  const { roomId } = await createRoom(host);
  const guest = client();
  const guestSeat = await joinRoom(guest, roomId, { name: 'BEN' });

  const hostLog = next<LogMessage>(host, GAME_SERVER_EVENTS.log);
  const guestLog = next<LogMessage>(guest, GAME_SERVER_EVENTS.log);
  host.emit('beginGame');
  const [a, b] = await Promise.all([hostLog, guestLog]);
  expect(b.events).toEqual(a.events);
  return { host, guest, roomId, guestSeat, log: a.events };
}

describe('the game wire', () => {
  it('hands a creator who joins on the same socket their own seat back', async () => {
    // The client's whole create→room flow rides on this: the join screen
    // creates the room, navigates, and the room screen joins — same socket,
    // no stored identity yet, because identity is only saved by the joined
    // reply the room screen is waiting for. The server's binding shortcut is
    // what makes that arrival the host coming home rather than a stranger
    // taking a second seat.
    const socket = client();
    const created = await createRoom(socket);
    const again = await joinRoom(socket, created.roomId);

    expect(again.playerId).toBe('red');
    expect(again.roomId).toBe(created.roomId);

    // And Begin seeds one baron, not a host plus their own ghost — the
    // seeded log is the roster, stated in the game's own vocabulary.
    const begun = next<LogMessage>(socket, GAME_SERVER_EVENTS.log);
    socket.emit('beginGame');
    expect((await begun).events).toEqual([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
    ]);
  });

  it('seeds a joined per seat and one started at Begin, in roster order', async () => {
    const { log, guestSeat } = await begunRoom();
    expect(guestSeat.playerId).toBe('green');
    expect(log).toEqual([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'BEN' },
      { type: 'started' },
    ]);
  });

  it('broadcasts an accepted append to every socket in the room', async () => {
    const { host, guest } = await begunRoom();
    const onHost = next<LogMessage>(host, GAME_SERVER_EVENTS.log);
    const onGuest = next<LogMessage>(guest, GAME_SERVER_EVENTS.log);
    host.emit(GAME_CLIENT_EVENTS.append, { event: redHome });

    const [a, b] = await Promise.all([onHost, onGuest]);
    expect(a.events[a.events.length - 1]).toEqual(redHome);
    expect(b.events).toEqual(a.events);
  });

  it('refuses an append out of turn and leaves the log alone', async () => {
    const { host, guest } = await begunRoom();
    const refused = refusals(guest);
    // Homes go in seat order, so red's comes before green's.
    guest.emit(GAME_CLIENT_EVENTS.append, { event: greenHome });
    await next(guest, 'rejected');
    expect(refused[0]!.code).toBe('notNow');

    // The log the other socket holds never moved: red's home is still the
    // fourth event, not the fifth.
    expect(await append(host, redHome)).toHaveLength(4);
  });

  it('refuses an append whose seat is not the sender', async () => {
    const { guest } = await begunRoom();
    const refused = refusals(guest);
    guest.emit(GAME_CLIENT_EVENTS.append, { event: redHome });
    await next(guest, 'rejected');
    expect(refused[0]!.code).toBe('notYourSeat');
  });

  it('refuses malformed appends and stays alive to accept a real one', async () => {
    const { host } = await begunRoom();
    const refused = refusals(host);
    host.emit(GAME_CLIENT_EVENTS.append, { event: { type: 'joined', seat: 'red', name: 'X' } });
    await next(host, 'rejected');
    host.emit(GAME_CLIENT_EVENTS.append, { event: 42 });
    await next(host, 'rejected');
    host.emit(GAME_CLIENT_EVENTS.append, {});
    await next(host, 'rejected');
    expect(refused.map((r) => r.code)).toEqual(['notNow', 'malformedEvent', 'malformedEvent']);

    // Liveness: a synchronous throw inside a listener would have taken the
    // process down, and this legal append is what proves it did not.
    expect(await append(host, redHome)).toHaveLength(4);
  });

  it('takes orderRolled from a seat that did not roll it, but only once', async () => {
    const { host, guest } = await begunRoom();
    await append(host, redHome);
    await append(guest, greenHome);

    // Rolling for first player is a shared ceremony: green may report red's.
    const order: GameEvent = { type: 'orderRolled', seat: 'red', first: 'red' };
    expect(await append(guest, order)).toHaveLength(6);

    const refused = refusals(guest);
    guest.emit(GAME_CLIENT_EVENTS.append, { event: order });
    await next(guest, 'rejected');
    expect(refused[0]!.code).toBe('notNow');
  });

  describe('undo', () => {
    /** Homes in, order rolled, red rolling and moving: a turn to take back. */
    async function midTurn(): Promise<Begun> {
      const room = await begunRoom();
      await append(room.host, redHome);
      await append(room.guest, greenHome);
      await append(room.host, { type: 'orderRolled', seat: 'red', first: 'red' });
      await append(room.host,
        { type: 'arrived', seat: 'red', city: 9, region: 'SE', payout: 45 });
      await append(room.host,
        { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null });
      await append(room.host,
        { type: 'moved', seat: 'red', path: ['c24', 'd122'], arrived: false });
      return room;
    }

    it('refuses an undo from a seat whose action it is not', async () => {
      const { guest } = await midTurn();
      const refused = refusals(guest);
      guest.emit(GAME_CLIENT_EVENTS.undo);
      await next(guest, 'rejected');
      expect(refused[0]!.code).toBe('notYourUndo');
    });

    it('takes back the whole turn for the seat that acted', async () => {
      const { host } = await midTurn();
      const echo = next<LogMessage>(host, GAME_SERVER_EVENTS.log);
      host.emit(GAME_CLIENT_EVENTS.undo);
      // One tap pops one player action, and a turn is its roll and the leg it
      // paid for — so the log goes back through `turnRolled`, not by one event.
      expect((await echo).events.map((e) => e.type)).toEqual([
        'joined', 'joined', 'started', 'arrived', 'arrived', 'orderRolled', 'arrived',
      ]);
    });

    it('refuses an undo that would reach into the seeded prefix', async () => {
      const { host } = await begunRoom();
      const refused = refusals(host);
      host.emit(GAME_CLIENT_EVENTS.undo);
      await next(host, 'rejected');
      expect(refused[0]!.code).toBe('nothingToUndo');
    });
  });

  it('hands a rejoining socket the game so far', async () => {
    const { host, guest, roomId, guestSeat } = await begunRoom();
    expect(await append(host, redHome)).toHaveLength(4);

    guest.disconnect();
    // A rejoin must prove itself: the id alone is someone else's seat, and the
    // token is what the server issued only to this player.
    const returning = client();
    // Registered before the join is sent, not after it resolves. onSeated
    // emits the log in the same breath as `joined`, so a listener attached
    // after awaiting `joined` can miss it outright — which shows up as a
    // timeout only under load, when the two messages are not split across
    // ticks the way an idle machine splits them.
    const caught = next<LogMessage>(returning, GAME_SERVER_EVENTS.log);
    const seat = await joinRoom(returning, roomId, {
      playerId: guestSeat.playerId, token: guestSeat.token,
    });
    expect(seat.playerId).toBe('green');

    const { events } = await caught;
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual(redHome);
  });
});
