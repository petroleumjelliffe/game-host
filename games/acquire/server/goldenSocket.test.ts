import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { assertState } from '../engine/golden/runner.js';
import { startTestServer, connectPlayer, type TestClient, type TestServer } from './socketHarness.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

/**
 * This suite proves the inbound leg only: socket → binding → engine → the
 * correct rules outcome (asserted against `room.draft()`, the authority's own
 * live state) plus the rejection channel. `TestClient.states` — every `state`
 * message this client actually received over the wire — is collected by the
 * harness but never asserted here. Break 2 in the task-7 fix round confirmed
 * this directly: suppressing every outbound `state`/`rejected` delivery still
 * left eight of seventeen games passing in full, which is only possible if
 * nothing in this file depends on what arrives back over the wire.
 * Projection and the broadcast itself are Task 8's job, not this file's.
 */
describe('golden games reach their declared states through the socket layer', () => {
  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, async () => {
      const fixture = buildFixture(game.setup);
      const names = fixture.players.map((p) => p.name);
      const room = server.rooms.fromState(`socket-${game.id}`, names, fixture);

      const clients: Record<string, TestClient> = {};
      for (const seat of room.players) {
        clients[seat.id] = await connectPlayer(
          server.port, room.id, seat.name, seat.id, seat.token,
        );
      }

      try {
        for (const step of game.steps) {
          const client = clients[step.intent.playerId]!;
          const { playerId, ...wire } = step.intent;
          const before = client.rejections.length;
          // `logPhases` assertions only see log entries appended by this
          // step, mirroring `runGoldenGame`'s own `logMark` — without it a
          // step's assertion would see every earlier step's log entries too.
          const logMark = room.draft().log.length;

          await client.send(wire);

          if (step.expectError) {
            expect(client.rejections.length, `${game.id} / ${step.name} — expected a rejection`)
              .toBe(before + 1);
            expect(client.rejections[before]!.code, `${game.id} / ${step.name}`)
              .toBe(step.expectError);
          } else {
            expect(client.rejections.length, `${game.id} / ${step.name} — unexpected rejection: ${JSON.stringify(client.rejections[before])}`)
              .toBe(before);
          }

          if (step.then) {
            assertState(room.draft(), step.then, `${game.id} / ${step.name} (over the wire)`, logMark);
          }
        }

        if (game.final) {
          assertState(room.draft(), game.final, `${game.id} final (over the wire)`);
        }
      } finally {
        for (const client of Object.values(clients)) client.close();
      }
    });
  }
});
