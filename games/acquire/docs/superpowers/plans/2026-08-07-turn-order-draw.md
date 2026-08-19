# The turn-order draw passes the turn — plan

**Design:** [../specs/2026-08-07-turn-order-draw-design.md](../specs/2026-08-07-turn-order-draw-design.md)
**Branch:** `revamp/turn-order-draw`, off `main` **after** the lobby branch merges — not off
`revamp/online-lobby-mockup`. Two protocol changes in one debugging window is the trade this
project's notes warn against, and v2 needs to be deployed and driven by hand before v3 exists.

**Two rulings are still open** (see the design's last section: the curtain between draws, and
whether the winner is announced). Neither blocks Tasks 1–3; Task 5 is where they land.

## Task 1 — the actor moves during the draw

Engine only, no wire.

- `GameState` gains `turnOrderDraws?: { playerId: string; tile: Coord }[]`.
- `getCurrentActor` for `stage: 'draw'` returns `players[turnOrderDraws?.length ?? 0]`.

**Test first, and prove it fails:** a state at `stage: 'draw'` with one draw recorded reports seat
*two* as the actor. Against today's engine that returns seat one, so it goes red before the change
— confirm that, rather than trusting it.

**Verify:** the existing golden still passes, since with zero draws recorded the answer is
unchanged.

## Task 2 — one draw per player

- Replace `doStartGame` with `doDrawTurnOrderTile`: take one tile, place it, append to
  `turnOrderDraws`, and **only when the last player has drawn** sort, set `turnIndex`, write the
  log and move to `stage: 'play'`.
- Guard: the sender must be the current drawer, not seat one.
- Keep the two warnings the old function carries — do not set `lastPlacedTile`, and do not push the
  tile back onto the bag (`checkInvariants`' tile conservation catches the second).

**Tests:** each player in turn; a draw from the wrong player refused; the highest tile takes the
first turn; tile conservation holds across the whole draw (108 everywhere, every step).

**Prove one can fail:** make the winner the *lowest* tile and confirm the ordering test reddens.
The comment at [intents.ts:407](../../../engine/intents.ts#L407) records that this game reverses
tabletop Acquire deliberately, so the direction is a real decision worth a live guard.

## Task 3 — the wire

- `WireIntent`: `drawTurnOrderTile` in, `startGame` out. New `isWireIntent` case.
- **Add it to `DRAWS`** — it takes from the bag. See the design; that set has three consumers and
  missing one fails silently in all three.
- `PROTOCOL_VERSION` → **3**.
- Update `engine/golden/turns.ts`: the single `startGame` step becomes N draws.

**Prove `DRAWS` is doing work:** remove `drawTurnOrderTile` from it and confirm
`server/projection.test.ts`'s equivalence proof or the socket golden notices. If neither does, the
seam is not covered and that is itself the finding — it is exactly what the protocol comment
predicts.

## Task 4 — the panel

- The draw step shows the button only to the current drawer, and the tiles already drawn as they
  land. Everyone else sees whose draw it is, which `TurnToast` already handles.
- `/catalog` gains the mid-draw state. Its absence is why the clipped away-dot went unseen for a
  phase; a new step with no catalog entry repeats that.

**Verify in a browser**, both pass-and-play and two online clients. jsdom reports zero for layout.

## Task 5 — `verify:layout`, and the two rulings

- The walk clicks "Draw for turn order" once and then one curtain `Start`. Six-handed, that becomes
  six draws. Rewrite the **comment** as well as the code: it currently explains that the draw
  raises no curtain because it is a gate in front of the game, which stops being true.
- Land the owner's rulings on the between-draw curtain and the winner announcement.

## Gates

Full suite, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`,
then a two-browser by-hand pass through the opening of a game.

**Review the whole branch at the end**, not per task — Tasks 1–3 are one behaviour split three
ways, which is exactly the shape that got past ten clean per-task reviews in Phase 4.

## Deploying it

v3 is a **second cutover**: merging deploys the server, `npm run deploy` the client, and every open
tab takes the stale-client screen once. Read the version back from `/health` before believing it.
