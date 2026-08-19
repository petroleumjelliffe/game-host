# Phase 0 — Pre-Migration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every independently-correct improvement in the three game repos *before* the monorepo migration moves their files, so the migration diff contains moves and nothing else.

**Architecture:** No structural change. Each task is a self-contained PR in one game's own repository, gated by that repo's own suite. Work is ordered so a safety net exists before the largest refactor, and so the `noUncheckedIndexedAccess` fixes land as valid-without-the-flag changes with typecheck green throughout — the flag flips last, when the error count is already zero.

**Tech Stack:** TypeScript 5.9, vitest, Vite, Express 5, socket.io 4.8, GitHub Actions, tsx.

**Spec:** [`specs/2026-08-19-monorepo-single-host.md`](../../specs/2026-08-19-monorepo-single-host.md) — Phase 0 section. Read it first; this plan argues from it.

## Status

**Tasks 1 and 3–6 are complete** — done directly in the Acquire repo on
2026-08-19, ahead of this plan being written. Verified in place: the flag is
on in `tsconfig.json`, `.github/workflows/ci.yml` exists, `npm run typecheck`
exits 0, `tsc --noUncheckedIndexedAccess` reports 0 residual errors, and
`npm run test:run` passes 864 tests across 82 files. The two source batches
this plan separated (Tasks 3 and 4) landed as one `refactor:` commit, which
is fine — the split existed for reviewability, and the review happened.

Acquire commits: `42af86b` (CI), `9ede8fe` (source), `3136274` (tests),
`70ba7db` (flag on).

**Remaining: Task 2, Task 7, Task 8.**

## Global Constraints

- **These changes land in the three game repos, not in game-host.** `~/Developer/personal/acquire-startups-m1` and `~/Developer/personal/railbaron`. This plan lives in game-host because game-host becomes the monorepo; the work does not.
- **Marco Polo needs no Phase 0 work.** It already carries `noUncheckedIndexedAccess: true` in both `tsconfig.json` and `client/tsconfig.json`, both pass clean, and it already has the `nodenext`-server / `bundler`-client split. Do not open a PR against it.
- **Do not rename `BASE_PATH`.** `/acquire-startups-m1` → `/acquire` is coupled to GitHub Pages retirement and belongs to the migration plan's step 9, not here. Renaming it now breaks the live Pages deployment.
- **Do not touch `vendor/lobby`.** It is a submodule with its own repo and PR flow. Every task below stays inside the consuming repo.
- **Every task ends with a green `npm run typecheck` and a green test run** in the repo it touched. No task may be committed red.
- **`NODE_ENV=production` is confirmed set on the live Render service** (verified 2026-08-19). Task 2 is hygiene, not incident response.

---

## ✅ DONE — Task 1: Acquire — CI workflow

The safety net comes first. Acquire has no workflow at all, and Tasks 3–6 change several hundred lines across 42 files. Rail Baron's `deploy.yml` is the only existing workflow in any repo and is the pattern to copy — in particular its `submodules: recursive`, without which every `vendor/lobby` import fails to resolve and the run goes red for the wrong reason.

**Files:**
- Create: `~/Developer/personal/acquire-startups-m1/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a green CI run on push and PR, gating every later task in this plan.

- [x] **Step 1: Confirm the two commands pass locally first**

A workflow that codifies a failing command teaches you nothing about the workflow.

```bash
cd ~/Developer/personal/acquire-startups-m1
npm run typecheck && npm run test:run
```

Expected: both pass. `test:run` is `vitest run` (the bare `test` script is watch mode and would hang CI).

- [x] **Step 2: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      # vendor/lobby is a submodule and checkout does not fetch one unless
      # told to. Without this the directory is present but empty, every
      # import of it fails to resolve, and the run goes red for a reason
      # that has nothing to do with the change under test.
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      # `test:run`, not `test` — the bare script is vitest watch mode, which
      # never exits.
      - run: npm run test:run
```

