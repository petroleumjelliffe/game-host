# Lobby UI Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `src/lobby/ui/` into `src/game/lobby/`, so what remains under the lobby directories is exactly what moves to the submodule later — and fix `npm run preview`, which every by-hand pass from here needs.

**Architecture:** A file move plus import rewrites. Twelve files leave the lobby's three directories, which trips the import-boundary test's own absence guard — answering that deliberately is the interesting part. No behaviour changes.

**Tech Stack:** React 19, Vite 7, Vitest 4 (`node` and `app` projects), TypeScript 5.

**Spec:** [2026-08-12-lobby-lift-sequencing.md](../specs/2026-08-12-lobby-lift-sequencing.md), step 3.

## Global Constraints

- **Branch from `main`** as `chore/lobby-ui-extraction`. **Independent of [PR #15](https://github.com/petroleumjelliffe/acquire-startups-m1/pull/15)** — moving React components does not interact with the React version, so the two can merge in either order. (An earlier draft of this line said #15 was required; it is not.) The only consequence of merging this first is that its by-hand pass runs without StrictMode, which is fine: this plan verifies a file move, and StrictMode was verified in #15.
- **No aqua conflict — verified.** `revamp/aqua-titanium-reskin` touches `HomePage`, `OnlineLobbyPage`, `PassAndPlayPage`; this plan touches `JoinRoomPage` and `RoomPage`. Disjoint. An earlier draft of the sequencing doc predicted a 6-line conflict on `OnlineLobbyPage`; that was wrong — it imports from `src/net/`, not from the lobby UI at all.
- **No behaviour change.** Every test that passes before must pass after, with the same totals: **830 tests in 79 files** on `main` as of 2026-08-12.
- **`PROTOCOL_VERSION` does not change.**
- **Never run bare `tsc`** — use `npm run typecheck`.
- **Prove any new or changed test can fail** by breaking the code and reading real output.

## File Structure

| Path | Change |
|---|---|
| `src/lobby/ui/*` (12 files) | **Move** to `src/game/lobby/`. Seven components, four tests, one is `LobbyCard` which two others import. |
| `src/pages/JoinRoomPage.tsx` | 1 import rewritten |
| `src/pages/RoomPage.tsx` | 5 imports rewritten |
| `lobby/importBoundary.test.ts` | Its absence guard, and a comment explaining the new count |
| `lobby/README.md` | Drop the "themeable default UI" claim |
| `package.json` | `preview` script gains `--base` |

**Import depths, checked:** `src/lobby/ui/X.tsx` and `src/game/lobby/X.tsx` are both three levels deep, so `from '../../../lobby/protocol'` stays correct unchanged. Only `from '../connection'` moves, becoming `from '../../lobby/connection'`.

---

### Task 1: Fix `npm run preview`

Unrelated to the move, and first because the by-hand pass in Task 3 needs it.

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a `preview` script that serves the build at its real base path.

- [ ] **Step 1: See the bug before fixing it**

```bash
npm run build
npm run preview
```

Open `http://localhost:4173/acquire-startups-m1/`. The page is **blank**. Confirm why with the byte count, not the status code — the SPA fallback returns `index.html` with a `200`, which is why this was mistaken for a healthy server once already:

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  "http://localhost:4173/acquire-startups-m1/$(grep -oE 'assets/[^"]+\.js' dist/index.html)"
```

Expected: `200 2630` — a 200 carrying `index.html` instead of a ~358000-byte bundle.

- [ ] **Step 2: Fix the script**

[vite.config.ts:121](../../../vite.config.ts#L121) sets `base` only for `command === 'build'`, and `vite preview` runs as `serve`. Rather than change that — dev genuinely wants `/` — give preview the base explicitly:

```json
"preview": "vite preview --base /acquire-startups-m1/",
```

- [ ] **Step 3: Verify the fix**

```bash
npm run preview
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  "http://localhost:4173/acquire-startups-m1/$(grep -oE 'assets/[^"]+\.js' dist/index.html)"
```

Expected: `200` and roughly **358000** bytes. Then open the URL and confirm the board renders rather than a blank page.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "fix: preview serves the build at its real base path

vite.config sets base only for command === 'build', and preview runs as
serve — so it hosted dist/ at / while the built index.html asked for
/acquire-startups-m1/. Every asset missed and the SPA fallback returned
index.html with a 200, so the page rendered blank and a status-code
check read as success.

Found while driving the React 19 by-hand pass, where it cost real time."
```

