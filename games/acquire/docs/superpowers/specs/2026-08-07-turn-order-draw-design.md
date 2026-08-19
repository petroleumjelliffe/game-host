# The turn-order draw passes the turn — design

**Date:** 2026-08-07
**Status:** **built 2026-08-08** on `revamp/turn-order-draw` (`fd6dd0c`), unmerged. 776 tests, five
gates green, driven by hand in pass-and-play six-handed and online across two clients.

> **Both open rulings were made** (owner, 2026-08-08): a curtain rises **between** draws — but not
> in front of the first, where seat one is already holding the device — and the winner **is
> announced**, as its own unattributed `Turn order` step.
>
> **Three things this design did not anticipate**, all found in a browser and none by the suite:
>
> 1. **The draw has to narrate itself.** `pushLog` is what advances `nextStepId`, and the segment
>    machinery is built on step ids — so a draw that logged nothing left the undo range and the
>    commit boundary with no step to move past. Every draw is now its own step.
> 2. **"YOU PLAYS FIRST".** `stepsOf` prefixes an entry with its player and says "You" for the
>    viewer, so an attributed phase must read after a name. The announcement is unattributed.
> 3. **The claim "undo falls out" below was wrong.** It holds only when the actor changes. When the
>    *last* drawer wins their own draw the actor never moves, so the draw stayed inside the open
>    segment and the panel offered `↺ undo` on a random reveal — and, worse, `server/room.ts`
>    derives its commit from the segment closing, so the table would not have seen the result until
>    the winner finished their entire first turn. Leaving the draw now closes the segment; the
>    curtain stays narrower. **Curtain and commit are no longer the same event**, which is a
>    genuinely new distinction in this codebase.
>
> One thing the design got right and is worth keeping: `DRAWS` **is** covered. Removing
> `drawTurnOrderTile` from it fails all three consumers, contradicting the protocol comment's
> prediction that it would fail silently.
**Found by:** the owner's by-hand pass — *"the draw to go first was meant to pass turn like any
other move and then update the turn order once complete. right now it happens instantaneously."*

## What it does today