- [x] **Step 3: Verify the workflow is valid YAML and references real scripts**

```bash
cd ~/Developer/personal/acquire-startups-m1
node -e "console.log(Object.keys(require('./package.json').scripts))" | grep -o "typecheck\|test:run"
```

Expected: both `typecheck` and `test:run` appear.

- [x] **Step 4: Commit**

```bash
cd ~/Developer/personal/acquire-startups-m1
git add .github/workflows/ci.yml
git commit -m "ci: gate Acquire on typecheck and the suite

The only workflow in any of the three game repos was Rail Baron's Pages
deploy. A 633-error type refactor is about to land here, and a laptop is
not a safety net.

submodules: recursive because vendor/lobby is one — without it the
directory checks out empty and every import fails to resolve, which is a
red run about the wrong thing."
```

- [x] **Step 5: Push and confirm the run is green**

```bash
git push && gh run watch
```

Expected: the `check` job passes. Do not start Task 2 until it does.

---

## Task 2: Acquire — dev seed fails closed and moves under the base path

`server/devSeed.ts` registers `POST /dev/rooms` — a route that installs arbitrary prepared game state — guarded by `process.env.NODE_ENV !== 'production'`. That guard **fails open**: any value that is not exactly `production`, including unset, registers the route. Nothing is exposed today because Render sets `NODE_ENV=production`, but the protection should come from the code rather than from an environment variable staying set — and after the migration this route sits at the root of an app shared by three games.

**The trap this task exists to catch:** `dev:server` is `SOCKET_PATH=/socket.io tsx watch server/index.ts` and never sets `NODE_ENV`. Inverting the guard to `=== 'development'` without also fixing that script silently disables the dev seed in actual development, which is the one place it is supposed to work.

**Files:**
- Modify: `~/Developer/personal/acquire-startups-m1/server/index.ts` (the `registerDevSeed` call)
- Modify: `~/Developer/personal/acquire-startups-m1/server/devSeed.ts` (route path)
- Modify: `~/Developer/personal/acquire-startups-m1/server/devSeed.test.ts` (new test + helper URL)
- Modify: `~/Developer/personal/acquire-startups-m1/package.json` (`dev:server`)

**Interfaces:**
- Consumes: Task 1's CI.
- Produces: `registerDevSeed(app, rooms)` registering `POST ${BASE_PATH}/dev/rooms`, called only when `NODE_ENV === 'development'`.

- [ ] **Step 1: Write the failing test — unset NODE_ENV must not register the route**

The existing suite passes `'development'` or `'production'` explicitly in every case, so the fail-open gap is untested. Add this case to the `describe('POST /dev/rooms')` block in `server/devSeed.test.ts`:

```ts
  it('does not exist when NODE_ENV is unset, because the guard fails closed', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const { port } = await start();
      // An absent NODE_ENV must not be read as "not production, therefore
      // dev". Anything that is not explicitly development gets no route.
      expect((await seed(port, { goldenId: 'G2' })).status).toBe(404);
      expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/Developer/personal/acquire-startups-m1
npx vitest run server/devSeed.test.ts -t 'fails closed'
```

Expected: FAIL — `expected 200 to be 404`. The route registers today because `undefined !== 'production'`.

- [ ] **Step 3: Invert the guard**

In `server/index.ts`, change the registration line:

```ts
  // Dev only, and absent rather than guarded — see `devSeed.ts`. Fail
  // closed: an unset NODE_ENV is not "probably dev", it is unknown, and the
  // route that installs arbitrary game state does not run on unknown.
  if (process.env.NODE_ENV === 'development') registerDevSeed(app, rooms);
```

- [ ] **Step 4: Make dev set NODE_ENV, or the guard turns the tool off**

In `package.json`, the `dev:server` script must now declare the environment it is:

```json
    "dev:server": "NODE_ENV=development SOCKET_PATH=/socket.io tsx watch server/index.ts",
```

- [ ] **Step 5: Run the whole dev-seed suite**

