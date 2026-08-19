# Phase 2a — Playable pass-and-play

**Date:** 2026-08-04
**Status:** Approved design, pre-implementation
**Roadmap:** [2026-07-31-react-app-revamp-roadmap-design.md](./2026-07-31-react-app-revamp-roadmap-design.md)
**Predecessor:** [2026-08-03-phase-1b-carry-forward.md](./2026-08-03-phase-1b-carry-forward.md)

## Purpose

Make a game of Acquire playable from setup to an arbitrary later turn, on one device, using the
Phase 1b component layer and the real engine. Ending the game is deliberately out of scope; a 2a
game simply continues.

The roadmap's Phase 2 is split. **2a** is everything needed to play; **2b** is everything needed to
finish — declare-end, final scoring on real `finalScore()` output, dead-tile trade-in, and the G9
driven pass. The seam falls where it does because a live game hits a merger within a few turns, so
a phase that stopped before mergers would wedge exactly the way the current build wedges at `draw`,
only deeper in.

## What is broken today

Verified against the tree, not assumed.

| Finding | Evidence |
|---|---|
| **No path from "new game" to "first turn".** `createInitialGame` deals full hands but parks at `stage: 'draw'`, and no intent accepts that stage. | `engine/gameInit.ts:51`; `engine/golden/invariants.test.ts:38` says so in as many words; `server/engineSpike.test.ts:79` works around it with `{...createInitialGame(...), stage: 'play'}` |
| **Nothing composes the board and the panel.** Every Phase 1b component is pure and was only ever rendered alone in the catalog. | `src/game/layout.test.tsx` renders `Board` with no panel |
| **Payout figures are destroyed inside the intent that computes them.** `pendingBonuses` is set and cleared in one `applyIntent`, so the amounts survive only as log tokens. | `engine/gameLogic.ts:644,686`; `engine/intents.ts:72` |
| **Two forked player-setup UIs.** `SetupScreen` is a comma-separated text field with no per-player identity; `WaitingRoom` is 468 lines of roster plus transport. | `src/components/SetupScreen.tsx`, `src/components/WaitingRoom.tsx:314` |
| **Two conflicting emoji systems.** `PLAYER_EMOJI` is six seat avatars, already rendered by `PlayersStrip` and `RevealOverlay`; `emojiNames.ts` generates hundreds of emoji as *names*. | `engine/startups.ts:21`; `src/utils/emojiNames.ts` |

### A correction to the roadmap

The roadmap lists Phase 2 as deleting `BuyModal`, `MergerLiquidation`, `SurvivorSelectionModal`,
`FoundStartupModal`, `DrawModal`, `TilePlacementConfirmModal` and `Game.tsx`. **It cannot.**
`RoomPage` renders the same `<Game>` for online play (`src/pages/RoomPage.tsx:7,42`), so those
components serve `/room/:roomId` until Phase 3 replaces the online screen. Phase 2 stops *using*
them. Deletion moves to Phase 3/5.

## The central idea: a segment is a run of steps by one actor

Four separate-looking problems — when to raise the pass-the-device curtain, how far undo may reach,
when to prune snapshots, and how to hand off between liquidators — are one problem.

`getCurrentActor(state)` returns whose input the rules are waiting on:

- `play` / `foundStartup` / `chooseSurvivor` / `buy` → the active player
- `liquidation` / `liquidationPrompt` → `mergerContext.shareholderQueue[currentShareholderIndex]`
- `draw` → seat one (`players[0]`), the only actor before turn order exists; `end` → nobody

When that id **changes**, a segment closes. Three things happen together and never independently:

1. the reveal curtain goes up over the whole game surface
2. the undo range resets — you may undo to the start of your current segment, no further
3. snapshots before the boundary are pruned

A turn with no merger is a single segment, which reads as "everything is local until you end your
turn". A merger splits the turn at precisely the points where a different person must decide. This
is the roadmap's segment-commit model with nothing added; Phase 3 makes the same boundary the
network commit point.

`getCurrentActor` lives in `engine/` rather than `src/`, because Phase 3's server needs the same
answer to validate who may act.

## Architecture

### `GameSession` — the seam Phase 3 cuts at

```ts
// src/game/session/GameSession.ts — plain TypeScript, no React
export interface SessionView {
  state: GameState;
  actorId: string | null;      // whose input is awaited
  awaitingReveal: boolean;     // the segment just changed hands
  undoableSteps: number[];     // this segment only, newest last
  error: { code: IllegalIntentCode; message: string } | null;
}

export interface GameSession {
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  dispatch(intent: Intent): void;
  undoTo(stepId: number): void;
  reveal(): void;
}

export function createGameSession(
  init: { seed: string; names: string[] } | { state: GameState },
): GameSession;
```

The session owns the `GameState` and the `SnapshotStore`, calls `applyIntentWithHistory` and
`rewindTo`, and is the one place that catches `IllegalIntentError` and turns it into something a
player can read. React binds to it through `useGameSession()` with `useSyncExternalStore`.

Two consequences justify the extra indirection over a plain hook:

