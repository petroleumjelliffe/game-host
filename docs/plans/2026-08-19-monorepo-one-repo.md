# One Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get all three games and the shared lobby into this repository as npm workspaces on one toolchain, with every existing test still passing and no deployment touched.

**Architecture:** Four `git subtree` merges bring each source repo in with its full history. The lobby stops being a git submodule and becomes a workspace package that all three games resolve by name. Then one version each of Vite, vitest, TypeScript and `@vitejs/plugin-react` replaces three. Nothing is composed into one process and nothing is deployed differently — that is the *next* plan. This one ends with one repo, one `npm install`, one test command, and three games that still work exactly as they did.

**Tech Stack:** npm workspaces (npm 11.19, Node 26.7), git subtree, TypeScript 5.9, Vite 8, vitest 4, `@vitejs/plugin-react` 6.

**Spec:** [`specs/2026-08-19-monorepo-single-host.md`](../../specs/2026-08-19-monorepo-single-host.md) — this plan implements migration-sequence steps 2–5 only.

**Status:** complete, merged to `main` at `3e06590` on 2026-08-19. Every "Done when" box below holds.

**Predecessor:** [`docs/plans/2026-08-19-phase-0-pre-migration-hardening.md`](2026-08-19-phase-0-pre-migration-hardening.md) — complete and merged. Do not start this plan until Acquire's `main` contains `027d237`.

**Successor:** [`docs/plans/2026-08-19-composition-one-process.md`](2026-08-19-composition-one-process.md) — spec steps 6–8, `mount()` and `apps/host`.

## Global Constraints

- **Nothing here changes a deployment.** Acquire's Render service and both GitHub Pages deploys must keep working off their own repos until the cutover plan. Do not delete a source repo, do not retire a workflow, do not touch `.env.production`.
- **Do not rename `BASE_PATH`.** Acquire's stays `/acquire-startups-m1`, Rail Baron's `/railbaron`, Marco Polo's `/marcopolo`. The rename is coupled to Pages retirement in the cutover plan.
- **Do not move `Caddyfile`, `launchd/`, `menu/`, `saves/`, or the `start-*.sh` scripts.** The spec's `infra/` layout is deferred to the cutover plan: the live game machine reaches these through `/opt/homebrew/etc/game-host` symlinks, and moving them breaks Caddy and all three services the moment that machine pulls. This plan only *adds* directories.
- **Do not compose anything into one process.** No `apps/host`, no `mount()`, no shared Express app. That is the next plan.
- **Every task ends green:** the repo installs, typechecks, and passes every game's full suite.
- **Baselines to preserve** — and the correction discovered in Task 3. All
  three games' pre-migration suites *collect the vendored lobby's own tests*
  through `vendor/lobby/**` globs in their vitest configs, so each game's
  pre-migration number double-counts the lobby's 31 tests / 5 files. Once the
  lobby is a package with a suite of its own (Task 2), each game's suite drops
  by exactly that much. Expected per-package counts after migration:

  | Package | Pre-migration | Own tests after | Files after |
  | --- | --- | --- | --- |
  | Marco Polo | 120 / 19 | **89** | **14** |
  | Rail Baron | 624 / 54 | **593** | **49** |
  | Acquire | 866 / 82 | **835** | **77** |
  | lobby | (never ran alone) | **31** | **5** |
  | repo total | — | **1548** | **145** |

  A game landing on its "own tests after" number is correct. A game landing on
  its pre-migration number means it is still collecting the lobby's tests and
  the `vendor/lobby/**` globs were not removed.
- **Node 26.7.0, npm 11.19.0.** Workspaces are npm-native; do not introduce pnpm, yarn, turbo, or nx.
- **A `tsx watch` reloads code but never its environment.** Any step that changes an environment variable or a script must say "restart your dev servers" — Phase 0 lost four days to exactly this.

## File Structure

```
game-host/                       # this repo, unchanged at root except:
  package.json                   # NEW — workspace root, private, no deps of its own
  tsconfig.base.json             # NEW — the one compiler baseline
  vitest.workspace.ts            # NEW — runs every package's suite
  .gitignore                     # MODIFIED — node_modules, dist
  packages/lobby/                # NEW — subtree of multiplayer-game-lobby
    package.json                 # NEW — name: @game-host/lobby
  games/marcopolo/               # NEW — subtree of marco-polo
  games/railbaron/               # NEW — subtree of railbaron
  games/acquire/                 # NEW — subtree of acquire-startups-m1
  Caddyfile, menu/, launchd/…    # UNTOUCHED — see Global Constraints
```