[`doStartGame`](../../../engine/intents.ts#L390) draws a tile for **every** player inside one
intent, sorts them, sets `turnIndex`, and moves straight to `stage: 'play'`. Only seat one may send
it — [`getCurrentActor`](../../../engine/actor.ts#L22) hardcodes `players[0]` for `stage: 'draw'`
with the comment *"turn order does not exist yet, so seat one opens the game"*.

So one player presses one button and the game is already running. Nobody else acts. That is the
"instantaneously" in the finding.

## What it should do

Each player draws their own tile, in seat order. The turn order is computed when the last one
lands, and play begins with the highest tile.

## The good news: the segment machinery already does this

`getCurrentActor` **is** the seam. `CLAUDE.md`: *"when this id changes, a segment closes — the
pass-the-device curtain rises, the undo range resets, and snapshots before the boundary are
pruned"*, and Phase 3a made it the server's commit boundary too.

So the whole "passes the turn like any other move" half is one change:

```ts
if (state.stage === 'draw') return state.players[state.turnOrderDraws?.length ?? 0]?.id ?? null;
```

From that, at no extra cost: the pass-and-play curtain between draws, the online hand-off, the
turn toast, the server's per-draw commit and broadcast, and presence on a player everyone is
waiting for. **Nothing about the transport or the session model needs inventing.** That is the
strongest argument for doing it this way rather than adding a bespoke draw phase.

## The state it needs

One field on `GameState`:

```ts
/** Filled in seat order during `stage: 'draw'`; complete when play begins. */
turnOrderDraws?: { playerId: string; tile: Coord }[];
```

Append-only while drawing. Its **length is the cursor** — who draws next — and its contents decide
the winner. Kept after the draw rather than cleared: it is what a recap would read, and it costs
nothing.

Deliberately *not* `player.lastPlacedTile`. The existing code already warns why — that field means
"placed this turn, still undoable", and the board gives it a selection ring and keeps it clickable.
Phase 2 shipped that bug once; the comment at [intents.ts:398](../../../engine/intents.ts#L398)
records it.

**No hidden information.** Drawn tiles already land on the board as unclaimed starting tiles, so
they are public, and `turnOrderDraws` adds nothing a projection must strip. The projection
equivalence proof is unaffected — worth stating, because it is a proven property that a new state
field could quietly narrow.

## The intent

`startGame` **goes away** and is replaced by `drawTurnOrderTile`, carrying nothing but its
`playerId`. It is a rename in spirit but not in meaning: the old one opened the game on everyone's
behalf, the new one is one player's own move.

- `isWireIntent`: a new no-payload case beside `declareEnd` and `endTurn`.
- **`DRAWS` must gain it.** It takes a tile from the bag, so a projected client cannot compute the
  result and owes a `correction`. [protocol.ts:92](../../../session/protocol.ts#L92) already
  states the hazard exactly: three consumers read that set, and an intent added to only one of them
  *"would stop producing its correction, silently narrow the equivalence proof, and mispredict on
  the client — with no test failing either way."* This is that intent.
- The stage guard becomes "you are the current drawer" rather than "you are seat one", which is
  just `requireActor`-shaped like every other intent.

**Ties are impossible** — tiles are unique and `compareTiles` totally orders them — so the winner
needs no tie-break rule. Worth writing down so nobody adds one defensively.

**Undo falls out.** Each draw is its own segment, and undo across a segment boundary is already
refused (`undoOutOfSegment`). A draw is the segment's only step and closing is immediate, so a
drawn tile cannot be taken back. That is correct for a random reveal and requires no new rule.

## Protocol v3

The wire changes shape, so `PROTOCOL_VERSION` goes to **3** — and this one really is a bump, unlike
the v2 correction the lobby branch made, because v2 will be deployed by then. A second cutover:
open clients get the stale-client screen once and reload.

**This is the reason it is its own branch.** An engine change and a protocol change in one
debugging window is the trade this project's notes already warn against, and the lobby work is
carrying a wire change of its own.

## What else moves

| Thing | Change |
|---|---|
| `engine/golden/turns.ts` | The one golden opening at `stage: 'draw'`. Its single `startGame` step becomes N `drawTurnOrderTile` steps; `stage` stays `draw` until the last, and only that one asserts `currentPlayer`. **The other sixteen goldens are untouched** — they open at `play`. |
| `src/game/screen/useTurnPanel.tsx` | The draw step is per-player: the button only for the current drawer, and the tiles drawn so far shown as they land. |
| `scripts/verify-layout.mjs` | Its walk clicks "Draw for turn order" **once**, then one curtain `Start`. The gate plays **six-handed**, so it becomes six draws with a curtain between each. Its comment that the draw "raises no curtain — it is a gate in front of the game" stops being true and must be rewritten, not just the code. |
| `session/GameSession.ts` | Nothing expected: the segment logic is driven by `getCurrentActor`. To be *verified*, not assumed. |
| `server/room.ts`, `server/index.ts` | Nothing expected — the intent flows the generic path, and `DRAWS` is what decides corrections. Also to be verified. |

## Two things the owner should rule before this is built

1. **A curtain between every draw, in pass-and-play?** It is what "pass turn like any other move"
   means, and the next person has to be able to pick the device up. The cost is that a six-handed
   game now opens with six curtain taps and six draws before anyone plays a tile. The alternative —
   drawing without a curtain — leaks nothing (the tiles are public), but then the draw is not
   really taking a turn.
2. **Does the winner get announced, or just discovered?** The log already writes "Drew for turn
   order" with every tile. A moment that names the winner before play starts is a small addition
   and might be the point of doing this at all; without it the last draw silently becomes someone's
   turn.

Both are cheap to change later, and neither blocks starting.

## Plan

[../plans/2026-08-07-turn-order-draw.md](../plans/2026-08-07-turn-order-draw.md).
