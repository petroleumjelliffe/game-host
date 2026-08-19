# Continuation plan — picking up from 2026-08-07

**Written for:** resuming on a different machine, cold.
**Branch to start from:** `revamp/online-lobby-mockup` — **unmerged**, pushed to origin. Everything
below assumes you have checked it out. `main` is three commits behind it.

## The state of the world

One day closed Stages 0–2 of [the round](../specs/2026-08-07-next-round-sequencing.md) and
deployed them: the two-browser full game was driven (via a new dev-only seeding route), the wire
and save record are versioned, and pass-and-play persists. All of that is **live** — prod client
and server both speak protocol **v1**, `SAVE_VERSION` 5.

The unmerged branch holds three commits that move the wire to **v2**:

| Commit | What |
|---|---|
| `33c2eee` | Online lobby copy/chips to the Lobby Flow design (restyle only) |
| `033af7a` | `renamePlayer` + `leaveSeat`, protocol v2, CreateRoomPage deleted — Create Room seats you immediately, the room's own-row edit is where names change |
| `23c88f0` | Board headers removed (aspect now 12/9); buy step gains the Pass gate — End turn is disabled over an empty basket until Pass is pressed, auto-pressed when nothing is buyable |

747 tests in 69 files, five gates green, clean output at `23c88f0`.

## Machine setup gotchas (each cost real time today)

- **`.env.local` is gitignored and machine-local.** If the new machine has one pointing
  `VITE_SERVER_URL` at Render, a local **v2** client will hit the deployed **v1** server and get
  the stale-client screen — the feature working, looking like a bug. Comment it out for local
  work; local needs `npm run dev:all` anyway.
- **Run the pre-flight before any by-hand pass**, and quote the caret:
  `lsof ... | grep '^n' ...` (unquoted `^n` is zsh glob negation — see the Stage 0 plan). Confirm
  both 5173 and 3001 map to *this* checkout.
- **`curl https://acquire-multiplayer.onrender.com/health`** tells you what prod speaks:
  `{ok,protocolVersion,saveVersion}` — absence of the version fields means pre-Stage-1 code.
- Render auto-deploys `main` on push (~6 min; poll `/health`). GitHub Pages is
  `npm run build && npm run deploy`, then ~1 min of CDN lag — verify the served bundle hash, do
  not assume.
- The Render MCP connector is authorized at the account level and follows you.
- **Dependencies are frozen no longer** (the freeze ended with Stage 2), but do upgrades as their
  own branch with full gates — `npm audit fix` rewrote 885/1156 lockfile lines when it ran unasked.

## Step 1 — verify and ship the branch

1. By hand, locally (`npm run dev:all`, two browser profiles):
   - Create Room — no name form; you land seated under a default name
   - Edit your name on your row; watch the other browser's roster update
   - × your seat; roster shrinks, host flag moves if the host left
   - Any pass-and-play turn: the headerless board, and the buy step's Pass → End turn arming
     (stage a share instead and Confirm purchase replaces the pair; sold-out-everything starts
     Pass pressed — `/scenarios` can get you there)
2. Merge to `main`, push — **this deploys the v2 server**. Then build + `npm run deploy` for the
   client. One push, both halves; any open tab shows the stale-client screen once and reloads
   clean. Verify: `/health` says `protocolVersion: 2`, GH Pages serves the new bundle hash.
3. **The ten-minute prod pass, immediately after** — the two Phase 4 scenarios still owed on
   Render: refresh mid-turn (back to your open draft, tile still placed), and a dropped socket
   (airplane-mode a phone mid-game, watch the pill and the away dot, reconnect). Record what you
   see in a by-hand note; the away dot on *prod* has still never been observed.

## Step 2 — Stage 3: the layout gate

The last open stage, and it starts with a live lead instead of a mystery:
`scripts/verify-layout.mjs` drives a **persistent Chrome profile**
(`--user-data-dir=/tmp/acquire-verify-layout-profile`), so every run depends on run history.
Stage 2 proved the mechanism when the gate's own saved game broke its next run.

- Reproduce first: loop the gate ~20× on the persistent profile, log failures and their shapes.
- Then swap to a `mkdtemp` throwaway profile per run and loop again. If the flake rate drops to
  zero, the mechanism is confirmed; keep the throwaway profile (the `localStorage.clear()` calls
  added in Stage 2 become belt-and-braces).
- If it does not, the lead is dead — record that honestly and keep looking; timing sensitivity in
  the fixed `sleep`s is suspect two.
- Close by updating the "intermittently flaky, treat green as weak evidence" warnings in CLAUDE.md
  and the carry-forwards — that caveat is quoted in four documents and every one should be
  retired or reaffirmed on evidence.

> **Done 2026-08-08, and the lead above was wrong.** The persistent profile was not the cause; the
> cause was the gate rounding each zone's height before summing and comparing exactly, so
> fractional heights near `.5` shifted a sum by 1px with no layout change. Retired on evidence, as
> this bullet asked. The profile and port hazards were removed anyway. See `CLAUDE.md` under
> Commands and the closed Stage 3 section in the sequencing spec.

## Step 3 — the decision queue (owner picks, none scheduled)

In recommended order:

1. **Durable `RoomStore`** — Render KV or Postgres via the MCP, second implementation behind the
   existing interface. Converts the gone-room ending from the *normal* prod case to a rarity —
   the biggest player-facing win available. Revisit the eviction policy and gone-room copy with
   it, since both were written for an ephemeral world.
2. **PWA** — both stated gates now exist (persistence + protocol version). Manifest and icons
   (colours from `tokens.ts`), service worker for the shell, and the update path: the
   stale-client screen's reload must get past the worker.
3. **Presence design pass** — Stage 0's two open findings: the away dot rides a roster row
   designed to clip (tap-to-expand is the anticipated answer), and final scoring has no presence
   at all. Add `/catalog`'s missing online/away states with it — their absence is why the clipped
   dot went unseen.
4. **Spectator seat + panel-only phone view** — wanted together, own design pass (see the
   roadmap's out-of-scope section for the constraints already recorded).
5. **Dependency upgrades** — own branch, full gates.

**Ride-alongs** for whichever branch touches their files: `LiqQueue` design review (still never
had one), seat-name truncation at 768px, `sections.tsx` building every fixture at module load.
The old "read-only board cells are `<button>`s" item looks already fixed — verify with one
tab-through and strike it.

## How this project works (the short version for a cold start)

Read `CLAUDE.md` first — commands, the two-vitest-project split, the working rules. The ones that
earned their place today, twice each: **prove a new test can fail by breaking the code** (three
hollow gates were caught this way today alone — the running total is thirteen); **verify which
tree is serving before trusting any by-hand result**; and **a deploy is not done until you have
read its version back** from `/health` or the served bundle hash.
