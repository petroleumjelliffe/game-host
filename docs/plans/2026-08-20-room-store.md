# The room store

**Status:** proposed 2026-08-20. The last of the three deferred-together
items from [the cutover](2026-08-19-cutover.md)'s "Deliberately not in this
plan" — the answer timeout and the shared name went in
[the lobby pass](2026-08-20-the-lobby-pass.md); this is the one it left out,
deliberately, because it is server-side where those were client-side.
**Follows:** [backlog](../backlog.md) item 1's design-together note.

## What the survey found, and why this is not just tidying

Two file stores, 111 and 262 lines, each carrying a hard-won behaviour the
other lacks — and each lacking one the other has hard-won reasons for. That
is not duplication to compress; it is two halves of one correct
implementation, shipped to two games:

| | Rail Baron | Acquire |
| --- | --- | --- |
| atomic temp-and-rename | yes — but **one temp name per room** | yes, unique per write, with the collision analysis in a 20-line comment |
| per-room write ordering | none | promise chain per room |
| drain before shutdown | `settled()`, and `close()` awaits it | **nothing — `close()` never drains** |
| unreadable files | warn at **every boot, forever** | quarantined aside as `.bad`, once |

The two gaps are live bugs, not style:

- **Acquire loses the last write on every deploy that catches one in
  flight.** Its handlers save fire-and-forget (correctly — a player should
  not wait on a disk), its store chains the writes (correctly), and its
  `close()` then abandons the chains. Rail Baron's own comment names the
  stakes: "the last move of every game is lost exactly when it matters
  most." Since the pull-is-the-deploy hook, deploys happen the moment a
  merge lands — the window is real and recurring.
- **Rail Baron's shared `.tmp` name is the exact hazard Acquire's comment
  dissects.** Two same-room saves in flight — and nothing in Rail Baron
  orders them — can overwrite each other's staging file, so the loser of
  the race is the *newer* state, or an ENOENT from a rename whose source a
  sibling already took. Acquire fixed this with per-write names and wrote
  down why; Rail Baron never caught it.

Marco Polo persists nothing, by design, and stays out of this entirely.

## The design

`packages/room-store` — one package, storage mechanics only, the division
both existing files already declare ("this file will hand back anything it
can parse and decides nothing"). Policy — eviction age, protocol-skew
handling, what to log — stays in each game's registry, where both games
already keep it.

The record is generic over its payload, because that is precisely what
differs: Rail Baron persists a `log` of events, Acquire a committed `state`
and a segment cursor. What they share is the envelope, down to the player
type — Acquire's `RoomPlayer` is literally `= SeatHolder`:

```ts
export interface SavedRoomEnvelope {
  roomId: string;
  version: number;         // the game's own SAVE_VERSION; the store never interprets it
  protocolVersion: number;
  savedAt: number;
  players: SeatHolder[];
}

createFileStore<R extends SavedRoomEnvelope>(
  dir: string,
  isRecord: (value: unknown) => value is R,   // the game's whole-record guard
): RoomStore<R>
```

`RoomStore` is the union of the two interfaces: `save`, `loadAll`, `remove`,
`quarantine`, `settled`. A `hasEnvelope(value, version)` helper does the
shared half of validation (including `isSeatHolder`), so each game's guard
shrinks to its payload. `createNullStore()` comes along — it is the
registry-default and test-default both games want.

Mechanics take the best of each, by name:

- Acquire's writes: per-room promise chain, unique-per-write temp names,
  both comments carried over intact — they are the record of why.
- Rail Baron's `settled()`: the loop-not-one-batch form, for its stated
  reason (awaiting a batch yields, and a handler may start another save),
  applied to the chain map the store now owns. Draining moves *into* the
  store: the chains live there, so the knowledge of what is in flight does
  too.
- Acquire's `quarantine`: a rename, never an unlink, same comment.
- **The store logs nothing.** Acquire's store warns and *also* returns
  `unreadable`, and its registry warns again — one file, two lines. Rail
  Baron's store is silent and its registry speaks. Silent-store is the
  division both files claim in their opening comment, so it wins; each
  registry keeps its one line. (Acquire's `!`-not-`✗` glyph reasoning moves
  with the message to where the message lives.)

## Test first, or fix first — applied

Same seam rule as the lobby pass. The store mechanics are *below* the seam
and already characterized by 20 tests across the two `store.test.ts` files —
those move to the package where the mechanics move, adjusted only in import
and in the record fixtures they build. The two behaviour changes are *above*
it and get failing tests first, in the game they fix:

- Acquire: a save still in flight when `close()` is called is on disk
  afterwards. Red today.
- Rail Baron: a boot that skips an unreadable file sets it aside; the
  second boot does not mention it. Red today.

## Tasks

**1. `packages/room-store`, with the merged mechanics and both games'
mechanics tests.** New workspace, `@game-host/room-store`, depending only on
`@game-host/lobby` (for `SeatHolder`) and node builtins. Port the mechanics
tests from both games' `store.test.ts` (temp-name isolation, chain ordering,
missing-dir loadAll, unreadable listing, quarantine idempotence, null
store); the per-game validator tests stay behind. Gate: package suite green;
nothing else touched yet.

**2. Acquire adopts, and `close()` drains.** Failing test first. Its
`store.ts` shrinks to the record type, `SAVE_VERSION`, the payload guard,
and a `createFileStore(dir, isSavedRoom)` call; `close()` gains
`await store.settled()` before `closeSockets`. The double-logged unreadable
line becomes the registry's alone.

**3. Rail Baron adopts, and skipped files stop warning forever.** Failing
test first. Its `store.ts` shrinks the same way; `rooms.ts` drops its
`inFlight` set (`settled` is the store's now) and its restore quarantines
what it skips, with Acquire's one-line-then-silence behaviour.

**4. Close the loop in the docs.** Backlog item 1's neighbourhood note gets
its third strike-through; the cutover plan's "Deliberately not in this
plan" gets a pointer. The compiled-host constraint holds throughout: the
new package must not add a runtime import that is not a production
dependency — it needs none.

**Done when:** both failing tests pass, both `store.ts` files are payload
definitions rather than implementations, the suite is at or above **1654
tests / 157 files**, and a kill-mid-save rehearsal against the composed
host (task 2's test, run over the wire) shows the last write surviving.

## Deliberately not in this plan

- **A second backend.** Acquire's store comment already refused this once:
  "a guess about a decision nobody has made yet." Render has a persistent
  disk now; nothing needs S3.
- **A boot-time `.tmp` sweep.** Orphaned temp files are leftover bytes, not
  a restore bug; Acquire's restore comment scopes this out and that stands.
- **Sharing restore/eviction policy.** MAX_AGE_MS, protocol-skew handling
  and adopt-vs-rebuild differ per game and belong to their registries.
