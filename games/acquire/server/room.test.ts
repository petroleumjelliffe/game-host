import { describe, it, expect } from 'vitest';
import { buildFixture } from '../engine/golden/fixtures.js';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { applyIntent } from '../engine/intents.js';
import { getCurrentActor } from '../engine/actor.js';
import { createGameRoom, type RoomPlayer } from './room.js';

function roster(...names: string[]): RoomPlayer[] {
  return names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    token: `token-${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

/** p1 can found a chain with E6; p2 waits. */
function openBoard() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

describe('the room stays silent while a segment is open', () => {
  it('says nothing when the actor advances their own draft', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());

    const delivery = room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    expect(delivery).toEqual({ kind: 'none' });
    expect(room.actorId()).toBe('p1');
  });

  it('keeps the committed state behind the draft', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const before = room.committed();

    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    expect(room.committed()).toEqual(before);
    expect(room.draft()).not.toEqual(before);
    expect(room.draft().board['E6'].placed).toBe(true);
    expect(room.committed().board['E6'].placed).toBe(false);
  });
});

describe('the room commits when the actor changes', () => {
  it('publishes the draft and reports a commit', () => {
    const room = createGameRoom(
      'r1',
      roster('Alex', 'Sam'),
      buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: [] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        loners: ['E5'],
        bag: [],
      }),
    );

    const delivery = room.dispatch('p1', { type: 'endTurn' });

    expect(delivery).toEqual({ kind: 'commit' });
    expect(room.actorId()).toBe('p2');
    expect(room.committed()).toEqual(room.draft());
  });
});

describe('the segment before the open one', () => {
  it('is undefined until a commit has replaced one', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    expect(room.previousSegmentStart()).toBeUndefined();
  });

  it('is where the finished segment began, once one commits', () => {
    // openBoard()'s E6 sits next to the loner at E5, so placing it founds a
    // chain and parks the room on `foundStartup` rather than closing the
    // segment — not the shortest path to a boundary here. This fixture's A1
    // has no adjacent loner or chain, so placing it founds nothing: the tile
    // just lands, the stage falls through to `buy`, and `endTurn` closes the
    // segment cleanly.
    const room = createGameRoom(
      'r1',
      roster('Alex', 'Sam'),
      buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['A1'] },
          { name: 'Sam', cash: 6000, hand: ['H8'] },
        ],
        bag: ['I11'],
      }),
    );
    const opened = room.segmentStart();

    room.dispatch('p1', { type: 'placeTile', coord: 'A1' });
    room.dispatch('p1', { type: 'endTurn' });

    expect(room.segmentStart()).not.toBe(opened);
    expect(room.previousSegmentStart()).toBe(opened);
  });
});

describe('the room refuses what the engine refuses', () => {
  it('rejects an intent from the player whose turn it is not', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());

    const delivery = room.dispatch('p2', { type: 'placeTile', coord: 'A1' });

    expect(delivery).toEqual({
      kind: 'rejected',
      to: 'p2',
      code: 'notYourTurn',
      message: expect.any(String),
    });
  });

  it('leaves the draft untouched after a rejection', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const before = structuredClone(room.draft());

    room.dispatch('p2', { type: 'placeTile', coord: 'A1' });

    expect(room.draft()).toEqual(before);
    expect(room.draft().board['A1'].placed).toBe(false);
    expect(room.draft().players.find((p) => p.id === 'p2')!.hand).toContain('A1');
  });
});

describe('undo is authorised by the room, not the session', () => {
  it('lets the actor rewind inside its own open segment', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const opened = room.segmentStart();
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p1', opened);

    expect(delivery).toEqual({ kind: 'correction', to: 'p1' });
    expect(room.draft().board['E6'].placed).toBe(false);
  });

  it('refuses an undo from someone who is not the actor', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    const opened = room.segmentStart();
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p2', opened);

    expect(delivery).toMatchObject({ kind: 'rejected', to: 'p2', code: 'notYourTurn' });
    expect(room.draft().board['E6'].placed).toBe(true);
  });

  it('refuses a step below the open segment', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam'), openBoard());
    room.dispatch('p1', { type: 'placeTile', coord: 'E6' });

    const delivery = room.undo('p1', 0);

    expect(delivery).toMatchObject({ kind: 'rejected', to: 'p1', code: 'undoOutOfSegment' });
  });
});

describe('beginning a game', () => {
  it('creates a state whose player ids match the roster seats', () => {
    const room = createGameRoom('r1', roster('Alex', 'Sam', 'Jordan'));
    expect(room.lifecycle()).toBe('lobby');

    const delivery = room.begin('seed-abc');

    expect(delivery).toEqual({ kind: 'commit' });
    expect(room.lifecycle()).toBe('playing');
    expect(room.committed().players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(room.committed().players.map((p) => p.name)).toEqual(['Alex', 'Sam', 'Jordan']);
    expect(room.committed().stage).toBe('draw');
  });
});

/**
 * Test 6, reframed during implementation, then reframed again in review.
 *
 * As first written this asserted that no player is ever asked to act on stale
 * money. Once you account for an actor seeing their own draft, that follows by
 * construction from "a commit happens when the actor changes" — it would have
 * passed without exercising the room at all.
 *
 * The first reframing collapsed a segment close onto an actor change alone.
 * That over-reached *at the time*, because leaving the turn-order draw closed a
 * segment even with the actor unchanged: seat one pressed one button for the
 * whole table, so what followed belonged to the winner as a *player* and their
 * hand had been seen by nobody.
 *
 * As of 2026-08-08 the draw is one intent *per player*, and the rule survives
 * with its reason replaced — which is the third time this comment has been
 * rewritten by the same question, so it is worth stating precisely.
 *
 * A segment still closes when the draw resolves even if the actor is unchanged
 * (the last drawer winning their own draw). It is no longer about revealing a
 * hand: it is that this room derives `commit` from the segment closing, so
 * without it the turn order — public the instant it exists — would stay inside
 * the winner's private draft until they finished their entire first turn.
 *
 * The *curtain* is what narrowed. `GameSession` raises it only on a real actor
 * change, because its job is handing the device to somebody else and the last
 * drawer already has it. Curtain and commit are no longer the same event, and
 * G17 is the golden that pins the difference.
 *
 * The coupling itself is what deserves pinning. Every privacy and staleness
 * guarantee in this phase rests on it, and a `dispatch` that committed early
 * (on any payout, say) or late would break all of them silently while every
 * other test stayed green.
 */
describe('a commit and a segment close are the same event', () => {
  // Summed across every game below, then floored by the suite-level test
  // after the loop. Measured at 15 across the seventeen golden games current
  // as of this task; pinned well below that so a game that stops finding
  // segment boundaries is caught without a new golden game breaking the gate.
  let totalSegmentCloses = 0;

  for (const game of ALL_GOLDEN_GAMES) {
    it(`${game.id}: ${game.title}`, () => {
      const fixture = buildFixture(game.setup);
      const room = createGameRoom(
        `commit-${game.id}`,
        roster(...fixture.players.map((p) => p.name)),
        fixture,
      );

      let commits = 0;
      let segmentCloses = 0;

      for (const step of game.steps) {
        const where = `${game.id} / ${step.name}`;
        const actorBefore = room.actorId();
        const stageBefore = room.draft().stage;
        const delivery = room.dispatch(step.intent.playerId, step.intent);

        if (step.expectError) {
          expect(delivery.kind, where).toBe('rejected');
          continue;
        }
        expect(delivery.kind, `${where} — unexpected rejection`).not.toBe('rejected');

        // A segment closes two ways: the actor changes, or the turn-order draw
        // resolves. The second matters only when the last drawer wins their own
        // draw, and it is not about hand-offs — the *curtain* is narrower and
        // stays put in that case. It is about the table: this room derives its
        // commit from the segment closing, so without it nobody would see who
        // won the draw until the winner finished their whole first turn.
        const closed = room.actorId() !== actorBefore
          || (stageBefore === 'draw' && room.draft().stage !== 'draw');

        if (closed) segmentCloses++;
        if (delivery.kind === 'commit') commits++;

        expect(delivery.kind === 'commit', `${where} — commit and segment close disagree`)
          .toBe(closed);

        if (delivery.kind === 'commit') {
          expect(room.committed(), `${where} — commit did not publish the draft`)
            .toEqual(room.draft());
        }
      }

      expect(commits, `${game.id} — commits and segment closes diverged`).toBe(segmentCloses);
      totalSegmentCloses += segmentCloses;
    });
  }

  /**
   * Measured, not guessed: summing `segmentCloses` across all seventeen
   * golden games gives 15 — unchanged from the actor-change-only count,
   * because G17's `startGame` changes the actor anyway, so `leftDraw` and
   * `changed` coincide there rather than adding a new boundary. Pinned at a
   * round floor comfortably below that — 10 — so a change that stops the loop
   * finding segment boundaries (e.g. a `dispatch` that never commits) fails
   * here, while an added golden game does not.
   */
  it('finds enough segment boundaries across the corpus to trust the count', () => {
    expect(totalSegmentCloses).toBeGreaterThanOrEqual(10);
  });
});

/**
 * Test 8 from the design: the measured bound on how long a payout may stay
 * unbroadcast. Pinned so that an engine change widening it is noticed.
 */
describe('a payout precedes its commit by a bounded number of intents', () => {
  it('never lags by more than two, across the whole corpus', () => {
    let worst = 0;

    for (const game of ALL_GOLDEN_GAMES) {
      let state = buildFixture(game.setup);
      const steps = game.steps;

      for (let i = 0; i < steps.length; i++) {
        if (steps[i]!.expectError) {
          try { applyIntent(state, steps[i]!.intent); } catch { /* expected */ }
          continue;
        }
        const before = state;
        state = applyIntent(state, steps[i]!.intent);

        const movedOthers = state.players.some((p) => {
          const was = before.players.find((q) => q.id === p.id)!;
          return p.id !== steps[i]!.intent.playerId && p.cash !== was.cash;
        });
        if (!movedOthers) continue;

        let probe = state;
        const actorAt = getCurrentActor(state);
        let lag = 0;
        for (let j = i + 1; j < steps.length && getCurrentActor(probe) === actorAt; j++) {
          if (steps[j]!.expectError) continue;
          probe = applyIntent(probe, steps[j]!.intent);
          lag++;
        }
        worst = Math.max(worst, lag);
      }
    }

    expect(worst).toBe(2);
  });
});
