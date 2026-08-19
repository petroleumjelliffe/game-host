import { describe, it, expect, afterEach, vi } from 'vitest';
import { isInstalledApp } from './installed';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
});

describe('isInstalledApp', () => {
  it('is false in an ordinary tab (and in jsdom, which has no matchMedia)', () => {
    expect(isInstalledApp()).toBe(false);
  });

  it('is true under display-mode standalone', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    expect(isInstalledApp()).toBe(true);
  });

  it('is false when matchMedia exists but reports a browser tab', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isInstalledApp()).toBe(false);
  });

  it('is true under iOS legacy navigator.standalone', () => {
    (navigator as Navigator & { standalone?: boolean }).standalone = true;
    expect(isInstalledApp()).toBe(true);
  });
});
