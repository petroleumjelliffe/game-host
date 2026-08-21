# The Linter Implementation Plan — insurance, not a rescue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** implemented 2026-08-20, same day — three commits, both tasks. See
**As built** at the end for the four places the design was wrong, three of
them in the ledger it was proudest of.

**Goal:** add one type-aware ESLint gate at the repo root, green from the day
it lands, so that the next unawaited promise or misplaced hook cannot reach
either deployment — and add no formatter, because the measurement says a
formatter would cost 256 files to enforce a convention this tree already
follows.

**Architecture:** one `eslint.config.mjs` at the root, one `npm run lint`, one
CI job. `typescript-eslint`'s `projectService` resolves each of the seven
workspaces' own `tsconfig.json` automatically, so a single invocation covers
all 386 files in ~5s without any per-workspace fan-out. Five rules, all
errors, each chosen because it is true here — not a preset.

**Tech Stack:** `eslint@^10.8.1`, `typescript-eslint@^8.67.0` (type-aware, via
`projectService`), `eslint-plugin-react-hooks@^7.1.1`. All three are root
`devDependencies`; none reaches the bundle.

**Spec:** none separate. This document is the design record, in the manner of
[the room store](2026-08-20-room-store.md). The measurements it argues from
are reproduced below so nobody has to take them on trust.

---

## Why there is no formatter in this plan

The linter was deferred four times — Phase 0, the monorepo, the composition,
the cutover — always for the same stated reason: *a whole-repo reformat
mid-plan ruins the diff and the bisect.* That reason was about the
**formatter**, and it was correct. It was also, by 2026-08-20, protecting
something that had already happened on its own.

**The tree is already uniform.** Across 386 `.ts`/`.tsx` files: 1,540
single-quoted imports against 38 double, semicolons throughout, 2-space
indent everywhere, not one tab. Four repositories converged on one style
before they were ever merged.

**A formatter would therefore spend churn to buy nothing.** Prettier 3.9.6
configured as closely to the existing style as it goes (`singleQuote`,
`printWidth: 100`) rewrites **256 of 386 files, +7,077 / −3,357** — a net
expansion of ~3,700 lines. Prettier's own defaults are worse: 384 of 386.

**And in three places it would make the code worse.** The expansion is not
uniform; it concentrates where the current layout carries meaning:

| File | Churn | What the formatter does |
| --- | --- | --- |
| [`games/railbaron/engine/payouts.ts`](../../games/railbaron/engine/payouts.ts) | +208/−44 | The triangular payout table is one row per line. Rows under 100 columns stay; longer rows get folded into wrapped blocks. The result is a data table formatted two different ways down its own length — worse than either choice made consistently. |
| [`games/railbaron/engine/golden/games.ts`](../../games/railbaron/engine/golden/games.ts) | +301/−143 | The same, to golden fixtures. |
| [`games/railbaron/engine/cities.ts`](../../games/railbaron/engine/cities.ts) | +104/−17 | The same, to a data table. |

`// prettier-ignore` rescues each one, but that is a list somebody maintains
forever, and every entry on it is the tool being wrong about this code.

**What replaces it:** an `.editorconfig`. Indent, end-of-line, final newline,
trailing whitespace — the mechanical drift that actually happens, honoured by
every editor, at zero churn. It is Task 2.

## What the linter actually finds, stated honestly

**No bugs.** This is the part to carry into any future argument about the
value of this gate, because it is easy to misremember.

A first pass with the promise rules reported 35 findings and they looked, by
rule name, like the failure class this repo has genuinely shipped — an
unawaited store write is exactly what [the room store
plan](2026-08-20-room-store.md) was written to fix. Reading all 35 source
lines dissolved every one of them:

- **29 are `navigate(...)`** from react-router 7, whose `NavigateFunction` is
  typed `void | Promise<void>` on purpose, because navigation in a data router
  is asynchronous. Nobody awaits a route change; not awaiting it is the
  documented usage.
- **6 are `io.close()` / `socket.join()`**, which return `Promise<void>` in
  socket.io 4.8.3 and are being called callback-style. They work.

That includes `io.close(() => { process.exit(0); })` in Acquire's SIGTERM
handler, which was singled out as the best find in the repo and is not a find
at all — the callback fires and the exit is orderly.

**So the case for this gate is prospective and only prospective.** Five
seconds of CI to make sure the *next* unawaited `store.save()`, or the next
hook called under a condition, cannot land. That is a fair trade at this
price. It is not a rescue, and the commit message should not pretend it is.

