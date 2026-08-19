# React 19 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Acquire on React 19 and turn StrictMode on, so the lobby has one React baseline before it is extracted and its socket layer is exercised under the conditions its second consumer imposes.

**Architecture:** A four-dependency bump, then `<StrictMode>` in `src/main.tsx`. No source migration: Acquire uses none of React 19's removed APIs. The interesting half is StrictMode, which double-invokes mount effects and updaters and is expected to surface something in `src/net/`.

**Tech Stack:** React 19, `react-router-dom` 7, Vite 7, Vitest 4 (two projects: `node` and `app`/jsdom), `@testing-library/react` 16.

**Spec:** [2026-08-12-lobby-lift-sequencing.md](../specs/2026-08-12-lobby-lift-sequencing.md), step 1 and step 2.

> **Executed 2026-08-12** — [PR #15](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/15).
> No StrictMode doubling found. Corrections made to this document *after* execution are marked
> **[corrected]** below; three of the original steps asked for things the codebase does not do.
> Results: [2026-08-12-react-19-by-hand-notes.md](../specs/2026-08-12-react-19-by-hand-notes.md).

## Global Constraints

- **Branch from `main`**, not `revamp/aqua-titanium-reskin`. The reskin is 12 commits ahead across 31 files and touches none of `package.json`, `src/main.tsx`, `src/net/` or `src/lobby/`.
- **Target versions:** `react@^19`, `react-dom@^19`, `@types/react@^19`, `@types/react-dom@^19`. Leave `@testing-library/react` at `^16.3.0` — already the React 19–compatible line. Leave `@vitejs/plugin-react` at `^5.2.0` and `react-router-dom` at `^7.9.4`; both support 19.
- **`PROTOCOL_VERSION` does not change.** This is client-only; no wire change, no cutover.
- **Never run bare `tsc`** — use `npm run typecheck`.
- **This plan lives on `docs/lobby-lift-sequencing`.** Merge that branch first, or read the plan from it, or `git checkout main` will leave you without the file you are executing.
- **The two halves are separately revertible, and that is deliberate.** The React bump is Task 1's commit; StrictMode is Task 2's one-line commit. If StrictMode turns out to destabilise something you cannot fix quickly, revert *it* and keep React 19 — the baseline is what the lift needs, and StrictMode is the early-warning system, not the goal.
- **Two vitest projects, and the split is load-bearing.** `node` runs `engine/`, `session/`, `server/`; `app` runs `src/` under jsdom. A stray `window.` in the node set is a production crash.
- **Prove any new test can fail** by breaking the code and reading real output, never by reading the check.
- **A measurement you did not measure is a defect.** Where this plan asks for numbers, record the actual output.

---

### Task 1: Bump React to 19

No source changes expected. If any are needed, that is a finding — record it rather than absorbing it quietly.

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: React 19 available to every later task. No API surface changes.

- [ ] **Step 1: Record the baseline, so "still green" means something**

```bash
git checkout main && git pull --ff-only
git checkout -b chore/react-19-baseline
npx vitest run 2>&1 | tail -5
npm run typecheck
```

Write down the test count and file count. Measured on `main` on 2026-08-12: **830 tests in 79 files**. A later task compares against these numbers, so record what your run actually prints rather than copying these — `main` may have moved.

(An earlier draft of this plan said "771 `it()` blocks", which was a grep artifact rather than a measurement. Counting `it(` occurrences misses `it.each` expansions. Ask the runner.)

- [ ] **Step 2: Confirm the audit still holds**

React 19 removed these. Acquire had zero hits on 2026-08-12; re-check, because `main` may have moved:

```bash
for p in 'ReactDOM.render' 'findDOMNode' 'react-dom/test-utils' 'defaultProps' 'propTypes'; do
  printf '%-24s ' "$p"; grep -rl "$p" src session server 2>/dev/null | head -3 | tr '\n' ' '; echo
done
```

Expected: every line blank. **Any hit means this plan is incomplete** — stop and report it rather than improvising a migration.

- [ ] **Step 3: Bump**

```bash
npm install react@^19 react-dom@^19
npm install -D @types/react@^19 @types/react-dom@^19
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

The likely failure if anything fails is `@types/react` 19 having removed the implicit `children` prop from `React.FC`, or a `useRef` call with no argument. Neither exists in Acquire today (audited), but if one appears, fix it in this task rather than deferring — it is part of the bump.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: the same totals recorded in Step 1. Not "green" — *the same numbers*. A dropped test file also reports green.

- [ ] **Step 6: Run the two build gates**

```bash
npm run check:bundle
npm run verify:layout
```

`check:bundle` greps `dist/` for vitest and golden-game title strings. `verify:layout` drives a real Chrome over CDP and needs Chrome at `CHROME_PATH`; it checks three things jsdom cannot see — zone reservations, the holdings floor, and history growth. Treat a green run as ordinary evidence.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: React 19 baseline

Four dependencies, no source migration — audited for every React 19
removal (ReactDOM.render, findDOMNode, react-dom/test-utils,
defaultProps, propTypes, string refs) with zero hits.
@testing-library/react was already on the React 19-compatible line.

Client-only: PROTOCOL_VERSION unchanged, no cutover."
```

---

### Task 2: Turn StrictMode on

The reason the whole sequence starts here. Acquire has never run under StrictMode; Rail Baron does, and will run the extracted lobby under it.

**Files:**
- Modify: `src/main.tsx:15-19`

**Interfaces:**
- Consumes: React 19 from Task 1.
- Produces: StrictMode in the production entry point. No exported API.

- [ ] **Step 1: Read what you are wrapping**

`src/main.tsx` currently calls `registerServiceWorker()` at module scope and then:

```tsx
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>
);
```

`registerServiceWorker()` stays **outside** the tree — it is not a React concern and must not be double-invoked by StrictMode.

- [ ] **Step 2: Wrap the tree**

```tsx
import { StrictMode } from "react";

// StrictMode double-invokes mount effects and state updaters on purpose, to
// surface ones that aren't idempotent. It is on here deliberately and not
// only as hygiene: the lobby's socket layer is about to be extracted and
// consumed by Rail Baron, which runs under StrictMode. Double connect,
// double join, and a rejoin racing its own token are the failures it is
// here to catch, and they are invisible without it.
//
// registerServiceWorker() stays outside the tree — it is not a React
// concern and must not be double-invoked.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 3: Typecheck and run the suite**

```bash
npm run typecheck
npx vitest run
```

Expected: the Step 1 numbers from Task 1, unchanged. **Note this does not exercise StrictMode** — the tests render components directly, not through `main.tsx`. The suite passing here is necessary, not sufficient, which is what Task 3 is for.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "chore: run under StrictMode

The lobby's socket layer is about to be extracted and consumed by Rail
Baron, which runs under StrictMode. Double connect, double join and a
rejoin racing its own token are invisible without it, and far cheaper to
find here than across a submodule boundary."
```

---

### Task 3: Drive the socket layer under StrictMode, by hand

The suite renders components directly, so it never sees `main.tsx`. This task is the only thing in the plan that actually exercises what Task 2 turned on.

**Files:**
- Create: `docs/superpowers/specs/2026-08-12-react-19-by-hand-notes.md`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: notes; plus a fix and a regression test for anything found.

- [ ] **Step 1: Serve the built bundle, not the dev server**

**Prerequisites:** two browser windows, and the socket server running. The online legs cannot be driven without both.

```bash
npm run build
npm run dev:server                              # in one terminal
npx vite preview --base /acquire-startups-m1/   # in another
```

**[corrected]** `npm run preview` **cannot serve this project's build.** [vite.config.ts:121](../../../vite.config.ts#L121) sets `base` only for `command === 'build'`, so preview hosts `dist/` at `/` while the built `index.html` references `/acquire-startups-m1/…`. Every asset URL misses, the SPA fallback returns `index.html` **with a 200**, and the page renders nothing. Hence the explicit `--base`.

**Verify with the byte count, not the status code.** A status of `200` proves nothing here — the fallback returns 200 with the wrong body:

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  http://localhost:4173/acquire-startups-m1/assets/<hash>.js
```

Expect ~358000 bytes. ~2600 is `index.html` wearing the bundle's URL, and it cost real time on the first run of this plan.

If another checkout holds the port, Vite moves silently to the next one — check which tree is serving before believing anything. A Phase 4 round was once measured against `main` before anyone noticed.

- [ ] **Step 2: Count seats, not log lines**

**[corrected]** The original step said to count connect and join lines in the `dev:server` output. **The server logs neither** — nothing is printed on connect or join, so that step was unperformable.

Count seats instead, which is better anyway: the roster is the thing a double join would corrupt, and it is observable from the client.

Create a room in one browser. The roster must show **exactly one seat**. Then open the same room URL in a second tab of the same profile: still **one seat**, because the stored identity rejoins by token rather than minting a duplicate. That second tab is worth doing — it puts two sockets on one seat and exercises the rejoin path at the same time.

Two seats for one browser is the StrictMode double-mount reaching the socket, which is the headline bug this task exists to find.

**Run your own server on a spare port** so its log and its games directory are yours, rather than fighting whatever another shell already has on 3001:

```bash
env PORT=3002 GAMES_DIR=/tmp/rb-games npm run dev:server
env VITE_SERVER_URL=http://localhost:3002 npm run build
```

- [ ] **Step 3: Join from a second browser, then drive a full turn**

Place a tile, buy shares, end the turn. Watch for a duplicated intent — the same intent arriving twice for one click. The server rejects out-of-turn and illegal intents, so a duplicate may show as a *rejection* in the log rather than a double effect; read the log, not just the board.

- [ ] **Step 4: Refresh mid-turn, with an open draft**

Refresh the actor's browser while a draft is uncommitted. It must come back to its own open draft, undo and all — that is what the `resume` state reason exists for. Confirm the other player's board still reads the pre-draft state, so the draft stayed private across the remount.

- [ ] **Step 5: Kill and restart the server**

With a room live, restart `dev:server`. The boot line must read `✓ Restored N room(s)` — note [server/index.ts:258](../../../server/index.ts#L258) only prints it when `count > 0`, so silence means nothing was restored, not that restore is quiet. Reload both browsers and confirm the same mid-game state, both seats.

- [ ] **Step 6: Drive pass-and-play too**

**[corrected]** An earlier draft said the save holds "a whole `GameState`, not a move log — so there is no move count to compare". That is wrong: `GameState` carries a **`log`** and a monotonic **`nextStepId`**, and both are the cleanest measure available of "one action, one effect".

The best probe is the **turn-order draw**, because each draw is one discrete, countable action and the screen states the remaining count out loud:

```js
const s = JSON.parse(localStorage.getItem('acquire.local.game')).state;
({ log: s.log.length, nextStepId: s.nextStepId, draws: s.turnOrderDraws?.length, stage: s.stage })
```

Start a two-player game, then click **Draw your tile** once. Expect `log` 0 → 1, `nextStepId` 1 → 2, `draws` 1, and the screen to move from "2 still to draw" to "1 still to draw". A doubled updater consumes both draws on the first click and shows "0 still to draw".

Then the curtain (**Start**, passing the device) must change **nothing** — it is pure UI. Then the second draw takes `draws` to 2 and `stage` to `play`.

**One result looks like doubling and is not.** The final draw advances `log` by 2, because the turn-order winner is announced as its own step rather than merely arrived at. Expected; do not report it as a defect.

This is the same class of bug Rail Baron's `useGame` documents, in a codebase that has never been checked for it.

- [ ] **Step 7: Write the notes**

One section per leg: what you did, what happened, what you expected. Include the actual connect/join counts from Step 2 as numbers. If a leg passed, say so plainly; if nothing was found, that is the result and worth recording, because the next person will otherwise re-derive the doubt.

- [ ] **Step 8: Fix anything found, with a test that fails first**

For a double-connect or double-join, the fix is almost always an effect cleanup that tears down what its setup created. Write the failing test in the `app` project against the hook — not against `main.tsx` — then fix, then confirm the by-hand leg too. jsdom can see a socket being opened twice; it cannot see the panel that results.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-react-19-by-hand-notes.md
git commit -m "docs: by-hand notes for the React 19 + StrictMode baseline"
```

---

### Task 4: Review the whole branch and open the PR

Both of Phase 4's worst bugs spanned two tasks each and survived ten clean per-task reviews.

- [ ] **Step 1: Read the diff end to end**

```bash
git diff main...chore/react-19-baseline
```

Three files if nothing was found: `package.json`, `package-lock.json`, `src/main.tsx`. More than that means Task 3 found something — check its fix has a test that was proven to fail.

- [ ] **Step 2: Re-run every gate together**

```bash
npm run typecheck && npx vitest run && npm run check:bundle && npm run verify:layout
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/react-19-baseline
gh pr create --title "React 19 baseline, and StrictMode on" --body "$(cat <<'BODY'
Step 1 and 2 of `specs/2026-08-12-lobby-lift-sequencing.md`.

**React 19** is a four-dependency bump with no source migration — audited
for every React 19 removal with zero hits, and
`@testing-library/react` was already on the compatible line. Client-only:
`PROTOCOL_VERSION` unchanged, no cutover.

**StrictMode is the point of this PR.** Acquire has never run under it and
Rail Baron does. The lobby's socket layer is about to be extracted and
consumed there, and double connect, double join and a rejoin racing its
own token are invisible until StrictMode is on. Cheaper to find here than
across a submodule boundary in a game that has no server yet.

Making 19 the baseline for both games also means the extracted lobby
needs one React, not a dual-version CI job.

By-hand notes: `specs/2026-08-12-react-19-by-hand-notes.md`.
BODY
)"
```

- [ ] **Step 4: Note what this unblocks**

Steps 3–7 of the sequencing doc, each of which still needs its own plan: `ui/` out, the seat-id space ([#13](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/13)), `LobbyView`, the single-prefix reorg, and the submodule split.

---

## Deferred — not in this plan

- **Rail Baron does not change.** It is already on React 19.2 and already uses StrictMode.
- **`src/lobby/ui/` stays put.** That is step 3, and it touches `src/pages/OnlineLobbyPage.tsx`, which `revamp/aqua-titanium-reskin` also edits by 6 lines — a conflict that disappears if aqua merges first.
- **No wire or protocol change**, so no stale-client screen and no deploy coordination.