```bash
npx vitest run server/devSeed.test.ts
```

Expected: all pass, including the new case and the existing `does not exist at all in production`.

- [ ] **Step 6: Move the route under the base path**

At the root of a shared app, `/dev/rooms` is the one route in the system that ignores the prefixing discipline every other route follows. In `server/devSeed.ts`, import the base path and prefix the route:

```ts
import { BASE_PATH } from '../basePath.js';
```

```ts
  app.post(`${BASE_PATH}/dev/rooms`, express.json(), (req, res) => {
```

- [ ] **Step 7: Point the test helper at the prefixed route**

In `server/devSeed.test.ts`, add the import and update `seed`:

```ts
import { BASE_PATH } from '../basePath.js';
```

```ts
function seed(port: number, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}${BASE_PATH}/dev/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 8: Run the suite and the typecheck**

```bash
npx vitest run server/devSeed.test.ts && npm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add server/devSeed.ts server/devSeed.test.ts server/index.ts package.json
git commit -m "fix: the dev seed fails closed and lives under the base path

The guard was NODE_ENV !== 'production', which reads an unset NODE_ENV as
'probably dev' and registers a route that installs arbitrary game state.
Render sets NODE_ENV=production so nothing was exposed, but the protection
should come from the code rather than from a variable staying set.

Inverting it means dev has to say what it is: dev:server now sets
NODE_ENV=development, without which the guard would have quietly turned off
the tool in the one place it is meant to work.

Also moves the route under BASE_PATH. It was the only route in the system
sitting at the root, which stops being cosmetic when three games share one
Express app."
```

---

## ✅ DONE — Task 3: Acquire — remove unchecked index access in `engine/` source

The flag is **not** turned on until Task 6. Every fix below is valid TypeScript today, so `npm run typecheck` stays green after every commit and the work lands in reviewable batches instead of one 633-error wall.

Use this command throughout as the countdown — it enables the flag for the measurement only, changing no file:

```bash
cd ~/Developer/personal/acquire-startups-m1
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep -c "error TS"
```

Baseline measured 2026-08-19: **633 total** — 315 in `engine/`, 196 in `server/`, 120 in `src/`, 2 in `session/`; 520 of the 633 are in `.test.ts` files.

This task covers `engine/` **source only** (not `engine/**/*.test.ts`, which is Task 5).

**Files:**
- Modify: `~/Developer/personal/acquire-startups-m1/engine/*.ts` (source files reported below; `engine/gameLogic.ts` is the largest at 51)

**Interfaces:**
- Consumes: Task 1's CI.
- Produces: zero flag-errors in `engine/` source. No public signature changes.

- [x] **Step 1: List exactly what to fix**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 \
  | grep "^engine/" | grep -v "\.test\.ts" | tee /tmp/task3.txt | wc -l
```

Expected: a file:line list. Work top to bottom.

- [x] **Step 2: Fix each site, deciding which kind it is**

Two kinds, and telling them apart is the whole value of this task.

**Provably safe — assert.** The guard exists but TypeScript cannot connect it to the index. Real example from `engine/bonuses.ts`, where `holders.length === 0` returns early and `length === 1` is checked:

```ts
  if (holders.length === 1) {
    return [make(holders[0]!, majorityPot + minorityPot, 'both')];
  }
  const topShares = holders[0]!.shares;
```

Prefer destructuring where it reads better and needs no `!`:

```ts
  const [top] = holders;
  if (top === undefined) return [];
```

**Genuinely reachable — handle it.** If no guard upstream proves the element exists, the flag has found a real bug. Do not paper it with `!`. Add the guard, and if the situation is impossible-by-contract rather than impossible-by-check, throw with a message naming the invariant:

```ts
  const player = players[index];
  if (player === undefined) {
    throw new Error(`no player at seat ${index} of ${players.length}`);
  }
```

**Never** silence a site by widening a type or adding `as`. If a fix is not obviously one of the two shapes above, stop and leave that site for a human — note it in the commit body.

- [x] **Step 3: Confirm the countdown moved and nothing else broke**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep "^engine/" | grep -v "\.test\.ts" | wc -l
npm run typecheck && npm run test:run
```

Expected: first number `0`; typecheck green; suite green. The suite must be green **without the flag**, which is what proves these fixes are behaviour-preserving.

- [x] **Step 4: Commit**

```bash
git add engine/
git commit -m "refactor(engine): make indexed access explicit

Ahead of turning on noUncheckedIndexedAccess. Every change here is valid
without the flag, so typecheck and the suite stay green — the flag itself
flips in a later commit once the count is zero.

Most sites are guarded already and TypeScript simply cannot connect a
length check to an index; those take a non-null assertion or a destructure.
Any site where the element was genuinely reachable as undefined is now
guarded, and called out below if there were any."
```

---

## ✅ DONE — Task 4: Acquire — remove unchecked index access in `server/` and `src/` source

Same method as Task 3, different tree. Kept separate because a reviewer can meaningfully reject the engine work while approving this, and because `server/` is where a wrong `!` has the widest blast radius.

**Files:**
- Modify: `~/Developer/personal/acquire-startups-m1/server/*.ts` and `src/**/*.tsx?` (source files only)

**Interfaces:**
- Consumes: Task 3.
- Produces: zero flag-errors in `server/`, `src/`, `session/` source.

- [x] **Step 1: List the sites**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 \
  | grep -E "^(server|src|session)/" | grep -v "\.test\." | tee /tmp/task4.txt | wc -l
```

