# npm audit Module Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear all 23 npm audit vulnerabilities (3 critical, 14 high, 5 moderate, 1 low) without regressing the app, the suite, or the deploy pipeline.

**Architecture:** Two batches. Batch one is every fix npm can apply inside existing semver ranges (`npm audit fix`) plus deleting the unused `nodemon`, which carries two of the vulnerable nested packages. Batch two is the one genuinely breaking upgrade: Vite 4 → 7.3.6 with `@vitejs/plugin-react` 4 → 5.2.0, which clears the `esbuild` dev-server advisory. Each batch is its own commit, gated by the full suite, typecheck, build, `check:bundle`, and `verify:layout`; the branch ends with a by-hand browser pass and a verified deploy.

**Tech Stack:** npm, Vite 7, Vitest 4.1, existing project gates (`npm run typecheck`, `npm run check:bundle`, `npm run verify:layout`).

## Global Constraints

- Never run bare `tsc` — always `npm run typecheck` (CLAUDE.md).
- Vite stays on **7.3.6**, not 8 — Vite 8 is the rolldown bundler swap, a much bigger change than the audit requires. 7.3.6 is outside every vulnerable range (`<=6.4.2 || 7.0.0 - 7.3.3`).
- `@vitejs/plugin-react` goes to **5.2.0** (peers `vite ^4.2.0 || … || ^8.0.0`), not 6.x (6.x peers on `vite ^8.0.0` only).
- Node is v26.4.0 locally; Vite 7 needs `^20.19.0 || >=22.12.0` — fine. **Check the GH Pages build machine / any CI uses Node ≥ 20.19 too** before merging.
- Before any by-hand pass, confirm which tree is serving (Vite silently moves off port 5173 — see CLAUDE.md Commands).
- Pushing to `main` auto-deploys the Render server (~40s). Verify a deploy actually fired via `mcp__render__list_deploys` (trigger `new_commit`), never by polling `/health` alone.
- Work on a branch; merge to `main` only after the whole-branch review (Working rules: review the whole branch at the end).

## Background: what the audit contains

From `npm audit` on 2026-08-09, 23 vulnerabilities in three groups:

1. **Server runtime deps** (run in production on Render): `body-parser`, `qs`, `path-to-regexp` (under `express ^5.1.0`); `engine.io`, `engine.io-client`, `socket.io-parser`, `socket.io-adapter`, `ws` (under `socket.io`/`socket.io-client ^4.8.1`). All patchable in-range.
2. **Client runtime dep**: `react-router` / `react-router-dom` (14 advisories, mostly SSR/open-redirect; fix is ≥7.17.1, in-range for `^7.9.4`).
3. **Dev/build tooling**: `vitest` 4.0.x (critical, fixed in 4.1.x, in-range for `^4.0.14`), `@babel/core`, `postcss`, `nanoid`, `rollup`, `glob`, `minimatch`, `brace-expansion`, `picomatch`, `shell-quote` (via `concurrently`) — all in-range — and **`esbuild <=0.24.2` via `vite ^4.5.0`, the only fix that requires a major bump**.

`nodemon` is a devDependency nothing references (dev uses `tsx watch`); its nested `brace-expansion` and `minimatch` copies are two of the flagged paths.

---

### Task 1: In-range fixes (`npm audit fix`) + drop nodemon

**Files:**
- Modify: `package.json` (remove `nodemon`; npm may bump some ranges)
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a lockfile where the only remaining audit finding is the `esbuild`/`vite` chain. Task 2 starts from this state.

- [ ] **Step 1: Record the baseline**

```bash
npm audit 2>&1 | tail -5
```

Expected: `23 vulnerabilities (1 low, 5 moderate, 14 high, 3 critical)`.

- [ ] **Step 2: Remove nodemon**

```bash
npm rm nodemon
```

Expected: `package.json` devDependencies no longer lists `nodemon`. (Verified unused on 2026-08-09: only `package.json`/lockfile mention it; `dev:server` is `tsx watch`.)

- [ ] **Step 3: Apply the in-range fixes**

```bash
npm audit fix
```

Expected: on the order of 60+ changed packages, no `--force` prompt taken, `package.json` ranges for direct deps unchanged except possibly patch-level floor bumps.

- [ ] **Step 4: Confirm only the vite/esbuild chain remains**

```bash
npm audit 2>&1 | tail -8
```

