import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Every test here boots real servers on ephemeral ports and connects real
    // clients. Nothing is mocked, deliberately: the failures this package
    // exists to catch — two engine.io instances racing one upgrade, one
    // game's close taking down a shared listener — are invisible to anything
    // that fakes the transport.
    //
    // `forks`, not `threads`: the games' servers hold module-level state and
    // process-level signal handlers, and a pool that reuses a worker across
    // files would let one file's half-closed server meet the next file's.
    pool: 'forks',
    // Well above vitest's 5s default. A test here boots three whole games,
    // seats seven players across three lobbies and plays a round — the
    // composition suite is slow by construction, and 5s is the budget for a
    // unit test. Generous rather than tight on purpose: a timeout that
    // sometimes fires under machine load is a flake, and a flake in the suite
    // that guards composition is worse than no suite, because it teaches you
    // to re-run rather than to read.
    testTimeout: 20000,
  },
});
