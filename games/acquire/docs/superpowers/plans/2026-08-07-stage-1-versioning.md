# Stage 1 — Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make version skew announce itself as version skew, in both directions and from both sources — a socket and a saved room — instead of presenting as a game bug.

**Architecture:** One constant in `session/protocol.ts`, carried on the two events an unbound socket can send, checked where the server already answers them, refused with its own rejection code and its own screen. The same constant goes into the saved-room record, so a protocol bump invalidates rooms written by an older server, and onto `/health`, so "what is deployed" is one curl instead of a dashboard visit.

**Tech Stack:** TypeScript, React 18, Vite, vitest (two projects: `node` and `app`/jsdom), socket.io 4, Express, Tailwind.

**Sequencing:** [../specs/2026-08-07-next-round-sequencing.md](../specs/2026-08-07-next-round-sequencing.md)
**Predecessor:** [../specs/2026-08-07-full-game-by-hand-notes.md](../specs/2026-08-07-full-game-by-hand-notes.md)

## Global Constraints

- **No `as any`.** Narrow with the engine's type guards.
- **Derive from the engine, never hardcode** prices, totals or board positions.
- **Five gates per task:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`. The last is known-flaky and is Stage 3's subject; a red run needs diagnosis, not a re-run until green.
- **Baseline, measured 2026-08-07 on `revamp/stage-0-by-hand-setup`:** 677 tests in 64 files, all passing, clean output.
- **`engine/`, `session/` and `server/` must not touch browser globals.**
- **Every test that claims "X received Y" or "nobody received Z" ships with a named break that must turn it red.** Eleven for eleven, and Stage 0 added a twelfth by hardcoding a prop to `false`.
- **Do not touch `package.json` or `package-lock.json`.** Dependencies are frozen until after Stage 2 (owner, 2026-08-07).

## Design decisions, and why

**Skew goes both ways here, and that is not the usual case.** The client deploys to GitHub Pages and the server to Render, independently. So "client newer than server" is exactly as likely as "server newer than client", and the code and copy must handle both. `versionMismatch` is named for the condition rather than for one side's fault.

**Checked on `createRoom` and `joinRoom`, and that is sufficient — not a socket.io middleware.** Those two handlers are the only ones an unbound socket can usefully reach, and they are the only two that *create* a binding (`bindings.set`). Every other event resolves through a binding, so a client that never passes the check can never act. This keeps the refusal in the `rejected` channel the client already renders, rather than a `connect_error` needing a second error path.

**A missing version is a mismatch, not a pass.** Clients already deployed send nothing. Treating absent as "fine" would exempt precisely the clients this exists to catch.

**One `SAVE_VERSION` bump carries two changes.** The record gains `protocolVersion` *and* `previousSegmentStart` (the sweep item), so both ride one bump to 5 rather than two.

**A protocol bump invalidates saved rooms on purpose.** A saved room is a `GameState`, which is what the protocol carries; a server whose protocol has moved should not resume a room written before it. This does *not* close the known hole — `isSavedRoom` still trusts `state` past "is an object", so a `GameState` change with no bump is still uncaught. That limitation gets stated in the code, not quietly narrowed.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/game/online/StaleClient.tsx` | The screen for a client and server that cannot talk. |
| `src/game/online/StaleClient.test.tsx` | Both directions, and the reload affordance. |
| `server/versioning.test.ts` | The handshake check, both directions, and the absent-version case. |

**Modified**

| File | Change |
|---|---|
| `session/protocol.ts` | `PROTOCOL_VERSION`; `protocolVersion` on `CreateRoomMessage` and `JoinRoomMessage`; `versionMismatch` on `RejectionCode`. |
| `server/index.ts` | The check in both handlers; `/health` reports both versions. |
| `server/store.ts` | `SAVE_VERSION` → 5; `protocolVersion` and `previousSegmentStart` on `SavedRoom`; `loadAll` reports skipped files. |
| `server/rooms.ts` | Persist and restore the two new fields; quarantine unreadable records; make `restore` boot-only in fact. |
| `server/room.ts` | Accept a restored `previousSegmentStart`. |
| `src/net/connection.ts` | Send the version on both events. |
| `src/net/useRoom.ts` | A `stale` phase for `versionMismatch`. |
| `src/pages/RoomPage.tsx` | Render `StaleClient`. |
| `src/game/online/ConnectionStrip.tsx` | The cold-start copy ruling. |
| `src/game/catalog/sections.tsx` | The new screen as a catalog state. |

---

## Task 1: The constant and the code

**Files:** `session/protocol.ts`, `session/protocol.test.ts`

- [ ] **Write the failing test.** `PROTOCOL_VERSION` is a positive integer; `versionMismatch` is assignable to `RejectionCode`; `CreateRoomMessage` and `JoinRoomMessage` carry `protocolVersion`.
- [ ] **Run it, watch it fail.**
- [ ] **Implement.** `export const PROTOCOL_VERSION = 1;` with a docstring saying what counts as a change: `WireIntent`, `StateMessage`, `RejectionCode`, `JoinedMessage`, `RosterMessage`, `CLIENT_EVENTS`, `SERVER_EVENTS`. Make `protocolVersion` **required** on both message types so a new client cannot forget it; the server still treats absent as mismatch, because old clients exist.
- [ ] **Five gates. Commit.**

## Task 2: The server refuses skew

**Files:** `server/index.ts`, `server/versioning.test.ts`

