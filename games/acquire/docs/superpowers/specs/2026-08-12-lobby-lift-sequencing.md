# Lifting the lobby out — sequencing and rulings

**Date:** 2026-08-12
**Status:** sequencing decided; steps 3–7 each still need their own plan
**Predecessor:** [2026-08-12-lobby-lift-carry-forward.md](./2026-08-12-lobby-lift-carry-forward.md)
**Second consumer:** [railbaron#7](https://github.com/petroleumjelliffe/railbaron/pull/7) — Rail Baron's
local half is built and imports no lobby code yet.

Seven steps, across two repos, to get the lobby living on its own and consumed by both games.
This records the order, the four rulings behind it, and which steps are cheap versus which
need their own design pass.

## The rulings

| Question | Ruling |
|---|---|
| Workspace or separate repos | **Separate repos, lobby as a git submodule.** The owner does not want the two games sharing folders long term. The cost is accepted: every lobby change is commit-in-submodule → push → bump the pointer in each consumer. |
| Shared build artifact or shared source | **Source.** Acquire is React 18.2 and Rail Baron is React 19.2; a built package bakes in one React's JSX runtime and hook types. Source lets each app compile the lobby with its own React. |
| React version | **19 everywhere, Acquire moves first.** Making 19 the baseline removes the dual-React CI job the split would otherwise need, and the upgrade turns out to be a four-dependency bump. |
| Branch point | **`main`, not `revamp/aqua-titanium-reskin`.** The reskin is 12 commits ahead across 31 files and touches none of `package.json`, `src/main.tsx`, `src/net/` or `src/lobby/`. Stacking on it would mean the lobby work cannot merge until a reskin does — the wrong dependency direction. |

**There is no overlap with the reskin — checked, and an earlier draft of this doc was wrong.** It
claimed step 3 would conflict with aqua on `src/pages/OnlineLobbyPage.tsx`. It will not: that page
imports from `src/net/`, not from the lobby UI at all. aqua touches `HomePage`, `OnlineLobbyPage`
and `PassAndPlayPage`; step 3 touches `JoinRoomPage` and `RoomPage`. Disjoint, so the lobby work
does not need to wait for a reskin and aqua can rebase whenever it likes.

## The risk that is invisible today

**Acquire does not use StrictMode. Rail Baron does.**

So the lobby's sockets, mount effects and subscriptions in `useLobbyRoom` have **never once run
under StrictMode**, and the moment Rail Baron consumes it they will. Double-invoked mount
effects are exactly where socket code breaks: double connect, double join, a rejoin racing its
own token. Rail Baron's `useGame` carries a long comment about that hazard precisely because it
bit them there.

This is why step 2 exists and why it comes before anything is extracted. Finding it in one repo,
with 830 tests and a working by-hand routine, is far cheaper than finding it across a submodule
boundary in a game that has no server yet.

**But note what those 830 tests will not do here: no test imports `src/main.tsx`.** They render
components directly, so turning StrictMode on is not exercised by a single one of them. The
by-hand pass in step 1's plan is the only thing that actually tests it.

## The order

### Step 1 — React 19 in Acquire · **done**

**[PR #15](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/15)**, 2026-08-12. Landed on
19.2.8, the same version Rail Baron runs. 830 tests in 79 files before and after — the same numbers,
not merely green.

Four dependencies. Nothing to migrate: audited for every React 19 removal
(`ReactDOM.render`, `findDOMNode`, `react-dom/test-utils`, `defaultProps`, `propTypes`, string
refs) and there are **zero hits**. `@testing-library/react` is already on `^16.3.0`, the React
19–compatible line; `@vitejs/plugin-react` 5.2 and `react-router-dom` 7 both support 19.

Plan: [2026-08-12-react-19-baseline.md](../plans/2026-08-12-react-19-baseline.md).

### Step 2 — StrictMode on · **done**

Same PR as step 1. **It surfaced nothing** — two clicks produced exactly two turn-order draws, the
pass-the-device curtain changed no state at all, and one browser and two tabs both showed exactly
one seat, so the rejoin-by-token path held with two sockets on one seat.

A clean result, but a narrow one: both tabs share a browser profile and therefore one stored
identity, so a **genuine second player** — and with it refresh-mid-draft and server-restart under
StrictMode — was not covered and needs a separate profile.

## Tooling every remaining step will hit

Found while executing step 1, and unrelated to it:

- **`npm run preview` cannot serve this project's build.** [vite.config.ts:121](../../../vite.config.ts#L121)
  sets `base` only for `command === 'build'`, so preview hosts `dist/` at `/` while the built
  `index.html` asks for `/acquire-startups-m1/…`. Every asset misses and the SPA fallback returns
  `index.html` **with a 200**, so the page renders blank. Work around it with
  `npx vite preview --base /acquire-startups-m1/`; **worth fixing properly in step 3**, since every
  by-hand pass from here needs it.
- **Verify served assets by byte count, not status code.** The fallback returns 200 with the wrong
  body — ~2600 bytes instead of ~358000.
- **The server logs neither connect nor join.** Count seats in the roster instead; it is the thing a
  double join would corrupt, and it is visible from the client.
- **Run your own server on a spare port** (`env PORT=3002 GAMES_DIR=… npm run dev:server`, and build
  with `VITE_SERVER_URL` pointed at it) rather than contending for 3001 with another shell.

### Step 3 — `src/lobby/ui/` moves out of the lobby

Its ~580 lines of components are Acquire's screens, not a kit. The whole theming contract is
three CSS variables over hardcoded Tailwind, and Rail Baron has neither Tailwind nor
`className`. Lifting it and then un-lifting it is wasted motion, so it leaves the lobby before
anything is extracted.

Also rewrites `lobby/README.md`, which currently advertises the themeable UI as part of the
contract — a claim that did not survive first contact with a consumer.

**Target: `src/game/lobby/`** (owner's ruling, 2026-08-12), alongside Acquire's other game UI —
so `src/lobby/` is left purely headless, which is exactly what moves to the submodule.

**Plan written:** [2026-08-12-lobby-ui-extraction.md](../plans/2026-08-12-lobby-ui-extraction.md).
It also folds in the `npm run preview` fix, since every by-hand pass from here needs it.

**The interesting part is a tripwire firing.** The import-boundary test walks 21 files, 12 of them
under `ui/`, and guards with `expect(files.length).toBeGreaterThan(10)` so an empty walk cannot
pass vacuously. Remove 12 and 9 remain — the guard trips, correctly. The plan answers it by
asserting the exact count instead, so a file quietly leaving the lobby is caught too.

### Step 4 — The game supplies the seat-id space

[Issue #13](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/13). A `seatIds` list
or `mintSeatId(taken)` hook on `createLobbyRegistry`, so Acquire keeps `p1..pN` and Rail Baron
passes its six fixed colours. Kills the duplicate-seat-id bug by construction — ids stop coming
from a shrinking array's length — and yields **capacity**, which the lobby has no notion of
today and which step 5 needs.

Before the split, because it changes a public signature both consumers bind to on day one.

**Needs its own plan.** Behaviour-adjacent on the join path; wants a test replaying exactly the
leave-then-join sequence, proven to fail first.

### Step 5 — `LobbyView`

The element-inventory layer: `seats` (occupied *and* empty), `you`, `code`, `canBegin` +
`beginBlocked`, `connection`, `terminal`; and per seat `isYou`, `canRename`, `isHost`,
`connected`. Shapes in the carry-forward doc.

Today every consumer re-derives the same four facts from the raw roster, and cannot derive the
fifth — which seats are empty — because the roster sends only occupied ones.

**Needs its own plan.** Pure, testable without either game's UI, and the thing that makes Rail
Baron's boards `1d`/`1e`/`1f` buildable.

### Step 6 — ~~Reorganise into one prefix~~ · **deleted 2026-08-13**

**The premise was false, and testing it is what showed that.** This step existed so
`git subtree split` would have a single prefix to work from. But subtree split carries a prefix's
history only from the moment that prefix *began existing* — it does not follow content across a
rename into it.

Measured, not assumed: `git subtree split -P src/lobby` on `main` produced **9 commits**, reaching
back only to `596dc22`, which created `src/lobby/`. The earlier work in `lobby/` and
`server/lobby/` — the wire split, the generic registry, the handlers behind `onBegin`/`onSeated` —
was not in it.

So reorganising into `packages/lobby/` and then splitting that prefix would have yielded **one
commit: the reorg.** The step would have destroyed exactly the history it existed to preserve.

**`git filter-repo` replaces it** (owner ruling, 2026-08-13). It handles multiple paths *and* the
renaming in one pass, so no reorg PR is needed in Acquire at all:

```bash
# against a CLONE — filter-repo rewrites history irreversibly
git filter-repo \
  --path lobby --path server/lobby --path src/lobby \
  --path-rename lobby:protocol \
  --path-rename server/lobby:server \
  --path-rename src/lobby:client
```

All 15 commits, the right layout, one command.

<details>
<summary>The original step 6, kept because the reasoning is still instructive</summary>

#### Reorganise into one prefix

`git subtree split` operates on a single prefix, and the lobby is three directories. To carry
the 12 commits of history out, they first become:

```
packages/lobby/{protocol,server,client}/
```

Imports, the boundary test's roots, and the vitest project globs move with them. Skip this step
and copy files into a fresh repo instead if the history is judged not worth the churn — that is
a real option, not a failure.

</details>

### Step 7 — Extract and wire as a submodule

```bash
# in a throwaway clone, never the working repo
git clone https://github.com/petroleumjelliffe/acquire-startups-m1 lobby-extract
cd lobby-extract && git filter-repo \
  --path lobby --path server/lobby --path src/lobby \
  --path-rename lobby:protocol \
  --path-rename server/lobby:server \
  --path-rename src/lobby:client

# then, in each consumer
git submodule add https://github.com/petroleumjelliffe/<name> vendor/lobby
```

Per consumer: add `vendor/lobby` to `tsconfig.include`, point the vitest project globs at it,
rewrite imports, and in Acquire delete the originals. Rail Baron additionally adds
`socket.io-client`, which it does not currently have.

**Four things that will bite:**

- **Each consumer includes only the parts it uses.** Rail Baron has no server; if its
  `tsconfig.include` swallows `vendor/lobby/server/`, `npm run typecheck` fails on a missing
  `socket.io`. `protocol` + `client` only, until it has one.
- **Forgetting to push the submodule first** commits a pointer to a commit that exists on one
  machine, and the repo becomes unclonable for everyone else. Push submodule, *then* bump.
- **Clones and CI need `--recurse-submodules`** / `actions/checkout` with `submodules: true`.
- **Two consumers, one source tree.** With React 19 everywhere (step 1) this stops needing a
  dual-version CI job — which is most of why step 1 is first.

The compensation: each game pins its own commit, so Rail Baron can sit on a known-good lobby
while Acquire's churns.

**Needs its own plan.**

## Then, in Rail Baron

Boards `1d` (online lobby), `1e` (new room) and `1f` (join room) are already designed and
approved in the *Rail Baron Game Board Design* project, so that work has a target rather than a
blank page. Its `Row`/`ScreenDef` model maps onto `LobbyView` directly: a seat becomes a row, the
share link becomes a row, begin becomes a row that is dim until `canBegin`, and each terminal
state becomes a whole `ScreenDef`.

## Still open, and not resolved by this sequencing

- **`1e` shows five seats; both games seat six.** The room code takes a row. Rail Baron's
  saved-game board solved the same squeeze with a summary row; the room board has not.
- **Hosting** — a second Render service is a second paid instance, versus both games' servers in
  one process.
- **Honor-reclaim policy**, and the game-flavoured rejection codes (`notYourTurn` meaning "not
  the host") whose renaming costs a protocol bump.
- **[Issue #14](https://github.com/petroleumjelliffe/acquire-startups-m1/issues/14)** — the
  `RoomRefused` dead end. Rail Baron's approved `1f` has the optional name field that fixes it,
  which argues for building that behaviour into the shared half rather than only into Rail Baron.
- **The name of the lobby repo.** `lobby` is assumed above and is not a decision.
