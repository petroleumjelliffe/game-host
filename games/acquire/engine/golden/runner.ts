import { expect } from 'vitest';
import type { Coord, GameState } from '../gameTypes';
import type { GoldenGame, StateAssertion } from './types';
import { applyIntent, IllegalIntentError } from '../intents';
import { getStartupSize } from '../gameHelpers';
import { getCurrentActor } from '../actor';
import { finalScore } from '../endGame';
import { buildFixture } from './fixtures';

function player(state: GameState, id: string) {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`golden game refers to unknown player ${id}`);
  return p;
}

function startup(state: GameState, id: string, where: string) {
  const s = state.startups[id];
  if (!s) throw new Error(`${where} — golden game refers to unknown startup ${id}`);
  return s;
}

/**
 * Checks every declared field of `a` against `state`, one `expect` per
 * field so a failure names exactly which field, on which player/startup/
 * coord, in which game/step it was checking. `where` is a caller-supplied
 * label (game id + step number + step name); every message is built from it
 * so a bare `toBe` failure is never the only clue.
 */
export function assertState(
  state: GameState,
  a: StateAssertion,
  where: string,
  addedLogFrom = 0,
): void {
  const at = (what: string) => `${where} — ${what}`;

  if (a.stage !== undefined) {
    expect(state.stage, at('stage')).toBe(a.stage);
  }
  if (a.currentPlayer !== undefined) {
    expect(state.players[state.turnIndex]?.id, at('currentPlayer')).toBe(a.currentPlayer);
  }
  if (a.actor !== undefined) {
    expect(getCurrentActor(state), at('actor')).toBe(a.actor);
  }
  for (const [id, cash] of Object.entries(a.cash ?? {})) {
    expect(player(state, id).cash, at(`cash ${id}`)).toBe(cash);
  }
  for (const [id, holdings] of Object.entries(a.shares ?? {})) {
    for (const [startupId, qty] of Object.entries(holdings)) {
      expect(player(state, id).portfolio[startupId] ?? 0, at(`shares ${id}/${startupId}`)).toBe(qty);
    }
  }
  for (const [startupId, size] of Object.entries(a.chainSize ?? {})) {
    expect(getStartupSize(state, startupId), at(`chain size ${startupId}`)).toBe(size);
  }
  for (const [startupId, isFounded] of Object.entries(a.founded ?? {})) {
    expect(startup(state, startupId, where).isFounded, at(`founded ${startupId}`)).toBe(isFounded);
  }
  for (const [startupId, qty] of Object.entries(a.availableShares ?? {})) {
    expect(startup(state, startupId, where).availableShares, at(`available shares ${startupId}`)).toBe(qty);
  }
  for (const [id, hand] of Object.entries(a.hand ?? {})) {
    expect([...player(state, id).hand].sort(), at(`hand ${id}`)).toEqual([...hand].sort());
  }
  for (const [coordStr, owner] of Object.entries(a.boardOwner ?? {})) {
    const cell = state.board[coordStr as Coord];
    expect(cell?.startupId ?? null, at(`board owner ${coordStr}`)).toBe(owner);
  }
  if (a.logPhases !== undefined) {
    expect(state.log.slice(addedLogFrom).map((e) => e.phase), at('log phases')).toEqual(a.logPhases);
  }
  if (a.finalScoreTotals !== undefined) {
    const report = finalScore(state);
    for (const [id, total] of Object.entries(a.finalScoreTotals)) {
      const stock = Object.entries(report.holdings[id] ?? {}).reduce(
        (sum, [chainId, qty]) => sum + qty * (report.chains.find((c) => c.id === chainId)?.price ?? 0),
        0,
      );
      const bonus = report.bonuses
        .filter((b) => b.playerId === id)
        .reduce((sum, b) => sum + b.amount, 0);
      const cash = report.players.find((p) => p.id === id)?.cash ?? 0;
      expect(stock + bonus + cash, at(`final score total ${id}`)).toBe(total);
    }
  }
  if (a.finalScoreBonuses !== undefined) {
    const report = finalScore(state);
    for (const [id, expected] of Object.entries(a.finalScoreBonuses)) {
      const actual = report.bonuses
        .filter((b) => b.playerId === id)
        .map((b) => ({ chainId: b.chainId, type: b.type, amount: b.amount }));
      const key = (x: { chainId: string; type: string }) => `${x.chainId}:${x.type}`;
      expect([...actual].sort((x, y) => key(x).localeCompare(key(y))), at(`final score bonuses ${id}`))
        .toEqual([...expected].sort((x, y) => key(x).localeCompare(key(y))));
    }
  }
}

/**
 * Builds the fixture, then threads it through every step's intent in
 * order. A step with `expectError` must be REJECTED with that exact code
 * and must leave the state byte-for-byte unchanged — both are asserted.
 * Otherwise the returned state replaces the running state before the next
 * step runs. `logPhases` assertions only see log entries appended by that
 * step, tracked via each step's starting log length.
 */
export function runGoldenGame(game: GoldenGame): GameState {
  let state = buildFixture(game.setup);

  game.steps.forEach((step, i) => {
    const where = `${game.id} step ${i + 1} (${step.name})`;
    const logMark = state.log.length;

    if (step.expectError) {
      const before = JSON.stringify(state);
      let caught: unknown;
      try {
        applyIntent(state, step.intent);
      } catch (e) {
        caught = e;
      }
      expect(
        caught,
        `${where} — expected rejection ${step.expectError}, but nothing was thrown`,
      ).toBeInstanceOf(IllegalIntentError);
      expect((caught as IllegalIntentError).code, `${where} — rejection code`).toBe(step.expectError);
      expect(JSON.stringify(state), `${where} — state must be unchanged by a rejected intent`).toBe(before);
    } else {
      state = applyIntent(state, step.intent);
    }

    if (step.then) assertState(state, step.then, where, logMark);
  });

  if (game.final) assertState(state, game.final, `${game.id} final`);
  return state;
}
