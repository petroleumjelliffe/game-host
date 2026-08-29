/**
 * Scoring. Letter premiums (DL/TL) multiply the tile under them; word
 * premiums (DW/TW) multiply the whole word after letter premiums, and
 * multiplicatively when a word covers more than one. Premiums count only for
 * squares placed this turn — an existing tile's premium is spent. Blanks are
 * worth 0 but still trigger a word premium on their square.
 */
import type { WordScore } from './gameTypes.js';
import { BINGO_BONUS, RACK_SIZE, TILE_VALUES } from './constants.js';
import { premiumAt } from './board.js';
import type { FormedWord } from './words.js';

export function scoreWord(word: FormedWord): number {
  let sum = 0;
  let wordMultiplier = 1;
  for (const square of word.squares) {
    const base = square.isBlank ? 0 : TILE_VALUES[square.letter];
    const premium = square.isNew ? premiumAt(square.pos) : null;
    switch (premium) {
      case 'DL': sum += base * 2; break;
      case 'TL': sum += base * 3; break;
      case 'DW': sum += base; wordMultiplier *= 2; break;
      case 'TW': sum += base; wordMultiplier *= 3; break;
      case null: sum += base; break;
    }
  }
  return sum * wordMultiplier;
}

export interface PlayScore {
  wordScores: WordScore[];
  /** Word scores plus the bingo bonus when it applies. */
  total: number;
  bingo: boolean;
}

export function scorePlay(words: readonly FormedWord[], tilesPlayed: number): PlayScore {
  const wordScores = words.map((word) => ({ word: word.word, score: scoreWord(word) }));
  const bingo = tilesPlayed === RACK_SIZE;
  const total = wordScores.reduce((sum, w) => sum + w.score, 0) + (bingo ? BINGO_BONUS : 0);
  return { wordScores, total, bingo };
}