- **Phase 3 substitutes an implementation instead of rewriting a screen.** Online, `dispatch` sends
  an intent and awaits a broadcast; the view shape is unchanged.
- **Session logic is tested as pure TypeScript in the node environment**, like the engine. Given
  that jsdom's blindness to layout is what shipped a bug in Phase 1b, keeping the state machine out
  of jsdom is worth one file.

The `{ state }` constructor is not speculative: it is how the driven G2/G7 tests begin at a merger
instead of playing thirty turns to reach one.

### Engine changes — four, all additive

| Change | Detail |
|---|---|
| `startGame` intent | `{ type: 'startGame'; playerId: string }`, legal only in `draw` and only from seat one. Draws one tile per player from the bag, **places them permanently on the board**, sets `turnIndex` to the lowest coordinate, logs the draw, and leaves `stage: 'play'`. Supersedes `resolveInitialDraw`, which stays until `DrawModal` dies in Phase 3. |
| `getCurrentActor(state)` | Pure; as above. |
| `LogEntry.payload?: LogPayload` | A discriminated union whose first member is `{ kind: 'payout'; bonuses: BonusResult[] }`, emitted where `finalizeMergerPayout` writes its entry. `BonusResult` already carries `playerName`, `shares`, `type` and `amount` — everything `PayoutLines` needs. |
| A golden game for `startGame` | One new game, authored bag: order is deterministic, the drawn tiles are on the board, and they have left the bag. Nothing more — see below. |

**Starting tiles stay on the board**, as in Acquire. `previewPlacement` already handles unclaimed
placed tiles through `loneAdj` and `floodFillUnclaimed` (`engine/placement.ts:48,86`), so this costs
nothing in the rules layer — but it does mean a 2a game opens with N unclaimed tiles present.

### The existing golden games are not touched

`buildFixture` already supports `loners`, and **G1 uses it** — `loners: ['E5']`, Alex places `E6`
beside it and founds Messla at size 2 (`engine/golden/turns.ts:16`). A turn-order starting tile *is*
a loner, so the rule the opening depends on is pinned by the first golden game. Retrofitting
starting tiles into G1–G16 would perturb positions that were authored deliberately, for no coverage
gain; the roadmap's point about authored setups is that they are not meant to be reachable game
histories.

What is genuinely uncovered is the opening *sequence*, and the best place for it is not a new golden
game at all. `engine/golden/invariants.test.ts:38` builds its opening position by hand across 60
seeds, with a comment explaining why: "`createInitialGame` cannot be used: it yields `stage: 'draw'`,
which no intent accepts." Once `startGame` exists, `newGame(seed)` becomes `createInitialGame` plus
`startGame` — the real opening, the workaround deleted, and 60 seeded games of opening coverage for
free.

That harness is also the one that would have caught the legacy bug: `checkInvariants` asserts
`placed + hands + bag + discarded === 108`, while `resolveInitialDraw` marks each drawn tile
`placed: true` *and* pushes it back onto the bag (`engine/gameLogic.ts:60,75`). No test currently
runs that code, which is why the violation has sat there.

## The screen

```
┌─ GameScreen — relative, h-screen ──────────────────────┐
│ ┌── board area (flex-1, aspect 13/10) ─┐ ┌─ Panel ───┐ │
│ │                                      │ │ stepstack │ │
│ │  Board — hand tiles are the          │ │ active    │ │
│ │  current actor's, never anyone       │ │ staging   │ │
│ │  else's                              │ │ hand      │ │
│ └──────────────────────────────────────┘ │ players   │ │
│                                          └───────────┘ │
│  RevealOverlay — absolute inset-0, covers BOTH columns │
└────────────────────────────────────────────────────────┘
```

**Every decision happens in the panel's active zone.** Found-brand groups, survivor choice, payout
lines, liquidation actions and buying all render there. No modals anywhere. The board does exactly
one thing: show the position and accept a tile click.

**The curtain covers the whole surface.** `PlayersStrip` shows every player's cash, so cash is
public; the secrets are a player's tiles (rendered on the board) and their shares (rendered in
`HandZone`). Those live in different columns, so a curtain over the board alone would leak the
incoming player's portfolio to whoever is still holding the device. One overlay over both columns
needs no second hiding mechanism to keep consistent.

The state flips to the next actor immediately on `endTurn`; the curtain is what stands between that
flip and anyone seeing it.

### The turn, in order

| Beat | Interaction | Intent |
|---|---|---|
| Place | Click a hand tile on the board. `previewPlacement` supplies `kind`, `block` and `prices`, so illegal tiles read as blocked rather than failing on click. | `placeTile` |
| Found | `FoundGroups` in the active zone, brands bucketed by starting price. | `chooseFoundingBrand` |
| Merge | Survivor choice when tied; `PayoutLines` renders from the new log payload; `LiqQueue` shows done/current/pending; `LiqActions` for sell/trade/keep. Curtain between liquidators. | `chooseSurvivor`, `liquidate` |
| Buy | Picks accumulate in `StagingZone` as **local UI state** — no engine involvement, no commitment — then one intent on confirm. | `buyShares` |
| End | Closes the segment; curtain rises for the next player. | `endTurn` |

