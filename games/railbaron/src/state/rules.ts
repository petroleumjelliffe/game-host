// The house rules, as data. They travel in the `started` event and nowhere
// else, so replay never reads a file — see the spec's Decision 1. The file
// on disk (DATA_DIR/railbaron/rules.json) is parsed by exactly this function
// too, which is why refusal names a field: the mount error that quotes it is
// the only diagnostics that file gets.
import type { TrainType } from '../../engine/index.js';

export interface GameRules {
  /** Dollars. payoutBetween() already returns dollars (thousands * 1000). */
  winTarget: number;
  startingTrain: TrainType;
  /** Present = deterministic dice, verified by legal.ts. Absent = Math.random. */
  seed?: string;
}

export const PUBLISHED_RULES: GameRules = { winTarget: 200000, startingTrain: 'freight' };

const TRAINS: ReadonlySet<string> = new Set(['freight', 'express', 'superchief']);

export type ParsedRules = { ok: true; rules: GameRules } | { ok: false; field: string };

export function parseRules(value: unknown): ParsedRules {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, field: 'rules' };
  }
  const raw = value as Record<string, unknown>;
  const rules: GameRules = { ...PUBLISHED_RULES };

  if (raw.winTarget !== undefined) {
    if (typeof raw.winTarget !== 'number' || !Number.isFinite(raw.winTarget) || raw.winTarget <= 0) {
      return { ok: false, field: 'winTarget' };
    }
    rules.winTarget = raw.winTarget;
  }
  if (raw.startingTrain !== undefined) {
    if (typeof raw.startingTrain !== 'string' || !TRAINS.has(raw.startingTrain)) {
      return { ok: false, field: 'startingTrain' };
    }
    rules.startingTrain = raw.startingTrain as TrainType;
  }
  if (raw.seed !== undefined) {
    if (typeof raw.seed !== 'string' || raw.seed.length === 0) {
      return { ok: false, field: 'seed' };
    }
    rules.seed = raw.seed;
  }
  return { ok: true, rules };
}

export const isRulesShape = (value: unknown): boolean => parseRules(value).ok;
