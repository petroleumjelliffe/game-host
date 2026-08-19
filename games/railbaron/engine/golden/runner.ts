import { expect } from 'vitest';
import { earnsBonus, movement, rollTurn } from '../dice';
import { isRejection } from '../movement';
import { sectionKey } from '../network';
import {
  arrived, back, companies, complete, extend, here, path as pathOf,
  remaining, spent, startDraft, usedAfter
} from '../route';
import type { GoldenGame, GoldenState, GoldenRejection, StateAssertion } from './types';

const scripted = (faces: readonly number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) throw new Error('the golden game ran out of dice');
    return (face - 1) / 6;
  };
};

function build(game: GoldenGame): GoldenState {
  const used = new Map<string, number>();
  for (const [a, b] of game.setup.used ?? []) {
    const key = sectionKey(a, b);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return {
    at: game.setup.at,
    destination: game.setup.destination,
    train: game.setup.train ?? 'freight',
    used, roll: null, leg: 0, draft: null, story: []
  };
}

/** Applies one intent, or names why it could not be applied. */
function apply(state: GoldenState, step: GoldenGame['steps'][number]): GoldenState | GoldenRejection {
  const intent = step.intent;
  switch (intent.kind) {
    case 'roll': {
      // A turn still holding its roll cannot start another — which is also
      // where "if entitled, he must take it" is enforced: an entitled turn
      // keeps its roll past the white leg, so the next `roll` is refused
      // until the Bonus Roll has been taken and its leg walked.
      if (state.roll !== null) return 'no-roll';
      const roll = rollTurn(state.train, scripted(intent.faces));
      return {
        ...state, roll, leg: 0,
        draft: startDraft(state.at, state.destination, movement(roll), state.used),
        story: [...state.story, { kind: 'roll', white: roll.white }]
      };
    }
    /**
     * The Bonus Roll, taken as its own roll after the white movement — the
     * same three conditions `GameState.bonusOwed` derives from the log, in the
     * same order: entitlement fixed by the white pair, the white leg walked,
     * and the die not already thrown.
     */
    case 'bonusRoll': {
      if (state.roll === null) return 'no-roll';
      if (!earnsBonus(state.train, state.roll.white)) return 'no-bonus-entitlement';
      if (state.leg === 0) return 'bonus-too-early';
      if (state.roll.bonus !== null) return 'bonus-already-taken';
      return {
        ...state,
        roll: { white: state.roll.white, bonus: intent.face },
        // The bonus leg spends the face and nothing else, and it starts from
        // wherever the white leg stopped — over `state.used`, which is this
        // trip's spent sections unless an arrival released them.
        draft: startDraft(state.at, state.destination, intent.face, state.used),
        story: [...state.story, { kind: 'bonus', face: intent.face }]
      };
    }
    case 'step': {
      if (state.draft === null) return 'no-roll';
      const next = extend(state.draft, intent.to);
      if (isRejection(next)) return next;
      return { ...state, draft: next };
    }
    case 'back': {
      if (state.draft === null || state.draft.steps.length === 0) return 'nothing-to-undo';
      return { ...state, draft: back(state.draft) };
    }
    case 'commit': {
      if (state.draft === null) return 'no-roll';
      if (!complete(state.draft)) return 'route-incomplete';
      const draft = state.draft;
      const landed = arrived(draft);
      // Whether the turn goes on. Two rules, and neither of them is arrival
      // any more:
      //
      // - `state.leg === 0` is "a player can get no more than one Bonus Roll
      //   per turn". `replay` states the same cap as `open.legs >= 2`.
      // - entitlement was fixed when the white pair landed, so an entitled
      //   turn stays open whether the pawn arrived or not. Arriving means the
      //   bonus leg starts a new trip with the sections released; not
      //   arriving means it carries on over the ones already spent.
      //
      // The two sides are held together by `src/state/replay.golden.test.ts`,
      // which builds its log from `story` — real white faces, so a Freight
      // game that earns the die here earns it there too.
      //
      // Precisely what that test compares is worth stating, because the
      // obvious version of it does not work. Comparing only the state each
      // side ends in cannot see this rule at all: a turn wrongly closed after
      // leg 0 heals itself by the end of the log, since the orphaned
      // `bonusRolled` is ignored and the next `moved` moves the pawn anyway,
      // leaving the pawn and the sections identical. So it also replays the
      // log prefix ending at each moment a `bonusRoll` was taken here, and
      // asserts replay agrees a Bonus Roll was owed at that boundary. That is
      // the moment the two rules disagree, and comparing them there is what
      // makes this a comparison rather than a claim.
      //
      // Freight fixtures only, on the turn-state half: `replay` has no trains
      // and reads every entitlement as a Freight's.
      const owed = state.leg === 0
        && state.roll !== null && earnsBonus(state.train, state.roll.white);
      return {
        ...state,
        at: here(draft),
        // "Everything is released on arrival" — the whole trip, not the leg.
        used: landed ? new Map() : usedAfter(draft),
        roll: owed ? state.roll : null,
        leg: owed ? state.leg + 1 : 0,
        draft: null,
        story: [...state.story, { kind: 'leg', path: pathOf(draft), arrived: landed }]
      };
    }
    case 'destination': {
      // How much the leg now under way has to spend — and `null` for the one
      // case that has nothing yet: a bonus leg whose die is still in the cup.
      // Naming the new destination comes first there, in the book's order, so
      // there is a destination to walk toward when the face lands.
      const left = state.roll === null ? null
        : state.leg === 0 ? movement(state.roll)
        : state.roll.bonus;
      return {
        ...state,
        destination: intent.to,
        draft: left === null
          ? null
          : startDraft(state.at, intent.to, left, state.used)
      };
    }
  }
}

function assertState(state: GoldenState, want: StateAssertion, where: string): void {
  const at = (what: string) => `${where} — ${what}`;
  if (want.at !== undefined) expect(state.at, at('at')).toBe(want.at);
  if (want.usedCount !== undefined) expect(state.used.size, at('used sections')).toBe(want.usedCount);
  if (want.bonus !== undefined) expect(state.roll?.bonus ?? null, at('bonus die')).toBe(want.bonus);
  // Read off the white pair, never off the face: the two say different things
  // now that the die is thrown a leg later than the entitlement is fixed.
  if (want.entitled !== undefined) {
    expect(state.roll !== null && earnsBonus(state.train, state.roll.white), at('entitled'))
      .toBe(want.entitled);
  }
  if (want.legOwed !== undefined) expect(state.leg > 0, at('bonus leg owed')).toBe(want.legOwed);
  if (state.draft !== null) {
    if (want.spent !== undefined) expect(spent(state.draft), at('spent')).toBe(want.spent);
    if (want.remaining !== undefined) expect(remaining(state.draft), at('remaining')).toBe(want.remaining);
    if (want.arrived !== undefined) expect(arrived(state.draft), at('arrived')).toBe(want.arrived);
    if (want.complete !== undefined) expect(complete(state.draft), at('complete')).toBe(want.complete);
    if (want.companies !== undefined) {
      expect([...companies(state.draft)].sort(), at('companies'))
        .toEqual([...want.companies].sort());
    }
  } else {
    for (const field of ['spent', 'remaining', 'arrived', 'complete', 'companies'] as const) {
      expect(want[field], at(`${field} asserted with no draft`)).toBeUndefined();
    }
  }
}

export function runGoldenGame(game: GoldenGame): GoldenState {
  let state = build(game);

  game.steps.forEach((step, index) => {
    const where = `${game.id} step ${index + 1} (${step.name})`;
    const before = JSON.stringify(state, (_, value) =>
      value instanceof Map ? [...value] : value);
    const result = apply(state, step);

    if (step.expectError !== undefined) {
      expect(result, `${where} — expected rejection ${step.expectError}`).toBe(step.expectError);
      const after = JSON.stringify(state, (_, value) =>
        value instanceof Map ? [...value] : value);
      expect(after, `${where} — a rejected intent must change nothing`).toBe(before);
    } else {
      expect(typeof result, `${where} — unexpected rejection: ${String(result)}`)
        .not.toBe('string');
      state = result as GoldenState;
    }

    if (step.then) assertState(state, step.then, where);
  });

  if (game.final) assertState(state, game.final, `${game.id} final`);
  return state;
}
