import { describe, it, expect } from 'vitest';
import type { GameState } from '../gameTypes';
import type { Intent } from '../intents';
import { applyIntent, IllegalIntentError } from '../intents';
import { generateAllCoords, shuffleSeeded } from '../gameHelpers';
import { TRADE_RATIO, isStartupId } from '../startups';
import { createInitialGame } from '../gameInit';
import { checkInvariants, createProgressGuard } from './invariants';
import { previewPlacement, isDeadTile } from '../placement';

const MAX_STEPS = 400;

/**
 * `shuffleSeeded` (gameHelpers.ts) derives its RNG seed as the *sum of the
 * string's char codes*, not a real hash. Seeds sharing a "prop-" prefix plus
 * a numeric suffix collide whenever those suffixes share a digit sum —
 * "prop-17", "prop-26", "prop-35", "prop-44", "prop-53" all sum to 598 and
 * so replay byte-identical games. Across the old `prop-0..prop-59` scheme
 * there were only 24 distinct hash values behind 60 "seeds".
 *
 * Fixed here in the harness only (not in `shuffleSeeded`, which would change
 * real game seeding): each seed's distinguishing suffix is a single
 * character drawn from a pool of `SEED_COUNT` mutually distinct characters.
 * The shared "prop-" prefix contributes an identical constant to every sum,
 * so two seeds' sums differ exactly when their trailing characters' char
 * codes differ — true for any two distinct characters, independent of what
 * digits or letters they look like. `it('produces distinct shuffleSeeded
 * orderings ...')` below asserts this holds, so a future edit that
 * reintroduces collisions fails loudly instead of silently shrinking the
 * sample.
 */
const SEED_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SEED_COUNT = 60;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => `prop-${SEED_CHARS[i]}`);
const NAMES = ['Alex', 'Sam', 'Jordan'];

/**
 * The real opening. This used to be hand-built, because `createInitialGame`
 * yielded `stage: 'draw'` and no intent accepted it — the deadlock the
 * `startGame` intent closed. Running the genuine opening across all 60 seeds
 * is what puts tile conservation on the turn-order draw, which is where the
 * legacy `resolveInitialDraw` loses count.
 */
function newGame(seed: string): GameState {
  // Every seat draws, because the opening is now one intent *per player* — a
  // single draw leaves the game in `stage: 'draw'` waiting on seat two, and
  // every invariant below would then be measuring a game that never started.
  const dealt = createInitialGame(seed, NAMES);
  return dealt.players.reduce(
    (state, p) => applyIntent(state, { type: 'drawTurnOrderTile', playerId: p.id }),
    dealt,
  );
}

/** A cheap deterministic picker: shuffles by seed+salt and takes the head. */
function pick<T>(items: T[], seed: string, salt: number): T | undefined {
  return shuffleSeeded(items, `${seed}:${salt}`)[0];
}

/**
 * One plausible intent for the current stage, or null when this driver has no
 * move to make. Null is a signal, not an exit: `playOne` records the stage, and
 * a stall anywhere but `end` is a finding.
 */
