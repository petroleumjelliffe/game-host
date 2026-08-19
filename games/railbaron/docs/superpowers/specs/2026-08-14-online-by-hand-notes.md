# Online mode — what building it found

Companion to `2026-08-14-online-mode-design.md` and the plan beside it. Findings are
recorded whether or not they changed the design, including the ones that found nothing.

## Status

Tasks 1–10 of the plan are built, tested and committed. Task 11's deploy and the
two-browser by-hand pass are **not done** — they need the owner's Render workspace and two
real browsers. Everything below the "still owed" line is outstanding.

Suite at the end of Task 10: **571 tests, 46 files, typecheck clean, production build
clean.** Baseline before the work was 490 tests.

## Findings

### The plan's blue home was not in the South East

`src/state/legal.test.ts`'s fixture was written as `{ city: 57, region: 'SE' }`. City 57 is
**El Paso, in SW**. The plan flagged its own city ids as remembered rather than checked and
said to verify them — doing so is what caught it. Chicago (20, NC) was right. Atlanta (9)
is the SE city the fixtures now use, and `d122` is a real neighbour of Chicago's node
`c24`. Nothing downstream was wrong, because the fixture was corrected before the first
test ran.

### The second seat is green, not blue

`SEATS` runs red, green, blue, yellow, black, white, and the lobby seats the first free id.
So a two-player online room is **red and green**. Three wire tests were written against a
blue guest and failed for exactly this reason. Worth stating plainly because pass-and-play
fixtures throughout the repo use red/blue — those are hand-built logs where any two seats
are legal, and the constraint only appears when the *server* does the seating.

### `src/state/storage.test.ts` cannot move to the node project

Task 3 moves the pure state tests into a Node environment. `storage.test.ts` is the one
file under `src/state/` whose subject *is* `localStorage`, so it needs jsdom and the bridge
in `src/test/setup.ts`. The plan caught `useGame.test.tsx` (a `.tsx`, excluded by the glob)
but not this one. The split now names it via an extglob — `src/state/!(storage).test.ts` —
used by both projects from one constant, so they cannot drift into running a file twice or
not at all. Counts reconciled exactly: +1 boundary test, +1 store test, +3 lobby files
carrying 12 tests.

### The lobby's server half did not compile under this repo's flags

Adding `vendor/lobby/server` to the tsconfig surfaced two `noUncheckedIndexedAccess`
errors in `leaveSeat` — both provably-safe reads, both invisible until now because no
consumer had compiled that half. The submodule's own HEAD commit is "fix: satisfy
noUncheckedIndexedAccess", so this was unfinished work in that repo rather than a
disagreement. Fixed and committed **inside the submodule** (`d43705e`).

> **This commit is not pushed.** Rail Baron's submodule pointer is deliberately NOT bumped
> until it is, because a pointer to a commit that is not on the remote breaks a fresh clone
> and the Render build. Push `vendor/lobby`, then bump the pointer here.

### Shutdown could lose the last move — fixed

Handlers deliberately do not await `persist`: a player should not wait on a disk to see
their own move. But `close()` was killing the process with saves still in flight. The
symptom in tests was a room that restored to nothing and a stray `.json.tmp` on disk; the
symptom in production would be **a Render deploy stopping the process mid-turn and losing
the last move**, which is precisely the case recovery exists for. `Rooms` now tracks
in-flight saves and `close()` awaits them.

This is the one finding here that was a real defect in shipped-shape code rather than a
test bug.

### Two socket-test races, both real

Every socket in a room receives every broadcast, so a "wait for the next log message"
helper resolves on the *other* client's append — presenting as an append that silently did
nothing, several steps later. The helper now waits for the event it actually sent.

The mirror of it: `onSeated` emits the log in the same breath as `joined`, so a listener
attached *after* awaiting `joined` misses it. This only failed under full-suite load, when
the two messages are not split across ticks the way an idle machine splits them.

### Golden games needed a destination the fixtures do not have

