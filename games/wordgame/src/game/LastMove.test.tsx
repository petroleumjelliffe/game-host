import { describe, expect, it } from 'vitest';
import { ago } from './LastMove';

describe('ago', () => {
  it('is empty for a record predating timestamps', () => {
    expect(ago(undefined)).toBe('');
  });

  it('says "just now" under a minute', () => {
    const now = Date.now();
    expect(ago(now - 10_000, now)).toBe('just now');
  });

  it('shows minutes under an hour', () => {
    const now = Date.now();
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago');
  });

  it('shows hours under a day', () => {
    const now = Date.now();
    expect(ago(now - 3 * 60 * 60_000, now)).toBe('3h ago');
  });

  // Regression: gating "yesterday" on the ROUNDED hour (h = round(m/60), then
  // h < 24) flipped to "yesterday" as early as 23.5h, because round(23.5) is
  // 24. Gating on minutes instead (m < 1440) keeps the boundary at a full day.
  it('still reads in hours just under the day boundary (23.7h)', () => {
    const now = Date.now();
    const at = now - 23.7 * 60 * 60_000;
    expect(ago(at, now)).toMatch(/^\d+h ago$/);
  });

  it('reads "yesterday" once a full day has passed (25h)', () => {
    const now = Date.now();
    const at = now - 25 * 60 * 60_000;
    expect(ago(at, now)).toBe('yesterday');
  });

  it('shows multiple days for older records', () => {
    const now = Date.now();
    expect(ago(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago');
  });
});