Undo is per-step from the step stack, calling `undoTo(stepId)`; entries outside the current segment
render without an undo affordance rather than failing when pressed.

A rejected intent sets `view.error` and surfaces in the active zone. Nothing throws to an error
boundary.

## Setup

New in `src/game/setup/`, built to Phase 1b's discipline — pure, props-in, catalog entries:

- **`PlayerRoster`** — 2 to 6 seats; add while under six, remove while over two; start gate closed
  under two. Knows nothing about local versus online.
- **`SeatRow`** — one seat: avatar, editable name, remove control.
- **`LocalSetupScreen`** — pass-and-play's screen: `PlayerRoster` plus Start. The seed input
  survives behind an "Advanced" disclosure; it is a debugging affordance and the reason golden
  replays are reproducible, not something to put in a player's way.

**2a does not build the online lobby.** It builds the roster so Phase 5 can drop it into
`WaitingRoom` and delete most of those 468 lines. Designing room codes and host semantics now, with
no transport work in flight, is what the roadmap deferred to its own spec.

### Resolving the emoji conflict

An emoji is a **seat avatar**: engine-owned, taken from `PLAYER_EMOJI` by seat index, distinct by
construction because there are exactly six of each. `Player.emoji` already carries it and two
Phase 1b components already render it.

`emojiNames.ts` demotes to a **name suggester** for online players who would rather not type one.
Different job, different name. This closes the roadmap's "reconcile the two" without touching
online code.

## Testing

| Layer | Runner | What it covers |
|---|---|---|
| Session | vitest / node | Segment boundaries, undo range, snapshot pruning, illegal-intent capture, `{state}` construction. No React. |
| Engine | vitest / node | The four additive changes, the `startGame` golden game, and `invariants.test.ts` switched to the real opening across its 60 seeds. |
| Components | vitest / jsdom | Setup roster and `GameScreen` wiring, as in Phase 1b. |
| Driven games | vitest / jsdom | **G2** (two-way merger, distinct majority and minority) and **G7** (three-way, sequential absorptions) built as sessions from their fixtures and driven through the real `GameScreen` by clicking, asserting the engine reaches the golden's asserted terminal state. |
| Layout | `npm run verify:layout` | Headless Chrome over CDP: panel zone heights at 768 and 1440, board fits without scrolling, the curtain's covered area equals the surface. Fails on drift. |
| By hand | a human | Explicit plan tasks: play several turns through a merger and report what you saw. |

`verify:layout` promotes the throwaway harness written during Phase 1b into a checked-in script. It
exists because a jsdom test asserted a height reservation's *structure*, passed, and shipped a zone
that shifted six pixels. jsdom reports zero for all layout; only a real page can catch an
insufficient reservation, as opposed to a missing one.

The by-hand tasks exist because in Phase 1b fourteen tasks of TDD produced 101 passing tests and
zero surprises, while the single "open it in a browser" step produced two real defects.

## Scope

**In:** the four engine changes, `GameSession` and its hook, `GameScreen`, the setup roster and local
setup screen, the full turn cycle including mergers with multiple liquidators, the reveal curtain at
game start and at every segment boundary, undo within a segment, `verify:layout`, and the driven G2
and G7 passes.

**Out, and going to 2b:** the declare-end affordance and its own design pass, `FinalScoring` wired to
real `finalScore()` output, the route back from a finished game, dead-tile trade-in in the panel, and
the G9 driven pass.

**Out, and going to Phase 3/5:** deleting `Game.tsx` and the six modals, the online lobby, per-player
projection, anything on the wire.

**Untouched:** `server/`, `prototype/`, and the existing `/catalog` route except where new components
add entries.

## Verification

Phase 2a is done when:

- A game started from `/pass-and-play` reaches the fifth turn with no wedge, no console error, and no
  modal.
- A three-way merger resolves with more than one liquidator, each behind their own curtain, and the
  resulting cash and portfolios match what the engine reports.
- Undo returns the board and the panel to a prior step within a segment, and offers nothing outside
  it.
- G2 and G7 driven through the real screen reach their golden terminal states.
- `verify:layout` passes at 768 and 1440.
- `npx vitest run`, `npm run typecheck`, `npx vite build` and `npm run check:bundle` are green.

## Risks

**The merger flow is the largest untested composition in the app.** `LiqQueue` has no prototype
ancestor and no design review (Phase 1b finding A3), and the multi-liquidator path is the one the
prototype explicitly simplified away. It is also where segments, the curtain and undo interact most.
Expect the by-hand tasks to find things here.

**`GameScreen` will want to grow.** It composes two columns, an overlay, five panel zones and six
interaction beats. If it passes roughly 200 lines, the beats belong in their own modules with
`GameScreen` reduced to composition — the same boundary discipline Phase 1b held.

**The opening board changes early-game feel.** Starting tiles on the board mean chains found sooner
and more cheaply than a fully empty opening. This is faithful to Acquire and the engine already
supports it, but it is a play-feel change nobody has experienced in this codebase.