- [x] **Step 2: Fix each site using the two shapes from Task 3 Step 2**

Assert only where a guard already proves it; otherwise add the guard. In `server/`, prefer the explicit throw over `!` — a wrong assertion here takes down a process that will soon be hosting three games.

- [x] **Step 3: Verify**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep -E "^(server|src|session)/" | grep -v "\.test\." | wc -l
npm run typecheck && npm run test:run
```

Expected: `0`, then green, then green.

- [x] **Step 4: Commit**

```bash
git add server/ src/ session/
git commit -m "refactor(server,src): make indexed access explicit

Second of the pre-flag batches; same rules as the engine commit. In server/
a wrong non-null assertion crashes a process that is about to host three
games, so reachable sites get a throw naming the invariant rather than a !."
```

---

## ✅ DONE — Task 5: Acquire — remove unchecked index access in test files

520 of the 633 sites live in `.test.ts`. They are mechanical — a fixture index the test itself just built — and they are separated from Tasks 3 and 4 precisely so that the source review is not buried under them.

**Files:**
- Modify: all `~/Developer/personal/acquire-startups-m1/**/*.test.ts(x)` reported below. Heaviest: `engine/intents.test.ts` (140), `server/projectionOverWire.test.ts` (106), `engine/gameLogic.test.ts` (61).

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: zero flag-errors anywhere in the repo.

- [x] **Step 1: Confirm only test files remain**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep "error TS" | grep -vc "\.test\."
```

Expected: `0`. If not, finish Tasks 3 and 4 first.

- [x] **Step 2: Fix the test sites**

In a test, `!` is usually right: the test built the fixture two lines above and an out-of-range index should fail the test loudly anyway.

```ts
    expect(result.players[0]!.cash).toBe(6000);
```

Where the index is the actual subject of the assertion, assert existence first so a failure reads as a missing element rather than a null dereference:

```ts
    const [first] = result.players;
    expect(first, 'no player was seated').toBeDefined();
    expect(first!.cash).toBe(6000);
```

- [x] **Step 3: Verify the count is zero and the suite is green**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep -c "error TS"
npm run test:run
```

Expected: `0`, then green.

- [x] **Step 4: Commit**

```bash
git add .
git commit -m "test: make indexed access explicit

