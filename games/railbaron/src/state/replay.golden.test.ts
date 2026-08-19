import { describe, expect, it } from 'vitest';
import { cityAt, cityById } from '../../engine';
import { GAMES } from '../../engine/golden/games';
import { runGoldenGame } from '../../engine/golden/runner';
import type { GameEvent } from './events';
import { replay } from './game';

/**
 * A golden game and the event log say the same thing two different ways: the
 * runner folds the engine's functions, replay folds the log. They are two
 * implementations of one rule, so this is where they are made to agree.
 * Without it the executable rules spec could drift away from the game the app
 * actually plays, and neither suite would notice.
 *
 * The log is built rather than scripted, and it is built from the game's own
 * story: a baron seated at the fixture's starting node, then the rolls and
 * legs the runner actually made, in order — `turnRolled` for a white pair,
 * `bonusRolled` for a Bonus Roll, `moved` for a committed leg.
 *
 * The faces used to be filler ([1,1] for every roll, which earns a Freight
 * nothing) and that made this test blind to exactly the rule it should be
 * holding: replay's bonus branch never ran. Carrying each game's real white
 * faces across means an entitled turn here is an entitled turn there, so the
 * two implementations of "how many legs does this turn have" can be compared
 * rather than merely pinned separately.
 */
/** Both spent-section tallies in one comparable shape: key and count, ordered. */
const sections = (used: ReadonlyMap<string, number>): [string, number][] =>
  [...used].sort(([a], [b]) => a.localeCompare(b));

describe('replay agrees with the golden runner', () => {
  for (const game of GAMES) {
    it(`${game.id}: leaves the pawn and the trip in the same state`, () => {
      const finished = runGoldenGame(game);

      // Every golden fixture starts on a city, never a plain dot — a home
      // roll needs a city to land on. If a future fixture starts on a dot
      // instead, this throws rather than silently skipping the game.
      const home = cityAt(game.setup.at);
      if (home === null) {
        throw new Error(
          `${game.id}: fixture starts on a dot (${game.setup.at}), not a city — ` +
          'no home city to build a replay log from'
        );
      }

      const log: GameEvent[] = [
        { type: 'joined', seat: 'red', name: 'ADA' },
        { type: 'started' },
        // The region must be the one this city really belongs to — isGameEvent
        // checks cityById(city).region === region and rejects the whole log
        // otherwise.
        { type: 'arrived', seat: 'red', city: home, region: cityById(home).region, payout: null },
        { type: 'orderRolled', seat: 'red', first: 'red' }
      ];
      /**
       * The log as it stood at each moment a Bonus Roll was about to be
       * thrown — that is, immediately after leg 0's `moved`.
       *
       * Final state alone cannot see the rule these games exist to state. A
       * turn wrongly closed after leg 0 self-heals by the end of the log: the
       * orphaned `bonusRolled` is ignored, the next `moved` is applied to the
       * pawn regardless, and the pawn and its sections come out identical. The
       * reviewer demonstrated exactly that — the first draft's arrival-
       * conditioned entitlement reintroduced, twelve other tests failing, and
       * this one passing every game. The boundary is where the two rules
       * actually disagree, so that is where they are compared.
       */
      const boundaries: GameEvent[][] = [];
      for (const record of finished.story) {
        if (record.kind === 'roll') {
          log.push({
            type: 'turnRolled', seat: 'red',
            white: [record.white[0], record.white[1]], bonus: null
          });
        } else if (record.kind === 'bonus') {
          // Snapshot before the face goes in: the log ends on leg 0's `moved`,
          // which is the state the player is in when the die is handed over.
          boundaries.push([...log]);
          log.push({ type: 'bonusRolled', seat: 'red', face: record.face });
        } else {
          log.push({ type: 'moved', seat: 'red', path: [...record.path], arrived: record.arrived });
        }
      }

      const state = replay(log);
      const seat = state.seats.red;
      expect(seat.at, 'where the pawn ended').toBe(finished.at);
      // The map, not its size. A section carrying two railroads may be
      // crossed twice, so the counts are the rule — comparing sizes alone
      // passes even if replay marks each section used without ever counting
      // it, and an app built on that would offer a third crossing.
      expect(sections(seat.used), 'sections the trip has spent')
        .toEqual(sections(finished.used));

      // The turn each side is left holding, which is where the two leg-caps
      // meet. Only for Freight games: `replay` has no trains yet and reads
      // every entitlement as a Freight's, so an Express or Superchief fixture
      // is not comparable on this — its pawn and its sections still are, which
      // is why the assertions above run for every game.
      if ((game.setup.train ?? 'freight') === 'freight') {
        expect(state.rolled !== null, 'whether the turn is still open')
          .toBe(finished.roll !== null);
        expect(state.leg, 'legs of the turn already walked').toBe(finished.leg);
        expect(state.bonusOwed, 'waiting on a Bonus Roll')
          .toBe(finished.roll !== null && finished.leg > 0 && finished.roll.bonus === null);

        // And at each boundary the runner took a `bonusRoll` at, replay must
        // agree the turn was owed one — open, one leg walked, die not thrown.
        // The runner accepted the intent there, so replay accepting the event
        // there is the same rule stated twice, and this is what makes that a
        // comparison rather than a claim.
        boundaries.forEach((prefix, index) => {
          const at = replay(prefix);
          const where = `${game.id} boundary ${index + 1} (after leg 0's move)`;
          expect(at.bonusOwed, `${where} — a Bonus Roll is owed`).toBe(true);
          expect(at.rolled !== null, `${where} — the turn is still open`).toBe(true);
          expect(at.leg, `${where} — one leg walked`).toBe(1);
          expect(at.turn, `${where} — and it is still the same baron's`).toBe('red');
        });
      }
    });
  }
});
