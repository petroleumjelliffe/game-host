/**
 * Node-only dictionary loading. Kept out of the engine barrel so no client
 * import chain ever reaches node:fs — import it directly as
 * '@game-host/wordgame/engine/dictionary.js' from server code only.
 * The contract and `createDictionary` live in dictionaryCore.ts and are
 * re-exported here and from the barrel.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDictionary, type Dictionary } from './dictionaryCore.js';

export { createDictionary } from './dictionaryCore.js';
export type { Dictionary } from './dictionaryCore.js';

let enableDictionary: Dictionary | undefined;

/**
 * The vendored ENABLE word list (172,823 words, one lowercase word per line).
 *
 * Resolved through the package's own name rather than `import.meta.url`,
 * because the server gets bundled by esbuild and a bundle erases module
 * locations — the same reason every game resolves its dist that way (see
 * games/acquire/server/index.ts). Memoized: the file is 1.7MB and the
 * dictionary never changes within a process.
 */
export function loadEnableDictionary(): Dictionary {
  if (enableDictionary === undefined) {
    const packageRoot = dirname(
      fileURLToPath(import.meta.resolve('@game-host/wordgame/package.json')),
    );
    const text = readFileSync(join(packageRoot, 'engine', 'words', 'enable1.txt'), 'utf8');
    enableDictionary = createDictionary(
      text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
    );
  }
  return enableDictionary;
}
