# Backlog

Work that is known, understood, and not yet done. Each item says what the
evidence was, so nobody has to rediscover it.

For work deliberately excluded from the cutover, see the plan's
[Deliberately not in this plan](plans/2026-08-19-cutover.md) section —
~~a linter~~, ~~compiling `apps/host`~~, ~~a shared `packages/room-store`~~,
~~tightening CORS~~, ~~a shared remembered name~~. Those were scoped
decisions, not oversights, and **all five are now done**: the
[compile plan](plans/2026-08-20-compile-the-host.md), the
[room store](plans/2026-08-20-room-store.md), the
[lobby pass](plans/2026-08-20-the-lobby-pass.md)'s task 4 and
[the linter](plans/2026-08-20-the-linter.md) on 2026-08-20, and
[CORS](plans/2026-08-21-cors.md) on 2026-08-21 — that last one by deletion
rather than the narrowing the cutover expected.

---

## State of play, 2026-08-21

Where a fresh session picks up. Everything below this section is the
detailed record; this is the map.

**Done, and live on both origins** (each linked plan carries as-built
notes): the composed host is compiled and deployed by `git pull` (the
post-merge hook runs `deploy.sh`; a bare pull *is* the LAN deploy now); CI
builds before testing; items 1–3 below are all closed; the three
deferred-together shared items are done — the answer timeout and the
shared remembered name in [the lobby pass](plans/2026-08-20-the-lobby-pass.md)
(tasks 0–5, which also gave the lobby its own tests, one localStorage
answer, Marco Polo component tests, and a wire-level conformance suite),
and [`packages/room-store`](plans/2026-08-20-room-store.md) (Acquire's
`close()` now drains in-flight saves; Rail Baron got per-write temp names
and quarantine). Dependency versions are aligned — one line per shared
dep, Acquire moved up to meet the rest. And
[the linter](plans/2026-08-20-the-linter.md) landed — five type-aware rules,
one root invocation over all seven workspaces, its own CI job. **It found no
defects**, which is the part to remember before anyone cites it as evidence
that this kind of gate catches things here; the 35 promise findings a first
pass reported were two library return-type changes (react-router 7's
`navigate()`, socket.io 4.8.3's `close()`), not bugs. **No formatter**, and
that was measured: Prettier would rewrite 256 of 386 files to enforce a
style the tree already follows, and would fold Rail Baron's payout table
into two shapes down its own length. `.editorconfig` covers the rest. And
[CORS](plans/2026-08-21-cors.md) is gone — **deleted, not narrowed**, which
was the finding rather than the plan: nothing has been cross-origin since the
origin-relative work, there is not one `fetch()` in any client, and Marco Polo
had never carried CORS at all. Note what it does *not* do, because the name
invites over-reading: sockets are not origin-locked, since browsers never
applied CORS to the WebSocket handshake.

**Open, roughly in the order the plans themselves point:**

- **The per-game improvements** at the bottom of this file — spectator
  mode is the one lobby-shaped item among them, and task 5's conformance
  suite is groundwork it can build on.
- Smaller recorded items: Rail Baron's NodeNext split; the orphaned-`.tmp`
  boot sweep the room-store plan scoped out; Marco Polo's untypechecked
  build configs (below).

---

## Marco Polo's build configs are not typechecked

**Found 2026-08-20**, by the linter, which could not resolve them to any
project. `games/marcopolo/vite.config.ts` and `vitest.config.ts` belong to no
`tsconfig.json`: Marco Polo's `include` is `["protocol", "server"]`, while
Rail Baron and Acquire both list their `vite.config.ts` explicitly. Marco
Polo is the only game whose build configuration `tsc` never reads.

**It is hiding two real type errors.** Adding both files to the `include`
produces:

```
vitest.config.ts(8,9):  error TS2769: 'name' does not exist in type 'TestProjectInlineConfiguration | ...'
vitest.config.ts(19,9): error TS2769: 'name' does not exist in type 'TestProjectInlineConfiguration | ...'
```

Vitest 4 moved a project's `name` under `test`; Marco Polo's two projects
still declare it at the top level, so the labels are almost certainly being
dropped. The tests all pass either way, which is why nobody noticed.

**Fix:** move both `name` keys under `test`, confirm the project labels
appear in `vitest run` output, then add both files to the `include` and drop
`games/marcopolo/*.config.ts` from `allowDefaultProject` in
`eslint.config.mjs`. Small, and worth doing while the reason is written down.

---

## 1. Creating a room gives no feedback when the server is unreachable

**Found 2026-08-20**, the day the composed host took over the LAN. Reported as
"Marco Polo and Acquire both hung on creating a room the first time; I had to
reload the page and try again."

**Root cause, in three parts.** ~~The transport is not the problem — it
recovers.~~ **That claim was false** — see the correction below. `createRoom` is fire-and-forget (no ack, no timeout,
`packages/lobby/client/connection.ts`), socket.io buffers the emit while
disconnected and flushes it on reconnect. Verified in isolation: clicking with
the server down produced the room 2s after it came back, with no reload.

What fails is the UI, and only in two of the three games:

| Game           | On click with the server unreachable                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rail Baron** | 8s timeout clears state and says "No answer through … — is the game server behind it running?" (`src/OnlineApp.tsx`). **The reference.**                                     |
| **Acquire**    | `setWaiting(true)`, cleared only by `joined` or `rejected` (`src/pages/OnlineLobbyPage.tsx`). An _absent_ server sends neither, so the spinner latches on a disabled button. |
| **Marco Polo** | Bare `onClick` (`client/src/screens/HomeScreen.tsx`). No waiting state, no status check, no timeout — the click vanishes into the buffer with no feedback at all.            |

Acquire's file already carries a comment about this failure class — "a server
that is down or slow must not leave `waiting` latched forever on a disabled
button with no way out" — fixed for the `rejected` case and never for the
absent one. That is the whole bug in one sentence.

**Fix:** give both games what Rail Baron has. Both already receive connection
status (`'connecting' | 'open' | 'closed'`) from the shared lobby client and
neither reads it, so the button can also stop pretending it is live. One
commit per game, each with a failing test first — the suites can drive the
lobby client against a server that is not there.

**Why it matters beyond the incident:** no infrastructure change covers a
genuinely dead server. This is the fix that makes the symptom explain itself.

### Status, 2026-08-20

**Acquire: done.** 8s timeout, tested — the sibling of the rejection test that
was already there.

**Marco Polo: done**, the smaller way, as planned. The button reads the
connection status it was always handed and shows `CONNECTING…` disabled while
`status !== 'open'`, and `onRejected` — which had no subscriber anywhere in
that client, on any screen — now puts a line under the buttons. Still no
component test: its client has a jsdom project but no `@testing-library`, and
that decision stands. Verified in a browser against the real build instead.

~~It does not cover connected-but-silent. That is the shared timeout below, and
it is the only piece of this item still open.~~ Closed 2026-08-20, the shared
way: all three games now ride `packages/lobby/client/answerTimeout.ts` — see
below.

### The correction, 2026-08-20 — "the transport recovers" was false

Found while verifying the Marco Polo fix in a browser, which is the only
reason it was found at all: with the server killed and brought back, the page
sat dead thirty seconds after a five-second outage, while a raw websocket to
the very same socket.io path opened fine.

`packages/host/close.ts` opened with `disconnectSockets(true)`. socket.io's
client treats a **server-initiated** disconnect as final — reason
`io server disconnect`, `socket.active` false — and the manager never retries
again. Not on a longer backoff. Never.

So **every deploy left every open page permanently dead**, recoverable only by
a manual reload, for as long as the composed host has existed. The original
verification saw a recovery because it killed and restarted a server without
going through the graceful shutdown path — which is exactly the path a real
deploy takes.

Fixed by closing the engine alone, so the client sees a transport close and
retries by itself: connected → `CONNECTING…` at +0.4s → connected at +8.8s,
no reload. `twoGames.test.ts` asserted that a closing game disconnects its own
sockets and only its own; it never asked whether they could come back, and now
it does.

### The shared extraction — deferred on purpose, then done

**Done 2026-08-20**, tasks 3a/3b of
[the lobby pass](plans/2026-08-20-the-lobby-pass.md), which is the
all-of-them-at-once design pass this section asked for. The design note below
was honoured: `askWithTimeout` is a pure module beside the connection, takes
the ask and the two answer channels as arguments, and is tested with nothing
faked but time. All three games consume it; the screen tests that pin the
behaviour were written first, at the screen's own altitude. This item is
closed. The section stands as written because its reasoning is why the
extraction waited — and why it was safe when it happened.

The obvious fix is to put "ask, and be told when nothing answers" in
`packages/lobby/client`, so all three games share one implementation instead
of three hand-rolled ones of which two were wrong. **That is the right fix and
it is deliberately not being done during the cutover**, for the reasons the
plan already applies to the linter: a shared API touched by all three games
makes the diff unreviewable and the bisect useless, and it would drag Rail
Baron — the one game with no bug — into a change it does not need.

It also should not be designed alone. There are now three deferred shared
items in the same neighbourhood, and a pass that sees all of them will design
better than three reactive ones:

- ~~this answer timeout~~ (done 2026-08-20, the lobby pass, task 3b),
- ~~the shared remembered name~~ (done 2026-08-20, the lobby pass, task 4),
- ~~`packages/room-store`~~ (done 2026-08-20,
  [the room store](plans/2026-08-20-room-store.md) — Acquire got its
  `settled()`, Rail Baron its `quarantine()`, and the survey found both were
  live bugs, not niceties). All three of this neighbourhood are done, and
  they were designed together as this note asked.

**Design note for whoever takes it**, so the requirement is not rediscovered:
it does not belong inside `createLobbyConnection`. That interface documents
itself as untested on purpose — "a test that stubs `io()` and asserts `emit`
was called would restate this file rather than check it" — so the timeout
wants to be a pure module beside it, taking the ask and the two answer
channels as arguments. Then it is testable without a socket, which is the
whole reason the current version went untested and unwritten in two games.

**Planned, 2026-08-20:**
[the lobby pass](plans/2026-08-20-the-lobby-pass.md) takes all three, plus a
fourth thing that only became visible while verifying this item — the three
games' test infrastructure has diverged far enough to hide bugs, and Marco
Polo cannot render a component at all, which is why this item's Marco Polo
half was verified in a browser instead of in a test.

## 2. Every restart takes all three games down for ~2.3 seconds

`start-host.sh` runs `npm run build` and only then `exec npm run start:host`,
so the build happens _after_ the old process is gone. Measured:

|                                                             | before the first request is served |
| ----------------------------------------------------------- | ---------------------------------- |
| `npm run build && npm run start:host` (what the agent runs) | **2.3s**                           |
| `npm run start:host` alone                                  | **0.6s**                           |

Client-visible dead time is longer — 3.6–5.9s measured on the live host, with
2–3 `xhr poll error`s first — because socket.io's retry backoff (500ms,
doubling) means a client that fails at t=0 does not retry the moment the
server returns.

