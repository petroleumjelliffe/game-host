/**
 * The dictionary contract and its in-memory implementation. This half is
 * environment-neutral so the barrel (and therefore any client import chain)
 * can re-export it; the node-only loader that reads the vendored word list
 * lives in dictionary.ts, which imports node:fs and must never be pulled
 * into a browser bundle.
 */

export interface Dictionary {
  has(word: string): boolean;
  readonly size: number;
}

/** Uppercases on build and on lookup, so callers never worry about case. */
export function createDictionary(words: Iterable<string>): Dictionary {
  const set = new Set<string>();
  for (const word of words) set.add(word.toUpperCase());
  return {
    has: (word: string) => set.has(word.toUpperCase()),
    size: set.size,
  };
}
