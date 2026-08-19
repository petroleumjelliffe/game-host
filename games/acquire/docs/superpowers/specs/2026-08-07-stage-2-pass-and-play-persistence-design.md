# Stage 2 — Pass-and-play persistence design

**Date:** 2026-08-07
**Status:** design; supersedes nothing — it assembles the rulings in
[2026-08-06-pass-and-play-persistence-decisions.md](./2026-08-06-pass-and-play-persistence-decisions.md)
and answers the questions that doc left open.
**Sequencing:** [2026-08-07-next-round-sequencing.md](./2026-08-07-next-round-sequencing.md), Stage 2.
**Mockup of record:** the Figma "Lobby Flow" frame, exported at
[assets/2026-08-06-lobby-flow.png](assets/2026-08-06-lobby-flow.png). Layout, copy, structure and
states come from it; colours stay Tailwind's.

**The finding this exists for:** a pass-and-play game lives entirely in React state —
[PassAndPlayPage.tsx](../../../src/pages/PassAndPlayPage.tsx) holds `{seed, names}` in `useState`
and nothing else. Refresh, or press the back button, and the game is gone. One device holds one
active local game and keeps it until it is finished.

## Already ruled, restated as constraints

| Ruling | Source |
|---|---|
| `/pass-and-play` is the lobby; `/pass-and-play/game` is the board | decisions doc |
| Save **on commit only** — a segment close. Staging is never saved; a refresh mid-turn returns to the start of that turn | decisions doc |
| The whole `GameState`, with a version — not seed-plus-intent-log | sequencing doc, 2026-08-07 |
| Curtain up on load — a refresh is exactly when nobody is sure who holds the device | decisions doc |
| The Continue card: fixed title `Game in progress`, players from the state, `Last played: …` | mockup + rulings |
| `New Game` with a save present discards it; no other abandon flow | mockup rulings |
| Final scoring gains **End game**, which clears the save and returns to the lobby. Nothing else clears it | decisions doc |
| Advertised in the pass-and-play lobby only; the home screen does not change | decisions doc |

## The save module

**`src/game/local/localSave.ts`** — and the placement is load-bearing: it touches `localStorage`,
so it must live under `src/` (the jsdom vitest project), never under `session/` or `engine/`,
which run in the server process where that global is a production crash. This is the boundary
`session/nodeEnvironment.test.ts` enforces.

It follows `src/net/identity.ts`'s conventions deliberately — same guarded `read`/`write` (Safari
private mode throws on `localStorage` itself; contents are user-editable text that has outlived
whatever wrote it), same key prefix, same "failure means the feature quietly doesn't work, never a
crash" posture. Not shared code: identity is three strings and this is a `GameState`, and a shared
abstraction over two three-function modules would be bigger than both.

```ts
const KEY = 'acquire.local.game';        // one active local game per device, by ruling
export const LOCAL_SAVE_VERSION = 1;

interface SavedLocalGame {
  version: number;        // LOCAL_SAVE_VERSION, checked on load
  savedAt: number;        // epoch ms — the Continue card's "Last played"
  state: GameState;       // committed only; a draft was never real
}

save(state: GameState): void          // never throws
load(): SavedLocalGame | null         // null on absence, parse failure, or version mismatch
loadFailure(): 'stale' | null         // whether a save exists that load() refused
clear(): void
```

**`version` is this module's own constant, not the server's `SAVE_VERSION`.** They version
different records — `SavedRoom` carries a roster and tokens this save does not — and importing
`server/store.ts` into `src/` would be the wrong direction on the only boundary this repo polices.
Like `SAVE_VERSION` and `PROTOCOL_VERSION`, it is bumped by hand, and like them it does not catch
a `GameState` shape change that lands without a bump — that limitation is stated on the guard, as
`isSavedRoom` now states it.

**A stale or unreadable save is reported, not silently absent, and not destroyed.** `load()`
returns null so nothing downstream can trip on it, but the lobby uses `loadFailure()` to say, in
the Continue card's place: *A saved game from an older version can't be continued.* with `New Game`
above it as the way forward. The bytes stay until `New Game` overwrites them — the quarantine
posture from Stage 1, minus the rename `localStorage` cannot express. What must not happen is the
Phase 4 near-miss shape: a save that quietly vanished, reported by nobody, indistinguishable from
never having existed.

