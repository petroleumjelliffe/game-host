# multiplayer-game-lobby

Rooms, seats, join/rejoin tokens, presence, rename and leave — game-agnostic,
shared by [Acquire](https://github.com/petroleumjelliffe/acquire-startups-m1)
and [Rail Baron](https://github.com/petroleumjelliffe/railbaron).

```
protocol/   wire types, node-safe
server/     seating registry and socket handlers
client/     headless React: identity, connection, useLobbyRoom, view
```

Extracted from `acquire-startups-m1` at `64a533b` on 2026-08-13, with history —
`git log` here reaches back to the commit that first split the wire in two.

## Two rules for a consumer

**Shared as source, not as a package.** Acquire and Rail Baron are on different
React versions, and a built artifact would bake one React's JSX runtime and hook
types into both. Each consumer compiles these files with its own toolchain, as a
git submodule at `vendor/lobby`.

**Include only what you use.** A game with no server must keep `server/` out of
its `tsconfig` include — it imports `socket.io`, and the fix for the resulting
error is not to install `socket.io` but to stop compiling code you do not run.

## What this is not

**There is no UI here, and that is a correction rather than an omission.** An
earlier version shipped a "themeable default UI" behind three `--lobby-*` CSS
variables. Rail Baron — the first real second consumer — has neither Tailwind
nor `className`, and its lobby *is* a seven-row split-flap departures board,
which no amount of theming turns a card into.

What is shared is the **element inventory**, not components: representatives of
players, a way to add players, a share link, a begin control, presence, and
terminal states. `client/view.ts` hands those over as data; every game draws
them itself.

**No badge, either.** Decoration is derived by the game from the seat — Acquire
reads an emoji by seat index, Rail Baron's seat ids *are* its colours. Letting a
player *pick* one would be a choice rather than a derivation, and would need an
opaque field here plus uniqueness enforcement.

## The contract a game implements

See [`protocol/README.md`](protocol/README.md) — the room shape, the two hooks
(`onBegin`, `onSeated`), the protocol version, the `appId` namespace, and the
seat-id space the game supplies.

## Tests

There is no build tooling here on purpose: this repo is compiled by its
consumers, and its tests run in theirs. Point your vitest globs at
`vendor/lobby/protocol/**`, `vendor/lobby/server/**` (node) and
`vendor/lobby/client/**` (jsdom). A consumer that does not run these will not
notice when a submodule bump breaks it.