**Three real, small things did fall out:**

1. Two `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in
   [`usePlayback.ts`](../../games/railbaron/src/map/usePlayback.ts) and
   [`useRoute.ts`](../../games/railbaron/src/map/useRoute.ts), survivors of
   Rail Baron's own repo, referring to a rule this monorepo does not have.
   Today they suppress nothing, and ESLint errors on them outright
   (`Definition for rule ... was not found`). Installing the plugin makes them
   mean what they say again.
2. Two further `exhaustive-deps` findings with no suppression, in
   [`DiceReadout.tsx`](../../games/railbaron/src/board/DiceReadout.tsx) and
   [`usePlayback.ts`](../../games/railbaron/src/map/usePlayback.ts). Both are
   the deliberate change-token pattern — a `key` in the dependency array
   standing in for the derived data it is computed from — so the fix is a
   documented suppression, **not** a dependency-array edit. Editing those
   arrays would change when animations restart.
3. Marco Polo's [`vite.config.ts`](../../games/marcopolo/vite.config.ts) and
   [`vitest.config.ts`](../../games/marcopolo/vitest.config.ts) belong to no
   `tsconfig.json` — Rail Baron and Acquire both list `vite.config.ts` in
   their `include`, Marco Polo lists neither. They are therefore not
   typechecked. This plan works around it (Task 1, step 2) rather than fixing
   it, because adding them to the `include` surfaces two pre-existing type
   errors in `vitest.config.ts` (`name` sits at the project level; Vitest 4
   wants it under `test`), and that is a separate change with its own risk.
   Task 2 records it in the backlog instead.

**One thing that looked like a find and is not:** `document.execCommand` in
[`LobbyPanel.tsx:59`](../../games/marcopolo/client/src/screens/LobbyPanel.tsx#L59)
is flagged as deprecated by `no-deprecated`. It is the last-resort clipboard
path for a page served over plain HTTP on a LAN — which is this project's
usual home — and the code already carries the comment explaining that both
modern paths are gated on a secure context. It is correct as written. Do not
"fix" it, and `no-deprecated` is not enabled (see *Deliberately not in this
plan*).

## Why five rules and not a preset

`tseslint.configs.strictTypeChecked` over this repo reports **~1,500
findings**, 911 of them `no-non-null-assertion`. A second candidate,
`oxlint`'s default set, reports 146 — of which **95 are one false positive**,
`unicorn/no-thenable` firing on the `then:` property of every given/when/then
golden fixture ([`endgame.ts:30`](../../games/acquire/engine/golden/endgame.ts#L30)).

A gate that cries wolf 95 times is a gate people learn to skip, and this one
has to survive being read by whoever picks the repo up next. Five rules that
are all true is a better starting position than forty that are mostly noise.
Rules get added when something bites, and the plan says so rather than
implying the list is finished.

`@typescript-eslint/no-unnecessary-condition` deserves its own note, because
it is the near-miss. It reports 38 findings and every one is *true* —
[`tsconfig.base.json`](../../tsconfig.base.json) already sets
`noUncheckedIndexedAccess`, and `Coord` is a finite template-literal union
([`gameHelpers.ts:19`](../../games/acquire/engine/gameHelpers.ts#L19)), so
`Record<Coord, TileCell>` really does have every key and those `cell?.placed`
guards really are redundant. True, and worth nobody's commit. Left off.

## Why the gate lands in one commit and not two

The obvious split — promise rules first, React hooks rules second — cannot be
made to work, and the reason is worth recording because it will look like an
arbitrary choice later.

Those two inherited `eslint-disable` comments name `react-hooks/exhaustive-deps`.
ESLint raises an **error** on a disable directive naming a rule it does not
know, and a rule is only known once its plugin is *registered in the config* —
installing the package is not enough. So a first commit that configured only
the promise rules would land with two errors it did not cause and could not
fix without either deleting comments it has no opinion about or registering
the plugin anyway.

Task 1 therefore lands the whole config green in one commit. It is a larger
task than it looks like it should be, and this is why.

## Global Constraints

- **Root devDependencies only.** `eslint`, `typescript-eslint` and
  `eslint-plugin-react-hooks` go in the root `package.json`'s
  `devDependencies`. The compiled bundle's external surface is `cors`,
  `express`, `socket.io` and node builtins, and nothing here may widen it.
- **One invocation, not seven.** `projectService` finds each workspace's own
  `tsconfig.json`. Do not mirror `typecheck`'s `--workspaces` fan-out; it is
  slower and buys nothing. Verified: one root `eslint .` covers apps/host 12
  files, games/acquire 181, games/marcopolo 52, games/railbaron 115,
  packages/host 5, packages/lobby 18, packages/room-store 3 — 386 in ~5s.
- **`npm run lint` must exit 0 when this plan is done.** A gate that lands
  red is a gate that gets `|| true`'d within a week.
- **Lint gates CI, not the deploy.** `deploy.sh` runs `npm run build`; do not
  add lint to it. A type error must fail a deploy (it already does, via
  `build`'s typecheck); a lint error should fail a pull request. Deploys stay
  as fast as [the compile plan](2026-08-20-compile-the-host.md) made them.
- **Every suppression carries its reason on the line above it.** This repo
  comments its load-bearing lines; a bare `// eslint-disable-next-line` is a
  load-bearing line with its reason deleted.
