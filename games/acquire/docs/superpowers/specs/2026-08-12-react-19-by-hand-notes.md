# React 19 + StrictMode — by-hand pass

**Date:** 2026-08-12
**Branch:** `chore/react-19-baseline`
**Built bundle**, driven in real Chrome over CDP against an isolated server
(`PORT=3002`, `GAMES_DIR` in scratch) so nothing touched the server another shell already had
on 3001.

**Why by hand at all:** no test imports `src/main.tsx`. All 830 render components directly, so
not one of them exercises the StrictMode that Task 2 turned on. This pass is the only thing that
does.

## Result: no doubling found

StrictMode double-invokes mount effects and state updaters. Every measurement below is a count,
because "looks fine" cannot distinguish one invocation from two.

| Check | Measured |
|---|---|
| One browser creates a room | Roster shows **1 seat** (`Player 1`, HOST) |
| A second tab opens the same room URL | Still **1 seat** — the stored identity rejoined by token rather than minting a duplicate. Two sockets, one seat. |
| One click on "Draw your tile" | `log` 0→1, `nextStepId` 1→2, `turnOrderDraws` **1**, screen "2 still to draw" → "1 still to draw" |
| The pass-the-device curtain ("Start") | `log` 1→1, `nextStepId` 2→2, draws 1→1 — **no state change at all**, correctly pure UI |
| Second draw, completing the order | `turnOrderDraws` **2** for **2 clicks**; `stage` `draw` → `play` |

**The decisive number is two clicks producing two draws.** A doubled updater would have consumed
both draws on the first click and shown "0 still to draw" immediately.

**One result that looks like doubling and is not.** The final draw advanced `log` by 2 and
`nextStepId` by 2. That is the designed behaviour: the turn-order winner is *announced as its own
step* rather than merely arrived at, so the last draw legitimately produces the draw entry plus
the announcement. Recorded here because the next person to run this will see it and reach for the
wrong conclusion.

## Findings

### 1. `npm run preview` cannot serve this project's build — pre-existing, not caused by this branch

[vite.config.ts:121](../../../vite.config.ts#L121) reads:

```ts
base: command === 'build' ? BASE_PATH : "/",
```

`vite preview` runs as `serve`, so it hosts `dist/` at `/` while the built `index.html` references
`/acquire-startups-m1/assets/…`. Every asset URL misses and falls through to the SPA fallback,
which returns `index.html` with a **200**. The page renders nothing and `#root` stays empty.

**This cost real time, and the reason is worth keeping.** The first check ran was
`curl -o /dev/null -w "%{http_code}"`, which reported `200` for the bundle and looked like
proof the server was fine. It was not: the size was **2630 bytes** against a real bundle of
**358054**. A status code is not evidence that the right bytes came back.

Workaround used: `npx vite preview --base /acquire-startups-m1/`. A permanent fix would be to
give the `preview` script that flag, since `base` is deliberately build-only.

### 2. The plan asked for something the server does not do

Task 3 Step 2 said to "count the connect and join lines" in the `dev:server` output. **The server
logs neither.** Nothing is printed on connect or on join, so the step is unperformable as
written.

Substituted, and better: count *seats* rather than log lines — the roster is the thing a double
join would corrupt, and it is observable from the client. Two tabs on one seat is a stronger
result than a log line, because it also exercises the rejoin-by-token path.

### 3. The plan was wrong that there is no move count

It states the save "holds a whole `GameState`, not a move log — so there is no move count to
compare". `GameState` **does** carry a `log`, plus a monotonic `nextStepId`. Both were used above
and are the cleanest available measure of "one action, one effect". The plan's caution was an
over-correction of an earlier error and should be fixed.

## Not covered

- **Two genuinely separate players.** Both browser tabs share one profile and therefore one
  `localStorage` identity, so the second tab rejoined seat 1 rather than taking seat 2. Testing a
  real second player needs a separate profile or an incognito context, which the driving tooling
  here does not expose. The single-seat and two-tab results stand; a full two-player game under
  StrictMode does not.
- **Refresh mid-turn with an open draft**, and **server restart with a live room** (plan steps 4
  and 5). Both need the two-player setup above.
- **`verify:layout`** was run in Task 1 and passed at both widths, with `listTransform: "none"` at
  every step-reveal sample — so the step stack still carries no transform, the invariant that has
  regressed twice before.
