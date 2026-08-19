// server/devSeed.ts
// Seats a golden game so a browser can be dropped into a mid-game room.
//
// Why this exists: there is no other way to reach a merger by hand. Every
// socket-level test seats fixtures through `rooms.fromState`, but
// `socketHarness.ts` records the deliberate limit — "there is deliberately no
// socket event that installs a prepared state" — so from a browser the only
// route to a merger is playing a real game until one happens *and* both
// players happen to hold the dying chain's stock. That is minutes per attempt,
// non-deterministic, and not repeatable, which is the most likely reason the
// two-browser merger pass has been owed across three carry-forwards.
//
// HTTP, not a socket event, on purpose: the limit above stays true, and the
// protocol surface does not grow a permanent dev affordance immediately before
// a protocol version is put on it.
//
// The golden data is imported unconditionally while the *route* is registered
// conditionally, so a production server loads the fixtures and serves nothing
// from them. Accepted rather than overlooked: the server is not bundled, so
// this costs memory and not a shipped byte, and the alternative — a dynamic
// import inside the guard — would make `createServer` async, which the boot
// path and every test depend on it not being.

import express, { type Express } from 'express';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import type { RoomRegistry } from './rooms.js';
import { BASE_PATH } from '../basePath.js';

/**
 * Registers `POST ${BASE_PATH}/dev/rooms`, but only when the caller
 * (server/index.ts) has confirmed `NODE_ENV === 'development'` — fail
 * closed, not "unless production": an unset or unexpected NODE_ENV does not
 * register the route. That means it exists under `npm run dev:server`, and
 * not under `npm run serve` / `npm run start:server`, neither of which set
 * NODE_ENV at all.
 *
 * The caller registers conditionally rather than this handler checking on each
 * request: an absent route cannot be reached by a bug in its own guard.
 * `server/devSeed.test.ts` asserts the absence, and that assertion is only
 * meaningful because the route otherwise exists.
 */
export function registerDevSeed(app: Express, rooms: RoomRegistry): void {
  // Body parsing is scoped to this route rather than the app, so nothing about
  // production request handling changes by adding a dev tool.
  app.post(`${BASE_PATH}/dev/rooms`, express.json(), (req, res) => {
    const body: unknown = req.body;
    const { goldenId, roomId } =
      typeof body === 'object' && body !== null
        ? (body as { goldenId?: unknown; roomId?: unknown })
        : {};

    const game = ALL_GOLDEN_GAMES.find((g) => g.id === goldenId);
    if (!game) {
      res.status(400).json({ error: `unknown golden game: ${String(goldenId)}` });
      return;
    }

    // The fixture is the authority on who is playing. The caller passes no
    // names, so a seeded room cannot disagree with the game it came from.
    const state = buildFixture(game.setup);
    const names = state.players.map((p) => p.name);

    // Re-seeding an id replaces the room, which is how a by-hand run is
    // restarted. Tokens are fresh because the room object is.
    const id = typeof roomId === 'string' && roomId !== '' ? roomId : `DEV${game.id}`;
    const room = rooms.fromState(id, names, state);

    // `fromState` seats through `seatPlayer`, which marks a player connected.
    // Nobody has connected yet, and a roster that claims otherwise makes the
    // presence dots lie before a single socket has opened.
    for (const player of room.players) player.connected = false;

    res.json({
      roomId: room.id,
      goldenId: game.id,
      title: game.title,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        // Origin-free on purpose: the server does not know where the client is
        // being served from, and during this work it is often somewhere else.
        path:
          `${BASE_PATH}/room/${room.id}?devSeat=${p.id}&devToken=${p.token}` +
          `&devName=${encodeURIComponent(p.name)}`,
      })),
    });
  });
}
