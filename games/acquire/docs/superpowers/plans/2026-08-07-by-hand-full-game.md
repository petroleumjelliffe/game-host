# Stage 0 — The by-hand full game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans for Tasks 1–2. Task 3 is driven by a human and cannot be delegated. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a full two-browser game to final scoring, through a merger whose liquidation queue reaches both players — the pass owed since Phase 3b — and build the setup that makes it repeatable.

**Architecture:** The blocker is setup, not play: there is no way to put a browser into a mid-game room, so the merger case has never been reached by hand. Tasks 1 and 2 add a dev-only path that seats two browsers into a golden-game state. Task 3 is the pass itself. Nothing here ships to production; the whole seeding path is guarded and must be absent from a production build.

**Tech Stack:** TypeScript, React 18, Vite, vitest (two projects: `node` and `app`/jsdom), socket.io 4, Express, Tailwind.

**Sequencing:** [../specs/2026-08-07-next-round-sequencing.md](../specs/2026-08-07-next-round-sequencing.md)

## Global Constraints

- **No `as any`.** Narrow with the engine's type guards.
- **Derive from the engine, never hardcode** prices, totals or board positions.
- **Five gates per task:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`. Note that the last one is known-flaky and is Stage 3's subject — a red run needs diagnosis, not a re-run until green.
- **Baseline, measured 2026-08-07:** 664 tests in 63 files, all passing, clean output. Any task leaving a warning in `npx vitest run` has regressed it.
- **`engine/`, `session/` and `server/` must not touch browser globals** — they run under `environment: 'node'` for exactly that reason.
- **Every test that claims "X received Y" or "nobody received Z" ships with a named break that must turn it red.** Eleven hollow gates, eleven found by running the break.
- **`engine/golden/fixtures.ts`, `replay.ts` and `index.ts` are vitest-free** (verified); only `runner.ts` imports vitest. The server may import the first three. `src/` may import none of them outside the lazily-routed catalog.

---

## Why this needs building before it can be run

`rooms.fromState(roomId, names, state)` exists and every socket-level test uses it, but
[socketHarness.ts:85](../../../server/socketHarness.ts#L85) states the deliberate limit: *"there is
deliberately no socket event that installs a prepared state."* The only HTTP route is `/health`.

So today the merger case is reachable only by playing a real game until a merger happens **and**
both players happen to hold stock in the chain that dies. That is several minutes per attempt, not
guaranteed to produce a two-player queue, and not repeatable — and it is the most likely reason
three carry-forwards have recorded this pass as owed without it being run.

**G2 is exactly the case.** Its liquidation queue reaches both seats: Alex sells two and trades two,
then *"Sam sells out, which closes the merger."* Both hold ZuckFace. It already passes over real
sockets in `goldenSocket.test.ts` and `clientOverWire.test.ts` — so the protocol is proven and it is
the **UI** for the second player's liquidation that has never been seen. `LiqQueue`, which renders
it, has had no design review since Phase 1b flagged it.

---

## Task 1: A dev-only seeding route

**Files:**
- Modify: `server/index.ts` (add the route beside `/health`)
- Test: `server/devSeed.test.ts` (create)

**Shape.** `POST /dev/rooms` taking `{ roomId, goldenId, names }`, returning the seated roster
including each player's `token`. It calls `rooms.fromState` with the golden game's fixture and
returns what a browser needs to join. Deliberately **HTTP, not a socket event** — Stage 1 is about
to put a version on the wire, and the wire surface should not grow a permanent dev affordance
first. `socketHarness.ts`'s comment stays true.

**Guarding is the part to get right.** The route must not exist when `NODE_ENV === 'production'`,
and that must be the test that ships with a named break. Register it conditionally so it 404s rather
than 403s — an absent route cannot be reached by a bug in its own auth check.

**Steps:**

- [ ] **Write the failing test.** Three cases: seeding a room by golden id returns tokens for every
      name; an unknown golden id is a 400, not a 500; and with `NODE_ENV=production` the route is
      **absent** (404).
- [ ] **Run it and watch it fail** for the right reason — "no such route", not a typo in the body.
- [ ] **Implement**, importing `ALL_GOLDEN_GAMES` and `buildFixture` from `engine/golden/`. Do not
      import `runner.ts`.
- [ ] **Break the guard on purpose** — register the route unconditionally — and confirm the
      production case turns red. A guard test that cannot fail is the eleven-times-repeated mistake.
- [ ] **Run the five gates. Commit.**

## Task 2: Seating a browser into a seeded room

**Files:**
- Modify: `src/pages/RoomPage.tsx`, `src/net/identity.ts`
- Test: `src/pages/RoomPage.test.tsx`

**The problem.** A seeded room's lifecycle is `playing`, so a browser arriving without a token is
refused with `seatRefused` — correctly. The tokens exist only in Task 1's HTTP response.

**Shape.** `/room/:roomId?devSeat=<playerId>&devToken=<token>` writes that identity through
`saveIdentity` and strips the query before anything else runs, so a reload behaves like any other
returning player. Gate the whole branch on `import.meta.env.DEV` so it is compiled out of a
production build.

**Steps:**

- [ ] **Write the failing test:** a mount with the query params saves the identity and joins with
      it; a mount without them is unchanged; and the params are ignored when not in DEV.
- [ ] **Run it and watch it fail.**
- [ ] **Implement.** Strip the query with `replace: true` so the back button does not walk back into
      a URL carrying a token.
- [ ] **Verify the production build does not contain the string `devSeat`** — `npx vite build` then
      grep `dist/assets`. This is the same shape as `check:bundle` and is the only real proof the
      gate compiled out.
- [ ] **Run the five gates. Commit.**

## Task 3: The pass itself

**Not delegable.** A human drives this, in two real browsers. Its output is a findings document,
not code.

### Pre-flight, which is not optional

The first round of Phase 4's by-hand testing was invalidated because two dev servers from another
checkout already held 5173 and 3001; Vite moved silently to the next free port and the whole round
measured `main`. Verify which **tree** is serving:

```bash
lsof -nP -iTCP -sTCP:LISTEN | awk '$1=="node"{print $2, $9}' | sort -u | while read P ADDR; do
  echo "$ADDR  $(lsof -a -p $P -d cwd -Fn | grep '^n' | cut -c2-)"
