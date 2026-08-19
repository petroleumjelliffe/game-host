# The lobby lift — what game #2 taught, before it consumed anything

**Date:** 2026-08-12
**Status:** Findings and a proposed shape. Nothing built.
**Context:** Rail Baron's board-as-lobby branch is complete
([railbaron#7](https://github.com/petroleumjelliffe/railbaron/pull/7)) and its **local** half
is built. It imports no lobby code — boards `1d`/`1e`/`1f` are designed and approved but
unbuilt. So this is what a real second game revealed *without* the lift happening.

## The one-line finding

**The UI is not shared. The elements are.** A lobby has representatives of players, a way
to add players, a share link, a begin control, presence, and terminal states — every game
needs all of them, and every game will draw them completely differently. The shared thing
is the *inventory and its data*, not components and not CSS.

## What held up

| Assumption | Verdict |
|---|---|
| The headless half is game-agnostic | **Held.** `useLobbyRoom` returns data, which is precisely what a game whose screens are data can consume. |
| The lobby is turn-agnostic | **Held, under the hardest available case.** Rail Baron's roller has *no turn order at all* — any baron may roll at any time — and the lobby never noticed. |
| `lifecycle()` will have something to map onto | **Held.** Rail Baron's `started` event and derived `phase` are it. Speculative when written; real now. |
| `appId` namespacing matters | **Held.** Rail Baron writes `railbaron:log:v1`, with a test pinning the prefix. |

## What did not hold: `src/lobby/ui/` as a "themeable kit"

The whole theming contract is three CSS variables controlling **primary button colours
only** — `--lobby-accent`, `--lobby-accent-strong`, `--lobby-on-accent`. Everything else is
hardcoded Tailwind (`rounded-lg px-4 py-3 font-semibold bg-gray-300 hover:bg-gray-50`).

**Rail Baron has zero Tailwind and zero `className`** — every component is inline styles
from its own `tokens.ts`. So the kit does not merely look wrong there; it does not render.

And the shallow problem hides the real one: Rail Baron's design premise is that *the
departures board is the lobby*. The kit is a set of cards. Three CSS variables cannot turn
a card into a seven-row split-flap board.

**~580 lines of components in `src/lobby/ui/` against 1148 lines of headless + wire +
server.** About a third of what was extracted as "shared" is Acquire's own screens.

`lobby/README.md` currently advertises the themeable UI as part of the contract. That claim
did not survive first contact with a consumer and should be rewritten.

## The proposed shape: a lobby view model

`useLobbyRoom` gives behaviour. What is missing is a thin layer turning the wire shape into
the element inventory, so that no consumer re-derives the same four things.

Today every game must compute, itself: *is this seat me* (`player.id === playerId`), *may I
begin* (host + lifecycle + enough players), *may I rename this* (mine, and lobby-only), and
*which seats are empty* — which it cannot, because the roster lists only occupied seats and
the wire carries no capacity at all.

```ts
interface LobbyView {
  seats: LobbySeat[];          // every seat, occupied and empty, in seat order
  you: LobbySeat | null;
  code: string;                // the share element's payload; the game builds the URL
  canBegin: boolean;
  beginBlocked: 'notHost' | 'notEnoughPlayers' | 'alreadyBegun' | null;
  connection: 'connecting' | 'live' | 'dropped';
  terminal: 'gone' | 'refused' | 'stale' | null;
}

interface LobbySeat {
  id: string;
  index: number;
  name: string | null;         // null means an empty seat
  isHost: boolean;
  isYou: boolean;
  connected: boolean;
  canRename: boolean;          // isYou && lifecycle === 'lobby'
}
```

Acquire renders those as cards. Rail Baron renders them as `Row`s — and the mapping is
uncannily direct, which is itself evidence the inventory is real rather than invented:

| Element | Rail Baron renders it as |
|---|---|
| A seat | a row: chip = seat colour, label = `Seat N`, status = presence, text = name, right = `Tap to edit` |
| The share link | a row: text = `TPJRQD`, right = `Copy link` |
| Begin | a row: text = `START GAME`, dim until `canBegin` |
| Terminal states | a whole `ScreenDef` |

Note that the game builds the share **URL**, not the lobby — it depends on the base path,
which is per-repo (`basePath.ts`). The lobby owns the code; the game owns the link.

## The seat-id space — one change fixing two problems

Rail Baron's seats are **colours**: `'red' | 'green' | 'blue' | 'yellow' | 'black' |
'white'`, six of them, always present, an empty one reading `TAP TO JOIN`. The lobby mints
`p${players.length + 1}` and splices on leave.

Those do not map. And the minting is exactly the cause of the still-open
[[lobby-duplicate-seat-id-bug]]: p1,p2,p3 → p2 leaves → the next join mints a second p3.

**Let the game supply the seat-id space.** A `seatIds` list or a `mintSeatId(taken)` hook on
`createLobbyRegistry` would let Acquire keep its `p1..pN` semantics and Rail Baron pass its
six colours — and the duplicate-id bug disappears by construction, because ids stop being
derived from a shrinking array's length.

That also gives capacity, which the view model needs for empty seats, without inventing a
second concept.

## What should move at the lift

- **Move:** `lobby/`, `server/lobby/`, `src/lobby/{identity,connection,useLobbyRoom}`, plus
  the new view-model layer.
- **Do not move:** `src/lobby/ui/`. It is Acquire's screens. Leave it in Acquire and drop
  the "themeable kit" claim from the README.

## Still open, unchanged by this

- **`1e` shows five seats; both games seat six.** The room code takes a row. Rail Baron's
  saved-game board solved the same squeeze with a summary row; the room board has not.
- **Hosting** — a second Render service is a second paid instance, versus both games' servers
  in one process.
- **Honor-reclaim policy** and the **game-flavoured rejection codes** (`notYourTurn` meaning
  "not the host").
- **[[roomrefused-reclaim-dead-end]]** is still live: `RoomRefused.tsx`'s own comment reads
  *"Deliberately not a name form"*, while the honor reclaim needs a typed name. Rail Baron's
  approved `1f` board has an optional name field, which would fix it — a reason to build
  that board's behaviour into the shared half rather than only into Rail Baron.