function nextIntent(state: GameState, seed: string, salt: number): Intent | null {
  const me = state.players[state.turnIndex];
  if (!me) return null;
  // `Startup.id` is declared `string` (see the TODO on gameTypes.ts's `Startup.id`),
  // though it is always drawn from the fixed 7-id set. `isStartupId` is the
  // sanctioned runtime narrowing (see its doc comment in startups.ts) — used
  // here instead of `as StartupId` so this stays a real check, not an assertion.
  const founded = Object.values(state.startups).filter((s) => s.isFounded).map((s) => s.id).filter(isStartupId);
  const unfounded = Object.values(state.startups).filter((s) => !s.isFounded).map((s) => s.id).filter(isStartupId);

  switch (state.stage) {
    case 'play': {
      // Pick only among tiles that are actually placeable. The previous
      // version picked from the whole hand and let the reducer reject
      // illegal picks, relying on a fresh salt eventually landing on a
      // legal one — which never happens when *every* tile in hand is
      // unplayable (Finding 1: a hand fully dead-ended, whether every tile
      // merges two safe chains or, less commonly, every remaining spot
      // would found a startup with no brands left). `doEndTurn`
      // (intents.ts) accepts `endTurn` from `play` in exactly that
      // situation — no legal placement anywhere in hand — but only once the
      // genuinely dead tiles have been traded in via `tradeInDeadTiles`;
      // otherwise the reducer's own `hasLegalTile` gate would just reject
      // the endTurn too, since a dead tile isn't a hand-emptying reason.
      const legal = me.hand.filter((c) => previewPlacement(state, c, me.id).legal);
      if (legal.length > 0) {
        const coord = pick(legal, seed, salt)!;
        return { type: 'placeTile', playerId: me.id, coord };
      }
      const dead = me.hand.filter((c) => isDeadTile(state, c));
      if (dead.length > 0) {
        return { type: 'tradeInDeadTiles', playerId: me.id, coords: dead };
      }
      return { type: 'endTurn', playerId: me.id };
    }
    case 'foundStartup': {
      const startupId = pick(unfounded, seed, salt);
      return startupId ? { type: 'chooseFoundingBrand', playerId: me.id, startupId } : null;
    }
    case 'chooseSurvivor': {
      // `pendingTiedStartups`/`absorbedIds` etc. are declared `string[]` on
      // `GameState`/`MergerContext` (same TODO as `Startup.id`); narrow
      // through `isStartupId` rather than asserting. `?.filter` only falls
      // back to `founded` when `pendingTiedStartups` itself is undefined —
      // matching the original `?? founded`, not falling back on an empty array.
      const tied = state.pendingTiedStartups?.filter(isStartupId);
      const startupId = pick(tied ?? founded, seed, salt);
      return startupId ? { type: 'chooseSurvivor', playerId: me.id, startupId } : null;
    }
    case 'mergerLiquidation': {
      // Multi-actor: the actor is the head of the shareholder queue, not the
      // player whose turn it is.
      const ctx = state.mergerContext;
      if (!ctx) return null;
      const playerId = ctx.shareholderQueue[ctx.currentShareholderIndex];
      const rawStartupId = ctx.absorbedIds[ctx.currentLiquidationIndex];
      if (!playerId || !rawStartupId || !isStartupId(rawStartupId)) return null;
      const startupId = rawStartupId;

      const held = state.players.find((p) => p.id === playerId)?.portfolio[startupId] ?? 0;
      // `trade` counts shares handed IN, so it must be a whole multiple of the
      // ratio or the reducer rejects with `oddTradeCount`.
      const trade = salt % 2 === 0 ? held - (held % TRADE_RATIO) : 0;
      return { type: 'liquidate', playerId, startupId, sell: held - trade, trade, keep: 0 };
    }
    case 'buy': {
      // three-way: buy something, declare the end, or just end the turn
      const choice = salt % 3;
      if (choice === 0) return { type: 'endTurn', playerId: me.id };
      if (choice === 1) return { type: 'declareEnd', playerId: me.id };
      const startupId = pick(founded, seed, salt);
      return startupId
        ? { type: 'buyShares', playerId: me.id, picks: [startupId] }
        : { type: 'endTurn', playerId: me.id };
    }
    default:
      return null;
  }
}

interface RunResult {
  seed: string;
  steps: number;
  reachedEnd: boolean;
  emptiedBag: boolean;
  stalledAt: string | null;
  violation: string | null;
  history: Intent[];
}

// Finding 1: past this many consecutive IllegalIntentErrors, the run is not
// "slow" — the driver has painted itself into a corner and is spending its
// remaining step budget being rejected. A single rejection is normal (see
// `nextIntent`'s `buy`/`chooseSurvivor` branches, which propose an option
// this state can't accept about a third of the time by design); a long run
// of them, with no successful intent in between, is not.
const STALL_THRESHOLD = 20;