Expected: only `esbuild`/`vite` (and `vitest`'s nested `vite`, if npm still lists it) remain, all marked "fix available via `npm audit fix --force`… vite@8". If anything else remains, stop and read why before proceeding — do not reach for `--force`.

- [ ] **Step 5: Run the full gate set**

```bash
npx vitest run && npm run typecheck && npm run check:bundle && npm run verify:layout
```

Expected: all 664+ tests pass; typecheck clean; `check:bundle` finds no vitest/golden strings in `dist/`; `verify:layout` green (treat as ordinary evidence — the flake was the gate's own rounding, fixed 2026-08-08). Note `check:bundle` runs `vite build` itself.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): apply in-range npm audit fixes, drop unused nodemon"
```

---

### Task 2: Vite 4 → 7.3.6, @vitejs/plugin-react 4 → 5.2.0

**Files:**
- Modify: `package.json`, `package-lock.json`
- Possibly modify: `vite.config.ts` (only if the build surfaces a removed-option error — see Step 2)

**Interfaces:**
- Consumes: Task 1's lockfile (audit shows only the vite chain).
- Produces: `npm audit` reporting **0 vulnerabilities**; `dist/` output that `check:bundle`, `scripts/sw.template.js` precache generation, and `scripts/generate-manifest.ts` still work against.

- [ ] **Step 1: Install the pinned pair**

```bash
npm install -D vite@7.3.6 @vitejs/plugin-react@5.2.0
```

Expected: installs clean with no peer warnings (`vitest@4.1.x` peers `vite ^6 || ^7 || ^8`; plugin-react 5.2.0 peers through ^8).

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: both clean. Known 4→7 hazards, none of which should bite here but check the error if one appears: the CJS Node API is gone (this repo is `"type": "module"` — fine); `import.meta.env.DEV` guards unchanged; default browser targets moved to Baseline (fine for this app). The config imports `basePath.ts` and registers the theme-color plugin — confirm the build log still shows the manifest prebuild and the emitted `dist/assets/*` layout looks the same shape (hashed files under `dist/assets/`), since `sw` precache and `check:bundle` grep that tree.

- [ ] **Step 3: Full gate set**

```bash
npx vitest run && npm run check:bundle && npm run verify:layout
```

Expected: all green. `verify:layout` matters most here — it drives a real Chrome against the *new* Vite dev pipeline.

- [ ] **Step 4: Confirm audit is clean**

```bash
npm audit
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore(deps): vite 7.3.6 + plugin-react 5.2.0, clears esbuild advisory"
```

(Only add `vite.config.ts` if Step 2 actually changed it.)

---

### Task 3: By-hand pass, whole-branch review, deploy verification

By-hand passes are what find bugs here (CLAUDE.md) — a dependency branch is not exempt: socket.io, express, and react-router all moved.

**Files:** none (verification only).

**Interfaces:**
- Consumes: the two commits above.
- Produces: a merged `main`, a verified Render deploy, a verified GH Pages deploy.

- [ ] **Step 1: By-hand smoke, both transports**

```bash
npm run dev:all
```

Then in a real browser (confirm the port is *this* tree's — check the vite startup line, not just 5173):
1. Pass-and-play: start a game, place a tile, refresh, confirm the Continue card resumes it (`localStorage` save path).
2. Online: create a room in two browser windows, join by code, run the turn-order draw through the winner announcement, place one tile each, refresh one window mid-turn and confirm it resumes to the open draft (this exercises the upgraded socket.io stack + react-router routes end to end).

Expected: no console errors, both flows behave exactly as before.

- [ ] **Step 2: Whole-branch review**

Read the full branch diff (`git diff main...HEAD`) in one sitting — both of Phase 4's worst bugs spanned tasks and survived per-task review. For a deps branch the diff is mostly lockfile; the parts to actually read are `package.json` and any `vite.config.ts` change.

- [ ] **Step 3: Merge and verify the server deploy**

```bash
git checkout main && git merge --no-ff <branch> && git push
```

Then via Render MCP: `mcp__render__list_deploys` for `srv-d3klnhnfte5s73diht90` — expect a deploy with `trigger: "new_commit"` within seconds, live ~40s after push. Then `curl` the prod `/health`: expect `protocolVersion: 3` and a healthy response. Watch the boot log for `✓ Restored N room(s)` — the disk-backed rooms must survive this deploy like any other.

- [ ] **Step 4: Deploy and verify GH Pages**

```bash
npm run build && npm run deploy
```

Then load the GH Pages URL and read the bundle hash back from the network panel before believing it (the Pages CDN served a stale file for ~90s once). Confirm the app boots and can reach the prod server from the deployed client.

- [ ] **Step 5: Confirm the audit stays clean on main**

```bash
npm audit
```

Expected: `found 0 vulnerabilities`.

---

## Deliberately out of scope

- **Vite 8 / plugin-react 6**: the rolldown-based bundler swap. Nothing in the audit requires it; take it as its own change when there's a reason.
- **React 19, Tailwind 4, or any other major not named by the audit**: `npm outdated` is a different task.
- **The PWA update path on a real install**: still owed per CLAUDE.md, but owed regardless of this branch. Note only: this branch's GH Pages deploy will produce a new `sw.js` cache hash like any deploy; no special handling needed since zero installs exist.