- **`npm test` must still report 1658 tests / 160 files passing** after each
  task. No task here is allowed to change behaviour.

---

## Task 1: The whole gate, green

Config, dependencies, and every finding resolved, in one commit. Nothing in
this task changes what any code does — the eight `void` operators are
annotations on calls that already behave exactly this way, and the hook
suppressions are comments.

**Files:**

- Create: `eslint.config.mjs`
- Modify: `package.json` (root — `devDependencies`, `scripts.lint`)
- Modify: `games/acquire/server/index.ts:499`
- Modify: `games/acquire/server/socketHarness.ts:52`
- Modify: `games/acquire/server/clientOverWire.test.ts:387`
- Modify: `games/acquire/server/devSeed.test.ts:58`
- Modify: `games/acquire/server/recovery.test.ts:74`
- Modify: `games/acquire/server/staticClient.test.ts:15`
- Modify: `packages/host/guard.test.ts:49,159`
- Modify: `games/railbaron/src/board/DiceReadout.tsx:142`
- Modify: `games/railbaron/src/map/usePlayback.ts:48,54`

**Interfaces:**

- Produces: a root script `npm run lint` (`eslint .`) exiting 0. Task 2 calls
  that script from CI and documents it.

- [x] **Step 1: Install the three devDependencies at the root**

```bash
npm install -D eslint@^10.8.1 typescript-eslint@^8.67.0 eslint-plugin-react-hooks@^7.1.1
```

Verify they landed in the **root** `package.json` under `devDependencies` and
that no workspace `package.json` changed. `typescript-eslint@8` is compatible
with `eslint@10` and with this repo's `typescript@^6.0.3`; that combination
was run against all 386 files before this plan was written.

- [x] **Step 2: Write `eslint.config.mjs`**

Create it at the repo root, exactly as below. The comments are part of the
deliverable — every non-obvious line here was a measurement, and the next
person to open this file needs the measurement, not the conclusion.