function playOne(seed: string): RunResult {
  let state = newGame(seed);
  const history: Intent[] = [];
  const base = { seed, reachedEnd: false, emptiedBag: false, stalledAt: null as string | null };
  let emptiedBag = false;
  let salt = 0;
  let consecutiveRejections = 0;
  const progress = createProgressGuard();

  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.stage === 'end') {
      return { ...base, steps: step, reachedEnd: true, emptiedBag, violation: null, history };
    }

    const intent = nextIntent(state, seed, salt++);
    if (!intent) {
      return { ...base, steps: step, emptiedBag, stalledAt: state.stage, violation: null, history };
    }

    let rejected = false;
    try {
      state = applyIntent(state, intent);
      history.push(intent);
      consecutiveRejections = 0;
    } catch (e) {
      if (e instanceof IllegalIntentError) {
        rejected = true;
        consecutiveRejections += 1;
      } else {
        return { ...base, steps: step, emptiedBag, violation: String(e), history };
      }
    }

    if (!rejected) {
      if (state.bag.length === 0) emptiedBag = true;
      const problems = checkInvariants(state);
      if (problems.length) {
        return { ...base, steps: step, emptiedBag, violation: problems.join('; '), history };
      }
    }

    // Finding 1: surfaces a wedged driver as a stall instead of silently
    // exhausting MAX_STEPS and reporting nothing.
    if (consecutiveRejections >= STALL_THRESHOLD) {
      return {
        ...base,
        steps: step,
        emptiedBag,
        stalledAt: `${state.stage} (all intents rejected)`,
        violation: null,
        history,
      };
    }

    // Finding 2 — the spec's fourth invariant ("Progress": no state repeats
    // with an unchanged nextStepId). Catches the same failure shape as
    // Finding 1 directly, via the state standing still rather than via the
    // error type that happened to cause it — see createProgressGuard's doc
    // comment in invariants.ts for why it lives there and how it's scoped.
    const progressViolation = progress.check(state);
    if (progressViolation) {
      return { ...base, steps: step, emptiedBag, violation: progressViolation, history };
    }
  }

  return { ...base, steps: MAX_STEPS, emptiedBag, reachedEnd: state.stage === 'end', violation: null, history };
}

describe('random-play invariants', () => {
  const runs = SEEDS.map(playOne);
  const report = (r: RunResult) =>
    `seed ${r.seed} @ step ${r.steps}: ${r.violation ?? r.stalledAt}\n  ${JSON.stringify(r.history)}`;

  it('holds every invariant across every seed', () => {
    expect(
      runs.filter((r) => r.violation).map(report),
      'a failing seed above is reproducible — paste its intent list into a golden game',
    ).toEqual([]);
  });

  // The Phase 0 deadlock in one assertion: a game that can go no further while
  // it is not over is a bug, whether the reducer refuses or the driver has no move.
  it('never stalls anywhere but end', () => {
    expect(runs.filter((r) => r.stalledAt).map(report)).toEqual([]);
  });

  // Guards against the probe that proves nothing: a policy that quits early
  // reports zero failures without ever visiting the states where bugs live.
  it('reaches deep states — at least one game empties the bag', () => {
    expect(runs.some((r) => r.emptiedBag)).toBe(true);
  });

  it('reaches terminal states — at least one game ends', () => {
    expect(runs.some((r) => r.reachedEnd)).toBe(true);
  });

  // Guards the fix above: if SEEDS ever regresses to a scheme where
  // shuffleSeeded's char-code-sum hash collides, this catches it directly
  // rather than letting the sample silently shrink to fewer distinct games.
  it('SEEDS produces SEED_COUNT distinct shuffleSeeded orderings', () => {
    const coords = generateAllCoords();
    const orderings = new Set(SEEDS.map((seed) => shuffleSeeded(coords, seed).join(',')));
    expect(SEEDS.length).toBe(SEED_COUNT);
    expect(orderings.size).toBe(SEED_COUNT);
  });
});