This is every deploy and every unattended `KeepAlive` crash restart, not just
a hand-run one.

**Fix:** build before stopping the old process, or take the build out of the
service start path and make it a deploy step. Keeping the build in
`start-host.sh` was a deliberate call — "a service restarted after a `git
pull` should serve the code that was pulled" — so this is a trade to make
knowingly, not a bug to squash.

**Note it does not close the window**, only shrinks it to ~0.6s. Item 1 is
what makes the remaining window survivable.

### Done, 2026-08-20

Both halves, in
[the compile plan](plans/2026-08-20-compile-the-host.md): the build moved to
`deploy.sh` and the agent now execs a prebuilt bundle instead of `tsx`, so the
0.6s floor became **179ms**. Measured spawn-to-served-`/health`, not
log-line-to-guess.

The larger gain was not the seconds. Building before stopping anything means a
broken build now leaves the old version serving, where before the old process
was already gone by the time the failure was discovered — and it is what made
the 9.1s `tsc` gate affordable, so a type error fails the deploy instead of
booting happily. It was verified to ship before: a planted
`const x: number = "..."` built clean under Vite and served all three games.

Still does not close the socket.io backoff window — item 1 remains what makes
that survivable — but ~0.2s is short enough that most clients will not notice
one at all.

## 3. `KeepAlive` does not restart the agent when the process is killed

Found 2026-08-20, by accident: a `pkill -f "tsx apps/host/main.ts"` aimed at a
stray test server also matched the launchd agent, and **the agent did not come
back**. `launchctl list` showed the label with no PID and last exit status 0;
the front door served 502 until `launchctl kickstart -k` by hand.

`launchd/com.game-host.plist` sets `KeepAlive` / `SuccessfulExit: false`, and
its comment reads: "Restart on crash, not on clean exit — so `launchctl
bootout` (and a deliberate stop) stays stopped, but a wedged process comes
back… this is the only thing standing between one bad payload and an evening
ending."

That protection is weaker than it claims. The agent runs `npm run start:host`,
and npm exits **0** when its child is signalled — so launchd sees a successful
exit and leaves it down. Anything that signals the process rather than
crashing it inside node lands in that hole: an OOM kill, a stray `pkill`, a
`killall node`.

### Answered, 2026-08-20 — and the diagnosis above is wrong

Reproduced under scratch launchd agents rather than reasoned about. **npm is
not the culprit; `tsx` is.** With npm running `node` directly, a signalled
child came back as `-15` and launchd restarted it. The agent's real chain was
`sh -> npm -> tsx -> node`, and `pkill -f "tsx apps/host/main.ts"` matches the
**tsx wrapper** — `tsx` treats SIGTERM as a graceful shutdown and exits **0**,
npm faithfully reports that 0, and `SuccessfulExit: false` reads a clean exit.
A scratch agent running the exact chain reproduced `-  0  <label>`, stopped,
first try.

**Partly fixed** by compiling: `start-host.sh` now `exec`s `node` on a bundle,
so there is no wrapper, the PID launchd tracks is the server itself, and a
`pkill -f tsx` cannot match it at all. Verified on the real artifact under a
scratch agent: **SIGKILL restarts it, `bootout` stays stopped.**

**Not fixed, and should not be:** a SIGTERM still leaves it down, because
`apps/host/main.ts` handles SIGTERM by draining and exiting 0 — which is
exactly what `launchctl bootout` sends. Nothing can distinguish a deliberate
stop from a stray `kill -TERM` without breaking the deliberate stop. The
operational lesson is the durable one: **never `pkill -f` on the host
machine.**

**Related:** item 2. Both are about what happens when the one process serving
every game goes away — one measures how long it takes to come back, this one
is about whether it comes back at all.

## Per game improvmeents

### Lobby

- spectator mode for all games
- better create room feedback while server responding or down

### Rail baron

- earn money from deliveries, pay money to track owners, buy lines
- map animation for desination rolls and region picking
- auto pan/zoom when moving
- better controls to select next node

### Marco polo

- splashing water action
- tap to move farther but make a splash
- turbo meter?

### Acquire

- finish applying reskin
- broadcast per step moves to minimize other players wait times
- move lobby in game?
