import type { GameState } from '../gameTypes';

const TOTAL_TILES = 108;

/**
 * Structural truths that must hold after every intent, in every game, forever.
 * Returns one message per violation; an empty array means the state is sound.
 *
 * These are deliberately not rules assertions — nothing here knows what a merger
 * is. They are conservation and sanity properties, the kind that example-based
 * tests systematically miss because each example only visits states its author
 * already imagined.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];

  const placed = Object.values(state.board).filter((c) => c.placed).length;
  const inHands = state.players.reduce((n, p) => n + p.hand.length, 0);
  const total = placed + inHands + state.bag.length + state.discarded.length;
  if (total !== TOTAL_TILES) {
    problems.push(
      `tile conservation: placed ${placed} + hands ${inHands} + bag ${state.bag.length} ` +
        `+ discarded ${state.discarded.length} = ${total}, expected ${TOTAL_TILES}`,
    );
  }

  for (const [id, startup] of Object.entries(state.startups)) {
    const held = state.players.reduce((n, p) => n + (p.portfolio[id] ?? 0), 0);
    if (held + startup.availableShares !== startup.totalShares) {
      problems.push(
        `share conservation ${id}: held ${held} + available ${startup.availableShares} ` +
          `= ${held + startup.availableShares}, expected ${startup.totalShares}`,
      );
    }
    if (startup.availableShares < 0) problems.push(`${id} has negative available shares`);
  }

  for (const p of state.players) {
    if (p.cash < 0) problems.push(`${p.name} has negative cash: ${p.cash}`);
    for (const [id, qty] of Object.entries(p.portfolio)) {
      if (qty < 0) problems.push(`${p.name} holds negative ${id}: ${qty}`);
    }
  }

  return problems;
}

/**
 * The spec's fourth invariant (docs/superpowers/specs/2026-08-03-phase-1-
 * component-layer-design.md:148): "no state repeats with an unchanged
 * nextStepId." Unlike the three above, this is not a pure function of a
 * single `GameState` — a single state snapshot can't tell you whether it has
 * been seen before. It lives here anyway (rather than only inline in the
 * test driver) so it stays next to, and is exported alongside, the
 * invariants it complements; `invariants.test.ts`'s `playOne` owns the loop
 * that calls it once per iteration.
 *
 * `nextStepId` only advances when `pushLog` runs (see `log.ts`), and every
 * *successful* intent on this engine calls `pushLog` at least once — so
 * among successful steps `nextStepId` is already a strictly increasing,
 * free progress counter, and two different successful steps can never share
 * one. The only way the pair (state, nextStepId) can recur across loop
 * iterations is a run that isn't moving: typically a driver stuck reissuing
 * intents the reducer rejects, where `state` (and therefore `nextStepId`)
 * is left completely untouched by the `IllegalIntentError` catch. This is
 * exactly Finding 1's failure shape — a run that spends its whole budget
 * being rejected — which is why this invariant, implemented directly,
 * would have caught it without needing a bespoke rejection counter.
 *
 * A *single* repeat is not itself a bug: this driver's `nextIntent` often
 * proposes something the current state can't accept (e.g. `declareEnd` when
 * the condition isn't met) and simply retries with a different salt next
 * iteration, leaving state briefly unchanged on purpose. Only a sustained
 * run of identical (fingerprint, nextStepId) pairs — `threshold` in a row —
 * indicates the driver is actually wedged rather than just probing.
 */
export interface ProgressGuard {
  /** Call once per driver loop iteration, on whatever `state` is current
   * after that iteration's intent attempt (accepted or rejected). Returns a
   * violation message once the same state has recurred `threshold` times in
   * a row with no advance in `nextStepId`; otherwise null. */
  check(state: GameState): string | null;
}

export function createProgressGuard(threshold = 20): ProgressGuard {
  let lastFingerprint: string | null = null;
  let lastNextStepId = -1;
  let streak = 0;
  return {
    check(state: GameState): string | null {
      // Exact, not sampled: these states are small (108 tiles, <=3 players,
      // 7 startups), so a full JSON.stringify is cheap and — unlike a
      // rolled-up hash — cannot false-negative on a genuine difference.
      const fingerprint = JSON.stringify(state);
      if (fingerprint === lastFingerprint && state.nextStepId === lastNextStepId) {
        streak += 1;
      } else {
        streak = 0;
        lastFingerprint = fingerprint;
        lastNextStepId = state.nextStepId;
      }
      if (streak >= threshold) {
        return (
          `no progress: state repeated ${streak} times in a row with ` +
          `nextStepId stuck at ${state.nextStepId}`
        );
      }
      return null;
    },
  };
}
