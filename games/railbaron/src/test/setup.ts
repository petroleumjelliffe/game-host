import '@testing-library/jest-dom/vitest';

// No localStorage bridge here any more (2026-08-20). This file used to copy
// jsdom's Storage onto globalThis because Node's experimental `localStorage`
// global — undefined without --localstorage-file — shadowed it. The `app`
// project now starts its workers with --no-experimental-webstorage instead
// (see vite.config.ts), so there is nothing on globalThis for jsdom to lose
// to, and vitest bridges the real Storage through by itself. Same mechanism
// as packages/lobby, which is the point: one answer, not four.
