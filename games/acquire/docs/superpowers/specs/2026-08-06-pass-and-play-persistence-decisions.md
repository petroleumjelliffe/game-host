# Pass-and-play persistence — decisions so far

**Status: not a design yet.** These are the owner's rulings on the five
questions that were blocking one, recorded on 2026-08-06 so they survive the
Phase 5 work happening in front of them. The design doc and its plan come after
Phase 5.

**The finding that started it:** a pass-and-play game lives entirely in React
state. Refresh the page, or use the browser's back button, and the game is
gone. One device should hold **one** active local game and keep it until it is
finished.

## Rulings

| Question | Ruling |
|---|---|
| Route shape | `/pass-and-play` is the lobby; `/pass-and-play/game` is the board. The game gets its own route, so the back button leaves the game rather than destroying it. |
| Save cadence | **On commit only** — a segment close, the same boundary the server treats as authoritative online. Uncommitted staging is not saved; a refresh mid-turn returns you to the start of that turn. |
| Finishing a game | The final-scoring screen gains an **End game** button. Pressing it marks the game fully over and returns to the lobby, which then offers a new game rather than a continue. Nothing else clears the save. |
| Curtain on reload | **Yes** — the reveal curtain comes up on load, so the device confirms whose turn it is before showing anyone's hand. A refresh is exactly the moment nobody is sure who is holding the phone. |
| Where a game in progress is advertised | The pass-and-play lobby only. The home screen does not change. |

## The lobby, from the mockup

**Figma:** <https://www.figma.com/design/pGLOfYYNCsYY8LzNeDpwX7/Untitled?node-id=23-866>
— "Lobby Flow" (owner, 2026-08-06). Exported frame:
[assets/2026-08-06-lobby-flow.png](assets/2026-08-06-lobby-flow.png), which is
the copy of record if the Figma file moves.

**It takes precedence over the rulings above**, which were made before it
existed.

Every screen is one narrow card, centred, with a primary action, a secondary
action, and a quiet way back. Copy below is verbatim from the file.

### Mode chooser

**Acquire** / *Choose your game mode*. Two large cards, each a heading with a
line of explanation:

- **Online** — *Each player joins from their own device. Share a room link to
  play together remotely.*
- **Pass & Play** — *Everyone plays on this device. Pass it around after each
  turn (local hotseat).*

Footer, quiet: *Both modes support 2–6 players.*

### Play Online

**Play Online** / *Everyone plays from their own device*. `Create Room`
(primary), `Join with a code` (secondary), `Back`.

### New Room

**New Room** / *Share this code with other players*. The room code as a wide,
letter-spaced block — `A B C 1 2 3`. Then one row per player: an emoji chip, the
name in an editable field, and a `×`. Actions:

- alone in the room: a **disabled** `Waiting for another player` where the start
  button will be, plus `Leave`
- with others: `Start game` (primary) and `Leave`

### Join Room

**Join Room** / *Enter or paste code below*. An empty code field, then your own
player row (emoji chip, name, `×`). `Join` is **disabled** until a code is
entered; with a code present the field shows it in the same letter-spaced style
as New Room and the button becomes `Join game`. `Leave` below.

> **Amendment, 2026-08-07 — the `×` is not built, on both cards.** The frame
> remains the copy of record for everything else; this records where the build
> knowingly departs from it and why.
>
> `Leave`, directly below the roster, already vacates your seat, so the `×` on
> your own row was a second control for one action — and on the host's row it
> read as "boot yourself", which is what surfaced it in the by-hand pass. Ruled
> by the owner: dropped from every row, not just the host's, since being first
> does not make a duplicate less of one. `leaveSeat` on the wire is unchanged.
>
> Two further departures, same ruling, both *toward* the frame rather than away
> from it: the name field on either card is **optional** (an unnamed seat is
> named `Player N` by the server, since only it knows your seat number), and the
> Join card's row carries **no emoji chip** — the chip is the seat's, assigned by
> seat index at `startGame`, and there is no seat until the join lands.
>
> See `plans/2026-08-07-lobby-flow-corrections.md`.

### Pass & Play

**Pass & Play** / *Pass and play on this device*.

- **Nothing saved:** `New Game` (primary), then the player rows — emoji chip,
  editable name, `×` — with `+ Add a player`, then `Start game` and `Leave`.
