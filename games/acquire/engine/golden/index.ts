import type { GoldenGame } from './types';
import { TURN_GAMES } from './turns';
import { MERGER_GAMES } from './mergers';
import { ENDGAME_GAMES } from './endgame';

export * from './types';
export * from './fixtures';
export * from './replay';
// './runner' is deliberately NOT re-exported: it imports vitest, and this barrel
// is reachable from app code. Tests import it directly from './runner'.

export const ALL_GOLDEN_GAMES: GoldenGame[] = [...TURN_GAMES, ...MERGER_GAMES, ...ENDGAME_GAMES];
