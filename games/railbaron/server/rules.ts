// server/rules.ts
// The one read of DATA_DIR/railbaron/rules.json, at mount. Absent is the
// published game, silently — the file is optional equipment. Anything else
// wrong refuses the mount loudly: a half-read rules file is a wrong game,
// not a degraded one (the room store's quarantine precedent, spec Decision 1).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRules, PUBLISHED_RULES, type GameRules } from '../src/state/rules.js';

export async function readRules(dataDir: string): Promise<GameRules> {
  const path = join(dataDir, 'rules.json');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return PUBLISHED_RULES;
    throw new Error(`rules.json is unreadable at ${path}: ${String(error)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      `rules.json at ${path} is not JSON — fix it or delete it; absent means the published rules`,
    );
  }
  const parsed = parseRules(raw);
  if (!parsed.ok) {
    throw new Error(
      `rules.json at ${path}: the field '${parsed.field}' is not something this game can play`,
    );
  }
  return parsed.rules;
}
