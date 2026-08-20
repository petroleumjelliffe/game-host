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
