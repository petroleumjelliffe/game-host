# Phase 3b — the browser pass

Run by the controller on the final tree (HEAD `cbe4a8d`), 2026-08-05, before the
whole-branch review. **This is the first time any part of Phase 3 has been opened
in a browser.** 3a shipped headless with no by-hand verification of any kind.

## How it was driven

Two **separate Chrome instances**, each with its own `--user-data-dir` — so
separate `localStorage`, separate sockets, two genuinely distinct players —
against `npm run dev:all`. Raw CDP over `ws`, the same technique
`scripts/verify-layout.mjs` uses, because this project has no puppeteer.

The script lives outside the repo (session scratchpad, `twoPlayer.mjs`) and is
not committed. It is a verification pass, not a gate; the committed gate for
browser-only properties remains `npm run verify:layout`.

Two environment traps worth recording, both of which silently point a browser at
the wrong thing:

- **Another project's vite dev server was already on port 5173**, so ours fell
  back to 5174 — and a *third* server held `[::1]:5174` while ours held `*:5174`.
  On macOS `localhost` resolves to `::1` first, so `http://localhost:5174`
  served a completely different application ("The Shop // STRIPS prototype")
  while looking like a page that had simply failed to render Acquire. Driving
  the pass at `http://127.0.0.1:5174` fixed it. Anyone repeating this should
  check `lsof -nP -iTCP -sTCP:LISTEN | grep 517` before believing what they see.
- The chrome-devtools MCP could not be used at all: a browser was already
  running on its shared profile, and killing someone's browser to run a test is
  not a trade worth making.

## What passed

Every check below passed on the first complete run, with **no console errors on
either client**.

| # | Check | Result |
|---|---|---|
| 1 | Alex creates a room; a six-character code appears | `D4Y59L` |
| 2 | Sam joins with the code; both rosters show both players | pass |
| 3 | Only the host is offered a start — Sam's only button is "Leave" | pass |
| 4 | Both reach the game surface; seat one alone is offered the turn-order draw; Sam reads "Waiting for Alex" | pass |
| 5 | No pass-the-device curtain appears on either client, at any point | pass |
| 6 | The draw resolves and exactly one player is on turn | Sam won (`H4` beats `G8` — highest letter, the reverse of tabletop Acquire) |
| 7 | The two hands are disjoint: `Sam E7,E8,E9,F3,F9,G3` / `Alex B3,E4,H5,H6,H11,I5` | pass |
| 8 | **The open segment stays private.** Sam places `E7`; Alex's screen does not change at all — `E7` is not on Alex's board | pass |
| 9 | Undo inside the open segment returns `E7` to Sam's hand, and Alex never saw the undone step | pass |
| 10 | Ending the turn commits to both screens: Sam reads "Waiting", Alex takes the turn | pass |
| 11 | A mid-game refresh rejoins the same seat with the same six tiles | pass |

Screenshot evidence was inspected, not just asserted: Alex's waiting screen shows
"PLACE A TILE — Waiting for Sam." with no controls, Alex's own six tiles still
highlighted on the board, Sam highlighted as the active seat in the strip, and
`E7` absent from the board. The step stack after the handoff reads "DREW FOR TURN
ORDER Sam H4, Alex G8 / PLACED A TILE E7 (isolated) / DREW TILES 1 tile / ENDED
TURN" — note that the drawn tile is reported as a *count*, not a coordinate,
which is the log redaction Phase 3a added.

## What this pass did NOT cover

Stated plainly, because a table of green rows invites the assumption that
everything was checked:

- **A merger with a liquidation queue reaching both players, in the UI.** The
  mechanics are covered over real sockets by `server/clientOverWire.test.ts`
  (every merger game in the corpus passes, including the multi-chain G7), but
  nobody has watched a liquidation prompt arrive on a second player's screen and
  hand them control mid-turn.
- **A game played through to final scoring.** The pass covers the opening, one
  full turn and the handoff.
- **The `pending` inert state.** `GameScreen` goes inert while a bag-drawing
  intent is in flight; on a local server that window is a few milliseconds, so
  the pass could not observe it. It is covered by unit tests, not by eye.
- **Anything about a real network** — latency, packet loss, a dropped socket, a
  Render cold start. All Phase 4.
- **A human's judgement about how any of it feels.** This was a scripted pass by
  the same author as the code. It substitutes for the missing by-hand pass in
  coverage, not in perspective.