```js
// One ESLint invocation covers all seven workspaces: typescript-eslint's
// `projectService` resolves each file to its own package's tsconfig.json, so
// there is no --workspaces fan-out here and there should not be one. 386
// files, type-aware, in about five seconds.
//
// Five rules, all errors, each one measured against this repo rather than
// inherited from a preset. `strictTypeChecked` reports ~1,500 findings here
// (911 of them no-non-null-assertion) and oxlint's defaults report 146, of
// which 95 are one false positive on the `then:` key of our golden fixtures.
// A gate nobody trusts is a gate nobody runs. See
// docs/plans/2026-08-20-the-linter.md for the full ledger.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Built output, coverage, and Acquire's static design prototype — the
    // last is hand-written demo HTML/JS that was never part of the app.
    ignores: ['**/dist/**', '**/coverage/**', 'games/acquire/prototype/**'],
  },
  {
    // Type-aware rules need types, so this block is TypeScript only. The
    // .mjs build and tooling scripts are deliberately unlinted: they would
    // need a default project, and they are not where the risk is.
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Marco Polo's two config files belong to no tsconfig — Rail Baron
          // and Acquire both list vite.config.ts in their `include` and Marco
          // Polo lists neither, so they are not typechecked either. Adding
          // them to the include surfaces two pre-existing type errors in
          // vitest.config.ts and is its own change; see docs/backlog.md.
          allowDefaultProject: ['games/marcopolo/*.config.ts'],
        },
      },
    },
    linterOptions: {
      // The reverse of the problem this repo already had: two disable
      // comments outlived the plugin they named and silently suppressed
      // nothing for months. A stale suppression is a lie in the source.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // The rule this gate exists for: the next unawaited store write.
      //
      // react-router 7 types NavigateFunction as `void | Promise<void>`
      // because navigation in a data router is async, so every navigate()
      // call in all three clients reads as a floating promise — 29 of them,
      // none a defect. Naming the type here keeps the rule sharp for the
      // calls that matter instead of training everyone to ignore it.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'react-router', name: 'NavigateFunction' },
          ],
        },
      ],
      // `checksVoidReturn.attributes` off: an async onClick is ordinary React
      // and flagging it says nothing useful. The other checksVoidReturn
      // cases — an async function passed where void is required — stay on.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Cheap, and catches `await` on a value that was never a promise —
      // usually a signature that changed underneath the caller.
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    // The three clients are all React. rules-of-hooks reports nothing today
    // and is pure insurance; exhaustive-deps found four things, all of them
    // this codebase's deliberate change-token pattern — a `key` in the array
    // standing in for the derived data it was computed from. Kept as an
    // error rather than a warning so each one has to say so out loud: a
    // warning tier here would just be a list nobody reads.
    files: ['**/*.tsx', '**/src/**/*.ts', '**/client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
```

- [x] **Step 3: Add the root script**

In the root `package.json`, alongside `typecheck`:

```json
"lint": "eslint ."
```

- [x] **Step 4: Run it and confirm it fails in exactly the expected way**

Run: `npm run lint`

Expected: **10 errors and nothing else** —

- 8 × `@typescript-eslint/no-floating-promises`, in the eight socket.io
  locations listed under Files;
