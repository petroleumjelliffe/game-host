/**
 * The engine's public surface. Everything here is environment-neutral —
 * importable from client and server alike.
 *
 * Deliberately absent: `loadEnableDictionary`. It reads the vendored word
 * list with node:fs, so it lives in dictionary.ts and is imported directly
 * as '@game-host/wordgame/engine/dictionary.js' by server code only. The
 * `Dictionary` contract and `createDictionary` are re-exported here from
 * dictionaryCore.ts, which touches no node builtin.
 */
export * from './constants.js';
export * from './board.js';
export * from './rng.js';
export * from './gameTypes.js';
export * from './errors.js';
export * from './dictionaryCore.js';
export * from './placement.js';
export * from './words.js';
export * from './score.js';
export * from './actor.js';
export * from './init.js';
export * from './intents.js';