The last of the pre-flag batches, and the bulk of the count: 520 of the 633
sites were in tests, where the fixture two lines above is the proof and a !
is honest. Split out from the source commits so the source review was not
buried under them."
```

---

## ✅ DONE — Task 6: Acquire — turn on `noUncheckedIndexedAccess`

The count is already zero, so this commit is one line and cannot break anything. That is the point of doing it last.

**Files:**
- Modify: `~/Developer/personal/acquire-startups-m1/tsconfig.json`

**Interfaces:**
- Consumes: Tasks 3–5 (count must be zero).
- Produces: Acquire matching Rail Baron and Marco Polo, which both already have the flag.

- [x] **Step 1: Confirm zero before flipping**

```bash
npx tsc -p tsconfig.json --noEmit --noUncheckedIndexedAccess 2>&1 | grep -c "error TS"
```

Expected: `0`. If not, do not proceed.

- [x] **Step 2: Add the flag**

In `tsconfig.json`, beside `"strict": true`:

```json
    "strict": true,
    "noUncheckedIndexedAccess": true,
```

- [x] **Step 3: Verify the plain typecheck now enforces it**

```bash
npm run typecheck && npm run test:run
```

Expected: both green — and now `npm run typecheck` alone catches any regression, with no extra flag needed.

- [x] **Step 4: Commit**

```bash
git add tsconfig.json
git commit -m "build: turn on noUncheckedIndexedAccess

One line, zero errors, because the previous three commits did the work.
Brings Acquire in line with Rail Baron and Marco Polo, which both already
had it — Acquire was the only repo whose type system still claimed every
array index returns an element."
```

---

## Task 7: Acquire — make the dev base symmetric

`vite.config.ts` ends with `base: command === 'build' || isPreview ? BASE_PATH : "/"`. That single asymmetry is the sole cause of three separate workarounds, and Rail Baron's config states the contrast plainly: *"One key suffices because `base` is BASE_PATH in dev and build alike."*

**Do this task last of the Acquire tasks.** It touches `transformIndexHtml`, which carries a hard-won Vite 7 regression fix; doing it while the type refactor is in flight would make a bisect ambiguous.

**Files:**
- Modify: `~/Developer/personal/acquire-startups-m1/vite.config.ts` (base, the `__PWA_BASE__` substitution, the dev manifest rewrite, the socket proxy keys)
- Modify: `~/Developer/personal/acquire-startups-m1/package.json` (`dev:server`)
- Modify: `~/Developer/personal/acquire-startups-m1/server/devSeed.ts` (the returned `path`)
- Modify: `~/Developer/personal/acquire-startups-m1/server/devSeed.test.ts` (the asserted `path`)

**Interfaces:**
- Consumes: Task 2 (owns `devSeed.ts` and `dev:server`).
- Produces: dev and build serving at the same base, `SOCKET_PATH` no longer set in dev, one socket proxy key.

- [ ] **Step 1: Make the base unconditional**

```ts
  // One base, dev and build alike. The asymmetry this replaces was the sole
  // reason dev needed its own socket path, its own manifest rewrite and a
  // differently-substituted __PWA_BASE__ — see the deletions below.
  base: BASE_PATH,
```

- [ ] **Step 2: Collapse the socket proxy to one key**

The two-key proxy existed only because dev asked for `/socket.io` while build asked for `${BASE_PATH}/socket.io`. Replace both keys with:

```ts
    proxy: {
      [`${BASE_PATH}/socket.io`]: { target: 'http://localhost:4002', ws: true },
    },
```

- [ ] **Step 3: Stop overriding the socket path in dev**

In `package.json`, `dev:server` keeps the `NODE_ENV` from Task 2 and drops `SOCKET_PATH`, so the server uses its own prefixed default:

```json
    "dev:server": "NODE_ENV=development tsx watch server/index.ts",
```

- [ ] **Step 4: Simplify `__PWA_BASE__`, keeping `order: 'pre'`**

The substitution no longer varies by command. **Do not remove `order: "pre"`** — that fix is about the placeholder being unsubstituted when Vite's `devHtmlHook` runs, which is independent of the value.

```ts
            .replaceAll("__PWA_BASE__", `${BASE_PATH}/`),
