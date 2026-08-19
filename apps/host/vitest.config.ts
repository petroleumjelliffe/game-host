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
  },
});