The golden fixtures are movement fixtures — they script rolls and legs and never roll a
destination. A real game always holds one and `appendLegality` says so ("roll a destination
first"), so `goldenSocket.test.ts` names a city **off the game's own route**, which the pawn
therefore never stands on, so one announcement covers the whole story. The wire being
stricter than `replay` is the point of having it.

### Port 3001 collides with the sibling Acquire server

Confirmed by hand: something was already serving `/health` on 3001 with
`{"protocolVersion":3,"saveVersion":5}` — not this server, which answers 1/1. `npm run
dev:all` will fail with `EADDRINUSE` if Acquire's server is up. `PORT` overrides it. Noted
in the README rather than changing the default, which Render sets anyway.

### The online routes mount their own Board — the flap is lost on one transition

`App` keeps one Board across its own routes so the flap plays between them. Sharing it with
online would mean calling `useRoom` unconditionally — hooks cannot be conditional — which
opens a socket to the game server on every load of the mode-select screen, for every player
who never goes online. The trade taken: **one lost flap on home → online**. Within online,
lobby → game → map keep the same Board and animate normally. The plan asked for this to be
written down rather than silently accepted if it proved unavoidable.

### Surfaced nothing

- `tsx` runs the server with extensionless imports and the `.js`-suffixed ones the lobby
  uses, side by side. Booted the real process and read `/health` back: `{"ok":true,
  "protocolVersion":1,"saveVersion":1}`.
- Extracting the game shell did not change pass-and-play: `src/App.test.tsx` passed
  unchanged and untouched, which is what makes it an extraction rather than a rewrite.
- The production build is clean and the map is still lazily split (105 kB separate chunk).

## What the first by-hand pass found (2026-08-15)

The owner ran the first real pass. Five bugs, zero caught by the suite as it stood, and
four of the five clustered in one stratum: the client glue between the lobby and the
boards. The root-cause analysis and the remediation are one story.

### The bugs

- **The join board could not be typed into.** `Board` matched the editing row by
  rebuilding a field id from a seat (`seat:${editing.seat}`), which could not express
  `roomCode` — the one editable field that is not a seat. `FieldId` had been widened; its
  consumer had not. Fixed: the prop carries the `FieldId` itself.
- **NEW ROOM failed silently.** `JoinRoomApp` never subscribed to `rejected`, and the
  thing refusing it was the sibling Acquire dev server on port 3001 answering protocol 3
  to a protocol-1 client. Fixed: refusals and an 8s no-answer timeout reach the board.
- **The port collision itself.** Both games default to 3001. `VITE_SERVER_PORT` in
  `.env.local` now moves server and client together — the server loads the same file, so
  no env prefix to forget (forgetting it was the first thing that happened).
- **The room stuck on "Reconnecting", roster empty, zero console errors.** `useRoom`
  built its connection in `useMemo` and closed it in an effect cleanup; StrictMode's
  mount-unmount-remount pass ran the cleanup — `close()` is a permanent
  `socket.disconnect()` — and `useMemo` never re-ran. The discarded first render also
  leaked a second orphaned socket.
- **Latent, found by reading Acquire while fixing the above: the creator would arrive in
  their own room as a stranger.** The join screen created the room on its own connection
  and closed it on navigate. Identity is only stored by the `joined` reply the *room*
  screen waits for, so at that moment the socket binding is the creator's only claim to
  their seat — and it was being thrown away.

### The correction to this document's own record

The plan (and an earlier comment in `useRoom`) claimed StrictMode's double-mount was
survivable because "the rejoin binding resolves it". **That claim was inherited without
verification and is false for the structure as built.** Acquire survives StrictMode
because its connection is a module-scope singleton no component lifecycle can close —
not because closing is harmless.

### The root cause, in one sentence

The client integration was built against the lobby's API surface rather than against its
proven usage pattern — which lived in Acquire's `src/net/connection.ts` and page tests —
and the lobby repo's "don't mock the socket" rule was over-extended to excuse the glue
layer from testing, which is exactly where all the bugs were.

### The remediation

`src/net/connection.ts` is now the reference pattern: one lazy module-owned connection,
`getConnection()`/`closeConnection()`, closed only on explicit leave. `useRoom` takes an
injectable `connect`, which is also how the new lifecycle tests observe socket creation
and closing with no server anywhere — the StrictMode test showed two-sockets-one-closed
against the old code. A wire test pins the server's same-socket rejoin (disable the
binding shortcut and the creator arrives as green in their own room). Lobby refusals the
roster outranks now reach the lobby board's sub. The consumer checklist is upstreamed:
multiplayer-game-lobby PR #3.

## Still owed

1. **Push `vendor/lobby`**, then bump this repo's submodule pointer.
2. **Reconcile the 1d/1f copy** against the Rail Baron Game Board Design project
   (Multiplayer Screens, boards 1d–1f). Structure is fixed and tested; labels and status
   text are house-voice placeholders and are flagged as such in
   `src/board/screens/online.ts`.
3. **Local two-browser pass**: `npm run dev:all`, two profiles — create, share-join, begin,
   homes, first turns, one undo, one refresh mid-turn (must rejoin to the same seat and
   state), one server restart (must restore).
4. **Render service** `railbaron-multiplayer`, starter plan, 1 GB disk at `/var/data`,
   `GAMES_DIR=/var/data/games`. Verify the deploy fired via the deploy list, then
   `curl /health`.
5. **Client with `VITE_SERVER_URL`** built and deployed to Pages; read the bundle hash back
   before believing it.
6. **Prod pass on two real machines**, including a deploy restart mid-game
   (`✓ Restored N room(s)` in the boot log, both browsers resume).