```

- [ ] **Step 5: Delete the dev manifest rewrite**

The plugin branch that rewrites the manifest in dev exists because the generated manifest carried the prod `start_url`/`scope` while dev served at `/`. Dev now serves at `BASE_PATH`, so the generated manifest is correct as-is. Remove that branch and its comment.

- [ ] **Step 6: Prefix the dev seed's returned path**

`devSeed.ts` builds `path` from `room.id` and the seat `p`, and it worked only because dev served at `/`. It must now carry the base or every seeded link 404s. The existing comment there — *"Origin-free on purpose: the server does not know where the client is being served from"* — still holds: a base path is a path, not an origin, so leave that comment in place.

```ts
        path:
          `${BASE_PATH}/room/${room.id}?devSeat=${p.id}&devToken=${p.token}` +
          `&devName=${encodeURIComponent(p.name)}`,
```

Update the matching assertion in `devSeed.test.ts`:

```ts
      expect(player.path).toBe(
        `${BASE_PATH}/room/${body.roomId}?devSeat=${player.id}&devToken=${player.token}` +
          `&devName=${encodeURIComponent(player.name)}`,
      );
```

- [ ] **Step 7: Verify by hand — this is the task automated tests cover least**

```bash
npm run typecheck && npm run test:run
npm run dev:all
```

Then check all four, because each is one of the workarounds being removed:
1. `http://localhost:7932/acquire-startups-m1/` loads the app (not a 404 at `/`).
2. The browser console shows no `manifest.webmanifest` 404 and no protocol-relative URL — the `__PWA_BASE__` and `order: 'pre'` behaviour is intact.
3. Creating a room connects — the single-key proxy carries the socket to 4002.
4. `curl -s -X POST localhost:4002/acquire-startups-m1/dev/rooms -H 'content-type: application/json' -d '{"goldenId":"G2"}' | head -c 200` returns a body whose `path` starts with `/acquire-startups-m1/room/`, and opening that URL lands in the seeded room.

- [ ] **Step 8: Verify the production build is unchanged**

The Pages deploy must not move. `command === 'build'` already resolved to `BASE_PATH`, so this should be a no-op for the build:

```bash
npm run build && grep -o '"/acquire-startups-m1/[^"]*"' dist/index.html | head
```

Expected: asset URLs still under `/acquire-startups-m1/`, exactly as before.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts package.json server/devSeed.ts server/devSeed.test.ts
git commit -m "build: one base in dev and build alike

base was BASE_PATH for build and '/' for dev, and that single asymmetry was
paying for three workarounds: a two-key socket proxy, SOCKET_PATH=/socket.io
in dev:server, and a plugin branch rewriting the manifest because dev served
the app somewhere the generated start_url did not point.

All three delete. What stays is order: 'pre' on transformIndexHtml, which is
about the placeholder being unsubstituted when Vite's devHtmlHook runs and
has nothing to do with the base value.