Directory names are short (`games/acquire`) while `BASE_PATH` values stay long (`/acquire-startups-m1`). Those are different things; only the URL is deployment-coupled.

---

## Task 1: Workspace root

This repo has no `package.json` at all today — it is Caddy config and shell scripts. This task makes it an npm workspace root without adding any package yet, and records the test baselines every later task is measured against.

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore` (modify — it currently contains only `node-bin`)

**Interfaces:**
- Consumes: nothing.
- Produces: workspace globs `packages/*` and `games/*`; `tsconfig.base.json` for every package to extend.

- [ ] **Step 1: Record the three baselines — you cannot detect a regression without them**

```bash
cd ~/Developer/personal/railbaron && npm test 2>&1 | grep -E "Test Files|Tests "
cd ~/Developer/personal/marco-polo && npm test 2>&1 | grep -E "Test Files|Tests "
cd ~/Developer/personal/acquire-startups-m1 && npm run test:run 2>&1 | grep -E "Test Files|Tests "
```

Acquire must report 866 tests / 82 files. Write all three numbers into the commit message in Step 6 — later tasks compare against them.

- [ ] **Step 2: Create the workspace root**

`package.json` at the repo root:

```json
{
  "name": "game-host",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "games/*"
  ],
  "engines": {
    "node": ">=24"
  }
}
```

No dependencies here yet — Task 6 hoists the shared toolchain into this file.

- [ ] **Step 3: Create the compiler baseline**

`tsconfig.base.json`. These are the settings all three games already agree on, plus `noUncheckedIndexedAccess`, which all three now have (Phase 0 brought Acquire up):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Deliberately absent: `module`, `moduleResolution`, `lib`, `jsx`, `types`. Those differ legitimately between a Vite-bundled client (`bundler`, DOM libs, `react-jsx`) and a Node-executed server (`nodenext`, node types). Each package sets its own.

- [ ] **Step 4: Extend `.gitignore`**

It currently contains only `node-bin`. Append:

```gitignore
node_modules
dist
```

- [ ] **Step 5: Verify npm accepts the workspace root**

```bash
cd ~/Developer/personal/game-host
npm install
npm query .workspace
```

Expected: `npm install` succeeds and creates a lockfile; `npm query .workspace` returns `[]` (no workspaces exist yet — the globs match nothing, which is not an error).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json .gitignore package-lock.json
git commit -m "build: make this repo an npm workspace root

No packages yet — the games arrive by subtree merge in the next commits.
This is only the root that will hold them, plus the one compiler baseline
they will all extend.

tsconfig.base.json carries what all three games already agree on. module,
moduleResolution, lib, jsx and types stay out of it on purpose: a
Vite-bundled client and a Node-executed server disagree about those for
good reasons, and a shared base that forces them to agree would be a base
nobody could extend.

Baselines to hold through the migration: <RB counts>, <MP counts>,
Acquire 866 tests / 82 files."
```

---

## Task 2: The lobby becomes a workspace package

This is the task the other three depend on, and the one with a real unknown: the lobby is **raw TypeScript with no build step**, so a workspace package must expose `.ts` files to four different consumers — Vite, vitest, tsx, and tsc — two of which (Acquire's and Marco Polo's servers) use `nodenext` resolution and write `.js` in their specifiers.

**Resolve the unknown before converting any game.** Step 4 proves resolution four ways against one real import. If the primary approach fails, the fallback is in Step 5.

**Files:**
- Create: `packages/lobby/**` (by subtree merge), `packages/lobby/package.json`
- Modify: `tsconfig.base.json` (add `paths`)

**Interfaces:**
- Consumes: Task 1's workspace root and `tsconfig.base.json`.
- Produces: the specifier `@game-host/lobby/<subpath>` resolving to `packages/lobby/<subpath>.ts`, in **both** the bare form (`@game-host/lobby/client/view`) and the `.js` form (`@game-host/lobby/server/rooms.js`). Both shapes exist in the games today and both must work — normalising them would touch 50 files for no benefit.

- [ ] **Step 1: Subtree-merge the lobby with its history**

The repo has no local clone; subtree fetches it directly.

```bash
cd ~/Developer/personal/game-host
git subtree add --prefix=packages/lobby \
  https://github.com/petroleumjelliffe/multiplayer-game-lobby.git main
```

Expected: a merge commit plus the lobby's own history. Verify history survived:

```bash
git log --oneline -- packages/lobby | tail -3
```

Expected: the lobby's original commits (e.g. `17da30d`, `401a9a3`) appear.

- [ ] **Step 2: Give it a package identity**

`packages/lobby/package.json`:

```json
{
  "name": "@game-host/lobby",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*.js": "./*.ts",
    "./*": "./*.ts"
  }
}
```

Both patterns are required: `./*.js` serves the `nodenext` consumers that write `.js`, and `./*` serves the `bundler` consumers that do not. Order matters — the more specific pattern is listed first.

- [ ] **Step 3: Add the path mapping tsc needs**

`exports` covers runtime resolution; `paths` covers `tsc`, which will not follow an `exports` target into a `.ts` file. Add to `tsconfig.base.json`'s `compilerOptions`:

```json
    "baseUrl": ".",
    "paths": {
      "@game-host/lobby/*.js": ["./packages/lobby/*.ts"],
      "@game-host/lobby/*": ["./packages/lobby/*.ts"]
    }
```

- [ ] **Step 4: Give the lobby a tsconfig, so the next step has something to typecheck against**

`packages/lobby/tsconfig.json`. The lobby is consumed by both bundler clients and nodenext servers, but its own files are plain ESM, so `bundler` is the right lens for checking it in isolation:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"]
  },
  "include": ["."]
}
```

- [ ] **Step 5: Prove resolution four ways before touching any game**

This is the step that de-risks Tasks 3–5. Create a scratch file `packages/lobby/resolution-check.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// Both specifier shapes the games actually use, side by side.
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol.js';
import { createIdentityStore } from '@game-host/lobby/client/identity';

describe('the lobby resolves as a workspace package', () => {
  it('resolves the .js specifier shape used by nodenext servers', () => {
    expect(LOBBY_SERVER_EVENTS).toBeDefined();
  });

  it('resolves the bare specifier shape used by bundler clients', () => {
    expect(typeof createIdentityStore('probe').rememberedName).toBe('function');
  });
});
```

Run it, and run tsc over it:

```bash
cd ~/Developer/personal/game-host
npm install                       # links the workspace into node_modules
npx vitest run packages/lobby/resolution-check.test.ts
npx tsc --noEmit -p packages/lobby
```

Expected: both tests pass and tsc is silent.

- [ ] **Step 6: If Step 5 failed — the fallback**

If `exports` mapping to `.ts` is rejected by any consumer, delete the `exports` block from `packages/lobby/package.json` and rely on `paths` plus an explicit Vite alias, which each game's `vite.config.ts` will carry (Tasks 3–5 add it):

```ts
  resolve: {
    alias: { '@game-host/lobby': fileURLToPath(new URL('../../packages/lobby', import.meta.url)) },
  },
```

Record in the commit message which route was taken — Tasks 3–5 must use the same one.

- [ ] **Step 7: Give the lobby its own test script**

Its tests have only ever run by being pulled into a consumer's vitest run. `packages/lobby/package.json` gains:

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 8: Run the lobby's own suite for the first time in its life**

```bash
npm test --workspace @game-host/lobby
```

Expected: its four test files (`client/identity.test.ts`, `client/view.test.ts`, `protocol/importBoundary.test.ts`, `server/rooms.test.ts`, `server/genericConsumer.test.ts`) run and pass. Record the count.

- [ ] **Step 9: Delete the scratch file and commit**

```bash
rm packages/lobby/resolution-check.test.ts
git add packages/lobby tsconfig.base.json package-lock.json
git commit -m "build: the lobby becomes a workspace package, not a submodule

It arrives with its full history via git subtree, and for the first time it
has a toolchain of its own: until now its tests ran only by being pulled
into a consumer's vitest run, which meant the shared code three games
depend on had no suite it could fail on its own.

The awkward part is that it is raw TypeScript with no build step, so the
package has to hand .ts files to four consumers that disagree about
specifiers — nodenext servers write .js, bundler clients do not. Both
shapes are mapped, in exports for runtime and in paths for tsc, because
normalising 50 files' imports to one shape would be churn with nothing at
the end of it.

Resolution proven four ways before any game was touched: <record which
route Step 5/6 took>."
```

---

## Task 3: Marco Polo joins the repo

Smallest game (2.3k LOC), so it proves the whole pattern — subtree merge, drop the submodule, rewire imports — at the lowest cost. Tasks 4 and 5 repeat it.

**Files:**
- Create: `games/marcopolo/**` (by subtree merge)
- Delete: `games/marcopolo/.gitmodules`, the `vendor/lobby` gitlink
- Modify: every file importing `vendor/lobby` (Marco Polo's share of the 50), `games/marcopolo/package.json`, `games/marcopolo/tsconfig.json`, `games/marcopolo/client/tsconfig.json`

**Interfaces:**
- Consumes: `@game-host/lobby/*` from Task 2.
- Produces: `games/marcopolo` as workspace `@game-host/marcopolo`, tests green.

- [ ] **Step 1: Subtree-merge with history**

```bash
cd ~/Developer/personal/game-host
git subtree add --prefix=games/marcopolo ~/Developer/personal/marco-polo main
git log --oneline -- games/marcopolo | tail -3
```

Expected: Marco Polo's own commits appear.

- [ ] **Step 2: Remove the submodule, which is now a broken gitlink**

The subtree brought a `vendor/lobby` gitlink and a `.gitmodules` that cannot work from a subdirectory.

```bash
cd ~/Developer/personal/game-host
git rm --cached games/marcopolo/vendor/lobby
rm -rf games/marcopolo/vendor
git rm -f games/marcopolo/.gitmodules
```

- [ ] **Step 3: Rewrite the imports**

The specifiers use varying `../` depth (`../vendor/lobby` from `server/`, `../../../vendor/lobby` from `client/src/net/`). One expression handles every depth and preserves both `.js` and bare shapes:

```bash
cd ~/Developer/personal/game-host/games/marcopolo
grep -rl "vendor/lobby" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' -E "s|(\.\./)+vendor/lobby|@game-host/lobby|g"
grep -rn "vendor/lobby" --include="*.ts" --include="*.tsx" . || echo "no vendor/lobby references remain"
```

- [ ] **Step 4: Declare the dependency and the package name**

In `games/marcopolo/package.json`, set the name and add the lobby:

```json
  "name": "@game-host/marcopolo",
```

```json
  "dependencies": {
    "@game-host/lobby": "*",
```

(Keep every existing dependency; this adds one line.)

- [ ] **Step 5: Point both tsconfigs at the shared base**

`games/marcopolo/tsconfig.json` — keep its `nodenext` server settings, inherit the rest:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2022"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["protocol", "server"]
}
```

`games/marcopolo/client/tsconfig.json` — keep its `bundler` client settings:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "../protocol"]
}
```

Note both `include` lists lost their `vendor/lobby` entries — that code now arrives through the package, not the include path.

- [ ] **Step 6: Install and run the suite**

```bash
cd ~/Developer/personal/game-host
npm install
npm test --workspace @game-host/marcopolo
npm run typecheck --workspace @game-host/marcopolo
```

Expected: **89 tests / 14 files**. That is 31 tests / 5 files below Marco Polo's pre-migration 120/19, and the difference is exactly the vendored lobby's suite, which now runs under `@game-host/lobby` instead of being collected here. Delete the `vendor/lobby/{protocol,server,client}` globs from `vitest.config.ts` — do not repoint them at `packages/lobby`, or the lobby's tests run three times over. Any *other* shortfall is a real regression: investigate it.

- [ ] **Step 7: Commit**

```bash
git add -A games/marcopolo package-lock.json
git commit -m "build: Marco Polo joins the monorepo, off the submodule

Subtree merge with full history, then the vendor/lobby gitlink goes and
every import of it becomes @game-host/lobby. The specifiers kept whatever
shape they had — nodenext files keep their .js, bundler files stay bare —
because the package maps both and rewriting them would be churn.

Smallest game first on purpose: it proves the merge-and-rewire pattern the
other two repeat, at 2.3k lines instead of 25k.

Tests: <count> — unchanged from the pre-migration baseline."
```

---

## Task 4: Rail Baron joins the repo

Same pattern as Task 3. Rail Baron is 15.5k LOC and has one extra wrinkle: **its `tsconfig.json` is a single project covering client and server**, and its server imports game rules from `src/state/`. This plan does **not** split it — the deferred NodeNext split (Phase 0's Task 8) belongs to the composition plan, where that boundary is being looked at anyway.

**Files:**
- Create: `games/railbaron/**` (by subtree merge)
- Delete: `games/railbaron/.gitmodules`, the `vendor/lobby` gitlink
- Modify: Rail Baron's lobby-importing files, `games/railbaron/package.json`, `games/railbaron/tsconfig.json`

**Interfaces:**
- Consumes: `@game-host/lobby/*` from Task 2.
- Produces: `games/railbaron` as workspace `@game-host/railbaron`, tests green.

- [ ] **Step 1: Subtree-merge with history**

```bash
cd ~/Developer/personal/game-host
git subtree add --prefix=games/railbaron ~/Developer/personal/railbaron main
git log --oneline -- games/railbaron | tail -3
```

- [ ] **Step 2: Remove the submodule**

```bash
git rm --cached games/railbaron/vendor/lobby
rm -rf games/railbaron/vendor
git rm -f games/railbaron/.gitmodules
```

- [ ] **Step 3: Rewrite the imports**

```bash
cd ~/Developer/personal/game-host/games/railbaron
grep -rl "vendor/lobby" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' -E "s|(\.\./)+vendor/lobby|@game-host/lobby|g"
grep -rn "vendor/lobby" --include="*.ts" --include="*.tsx" . || echo "no vendor/lobby references remain"
```

- [ ] **Step 4: Delete the submodule guard script, which now guards nothing**

`games/railbaron/package.json` has a `build:server` script whose only job is to fail loudly when `vendor/lobby` is an empty submodule directory. There is no submodule any more; a workspace dependency that fails to resolve fails at install. Remove that script entirely, and set the package name and dependency:

```json
  "name": "@game-host/railbaron",
```

```json
  "dependencies": {
    "@game-host/lobby": "*",
```

- [ ] **Step 5: Point the tsconfig at the shared base**

`games/railbaron/tsconfig.json` — one project, `bundler`, client and server together, exactly as today:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["engine", "session", "server", "src", "vite.config.ts", "basePath.ts"]
}
```

`noUncheckedIndexedAccess` now comes from the base — do not restate it here.

- [ ] **Step 6: Install and run the suite**

```bash
cd ~/Developer/personal/game-host
npm install
npm test --workspace @game-host/railbaron
npm run typecheck --workspace @game-host/railbaron
```

Expected: **593 tests / 49 files** — 31/5 below the pre-migration 624/54, that difference being the vendored lobby's suite, which now runs under `@game-host/lobby`. Delete the `vendor/lobby/**` test globs from `vite.config.ts` (they are in its vitest `projects` blocks); do not repoint them. Any other shortfall is a real regression.

- [ ] **Step 7: Commit**

```bash
git add -A games/railbaron package-lock.json
git commit -m "build: Rail Baron joins the monorepo, off the submodule

Same pattern as Marco Polo. The build:server script goes with the
submodule — it existed only to catch an unfetched vendor/lobby and turn a
green build that dies at boot into a loud failure. A workspace dependency
that does not resolve fails at install instead, which is the same guarantee
without the script.

Its single client+server tsconfig is left alone deliberately. Splitting the
server onto nodenext reaches into src/state, because the server imports its
game rules from there, and that boundary belongs to the plan that composes
these servers rather than this one.

Tests: <count> — unchanged from baseline."
```

---

## Task 5: Acquire joins the repo

Largest game (25.7k LOC), most configuration, and the only one with a live deployment reading from its own repo — which is why the Global Constraints forbid touching anything that deployment uses.

**Files:**
- Create: `games/acquire/**` (by subtree merge)
- Delete: `games/acquire/.gitmodules`, the `vendor/lobby` gitlink
- Modify: Acquire's lobby-importing files, `games/acquire/package.json`, `games/acquire/tsconfig.json`, `games/acquire/tsconfig.server.json`

**Interfaces:**
- Consumes: `@game-host/lobby/*` from Task 2.
- Produces: `games/acquire` as workspace `@game-host/acquire`, 866 tests green.

- [ ] **Step 1: Confirm the predecessor merged, then subtree-merge**

```bash
git -C ~/Developer/personal/acquire-startups-m1 log --oneline main -1
```

Expected: `027d237` or later. If Phase 0 is not on `main`, stop — you would import the pre-hardening code.

```bash
cd ~/Developer/personal/game-host
git subtree add --prefix=games/acquire ~/Developer/personal/acquire-startups-m1 main
git log --oneline -- games/acquire | tail -3
```

- [ ] **Step 2: Remove the submodule**

```bash
git rm --cached games/acquire/vendor/lobby
rm -rf games/acquire/vendor
git rm -f games/acquire/.gitmodules
```

- [ ] **Step 3: Rewrite the imports**

```bash
cd ~/Developer/personal/game-host/games/acquire
grep -rl "vendor/lobby" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' -E "s|(\.\./)+vendor/lobby|@game-host/lobby|g"
grep -rn "vendor/lobby" --include="*.ts" --include="*.tsx" . || echo "no vendor/lobby references remain"
```

- [ ] **Step 4: Delete the submodule guard, set name and dependency**

Acquire has the same `build:server` submodule guard as Rail Baron. Remove it. Then:

```json
  "name": "@game-host/acquire",
```

```json
  "dependencies": {
    "@game-host/lobby": "*",
```

**Keep** `gh-pages`, `.env.production` and the `deploy` script — the Pages deploy is still live and is retired by the cutover plan, not this one.

- [ ] **Step 5: Point both tsconfigs at the shared base**

`games/acquire/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["engine", "session", "src", "server", "vite.config.ts"]
}
```

`games/acquire/tsconfig.server.json` — keep the NodeNext override that already exists:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist/server",
    "rootDir": "./",
    "noEmit": false,
    "types": ["node"]
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist", "src"]
}
```

Both lost their `vendor/lobby` include entries.

- [ ] **Step 6: Install and run everything Acquire has**

```bash
cd ~/Developer/personal/game-host
npm install
npm run test:run --workspace @game-host/acquire
npm run typecheck --workspace @game-host/acquire
npm run build --workspace @game-host/acquire
```

Expected: **835 tests / 77 files**, typecheck silent, build succeeds. That is 31/5 below the pre-migration 866/82 — the vendored lobby's suite, which now runs under `@game-host/lobby`. Delete the `vendor/lobby/**` test globs from `vite.config.ts`; do not repoint them. Then confirm the build output still targets the live Pages path:

```bash
grep -o '"/acquire-startups-m1/[^"]*"' games/acquire/dist/index.html | head -3
```

Expected: single-prefixed `/acquire-startups-m1/...` paths — identical to what Pages serves today.

- [ ] **Step 7: Commit**

```bash
git add -A games/acquire package-lock.json
git commit -m "build: Acquire joins the monorepo, off the submodule

The last and largest of the three, and the only one with a live deployment
reading from its own repo — so gh-pages, .env.production and the deploy
script all stay exactly as they are. Retiring them is the cutover plan's
job, and doing it here would break a running deployment for no gain.

Its tsconfig.server.json NodeNext override survives untouched: it is the
split the other two are being brought toward, not something to flatten.

835 tests / 77 files — the pre-migration 866/82 less the lobby's own suite,
which now runs under its own package instead of being collected here. Build
output still resolves under
/acquire-startups-m1/, verified against what Pages serves."
```

---

## Task 6: One toolchain

Three copies of Vite, vitest and `@vitejs/plugin-react` become one. This is the task most likely to surface real breakage, because Marco Polo jumps Vite 6→8 and vitest 3→4, and Acquire jumps Vite 7→8.

**Files:**
- Modify: root `package.json` (gains the shared devDependencies), all three `games/*/package.json`, `packages/lobby/package.json`

**Interfaces:**
- Consumes: Tasks 3–5 (all three games installed and green).
- Produces: exactly one version of each shared tool, resolvable from the root.

- [ ] **Step 1: Record where each package stands before you move anything**

```bash
cd ~/Developer/personal/game-host
npm ls vite vitest @vitejs/plugin-react typescript --workspaces 2>&1 | grep -E "vite@|vitest@|plugin-react@|typescript@"
```

Expected spread: Vite 8/7/6, vitest 4/4/3, plugin-react 6/5/4, TypeScript 5.9/5.2/5.9.

- [ ] **Step 2: Hoist the shared toolchain to the root**

Add to the root `package.json`. These are the highest versions currently in use, so Rail Baron moves least and Marco Polo most:

```json
  "devDependencies": {
    "@types/node": "^26.2.0",
    "@vitejs/plugin-react": "^6.0.5",
    "jsdom": "^30.0.1",
    "typescript": "^5.9.3",
    "vite": "^8.2.1",
    "vitest": "^4.1.10"
  }
