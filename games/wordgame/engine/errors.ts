/**
 * The one error the engine throws at an illegal intent. Defined in its own
 * module so placement.ts and words.ts can throw it without importing
 * intents.ts back (intents.ts imports both of them); intents.ts re-exports
 * it, and that re-export is the public name.
 */

export type IllegalIntentCode =
  | 'gameOver'
  | 'notYourTurn'
  | 'badIntent'
  | 'badPlacement'
  | 'notInRack'
  | 'invalidWord'
  | 'exchangeBlocked';

export class IllegalIntentError extends Error {
  readonly code: IllegalIntentCode;
  /** For `invalidWord`: the offending word(s), so the client can name them. */
  readonly words?: string[];

  constructor(code: IllegalIntentCode, message?: string, words?: string[]) {
    super(message ?? code);
    this.name = 'IllegalIntentError';
    this.code = code;
    if (words !== undefined) this.words = words;
  }
}

export function reject(code: IllegalIntentCode, message?: string, words?: string[]): never {
  throw new IllegalIntentError(code, message, words);
}