---

### Task 2: Move the UI out of the lobby

**Files:**
- Move: `src/lobby/ui/` → `src/game/lobby/` (12 files)
- Modify: `src/pages/JoinRoomPage.tsx`, `src/pages/RoomPage.tsx`, `lobby/importBoundary.test.ts`, `lobby/README.md`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `src/lobby/` containing only `connection.ts`, `identity.ts`, `identity.test.ts`, `useLobbyRoom.ts` — the headless half, which is exactly what moves to the submodule in step 7.

- [ ] **Step 1: Move the files with history**

```bash
git mv src/lobby/ui src/game/lobby
```

`git mv` rather than delete-and-add, so `git log --follow` still works on each component.

- [ ] **Step 2: Fix the one import that changes depth**

Inside the moved files, `from '../../../lobby/protocol'` is still correct — both locations are three levels deep. Only the `src/lobby/connection` import moves:

```bash
grep -rln "from '../connection'" src/game/lobby/
```

In each hit, rewrite `from '../connection'` to `from '../../lobby/connection'`.

- [ ] **Step 3: Repoint the two consuming pages**

`src/pages/JoinRoomPage.tsx` — one import:

```ts
import { JoinRoomCard } from '../game/lobby/JoinRoomCard';
```

`src/pages/RoomPage.tsx` — five:

```ts
import { RoomLobby } from '../game/lobby/RoomLobby';
import { RoomGone } from '../game/lobby/RoomGone';
import { StaleClient } from '../game/lobby/StaleClient';
import { ConnectionStrip } from '../game/lobby/ConnectionStrip';
import { RoomRefused } from '../game/lobby/RoomRefused';
```

- [ ] **Step 4: Answer the boundary test's absence guard**