```

- [ ] **Step 3: Remove those six from every package**

Delete `@types/node`, `@vitejs/plugin-react`, `jsdom`, `typescript`, `vite` and `vitest` from the `devDependencies` of `games/marcopolo/package.json`, `games/railbaron/package.json` and `games/acquire/package.json`. Leave everything else alone — Acquire keeps tailwind/postcss/autoprefixer/gh-pages, Rail Baron keeps d3-geo/topojson/us-atlas, Marco Polo keeps qrcode. Those are genuinely per-game.

- [ ] **Step 4: Reinstall and see what broke**

```bash
rm -rf node_modules games/*/node_modules packages/*/node_modules
npm install
npm ls vite vitest @vitejs/plugin-react typescript --workspaces 2>&1 | grep -E "vite@|vitest@|plugin-react@"
```

Expected: one version of each.

- [ ] **Step 5: Run all three suites and fix the fallout**

```bash
npm test --workspace @game-host/marcopolo
npm test --workspace @game-host/railbaron
npm run test:run --workspace @game-host/acquire
npm test --workspace @game-host/lobby
```

Expect failures here — that is what this task is for. Two known-likely sources:

- **Marco Polo's vitest 3→4 jump.** Its `vitest.config.ts` is a separate file with a `jsdom` setup (`vitest.jsdom.setup.ts`); vitest 4 changed how root-level setup files merge into projects. Rail Baron's `vite.config.ts` carries a comment about exactly this ("No setupFiles here, deliberately: vitest 4 merges a root-level setup") — read it before debugging Marco Polo's.
- **Vite 6/7→8 config changes** in `defineConfig` options.

Fix each failure at its cause. Do **not** pin a package back to an older version to make a suite pass — that defeats the task. If a genuine incompatibility makes unification impossible for one tool, stop and report it rather than working around it silently.

- [ ] **Step 6: Remove the `as any` that only existed because versions differed**

`games/railbaron/vite.config.ts` line ~79 reads `plugins: [react(), pagesFallback()] as any`. Task 4 added it because Vite 8 (Rail Baron) and Vite 6 (Marco Polo) were both installed under npm hoisting, giving two nominally different `Plugin`/`PluginOption` types. Unifying to one Vite makes those types identical again and the cast becomes dead weight hiding real errors.

Delete the cast and its explanatory comment, then confirm the typecheck still passes:

```bash
npm run typecheck --workspace @game-host/railbaron
```

Expected: silent. If it is not, the versions have not actually unified — check `npm ls vite --workspaces` before reaching for the cast again.

- [ ] **Step 7: Confirm counts against the baselines**

All four suites green at their post-migration counts: Marco Polo 89/14, Rail Baron 593/49, Acquire 835/77, lobby 31/5. A drop below those means files stopped being collected.

- [ ] **Step 8: Commit**

```bash
git add package.json games/*/package.json packages/lobby/package.json games/railbaron/vite.config.ts package-lock.json
git commit -m "build: one Vite, one vitest, one TypeScript

Three toolchains become one, at the highest version already in use — so
Rail Baron barely moves and Marco Polo jumps Vite 6 to 8 and vitest 3 to 4.
Per-game dependencies stay per-game: Acquire's tailwind, Rail Baron's
d3-geo and us-atlas, Marco Polo's qrcode are not shared and are not hoisted.

<Record here what broke in the jump and how it was fixed — that is the
part of this commit worth reading later.>

All four suites green at their pre-migration counts."
```

---

## Task 7: One command runs everything

The repo works package-by-package but has no top-level entry point, and its docs still describe three separate repos.

**Files:**
- Create: `vitest.workspace.ts`, `.github/workflows/ci.yml`
- Modify: root `package.json` (scripts), `CLAUDE.md`, `README.md`, `PORTS.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `npm test` and `npm run typecheck` at the root covering every package; CI gating the monorepo.

- [ ] **Step 1: Add the vitest workspace**

`vitest.workspace.ts`:

```ts
// Every package's own vitest config, run as one suite. Each game keeps its
// own environment and setup — Acquire and Rail Baron need jsdom for React,
// Marco Polo's server tests are node — so this file lists projects rather
// than imposing one configuration on all of them.
export default [
  'packages/lobby',
  'games/marcopolo',
  'games/railbaron',
  'games/acquire',
];
```

- [ ] **Step 2: Add root scripts**

In the root `package.json`:

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
```

- [ ] **Step 3: Verify one command runs every suite**

```bash
cd ~/Developer/personal/game-host
npm test
npm run typecheck
```

Expected: every package's tests run in one invocation, totalling **1548 tests across 145 files**. Record it.

- [ ] **Step 4: Add CI**

`.github/workflows/ci.yml`:

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
      # No `submodules: recursive` — the lobby is a workspace package now,
      # which is the point of the change that removed it.
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 5: Update the three docs that now describe a repo that does not exist**

- `CLAUDE.md`: the "What this repo is" section says no game code lives here and names three sibling repos. That is now false. Rewrite it to describe the monorepo: workspaces, where each game lives, `npm test` at the root, and the fact that the composition into one process has **not** happened yet.
- `README.md`: its setup section assumes a config-only repo. Add the `npm install` / `npm test` entry point above the Caddy setup, and note that the start scripts and Caddyfile still run the games as three separate processes until the composition plan lands.
- `PORTS.md`: unchanged in content — the three server ports and three dev-client ports are all still real, because nothing is composed yet. Add one line saying the registry collapses when the composition plan lands, so a reader is not surprised.

- [ ] **Step 6: Commit**

```bash
git add vitest.workspace.ts package.json .github/workflows/ci.yml CLAUDE.md README.md PORTS.md
git commit -m "build: one npm test for the whole repo, and docs that match it

vitest.workspace.ts lists projects rather than imposing one config: Acquire
and Rail Baron need jsdom for React, Marco Polo's server tests are node, and
flattening that would break suites to no purpose.

CI drops submodules: recursive — there is no submodule left, which was the
point.

The docs described a config-only repo with three siblings, which stopped
being true four commits ago. PORTS.md keeps all six numbers: nothing is
composed yet, so every port is still real. It says so, and says when that
changes."
```

---

## Deliberately not in this plan

- **A linter/formatter.** The spec's step 5 pairs it with toolchain
  unification, and there is still none in any repo — which is why quote
  style and operator placement differ between them. It is left out here on
  the same reasoning that shaped Phase 0: running a formatter across 45k
  lines would touch nearly every file, and a migration diff that is *also* a
  whole-repo reformat is one nobody can review and nothing can bisect. Land
  it as its own commit once the repo is one repo, before the composition
  plan starts moving server code.
- **Rail Baron's NodeNext server split** (deferred from Phase 0's Task 8).
  It reaches into `src/state/`, because Rail Baron's server imports its game
  rules from client-land. That boundary is the composition plan's business.
- **A root workflow for Rail Baron's GitHub Pages deploy.** Rail Baron's
  `deploy.yml` came across with the subtree merge but was inert here — GitHub
  reads workflows only from the repo root — so it was deleted along with
  Acquire's nested `ci.yml` rather than left looking live. Its Pages deploy
  still runs from Rail Baron's own repo and is unaffected. The spec's cutover
  step owes a root workflow with a path filter to replace it; deleting the
  stale copy makes that debt visible instead of appearing already solved. The
  original is in this repo's history and in the source repo.
- **Anything the spec's steps 6–11 cover** — `mount()`, `apps/host`, the
  composition tests, both cutovers, the `/acquire` rename, archiving the
  source repos.

## Done when

- [ ] `npm install` at the root links four workspaces; `npm test` runs all four suites in one command.
- [ ] Every package hits its post-migration count: Marco Polo 89/14, Rail Baron 593/49, Acquire 835/77, lobby 31/5 — 1548 tests across 145 files in total, which is the pre-migration sum with the lobby counted once instead of three times.
- [ ] The lobby has its own suite that runs without a consumer.
- [ ] `grep -rn "vendor/lobby" games/` returns nothing; no `.gitmodules` anywhere.
- [ ] History is present and blame follows lines to their original commits. **Verified in Task 3, and the property is narrower than first written:** `git subtree add` grafts every original commit onto this repo (107 commits after two merges), and `git blame` on a merged file attributes lines to their original authorship — 88 of 90 lines of `games/marcopolo/server/game.ts` blame to "feat: match state — rounds, scoring, marco rotation, lobby lifecycle", with only the two rewritten import lines belonging to the migration commit. What does **not** work is `git log --follow -- <new path>`: historical commits record the file at its old path (`server/game.ts`, not `games/marcopolo/server/game.ts`), so a path-limited log on the new path shows only the migration commit. For file archaeology use `git log --all --full-history -- <old path>`. Task 7 records this in `CLAUDE.md`.
- [ ] Exactly one version each of Vite, vitest, `@vitejs/plugin-react` and TypeScript.
- [ ] Acquire's build still emits `/acquire-startups-m1/` paths; `gh-pages`, `.env.production` and the deploy script are all still present.
- [ ] `Caddyfile`, `menu/`, `launchd/`, `saves/` and the `start-*.sh` scripts are untouched.
- [ ] No `apps/host`, no `mount()`, nothing composed — that is the next plan.
