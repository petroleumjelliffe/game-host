# Phase 2a — by-hand play notes

**Date:** 2026-08-04
**Task:** Plan Task 18
**Method:** a four-seat game driven through headless Chrome over CDP at 1440×900 and 768×900,
with screenshots inspected at each beat, plus a long walk (500 interaction steps) to reach a real
merger. The Chrome DevTools MCP browser was unavailable (its profile was held by another Chrome),
so the session used its own isolated profile — same real browser, same real layout.

Phase 1b's lesson held again: **fourteen tasks of TDD and 341 green tests found nothing that this
step found.** Four defects came out of looking at the actual page, three of them here and one from
`verify:layout` in Task 16.

## Defects found and fixed

### 1. The reconnection banner sat on top of the game

`ReconnectionBanner` rendered on **every** route from `App.tsx`. With no game server running — which
is the normal state for pass-and-play — it drew a full-width yellow "🔴 Disconnected from server"
bar across the top of the game, overlapping the board's column headers and the top of the step
stack. It was equally wrong on `/catalog`.

Carried finding C of the Phase 1b carry-forward predicted exactly this and could not act on it,
because Phase 1b was forbidden to touch `src/components/`. Phase 2a's constraints allow `App.tsx`,
which is enough: the banner now renders only on routes that actually have a server to be
disconnected from. `src/App.test.tsx` covers both directions.

### 2. The players strip silently clipped seats

`PlayersStrip` laid its seats out in a single flex row with `flex-1` **and** `whitespace-nowrap`.
A flex item's default `min-width: auto` refuses to shrink below its content, so the row grew instead
of fitting: **six seats wanted 1061px inside a 319px panel**, and the last four were simply not
visible. Nothing indicated they had been cut off. Four-player games lost two players; six-player
games lost four.

Measured, not guessed — `scrollWidth 1061 / clientWidth 319`. Fixed by laying the strip out as a
two-column grid, which gives each seat ~143px and fits every table size from two to six. Row count
varies with the number of players, which is fixed for a whole game, so the zone still never resizes
while anyone is looking at it.

`verify:layout` now measures horizontal overflow of the strip and every `data-zone`, and its walk
plays **four** seats rather than two — a gate that always played heads-up would never have seen
this. Proven to fail: reverting the fix produces `zone clips its content horizontally —
players 708>263`.

### 3. A starting tile pretended to be undoable

`doStartGame` copied the legacy `resolveInitialDraw`'s `player.lastPlacedTile = tile`. But
`lastPlacedTile` means *the tile placed this turn, still undoable*: `Board` gives it a selection
ring and keeps it clickable so it can be taken back. A turn-order tile is neither. The opening board
therefore showed the current player's starting tile ringed and clickable — and clicking it
dispatched `placeTile` on an occupied coordinate, which the engine correctly rejected. The UI
invited a click and then refused it.

Fixed by not setting the field; `engine/intents.test.ts` covers it.

### 4. (Task 16) The hand zone grew when the first share arrived

Found by `verify:layout` on its first working run: `HandZone`'s holdings row had no reservation, so
it went 57px → 64px the moment a player acquired a share, moving the zone 107px → 114px and shifting
everything below. Reserved at the measured filled height. Details in the Task 16 commit.

## Checks that passed

Recorded so the next phase knows what was actually looked at, not merely assumed.

- **The curtain covers both columns.** Measured 1440×900 against a 1440×900 surface. No board cell
  is hit-testable through it (`elementFromPoint` returns the curtain), and the incoming player's
  hand zone — name, shares, balance — is behind it. Cash stays public via the players strip by
  design; the secrets are tiles and shares, and both are covered.
- **The turn-order draw reads as a beat.** "Open the game → Draw for turn order" then a log line
  naming each player and their tile, e.g. `Dijkstra C5, Curie E2, Ada H3, Blaise H7`.
- **Starting tiles look intentional**, not like a bug: four dark unclaimed tiles for four players,
  visually distinct from both hand tiles (blue) and chain tiles (branded outlines).
- **Board and panel update together.** No frame where one had advanced and the other had not.
- **Panel zones hold their height** across `play`, `afterPlace`, `afterFound` and `afterStaging`, at
  both widths: staging 217, pile 72, net 37, action 40, hand 114, holdings 64, players 105. The
  step stack and active zone trade space (the stack is `flex-1` and absorbs exactly what the active
  zone does not use) and their **sum is invariant** — which is what "the panel does not resize"
  actually means, and is how `verify:layout` now checks it.
- **Undo works within a segment** and is offered per *intent*, not per log entry — a merger's payout
  line carries no undo control, because no snapshot exists for it.
- **The merger flow is legible.** Reached a genuine four-liquidator merger: `CamCrooned into
  ZuckFace`, payout lines reading `Dijkstra ×7 · Majority +$3,000`, `Ada ×6 · Minority +$500` and
  two more, then a liquidation queue marking Dijkstra current (›) with Ada, Blaise and Curie
  pending, sell/trade actions priced at $300, and a "Keeping 7" staging with one Confirm. This is
  the area the design named as the phase's largest risk; it behaved.
- **Reduced motion is respected properly.** Under `prefers-reduced-motion: reduce` the active step's
  `animationName` computes to `none` — the animation is *skipped*, not shortened. Without it, the
  same element animates `step-up` over 0.28s.
- **Both viewports fit.** Board 1088×868 at 1440px and 472×868 at 768px, bottom within the surface,
  no horizontal scrolling at either.

## Carried findings — not fixed, deliberately

- **The socket still connects on every route, and logs errors.** `main.tsx` wraps the whole app in
  `SocketProvider`, which dials the server on mount regardless of route. On `/pass-and-play` with no
  server running this prints `❌ Connection error: websocket error` repeatedly to the console. The
  *visible* symptom (the banner) is fixed; the console noise is not. Fixing it means changing when
  the transport connects, which is Phase 3's subject and cannot be verified here without a running
  server — so this is recorded rather than risked. **The plan's "no console error" verification
  criterion is therefore not fully met**, and this is the sole reason.
- **Seat names truncate hard at 768px.** With the panel at 263px and two columns, a default
  "Player 1" renders as "P". Real names fare better ("Blaise" → "Bl…"), and the emoji avatar plus
  the active outline still identify the seat — which is the identity the design chose. Worth a
  design pass, not a correctness fix.
- **`LiqQueue` still has no design review.** Phase 1b flagged it as the one merger component with no
  prototype ancestor. It now has a real four-liquidator state to review against (screenshot in the
  merger note above); the marks (`✓`/`›`/`·`) read clearly, but nobody has designed them.
