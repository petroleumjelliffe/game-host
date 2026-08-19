import { describe, expect, it } from 'vitest';

describe('the engine test project', () => {
  it('runs without a DOM, so browser globals cannot leak into engine code', () => {
    // window is the real guard here: it only exists under jsdom, so this
    // fails the moment a React or DOM dependency creeps into engine/.
    //
    // globalThis.localStorage is deliberately not asserted here. Node 26
    // defines it as a getter that returns undefined without
    // --localstorage-file, in both the plain-node engine project and a bare
    // jsdom project — jsdom's real Storage only reaches globalThis via the
    // bridge in src/test/setup.ts, which this project doesn't load. So
    // `typeof globalThis.localStorage === 'undefined'` is true in both
    // environments and would discriminate nothing.
    expect(typeof globalThis.window).toBe('undefined');
  });
});