- **A game saved:** `New Game` (primary) above a **Continue** section holding one
  card: the game's name, its players as `🐸 Name 1, 🐷 Name 2`, and
  `Last played: 2 days ago`.

### Tokens the file defines

From `get_variable_defs` on the frame. Recorded for the type scale and
proportions; see the note below on colour:

| | |
|---|---|
| Title | Inter Bold 21/22.5, letter-spacing −0.234 |
| Body | Inter Regular 12, letter-spacing −0.1 |
| Body fill | `#495564` |
| Primary button fill | `#0065F4` |
| Secondary button | fill `#FFFFFF`, text `#0E1828`, stroke `#d0d5dc` |
| Placeholder | stroke `#CCCCCC`, text `#666666` |

**The colours are not the file's to decide** (owner, 2026-08-06): the palette
stays Tailwind's, which is what the rest of the app is built on. So the
mockup's `#0065F4` does not replace `bg-blue-600`, and the greys above are
approximate rather than exact. Read the file for **layout, copy, structure and
states**; take colour from the app.

## What the mockup settles, and what it opens

Settles the last open question from the rulings — **what the lobby shows about a
saved game**: a name, the players, and how long ago it was played. So the save
carries a **name** and a **last-played timestamp**, not just a state blob.

The three it raised are now ruled (owner, 2026-08-06):

| Question | Ruling |
|---|---|
| `New Game` with a game already saved | **Discards it.** One active local game per device; multiple saves are a later feature if they are ever wanted. |
| Where the name comes from | **There is no name.** The Continue card's title is the literal string `Game in progress`. Nothing is stored and no screen collects one. |
| Abandoning a game | No dedicated control. Navigate back to `/pass-and-play`, see the game in progress, press `New Game` — which discards it. No breadcrumb, no settings screen. |

**One thing to settle when it is built, not now:** `New Game` discarding a game
in progress is irreversible and one press away, directly above the card showing
the thing it destroys. A confirmation step is the obvious guard, and the mockup
does not have one. Recommendation: confirm when a game exists, go straight
through when none does.

## How to read the Figma file

The desktop app's **Dev Mode MCP server** serves it on
`http://127.0.0.1:3845/mcp` while Figma is running with the file open, and it is
**registered with Claude Code** (2026-08-06) — `get_screenshot`, `get_metadata`,
`get_design_context`, `get_variable_defs` and `get_motion_context` are available
directly. `nodeId` takes either form, `23-866` or `23:866`.

Fetching the figma.com URL itself returns nothing — the file is private and the
page is a JavaScript app. If the MCP tools are ever missing, the server can be
driven over plain JSON-RPC instead: `initialize`, then `notifications/initialized`
carrying the returned `mcp-session-id` header, then `tools/call`, with responses
arriving as `text/event-stream` (strip the `data: ` prefix).

## Carried forward, not yet designed

- **A library of finished games.** The owner's TODO: results of a completed
  game should be saved somewhere viewable rather than discarded by **End game**.
  Out of scope for the first pass — but the save format should not make it
  impossible, so whatever is written should keep the final state rather than
  only a "finished" flag.

## Open questions the design must still answer

- ~~What is written: the whole `GameState` and `segmentStart`, or the seed plus
  the intent log replayed on load?~~ **Ruled 2026-08-07: the whole `GameState`,
  with a version.** The log is smaller and self-verifying and the replay
  machinery already exists, but under a changed rule an old log replays into a
  *plausible but different* game — it loads, it looks right, and it is wrong. A
  versioned blob refuses loudly instead. It also matches what `server/store.ts`
  already does, so there is one persistence model rather than two, and it keeps
  the final state that the library-of-finished-games TODO above needs. The save
  still carries a **last-played timestamp** — and no name: the Continue card's
  title is fixed copy, and the players it lists come from the state itself.
  Recorded in [2026-08-07-next-round-sequencing.md](./2026-08-07-next-round-sequencing.md).
- Storage key and versioning — one key per device, and what happens when a save
  predates a rules change and no longer replays or loads cleanly.
- ~~Whether the lobby's "continue" needs to show anything about the saved game~~
  — answered by the mockup: name, players, last played.
- `src/net/identity.ts` already keeps per-room identity in `localStorage`; a
  second storage module should either reuse its conventions or say why not.
- The three the mockup itself raises: what `New Game` does with a saved game,
  where a game's name comes from, and how a game is abandoned without finishing.
