import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLISHED_RULES } from '../src/state/rules.js';
import { readRules } from './rules.js';

describe('readRules', () => {
  it('is the published defaults when no file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-rules-'));
    await expect(readRules(dir)).resolves.toEqual(PUBLISHED_RULES);
  });

  it('reads and completes a partial file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-rules-'));
    await writeFile(join(dir, 'rules.json'), '{"winTarget": 50000}');
    await expect(readRules(dir)).resolves
      .toEqual({ ...PUBLISHED_RULES, winTarget: 50000 });
  });

  it('refuses unparseable JSON, naming the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-rules-'));
    await writeFile(join(dir, 'rules.json'), '{not json');
    await expect(readRules(dir)).rejects.toThrow(/rules\.json/);
  });

  it('refuses a bad field, naming it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-rules-'));
    await writeFile(join(dir, 'rules.json'), '{"startingTrain": "fast freight"}');
    await expect(readRules(dir)).rejects.toThrow(/startingTrain/);
  });
});