- [ ] **Write the failing test.** Four cases, over real sockets via `socketHarness`:
  - `joinRoom` with a version below `PROTOCOL_VERSION` → `rejected` with `versionMismatch`, and **no binding is created**
  - `joinRoom` with a version *above* it → same (the server-behind case, which is live here)
  - `joinRoom` with no version at all → same
  - `createRoom` with a bad version → same, and no room is created
- [ ] **Run it, watch it fail.**
- [ ] **Implement**, before the existing shape checks in both handlers.
- [ ] **Break it:** make the comparison `>=` instead of `===` and confirm the "client newer" case turns red. A one-sided check would pass three of the four tests above.
- [ ] **Five gates. Commit.**

## Task 3: `/health` says what is deployed

**Files:** `server/index.ts`, `server/versioning.test.ts`

Motivated directly: during Stage 0 there was no way to tell what was running on Render short of the dashboard, and the client was about to be pointed at it.

- [ ] **Write the failing test.** `/health` returns `{ ok: true, protocolVersion, saveVersion }`, and the values equal the exported constants rather than literals typed into the test.
- [ ] **Run, implement, five gates. Commit.**

## Task 4: The client sends its version

**Files:** `src/net/connection.ts`, `src/pages/RoomPage.test.tsx`

- [ ] **Write the failing test** at the `RoomPage` level with the fake connection: every `joinRoom` the app sends carries `PROTOCOL_VERSION`, including the stored-identity rejoin and the seeded dev seat.
- [ ] **Run, implement, five gates. Commit.**

## Task 5: The screen for a client that cannot talk

**Files:** `src/game/online/StaleClient.tsx`, its test, `src/net/useRoom.ts`, `src/pages/RoomPage.tsx`, `src/game/catalog/sections.tsx`

- [ ] **Write the failing tests.** `useRoom` moves to a `stale` phase on `versionMismatch` and — like `noSuchRoom` — **tears the session down**, so a mid-game player cannot keep a live-looking board. That exact bug shipped in Phase 4 and was caught only by the final review; the same mistake is available here.
- [ ] The screen names the situation without blaming the player, works for either direction, and offers a reload. Copy: **`This version can't talk to the server`**, with **`Reload to update`**.
- [ ] **Run, implement.**
- [ ] **Break it:** leave `stale` out of the phase expression's precedence so `playing` outranks it, and confirm the mid-game test turns red. This is the Phase 4 bug re-run deliberately.
- [ ] Add the state to `/catalog`.
- [ ] **Five gates. Commit.**

## Task 6: The saved record carries both new fields

**Files:** `server/store.ts`, `server/rooms.ts`, `server/room.ts`, their tests

- [ ] **Write the failing tests.**
  - A record written now carries `protocolVersion` and `previousSegmentStart`.
  - A record whose `protocolVersion` differs is skipped, not restored.
  - **A restored room's `previousSegmentStart` survives**, so a client resuming after a restart sees the previous turn in the step stack instead of a blank — the sweep item, and the gap the field exists to close.
  - A version-4 record is refused (`SAVE_VERSION` → 5).
- [ ] **Run, implement.**
- [ ] In `isSavedRoom`, **state the limitation in a comment rather than narrowing it away**: `state` is still trusted past "is an object", so a `GameState` change without a bump is still uncaught.
- [ ] **Five gates. Commit.**

## Task 7: Unreadable saves stop accumulating

**Files:** `server/store.ts`, `server/rooms.ts`, their tests

Phase 4 left this open on purpose: deleting a file you could not parse is destructive and deserves a decision. **The decision: quarantine, do not delete.**

- [ ] **Write the failing test.** `loadAll` reports the names it skipped; `restore` renames each to `.bad` rather than unlinking; a quarantined file is not read again on the next boot and warns once, not forever.
- [ ] **Run, implement, five gates. Commit.**

## Task 8: `restore()` is boot-only in fact, and the cold-start copy

**Files:** `server/rooms.ts`, `src/game/online/ConnectionStrip.tsx`, their tests

- [ ] **Write the failing test.** A second `restore()` call throws rather than silently swapping live room objects out from under socket bindings that still point at the old ones. Today only a docstring says this.
- [ ] **The cold-start copy** — see the open decision below. If ruled: replace `Waking the server — this can take up to 30 seconds` with copy that asserts no cause, and update the test that pins the old string.
- [ ] **Five gates. Commit.**

---

## Open decisions this plan needs

1. **The cold-start copy.** Phase 4's Finding 2 established that `navigator.onLine` cannot tell "server asleep" from "online but cannot reach it" — the case actually observed, a phone on cellular reaching for a LAN address. The honest repair blames nothing: **`Can't reach the server — retrying`**. The cost is losing the "this can take up to 30 seconds" reassurance that is genuinely true on Render free. A product call, recommended but not made.

2. **Whether `versionMismatch` should also end a game in progress.** Task 5 tears the session down, matching `noSuchRoom`. The alternative is letting an in-progress game continue read-only. Recommended as written: a client that cannot talk to the server cannot act, and a live-looking board that silently drops every click is the exact Phase 4 bug.

## Self-Review

- [ ] Does the check refuse a client that is *newer* than the server, proven by a break?
- [ ] Does a version-mismatched client mid-game lose its session, proven by a break?
- [ ] Does `/health` report values read from the constants rather than typed twice?
- [ ] Does a restored room bring `previousSegmentStart` back, and is that asserted end to end rather than at the store?
- [ ] Is the `isSavedRoom` limitation stated where the trust is granted?
- [ ] Are `package.json` and `package-lock.json` untouched?
