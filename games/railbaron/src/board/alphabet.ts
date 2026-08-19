/**
 * The flaps physically carry these characters, in this order. A drum can
 * only turn one way, so the distance from one character to another is
 * always measured going down the list and wrapping round the end — which
 * is why 'Z' to 'A' is seventeen steps rather than one.
 */
export const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.-&'";

/** The destination column, in tiles. Every screen's choice fits inside this. */
export const FLAP_WIDTH = 14;

/** Anything the flaps cannot show becomes a blank, never a negative index. */
function indexOfChar(character: string): number {
  const at = ALPHABET.indexOf(character.toUpperCase());
  return at < 0 ? 0 : at;
}

export function toIndexes(text: string, width: number): number[] {
  const padded = text.toUpperCase().slice(0, width).padEnd(width, ' ');
  return [...padded].map(indexOfChar);
}
