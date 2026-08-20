# Backlog

Work that is known, understood, and not yet done. Each item says what the
evidence was, so nobody has to rediscover it.

For work deliberately excluded from the cutover, see the plan's
[Deliberately not in this plan](plans/2026-08-19-cutover.md) section — a
linter, compiling `apps/host`, a shared `packages/room-store`, tightening
CORS, a shared remembered name. Those are scoped decisions, not oversights.

---

## 1. Creating a room gives no feedback when the server is unreachable

**Found 2026-08-20**, the day the composed host took over the LAN. Reported as
"Marco Polo and Acquire both hung on creating a room the first time; I had to
reload the page and try again."

**Root cause, in three parts.** The transport is not the problem — it
recovers. `createRoom` is fire-and-forget (no ack, no timeout,
`packages/lobby/client/connection.ts`), socket.io buffers the emit while
disconnected and flushes it on reconnect. Verified in isolation: clicking with
the server down produced the room 2s after it came back, with no reload.

What fails is the UI, and only in two of the three games:

| Game | On click with the server unreachable |
| --- | --- |
| **Rail Baron** | 8s timeout clears state and says "No answer through … — is the game server behind it running?" (`src/OnlineApp.tsx`). **The reference.** |
| **Acquire** | `setWaiting(true)`, cleared only by `joined` or `rejected` (`src/pages/OnlineLobbyPage.tsx`). An *absent* server sends neither, so the spinner latches on a disabled button. |
| **Marco Polo** | Bare `onClick` (`client/src/screens/HomeScreen.tsx`). No waiting state, no status check, no timeout — the click vanishes into the buffer with no feedback at all. |

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

**Marco Polo: open.** It needs the same treatment and has none of it: no
waiting state, no status check, no timeout. Two ways in, and the smaller one
is deliberately preferred for now:

- *Now, when someone picks it up:* the button reads the connection status it
  is already handed and shows `CONNECTING…` while `status !== 'open'` instead
  of swallowing the click. ~10 lines, no new dependency. It does not cover
  connected-but-silent — that is what the shared timeout below is for.
- *Not now:* a component test. Marco Polo's client has a jsdom project but no
  `@testing-library`, so testing this means adding a dev dependency, and a
  dependency added mid-cutover is the linter argument again. **Testing follows
  once the shared extraction lands** — decided 2026-08-20.

### The shared extraction — deferred on purpose

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

- this answer timeout,
- the shared remembered name (`lobby.name` instead of one per game — plan,
  "Deliberately not in this plan"),
- `packages/room-store`, which would give Acquire the `settled()` it lacks and
  Rail Baron the `quarantine()` it lacks.

**Design note for whoever takes it**, so the requirement is not rediscovered:
it does not belong inside `createLobbyConnection`. That interface documents
itself as untested on purpose — "a test that stubs `io()` and asserts `emit`
was called would restate this file rather than check it" — so the timeout
wants to be a pure module beside it, taking the ask and the two answer
channels as arguments. Then it is testable without a socket, which is the
whole reason the current version went untested and unwritten in two games.

## 2. Every restart takes all three games down for ~2.3 seconds

`start-host.sh` runs `npm run build` and only then `exec npm run start:host`,
so the build happens *after* the old process is gone. Measured:

| | before the first request is served |
| --- | --- |
| `npm run build && npm run start:host` (what the agent runs) | **2.3s** |
| `npm run start:host` alone | **0.6s** |

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