- 2 × `react-hooks/exhaustive-deps`, at
  [`DiceReadout.tsx:142`](../../games/railbaron/src/board/DiceReadout.tsx#L142)
  (missing `whiteKey`) and
  [`usePlayback.ts:54`](../../games/railbaron/src/map/usePlayback.ts#L54)
  (missing `path`).

`rules-of-hooks` must report nothing, and there must be no parsing errors —
if Marco Polo's two config files appear, `allowDefaultProject` is wrong. If
the count or the shape differs, stop and reconcile before touching source:
this plan's ledger is wrong, and that difference matters more than the fix.

- [x] **Step 5: Mark the eight socket.io calls as deliberate**

All eight are the same library fact: `Server.close(fn?)` and `Socket.join()`
return `Promise<void>` in socket.io 4.8.3, and every one of these call sites
uses the callback (or does not need to wait at all) while awaiting the
**HTTP** server's close instead. `void` is the operator that says "this
promise is intentionally dropped."

In [`games/acquire/server/index.ts`](../../games/acquire/server/index.ts), the
shutdown path gets a comment because it is the one place where "not waiting"
is a decision rather than a formality:

```ts
  let closing = false;
  const stop = (): void => {
    if (closing) process.exit(1);
    closing = true;
    // Deliberately not awaited: the callback is what exits, and socket.io's
    // close() returning a promise is a 4.x signature detail, not a wait we
    // owe anyone. Persists are already awaited inside the handlers above.
    void io.close(() => { process.exit(0); });
  };
```

The other seven take the bare operator — the config comment above explains
the whole class, and repeating it seven times would be noise:

```ts
// games/acquire/server/socketHarness.ts:52  (inside close: () => new Promise(...))
        void io.close();

// games/acquire/server/clientOverWire.test.ts:387
      void prefixed.io.close();

// games/acquire/server/devSeed.test.ts:58
        void io.close();

// games/acquire/server/recovery.test.ts:74
      void handle.io.close();

// games/acquire/server/staticClient.test.ts:15
  void handle?.io.close();

// packages/host/guard.test.ts:49
    void io.close(() => resolve());

// packages/host/guard.test.ts:159
    void server.join('a-room');
```

- [x] **Step 6: Suppress the two hook findings, with reasons**

**Do not edit the dependency arrays.** Both are the change-token pattern: a
`key` that changes exactly when the derived data changes, deliberately used
so the effect restarts on a new roll or a new route rather than on every
recomputation. Adding the "missing" dependency would restart these animations
at the wrong moments.

In [`games/railbaron/src/board/DiceReadout.tsx`](../../games/railbaron/src/board/DiceReadout.tsx),
above the dependency array at line 142:

```ts
    // `key` changes exactly when a new roll arrives, which is the only time
    // this should restart; `whiteKey` is derived from the same roll, so
    // listing it would restart the drums mid-spin on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, roll]);
```

In [`games/railbaron/src/map/usePlayback.ts`](../../games/railbaron/src/map/usePlayback.ts),
above the `skip` callback's dependency array at line 54:

```ts
  const skip = useCallback(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    setAt(path === null ? 0 : Math.max(0, path.length - 1));
    // `key` changes whenever `path` does — it is the token this hook uses to
    // mean "a new path" — so depending on both would hand every caller a new
    // `skip` identity on each render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
```

- [x] **Step 7: Give the inherited suppression that lacks a reason its own**

Of the two inherited suppressions, [`useRoute.ts:71`](../../games/railbaron/src/map/useRoute.ts#L71)
already carries its reason — *"`key` is the whole dependency: seat and roll
are rebuilt every render, and depending on them would reset the draft on
every tap."* Leave it exactly as it is.

The one in [`usePlayback.ts:48`](../../games/railbaron/src/map/usePlayback.ts#L48)
does not. Its effect reads `path.length` but depends on `[key, stepMs]`:

```ts
    return () => {
      if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    };
    // `key` changes whenever `path` does, so it stands in for it here.
    // Depending on `path` directly would clear and restart the interval on
    // every render that rebuilt the array, and playback would never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stepMs]);
```

- [x] **Step 8: Confirm the gate is green**

Run: `npm run lint`
Expected: no output, exit 0.

- [x] **Step 9: Confirm nothing changed behaviour**

Run: `npm test`

Expected: 1658 tests / 160 files, all passing. `void` cannot change a call's
behaviour and a comment cannot either, so a failure here means a dependency
array was edited when it should have been suppressed. Rail Baron's map and
board suites are the ones that would notice — if `MapView.test.tsx` or the
board tests fail, revert and re-read steps 6 and 7.

Run: `npm run typecheck`
Expected: clean.

- [x] **Step 10: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json \
  games/acquire/server/index.ts games/acquire/server/socketHarness.ts \
  games/acquire/server/clientOverWire.test.ts games/acquire/server/devSeed.test.ts \
  games/acquire/server/recovery.test.ts games/acquire/server/staticClient.test.ts \
  packages/host/guard.test.ts games/railbaron/src/board/DiceReadout.tsx \
  games/railbaron/src/map/usePlayback.ts
git commit -m "feat: one type-aware lint gate, green on the day it lands

Five rules, all errors, each measured against this repo instead of
inherited: no-floating-promises (with react-router's NavigateFunction
named, or 29 ordinary navigate() calls would read as defects),
no-misused-promises without the attributes check, await-thenable, and
the two React hooks rules. One root invocation covers all seven
workspaces in ~5s because projectService resolves each package's own
tsconfig.

It finds no defects, and the plan says so plainly rather than dressing
up what it does find. Eight of the ten are one library fact — socket.io
4.8.3 returns Promise<void> from close() and join(), and every call
site here uses the callback while awaiting the HTTP server instead.
They take a void operator; the shutdown path takes a comment too.

The other two are Rail Baron's change-token pattern, where a `key`
stands in for the data it was derived from. Editing those arrays would
restart animations at the wrong moment, so they are suppressed with
their reasons instead — as are the two inherited suppressions that
have named a plugin this monorepo never had since the subtree merge,
suppressing nothing and erroring outright.

No formatter, deliberately: the tree is already uniform (1,540 single
-quoted imports to 38) and Prettier would rewrite 256 of 386 files to
say so, folding Rail Baron's payout table into two different shapes
down its own length. See docs/plans/2026-08-20-the-linter.md."
```

---

## Task 2: The gate in CI, the `.editorconfig`, and the map

**Files:**

- Create: `.editorconfig`
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (Testing section)
- Modify: `README.md` (the commands list)
- Modify: `docs/backlog.md` (close the four-times-deferred item; record the
  Marco Polo tsconfig gap)

**Interfaces:**

- Consumes: `npm run lint` from Task 1.

- [x] **Step 1: `.editorconfig`**

The formatter's replacement, and the whole of it:

```ini
# The repo has no formatter, deliberately — see
# docs/plans/2026-08-20-the-linter.md, which measured what one would cost
# (256 of 386 files, and Rail Baron's payout table folded into two shapes).
# This is the part worth having anyway: the mechanical drift that actually
# happens, settled by the editor before it reaches a diff.
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
# Markdown gives trailing spaces a meaning, so leave them alone here.
trim_trailing_whitespace = false
```

- [x] **Step 2: Add a `lint` job to CI — a separate job, not a fourth step**

In [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), alongside the
existing `check` job:

```yaml
  # A job of its own rather than a step inside `check`, for the same reason
  # scripts/test-all.mjs refuses to `&&` its packages together: steps stop at
  # the first failure, so a lint error would hide whatever the build and the
  # 1658 tests were about to say. Two independent answers beat one that
  # short-circuits. It costs a second npm ci, which is cached.
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      # No build first: unlike the tests, lint needs types, not artifacts.
      - run: npm run lint
```

- [x] **Step 3: Verify the workflow parses**

```bash
npx --yes js-yaml .github/workflows/ci.yml | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Object.keys(JSON.parse(d).jobs).sort()))"
```

Expected: `[ 'check', 'lint' ]`. A malformed workflow fails silently by not
running, so parsing it here is the difference between a gate and the belief
in one. (`python3 -c "import yaml"` is the obvious alternative and does not
work — macOS ships python3 without PyYAML.)

- [x] **Step 4: `CLAUDE.md` — the Testing section**

Add `npm run lint` to the command block alongside `npm test` and
`npm run typecheck`, and add a short paragraph after the `test-all.mjs`
explanation. It should say: one root invocation covers all seven workspaces
because `projectService` resolves each package's own tsconfig; there is no
formatter and that was measured, not overlooked; the five rules are
deliberately few; and it gates CI rather than the deploy. Link the plan.

- [x] **Step 5: `README.md`**

One line in the commands list: `npm run lint` — what it covers, and that it
is a pull-request gate rather than part of `build` or `deploy.sh`.

- [x] **Step 6: `docs/backlog.md`**

Three edits:

1. In *State of play*, strike the linter from the open list and move it to
   the done list, with the honest one-line summary: added 2026-08-20; found
   no defects; kept as insurance; no formatter, and why.
2. In the header paragraph, the "deferred from the cutover" list — the
   linter's entry becomes the fourth strikethrough of five, leaving only
   CORS.
3. Add a new small item: **Marco Polo's build configs are not typechecked.**
   `vite.config.ts` and `vitest.config.ts` are in no `tsconfig.json`; adding
   them to `include` reveals two pre-existing errors in `vitest.config.ts`
   where `name` sits at the project level rather than under `test` (Vitest 4
   moved it). Rail Baron and Acquire both include their `vite.config.ts`
   already, so Marco Polo is the odd one out.

- [x] **Step 7: Full verification before the commit**

```bash
npm run lint        # exit 0, no output
npm run typecheck   # clean
npm test            # 1658 tests / 160 files
npm run build       # typechecks, then all three clients and the bundle
```

All four must pass. `build` is included because Task 2 is the last chance to
notice that a devDependency changed something the bundle sees.

- [x] **Step 8: Commit**

```bash
git add .editorconfig .github/workflows/ci.yml CLAUDE.md README.md docs/backlog.md
git commit -m "ci: the linter gates pull requests, and the map says why there is no formatter

A job of its own rather than a step in \`check\` — steps stop at the
first failure and a lint error would hide the build and the 1658
tests, which is the same reasoning test-all.mjs uses to refuse an &&
chain between packages.

.editorconfig is what stands in for the formatter this repo measured
and declined: end-of-line, final newline, trailing whitespace, two
spaces. The drift that actually happens, settled before it reaches a
diff, at none of the 256-file cost.

Backlog closes the item that was deferred four times, and opens a
small one it uncovered: Marco Polo's vite and vitest configs belong to
no tsconfig, so they are the only build configs in the repo that are
not typechecked."
```

---

## Deliberately not in this plan

- **A formatter.** Measured and declined; the reasoning is at the top of this
  document and in `.editorconfig`'s comment, which is where somebody will
  actually meet the question. If it is ever revisited, the number to beat is
  256 files and +3,700 lines, and the file to look at first is
  `payouts.ts`.
- **`no-unnecessary-condition`.** 38 findings, all true, none worth a commit.
- **`no-deprecated`.** 9 findings: 8 are one deliberately-deprecated Acquire
  engine function exercised by its own tests, and the ninth is Marco Polo's
  `execCommand` clipboard fallback, which is correct — a LAN page on plain
  HTTP has no secure context and no `navigator.clipboard`. Enabling the rule
  would buy nine suppressions and no information.
- **`strictTypeChecked`, or any preset.** ~1,500 findings, 911 of them
  `no-non-null-assertion`. The `no-unsafe-*` family (41 findings) is the part
  with real signal in it and is worth a look on its own someday, under its
  own plan, with someone's whole attention.
- **Linting `.mjs`.** `scripts/test-all.mjs`, the games' generator scripts and
  their neighbours would each need a default project to get type-aware rules,
  and none of them is where the risk lives.
- **Marco Polo's untyped build configs.** Worked around in Task 1, recorded
  in Task 2, fixed by whoever wants to also fix the two Vitest 4 type errors
  behind them.
- **Tightening CORS**, which remains the backlog's first open item and is
  entirely unrelated to this one.

## Done when

- [x] `npm run lint` exits 0 with no output, from the repo root, covering all
      386 TypeScript files in all seven workspaces in one invocation.
- [x] CI has a `lint` job that runs independently of `check`, so neither can
      hide the other's answer.
- [x] `npm test` still reports 1658 tests / 160 files, and `npm run build`
      still succeeds — this plan changed no behaviour anywhere.
- [x] Every `eslint-disable` comment in the repo names a rule that exists and
      carries its reason on the line above it. There are four, all in Rail
      Baron.
- [x] `deploy.sh` and `npm run build` are untouched: a lint error fails a pull
      request and never a deploy.
- [x] `.editorconfig` exists and says why it is standing in for a formatter.
- [x] `docs/backlog.md` records the linter as done — with the finding that it
      found nothing, which is the part that will otherwise be misremembered —
      and CORS is the only remaining cutover deferral.

---

## As built

Both tasks ran the same day. The gate is green, `npm test` still reports 1658
tests / 160 files, and `npm run build` still succeeds. Four deltas from the
design, and it is worth noticing that three of them are in the **ledger** —
the part of this plan that was supposed to be the reliable half.

**1. Twelve findings, not ten — and the two extra were in the plan's own
evidence.** Task 1 step 4 predicted 8 floating promises and 2
`exhaustive-deps`. The real count was 8 and **4**: the pair at
[`PassAndPlayPage.tsx:35–36`](../../games/acquire/src/pages/PassAndPlayPage.tsx#L35)
had appeared in the probe output all along and were miscounted as the two
already suppressed by the inherited comments. They never appear, because they
are suppressed. Two different pairs, read as one.

The finding itself is a pleasing symmetry the design did not anticipate:
Acquire runs the change-token pattern **inverted**. Rail Baron puts a `key`
in a dependency array to stand in for data the hook does read; Acquire puts a
`generation` counter in to force a re-read of data the hook does *not* read.
The rule objects to both, correctly, and both answers are a suppression with
its reason. Six suppressions exist now, not four.

**2. `games/acquire/scripts/generate-manifest.ts` resolved to no project.**
A `prebuild` step run by `tsx`, in a `scripts/` directory no `include`
covers — the same condition as Marco Polo's two config files, in a game the
plan had already checked. It joined `allowDefaultProject` rather than being
ignored: it is real TypeScript, and "not in a tsconfig" is a reason to lint
it, not an excuse to skip it.

**3. Plain JavaScript had to be ignored explicitly.** ESLint lints `.js` by
default, and while this config defines no rules for it, `reportUnusedDisableDirectives`
still fires — it flagged the `/* eslint-disable no-undef */` in
[`sw.template.js`](../../games/acquire/scripts/sw.template.js), which is
exactly right for a service worker's globals and reads as unused only
because `no-undef` is off. The plan said `.mjs` tooling was "deliberately
unlinted" but never made that true in the config. It does now, and the
comment explains which correct code it was scolding.

**4. `python3 -c "import yaml"` does not work on macOS**, which the plan
caught in its own self-review and swapped for `npx js-yaml` piped into node.
Recorded because the obvious command is obvious enough to be tried again.

**What did not change:** no rule was added, removed or downgraded; nothing
was fixed by editing a dependency array; `npm run build` and `deploy.sh` were
not touched. The gate found no defects, exactly as predicted — that part of
the ledger held.
