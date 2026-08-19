# Stage 2 — Pass-and-play persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pass-and-play game survives a refresh and the back button — one active local game per device, continued from the lobby, until End game finishes it.

**Architecture:** A small guarded `localStorage` module (`src/game/local/localSave.ts`) holding one versioned `{version, savedAt, state}` record, written at every segment close. The route splits into `/pass-and-play` (lobby: setup, Continue card, stale-save notice) and `/pass-and-play/game` (board: resume from save via `createGameSession({state})`, whose construction already raises the curtain). `FinalScoring`'s existing `actions` prop carries End game.

**Tech Stack:** TypeScript, React 18, react-router 7, Vite, vitest (`app` project — this feature is jsdom territory throughout), Tailwind.

**Design:** [../specs/2026-08-07-stage-2-pass-and-play-persistence-design.md](../specs/2026-08-07-stage-2-pass-and-play-persistence-design.md)

## Global Constraints

- **Five gates per task:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`.
- **Baseline, 2026-08-07 post-Stage-1:** 710 tests in 66 files, clean output.
- **Nothing here may live under `session/` or `engine/`** — it all touches `localStorage` and React. `session/nodeEnvironment.test.ts` is the tripwire.
- **Do not import `server/store.ts` into `src/`.** `LOCAL_SAVE_VERSION` is this feature's own constant, by design.
- **Every new test proves it can fail by a run break**, and absence assertions get the eight-run treatment.
- **No modals.** The discard confirmation is inline on the card; the modal family is deleted and stays deleted.
- **Copy verbatim from the design**, which took it verbatim from the mockup.
- **Dependencies stay frozen** until after this stage (owner, 2026-08-07).

## Task 1: The save module

**Files:** create `src/game/local/localSave.ts`, `src/game/local/localSave.test.ts`

- [ ] Failing tests: round trip (`save` then `load` returns state and a numeric `savedAt`); absence → `null` with `loadFailure() === null`; wrong `version` → `load()` null **and** `loadFailure() === 'stale'`; unparseable JSON → same; `clear()` empties both; a `localStorage` that throws (Safari private mode — mock `setItem` to throw) makes `save` a no-op, never a crash.
- [ ] Run; watch each fail for its own reason.
- [ ] Implement to the design's shape. State the by-hand-bump limitation on the version guard, as `isSavedRoom` does.
- [ ] Break: return `null` from `loadFailure()` unconditionally and confirm the stale tests go red — the silent-absence failure mode is the one the design names.
- [ ] Five gates. Commit.

## Task 2: The routes, resume, and save-on-commit

**Files:** modify `src/App.tsx`, rewrite `src/pages/PassAndPlayPage.tsx`, create `src/pages/PassAndPlayGamePage.tsx` (+ tests)

- [ ] Failing tests, game route: mounts from a save (`createGameSession({state})` — assert board content derives from the saved state, and `awaitingReveal` has the curtain up); with no save and no setup config, **redirects to `/pass-and-play`** rather than rendering anything; a segment close writes to the module (drive a real `placeTile`+`endTurn` through the session — mind the adjacency trap, isolated tile only); a staged-but-uncommitted step writes **nothing** (eight-run rule); `stage: 'end'` writes.
- [ ] Failing tests, lobby route: nothing saved → setup, no Continue; save present → Continue card shows `Game in progress`, the players from the state, and a relative `Last played`; stale save → the one-line notice, no Continue, no crash.
- [ ] Run; implement. The subscribe listener watches `segmentStart` move — not every notification — and unsubscribes on unmount.
- [ ] Break: disconnect the listener and confirm the segment-close test goes red *while the mount-time tests stay green* — a save written at mount would satisfy a lazy assertion; the test must distinguish "saved on commit" from "saved once, ever".
- [ ] Five gates. Commit.

## Task 3: The lobby card, per the mockup

**Files:** modify `src/game/setup/LocalSetupScreen.tsx` (restyle into the card), `src/pages/PassAndPlayPage.tsx` (+ tests)

- [ ] Failing tests: `New Game` over a live save swaps to the inline confirm (`Discard the saved game?`) and only the confirm discards; with nothing saved it goes straight through, no confirm frame (the `phasesSeen`-style every-render assertion, not a settled-DOM one — a one-frame confirm flash is the same bug class as Phase 4's Finding 3); cancel restores the card untouched.
- [ ] Run; implement to the mockup's structure — one centred card, primary/secondary/quiet-back. Colours from Tailwind, not the file.
- [ ] Five gates — `verify:layout` matters here; the card is new layout on its path. Commit.

## Task 4: End game

**Files:** modify `src/game/FinalScoring.tsx` callers to pass the action, `src/pages/PassAndPlayGamePage.tsx` (+ tests)

- [ ] Failing tests: End game clears the save and lands on the lobby with no Continue card; it appears **only** in pass-and-play — the online `RoomPage` path must not gain it (a room belongs to everyone in it; ending is not one player's to do).
- [ ] Run; implement through the existing `actions` prop.
- [ ] Break: make End game navigate without clearing and confirm the no-Continue assertion goes red.
- [ ] Five gates. Commit.

## Task 5: The by-hand pass, and the carry-forward

**Not delegable.** Short, and played rather than seeded — the seeding route is online-only.

- [ ] Pre-flight: the quoted `lsof` check; `npm run dev` suffices (no server needed — that is the point of this feature).
- [ ] New game → three segments → **refresh mid-turn** → back at the segment start, curtain up, undo floor correct → **back button** → lobby shows Continue → continue → finish → End game → lobby offers no Continue.
- [ ] Kill the tab mid-staging and reopen: the staged work is gone, the committed segment is not — the ruling, observed.
- [ ] Bump `LOCAL_SAVE_VERSION` locally, reload over the old save: the stale notice, not a crash, not a silent absence.
- [ ] Write the by-hand notes and the Stage 2 closeout in the sequencing doc; findings feed Stage 3's queue.

## Self-Review

- [ ] Can a save ever be written from uncommitted staging? Name the test that would catch it.
- [ ] Does anything import `localSave` outside `src/game/local`, the two pass-and-play pages, and tests?
- [ ] Is the stale-save path *shown* to a player, proven by a break — not merely returned by the module?
- [ ] Did the refresh test run in a real browser, given jsdom cannot hold a reload?
- [ ] Are `package.json` and `package-lock.json` untouched?