done
```

**Quote `'^n'`.** In zsh — this project's shell — an unquoted `^n` is extended-glob negation and
expands to the whole directory, so `grep` prints `dist: Is a directory` and no working directory at
all. The unquoted form shipped in the Phase 4 notes and failed for the next person who ran it.

- [ ] Kill anything from another checkout, then `npm run dev:all` — **both** servers. Plain
      `npm run dev` starts Vite alone, and the missing 3001 is invisible until a room fails to
      connect.
- [ ] Confirm both ports map to *this* working directory, and that 3001 appears at all.
- [ ] Restart Vite if it was running before a branch switch.
- [ ] Confirm `VITE_SERVER_URL` is unset or commented out — pointed at Render, the client cannot
      reach the seeding route, which exists only on a dev server.
- [ ] Use **two isolated browser contexts**, not two tabs — `identity.ts` keys `localStorage` per
      room, so two tabs in one profile fight over the same seat.

### 3a — The merger, seeded from G2

- [ ] Seed G2 through the Task 1 route; open both seats through Task 2's URLs.
- [ ] Drive the merger placement and both liquidations, watching for:
  - **`LiqQueue` on a real screen for the first time** — is the waiting player told they are waiting,
    and who for? This component has never had a design review.
  - **The second player's liquidation turn.** The protocol is proven here; the UI is not.
  - **The payout lines** against the engine's own figures — Alex majority 4 → $4,000, Sam minority
    2 → $2,000. Derive, do not trust the screen against itself.
  - **The three refusals G2 encodes** (`shareCountMismatch`, `oddTradeCount`, `notEnoughShares`) —
    what does the panel say when a liquidation is refused, and can the player recover?
  - **Panel height** across every transition, and the step stack's attribution of steps to players.

### 3b — On to final scoring

- [ ] Seed **G9** (`end by 41 tiles, declared`) and drive the declaration and final scoring in two
      browsers. `FinalScoring` has a catalog state but has never been reached by two real clients
      over a socket.
- [ ] Check the end is *declinable* by the player it is offered to, and that the other browser sees
      the outcome either way.

### 3c — Presence, since it is on screen anyway

- [ ] Drop one browser's network mid-merger and confirm the away dot renders on the seat and the
      other player is told. **The away dot has never been rendered on a measured page** — this is
      the first look at it.

### Recording it

- [ ] Write `docs/superpowers/specs/2026-08-07-full-game-by-hand-notes.md` in the house shape: one
      section per finding, each stating **why no test could have caught it**.
- [ ] **Measure anything numeric against a shared clock.** Phase 4 wrote up a confident "4–7
      seconds" from an unmeasured gap; the real figure was 98ms. A number that was never measured,
      presented as a measurement, is the same defect as a test that cannot fail.
- [ ] Feed the findings back into
      [../specs/2026-08-07-next-round-sequencing.md](../specs/2026-08-07-next-round-sequencing.md)
      before Stage 1 is planned in detail. That feedback is the reason this stage is first.

## Self-Review

- [ ] Is `devSeat` absent from `dist/assets` after a production build?
- [ ] Does the seeding route 404 under `NODE_ENV=production`, proven by a break that turned red?
- [ ] Did the by-hand pass measure this tree, verified by the `lsof` command and not by assumption?
- [ ] Does every finding say why no test could have caught it, and does every number have a
      measurement behind it?