## When a save is written

On **segment close**, from the game route, by subscribing to the session — the same boundary the
server treats as authoritative. Concretely: a `subscribe` listener that watches
`getView().segmentStart` move and writes `state` at that moment; the state at a segment boundary
*is* the committed state. Plus one write at game end (`stage === 'end'`), so the final scoring
screen survives a refresh too — and so the future "library of finished games" has a final state to
inherit, per the carry-forward.

Not on every step: staging is uncommitted work and was ruled unsaved. Not on an interval: there is
nothing to save that a segment close has not already captured.

**Undo interacts correctly for free.** The snapshot store is in-memory, so a refresh loses it —
but a refresh also lands you at the segment start with nothing played yet, which is exactly where
undo's floor already is. The undo boundary, the pass-the-device boundary, and the save boundary
are all the same boundary; that is the point of the segment model.

## Routes and resume

- **`/pass-and-play`** — the lobby (below). Owns the decision: nothing saved → setup; save present
  → setup plus Continue; save stale → setup plus the one-line explanation.
- **`/pass-and-play/game`** — the board. On mount: a session from the save if one loads, else from
  the setup config passed by the lobby, else **redirect to the lobby** — a deep link or refresh
  with nothing saved must not render a dead board. On resume, the session is
  `createGameSession({ state: saved.state })` — the same resume path `/scenarios` already proves —
  and the **curtain is up**, exactly as if the device had just been passed, before anyone's hand
  is shown.
- The back button now leaves the game rather than destroying it, because leaving the route no
  longer discards the only copy of the state.

## The lobby, from the mockup

One narrow card, centred: primary action, secondary action, quiet way back — copy verbatim from
the Figma file. **Pass & Play** / *Pass and play on this device*:

- **Nothing saved:** `New Game`, player rows (emoji chip, editable name, `×`), `+ Add a player`,
  `Start game`, `Leave`. This is `LocalSetupScreen` restyled to the mockup's card, not a second
  setup implementation.
- **A game saved:** `New Game` above a **Continue** section holding one card — `Game in progress`,
  the players as `🐸 Name 1, 🐷 Name 2` (from the saved state), `Last played: 2 days ago`
  (from `savedAt`, formatted relatively).

**`New Game` over a live save confirms first** — the ruling left "settle when built": discarding
is irreversible, one press away, directly above the card showing the thing it destroys.
*Recommendation, applied: confirm when a game exists, go straight through when none does.* The
confirm is inline on the card (button swaps to `Discard the saved game?` / confirm + cancel), not
a modal — the legacy modal family is deleted and stays deleted.

## End game

`FinalScoring` gains the **End game** action, threaded through `GameScreen` the way `onNewGame`
already is. It clears the save and navigates to the lobby, which then offers `New Game` with no
Continue card. Nothing else clears the save — not `onExit`, not navigation, not a new visit.

## What this deliberately does not do

- **No multiple saves.** One key, one game, by ruling. The record shape does not preclude a later
  `acquire.local.games.<id>` scheme, which is all the future library needs from it.
- **No library of finished games.** `End game` clears; the final state was saved at `stage: 'end'`
  so the shape is future-proof, and that is the whole concession.
- **No online involvement.** `identity.ts` already covers online resume; this module never touches
  a room.
- **No home-screen changes.** Ruled.

## Verification

- Break the version guard (bump `LOCAL_SAVE_VERSION`, load an old save) and watch the lobby show
  the stale message rather than a crash or a silent absence.
- A refresh mid-turn lands at the segment start behind the curtain — driven by hand, since jsdom
  cannot hold a real reload (the remount-vs-reload caveat in `RoomPage.test.tsx` applies here too).
- The full by-hand pass: new game → play three segments → refresh → continue → finish → End game →
  lobby offers no Continue. The seeding route does not help here — it is online-only — so this
  pass is played, not seeded; it is short.
- `npm run verify:layout` still passes — the lobby card is new layout on that gate's path.