[lobby/importBoundary.test.ts:25](../../../lobby/importBoundary.test.ts#L25) reads:

```ts
expect(files.length).toBeGreaterThan(10); // the absence-assertion guard: an empty walk passes vacuously
```

It walks 21 files today, 12 of them under `ui/`. After the move **9 remain, and this guard trips** — correctly. It exists so that a walk finding nothing cannot pass vacuously.

Do not just lower the number. Assert the count exactly, so a file quietly vanishing is also caught:

```ts
  // Nine files: lobby/{protocol,importBoundary.test},
  // server/lobby/{handlers,rooms,genericConsumer.test},
  // src/lobby/{connection,identity,identity.test,useLobbyRoom}.
  //
  // Exact rather than a floor. The floor existed so an empty walk could
  // not pass vacuously; an exact count also catches a file silently
  // leaving the lobby, which is the failure this whole step is about.
  // The UI moved to src/game/lobby/ on 2026-08-12 — it was Acquire's
  // screens, not a kit.
  expect(files.length).toBe(9);
```

- [ ] **Step 5: Prove that guard can still fail**

Temporarily `git mv src/lobby/identity.test.ts /tmp/`.

Run: `npx vitest run lobby/importBoundary.test.ts`
Expected: FAIL with `expected 8 to be 9`. **Read the output**, then move it back.

- [ ] **Step 6: Rewrite the README's claim**

`lobby/README.md` advertises a themeable UI kit. Replace that bullet with what game #2 established:

```markdown
- **No UI.** The lobby is headless. An earlier version shipped a "themeable
  default UI" behind three `--lobby-*` CSS variables; Rail Baron — the first
  real second consumer — has neither Tailwind nor `className`, and its lobby
  *is* a seven-row split-flap board, which no amount of theming turns a card
  into. What is shared is the element inventory, not components: seats,
  add-player, share link, begin, presence, terminal states. See
  `docs/superpowers/specs/2026-08-12-lobby-lift-carry-forward.md`.
```

- [ ] **Step 7: Verify**

```bash
npm run typecheck
npx vitest run
```

Expected: **830 tests in 79 files** — the same totals, since this moves files without changing behaviour. A different number means an import was missed or a test file was left behind.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move the lobby UI into src/game/lobby/

It is Acquire's screens, not a kit — the whole theming contract was
three CSS variables over hardcoded Tailwind, and Rail Baron has neither.
What remains under lobby/, server/lobby/ and src/lobby/ is now exactly
what moves to the submodule.

The import-boundary test's absence guard tripped, correctly: it walked
21 files and 9 remain. Now asserts the exact count, so a file quietly
leaving the lobby is caught too.

git mv throughout, so log --follow still works."
```

---

### Task 3: Verify in a browser

jsdom reports zero for all layout, so a moved component can render structurally while looking broken. These screens have never had a layout gate — `verify:layout` drives pass-and-play only.

**Files:**
- Create: `docs/superpowers/specs/2026-08-12-lobby-ui-extraction-by-hand-notes.md`

- [ ] **Step 1: Serve the built bundle and a private server**

```bash
env VITE_SERVER_URL=http://localhost:3002 npm run build
env PORT=3002 GAMES_DIR=/tmp/acq-games npm run dev:server   # one terminal
npm run preview                                              # another; Task 1 fixed this
```

- [ ] **Step 2: Drive every moved screen**

Each of these renders a component that moved. Confirm it appears and is not visually broken:

| Screen | How to reach it |
|---|---|
| `LobbyCard` + `RoomLobby` + `ShareRoomButton` | `/online` → Create Room. The room code, the seat rows and the Share button are all here. |
| `ConnectionStrip` | In the room, stop the server. The strip must report the drop. |
| `JoinRoomCard` | `/online/join` |
| `RoomRefused` | Join a room code that does not exist, e.g. `/room/ZZZZZZ` |
| `RoomGone` | Create a room, delete its file from `GAMES_DIR`, restart the server, reload |
| `StaleClient` | Hard to reach without a protocol bump — record as not covered rather than faking it |

- [ ] **Step 3: Write the notes**

One line per screen: reached, and what it looked like. Where a screen could not be reached, say so — an unreachable screen recorded honestly is worth more than a claim.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-lobby-ui-extraction-by-hand-notes.md
git commit -m "docs: by-hand notes for the lobby UI extraction"
```

---

### Task 4: Review the whole branch and open the PR

- [ ] **Step 1: Read the diff end to end**

```bash
git diff main...chore/lobby-ui-extraction
```

Expect: 12 renames, 6 import lines across two pages, the boundary test's guard, the README bullet, and the `preview` script. **Any change to a component's body is out of scope** — this task moves files, it does not edit them.

- [ ] **Step 2: Confirm the lobby is now headless**

```bash
find src/lobby -type f | sort
grep -rn "className\|tsx" src/lobby/ || echo "no JSX left under src/lobby — headless"
```

Expected: four files, no `.tsx`.

- [ ] **Step 3: Every gate**

```bash
npm run typecheck && npx vitest run && npm run check:bundle && npm run verify:layout
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin chore/lobby-ui-extraction
gh pr create --title "Move the lobby UI into src/game/lobby/" --body "$(cat <<'BODY'
Step 3 of `specs/2026-08-12-lobby-lift-sequencing.md`.

`src/lobby/ui/` was never a themeable kit — the whole contract was three
CSS variables over hardcoded Tailwind, and Rail Baron, the first real
second consumer, has neither Tailwind nor `className`. Its lobby *is* a
seven-row split-flap board, which no amount of theming turns a card into.

So the twelve files move to `src/game/lobby/`, and what remains under
`lobby/`, `server/lobby/` and `src/lobby/` is exactly what moves to the
submodule in step 7.

**The import-boundary test's absence guard tripped, correctly.** It walked
21 files; 9 remain. It now asserts the exact count rather than a floor, so
a file quietly leaving the lobby is caught as well as an empty walk.

Also fixes `npm run preview`, which could not serve this project's build:
`base` is set only for `command === 'build'`, so preview hosted `dist/` at
`/` while the built HTML asked for `/acquire-startups-m1/`. The SPA
fallback returned `index.html` with a **200**, so the page rendered blank
and a status-code check read as success. Separate commit; unrelated to the
move, but every by-hand pass from here needs it.

No behaviour change: 830 tests in 79 files, before and after.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Deferred — not in this plan

- **The `LobbyView` layer** is step 4, and the seat-id space is step 5. Neither is touched here.
- **`src/net/` stays put.** It is the game's transport on top of the lobby, not part of it.
- **No components are edited**, only moved. Restyling the lobby screens to match aqua is a reskin concern and belongs on that branch.
