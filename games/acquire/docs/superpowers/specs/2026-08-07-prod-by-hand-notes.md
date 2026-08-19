# The prod by-hand pass — 2026-08-07

**Owed since Phase 4**, which drove all three recovery scenarios locally and none on Render. Run
immediately after protocol v2 was deployed, against
`https://petroleumjelliffe.github.io/acquire-startups-m1/` and
`https://acquire-multiplayer.onrender.com`.

**Driven by Claude over CDP**, not by a human eye — two real browsers against the real deployment,
but every judgement below is a measurement rather than an impression. The one thing this cannot
substitute for is noticing something nobody thought to assert.

Two browser contexts, isolated so each got its own `localStorage`: Player 1 in the default context,
Player 2 in a named isolated one. Room `XMWHPD`.

## The deploy itself

| | before | after | observed |
|---|---|---|---|
| `/health` | `protocolVersion: 1` | `protocolVersion: 2` | 20:53:14 |
| GH Pages bundle | `index-e6b51d00.js` | `index-ac2efd0b.js` | 20:54:19 |

GitHub Pages took ~90 seconds and served the old bundle for the first two polls.

### A correction, recorded because the mistake is the interesting part

The first version of this note said "Render took ~12 minutes, not the ~6 the continuation plan
predicts", and that `/health` "stopped answering at all for ~6½ minutes" mid-restart. **Both were
wrong**, and the Render API says so:

- The deploy that made prod v2 is `dep-d9r7rjn40ujc73asrblg`, `trigger: **manual**`, built
  `00:52:30 → 00:52:54` — **24 seconds**, live by 00:53:27. The push at 00:41 fired *nothing*,
  because auto-deploy was broken (fixed by the owner immediately afterwards). The "12 minutes" was
  the wait for a human to notice, timed as though it were a build.
- The "silent window" was a **gap in the polling loop itself** (00:45:07 → 00:51:53), not the
  server. The samples on either side both answered `protocolVersion: 1` normally. Nothing was ever
  observed failing to answer.

The rule this broke is already in `CLAUDE.md` — *a measurement you did not measure is the same
defect* — and it broke in a new way worth naming: **`/health` cannot distinguish "still building"
from "never started"**. Polling an endpoint until it changes measures the interval, and then
invites you to attribute it to whatever you assumed was happening. `list_deploys` reports the
trigger and the real timings; it is the thing to read before claiming a duration.

## Scenario 1 — refresh mid-turn ✅

Player 2 placed C2, leaving an **open draft** (step stack showing `YOU PLACED A TILE ↺ undo C2`,
buy step open). Hard reload.

Came back **identical**: same step stack, same undo, `C2` still `filled`, hand unchanged
(`C4 D12 G9 I3 I9`), Pass/End turn in the same states. That is the `resume` reason handing the
actor their own open draft rather than the state at the start of their turn — the bug Phase 4
turned out to exist for — **working on Render for the first time**.

## Scenario 2 — a dropped socket ✅, and the away dot on prod at last

Player 2 taken offline with CDP network emulation (`Offline`). Not a real radio drop; it is the
same client code path, but it does not exercise mobile Safari or a flaky link.

**The offline player** saw two lines, which is one more than expected and reads well:

```
No network — waiting for this device to reconnect
Disconnected. Reconnecting…
```

**The other player** saw the toast become `🐢 Player 2 is up — disconnected`, and the away dot
appear on the roster row. **This is the first observation of the away dot on prod** — it is called
out as never-seen in the Phase 4 carry-forward and the continuation plan.

**The draft stayed private across the drop.** While Player 2 held C2 in an uncommitted draft,
Player 1's board reported `C2: empty` and only the two turn-order tiles as `filled`. The segment
model holding under a disconnection is worth more than it sounds: it is the guarantee that a
dropped player cannot leak a half-made move.

Clearing the emulation recovered fully — banners gone, toast back to `Player 2 is up`, the open
draft and its undo intact, and `C2` still `filled` on Player 2's own board.

## What this pass did **not** establish

- **Recovery time is not measured.** The reconnect had already completed before the first 500ms
  sample, so the honest statement is "faster than 500ms to first observation", not a number. Phase
  4 wrote up an unmeasured "4–7 seconds" that turned out to be 98ms; this note is not repeating it.
- **The clipped away dot is still unexercised.** The open Stage 0 finding is about a disconnected
  *non-actor* scrolling off a roster designed to clip. Here the disconnected player was the
  **actor**, so rotation kept them first and fully visible (176px). Reproducing the finding needs
  five or six seats, and this was heads-up.
- **The cold-start copy ruling is still owed.** The complaint is that the copy asserts a cause it
  cannot know. It did not appear here, because a *device-offline* drop has its own honest wording
  ("No network — waiting for this device to reconnect"). The unresolved case is
  **online-but-unreachable**, which this pass never produced.
- **The gone-room ending was not seen.** The deploy restarted the server onto a fresh disk, so
  every pre-existing room did die — but no browser was sitting in one to watch it happen.

## Incidental confirmations

- **The Pass gate** behaves as designed: with nothing founded and nothing buyable, `Pass` was
  already **disabled** (auto-pressed) and `End turn` live. Not a bypass.
- **Server-assigned names** work end to end on prod: both players seated as `Player 1` / `Player 2`
  with the seat emoji (🦊 / 🐢) as a separate chip, which is the conflation protocol v2 removed.
- **Join by code** on the shared lobby card works against Render: typing `XMWHPD` into the block the
  host reads it from filled the roster with both players, and the host's button flipped from
  `Waiting for another player` to `Start game` live.