The dev seed's returned path gains the prefix — it was relying on dev
serving at the root."
```

---

## Task 8: Rail Baron — split the server tsconfig to NodeNext

Rail Baron's server runs only because tsx patches Node's resolver to accept extensionless ESM imports. Plain `node` rejects them, which is what would block compiling `apps/host` later. Acquire and Marco Polo both already have this split; Rail Baron is the only repo typechecking its server under `bundler`.

**Scope warning — larger than the spec implied.** Measured 2026-08-19: `server/` has 42 extensionless relative imports, `session/` 1, and **`src/state/` 31** — because the server imports its game rules from client-land (`../src/state/events`, `game`, `legal`), so those files join the NodeNext program and need extensions too. `vendor/lobby`'s server and protocol files already use `.js`; its client files do not, and the server never imports them. Total ≈ 74 import statements, all mechanical, all bundler-compatible — `./foo.js` resolves fine under `bundler`, so the client keeps working unchanged.

**If the reviewer would rather not touch client source in Phase 0, defer this whole task to the migration plan.** Nothing else in Phase 0 depends on it, and compiling `apps/host` is itself marked "measure first" in the spec.

**Files:**
- Create: `~/Developer/personal/railbaron/tsconfig.server.json`
- Modify: `~/Developer/personal/railbaron/server/*.ts`, `session/protocol.ts`, `src/state/*.ts` (add `.js` to relative imports)
- Modify: `~/Developer/personal/railbaron/package.json` (`typecheck`)

**Interfaces:**
- Consumes: nothing (independent of every Acquire task).
- Produces: `npm run typecheck` checking the server under NodeNext.

- [ ] **Step 1: Create the server tsconfig, copying Acquire's pattern**

Create `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node", "vitest/globals"]
  },
  "include": ["server/**/*"]
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/Developer/personal/railbaron
npx tsc -p tsconfig.server.json --noEmit 2>&1 | grep -c "TS2835"
```

Expected: a non-zero count — `Relative import paths need explicit file extensions`. TypeScript reports only the first level, because it stops at each unresolved import; the count grows as you fix and re-run.

- [ ] **Step 3: Add `.js` to relative imports, re-running until zero**

Work the loop:

```bash
npx tsc -p tsconfig.server.json --noEmit 2>&1 | grep "TS2835" | sed 's|(.*||' | sort -u
```

For each file reported, add `.js` to every **relative** import specifier (leave bare package specifiers like `express` and `socket.io` alone). Example, `server/index.ts`:

```ts
import { BASE_PATH } from '../basePath.js';
import { createLobbyHandlers } from '../vendor/lobby/server/handlers.js';
import { attachGameHandlers } from './handlers.js';
import { createRooms, type GameRoom } from './rooms.js';
import { createFileStore } from './store.js';
```

Re-run after each file. The list will expand into `session/protocol.ts` and `src/state/*.ts` as resolution proceeds deeper — that is expected and is the 74-import scope noted above.

- [ ] **Step 4: Confirm both projects typecheck**

The client project must still pass, which is what proves `.js` specifiers are compatible with `bundler`:

```bash
npx tsc -p tsconfig.server.json --noEmit && npx tsc -p tsconfig.json --noEmit
```

Expected: both silent.

- [ ] **Step 5: Make `typecheck` cover both projects**

In `package.json`:

```json
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
```

- [ ] **Step 6: Prove the server actually still boots and serves**

The typecheck proves resolution on paper; this proves it in Node.

```bash
npm run typecheck && npm test
npm run serve
```

In another shell: `curl -s localhost:4001/railbaron/health` returns `{"ok":true,...}`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.server.json package.json server/ session/ src/state/
git commit -m "build: typecheck the server as Node actually resolves it

The server was checked under moduleResolution: bundler and ran only because
tsx patches Node's resolver to accept extensionless ESM imports. Plain node
rejects them, which blocks ever compiling this server rather than running it
through tsx.

Adds tsconfig.server.json on NodeNext, matching what Acquire and Marco Polo
already do, and the .js specifiers it requires. src/state is in the diff
because the server imports its game rules from there; the specifiers are
bundler-compatible, so the client project is unaffected.

typecheck now runs both projects — the split is worthless if only one is
checked."
```

---

## Done when

- [ ] Acquire CI is green on `main`.
- [ ] `npm run typecheck` in Acquire enforces `noUncheckedIndexedAccess` with no extra flag.
- [ ] Acquire's dev and build serve at the same base; `SOCKET_PATH` appears in no Acquire script.
- [ ] `POST ${BASE_PATH}/dev/rooms` is absent unless `NODE_ENV === 'development'`, and present when it is.
- [ ] Rail Baron's `npm run typecheck` runs both projects and both pass (or Task 8 is explicitly deferred to the migration plan).
- [ ] Marco Polo is untouched.
- [ ] The Acquire Pages deploy still serves from `/acquire-startups-m1/` — nothing in Phase 0 moves it.
