# Roadmap

**Written 2026-08-21.** What order the open work happens in, and roughly what
each piece costs. Revised whenever something lands.

**This file owns order and size. [`backlog.md`](backlog.md) owns evidence.**
That division is deliberate and worth keeping: the backlog says *what was
found and how*, one entry per item, and never sequences anything; this file
sequences and never re-argues the evidence. When they disagree about a fact,
the backlog wins and this file is stale. Two documents that both try to be the
record is how `CLAUDE.md` ended up asserting a retired deploy was live for a
day — see [the CORS plan](plans/2026-08-21-cors.md)'s As-built notes.

Implementation plans live in [`plans/`](plans/), are dated, and cover exactly
one scoped piece each. This file is not one of those and contains no code.

---

## The through-line: Rail Baron cannot currently be won

Everything below is ordered around one fact, decided 2026-08-21.

[`server/rooms.ts:38`](../games/railbaron/server/rooms.ts#L38) says it plainly:
*"'over' is unreachable: the game has no end rule yet. When the money spec
lands one, it will be derived from the log right here, exactly as 'playing'
is."* There is no balance anywhere in the game state. `payoutBetween(a, b)`
([`engine/payouts.ts:78`](../games/railbaron/engine/payouts.ts#L78)) computes a
correct payout that nothing banks. Both places that choose a train hardcode
`'freight'`, each with a comment saying the money spec is what makes it a
lookup.

So this is not an enhancement on a working game. Rail Baron is half a game,
and the missing half already has a name — **sixteen comments across the
codebase call it "the money spec"** and leave seams for it. Gathering those
sixteen is the first task of its design, not a nicety.

**The engine is already committed to the published ruleset**, which removes a
whole design argument before it starts:

| Already modelled | Where |
| --- | --- |
| `'freight' \| 'express' \| 'superchief'` | [`engine/dice.ts:11`](../games/railbaron/engine/dice.ts#L11) |
| The bonus-roll rule, per train | `earnsBonus(train, white)`, same file |
| 28 railroads, named and mapped | [`engine/network.json`](../games/railbaron/engine/network.json) |
| The full payout matrix | [`engine/payouts.ts`](../games/railbaron/engine/payouts.ts) |
| Destination rolling by region and city | `engine/rollTable.ts`, `engine/regions.ts` |

What is missing is money and everything money touches.

---

## Phase 0 — the small items, one of which is not small

The backlog groups three things in a single line as "smaller recorded items".
Checked 2026-08-21, that grouping was wrong in both directions: one was small,
one was a phase 1 prerequisite (now done), and one is not work at all. A
fourth turned up while doing the second.

1. **Marco Polo's build configs are not typechecked.** *Genuinely small.*
   `vite.config.ts` and `vitest.config.ts` are in no `tsconfig.json` — the only
   build configs in the repo `tsc` never reads, and they hide two real Vitest 4
   type errors where a project's `name` sits above `test` instead of inside it.
   Fix, then drop `games/marcopolo/*.config.ts` from `allowDefaultProject` in
   `eslint.config.mjs`. Found by the linter; full write-up in the backlog.

2. ~~**Rail Baron's NodeNext split.**~~ **Done 2026-08-21** — 93 lines across
   29 files, landed before phase 1 exactly so a 137-import rename would not
   collide with money-spec work in `src/state/`.

   Two of phase 0's Task 8 claims were wrong and are corrected in the commit:
   the count was **137 candidates, not ~74** (it never counted `engine/`, which
   the server reaches through `src/state/`), and it does **not** let the server
   run under plain `node` — which was its stated motivation. That motivation
   was already obsolete: `apps/host` has compiled since 2026-08-20 because
   esbuild resolves extensionless imports happily. What it buys is `tsc`
   verifying the server's module graph under Node's resolution instead of the
   bundler's laxer one.

3. **Acquire's `tsconfig.server.json` is unenforced.** *Found 2026-08-21,
   while doing item 2.* Nothing runs it, so Acquire's server is typechecked
   under `bundler` like Rail Baron's was — Acquire's own carry-forward spec
   called this out in August and it was never actioned. Its `server/` is
   already `.js`-clean by hand (0 extensionless imports), but enforcing the
   config pulls in `engine/` (121) and `session/` (16). Cheaper than Rail
   Baron's in the directory that matters, more expensive overall. Recorded in
   the backlog; not scheduled.

4. **The orphaned-`.tmp` boot sweep — do not plan this.** It was not deferred;
   it was **declined**, in the room store plan's *Deliberately not in this
   plan*: *"Orphaned temp files are leftover bytes, not a restore bug; Acquire's
   restore comment scopes this out and that stands."* The backlog's summary line
   lists it beside two real items, which reads as a to-do it never was. Strike
   it there, or restate it as a closed decision.

So what remains of phase 0 is item 1, plus deciding whether item 3 is worth
enforcing. Item 2 is done; item 4 should be un-listed.

---

## ~~Phase 1 — the money spec, part one: make it finishable~~ — done 2026-08-22

**Done 2026-08-22** — [spec](../specs/2026-08-22-money-phase-1.md),
[plan](plans/2026-08-22-money-phase-1.md), both with as-built notes. Smaller
than sized, because most of it already existed: payoutBetween was correct and
unused, the arrived event had carried payout on the wire all along, and the
fold already summed it. What actually landed: banked (earned minus the
in-flight trip — the timing caveat the spec caught), homeward, the winner
derived from the moved that ends at home, appendLegality closing finished
games and auditing payouts against the table, rules.json read once and
stamped into started, seeded games that verify their own dice, the Total
tile, and the golden standards shelf at two layers. **Rail Baron can be
won.** The original slice text follows for the record.

**In scope:**

- **A balance per player**, in the game state and in the log-folding that
  derives it. Rail Baron's state is rebuilt from its log
  (`src/state/game.ts`), so money is a fold, not a field that gets mutated —
  which also means an existing saved room replays into a balance for free.
- **Payout on arrival**, using `payoutBetween()` as it already stands. This is
  the one piece where the engine work is genuinely done.
- **An end rule**, derived from the log in `rooms.ts` exactly where the comment
  says, so `'over'` becomes reachable and `lifecycle()` can return it.
- **A rules config file** — see *House rules*, below. Phase 1 needs two
  settings out of it: the **win target** (default the published $200,000) and
  the **starting train type** (default `'freight'`, which is what both
  hardcoded constants currently assume).
- **Whatever UI says how much money you have.** Minimal — a number per player
  in the existing board furniture, not a redesign.

**Out of scope, deliberately:** ownership, rent, train upgrades. Phase 1 ends
with money that can be earned and a game that can be won, and nothing yet to
spend it on. That is a real half-state and it is the point of the slice.

**The one decision this phase must not duck:** the full published win
condition is a cash target *plus* owning at least one railroad *plus*
returning to your home city. Phase 1 has no ownership, so it cannot implement
the middle clause. Either the end rule is cash-plus-home-city for now and
gains the ownership clause in phase 2, or phase 1 ships a deliberately
different rule. Decide it in the money spec, in writing, because a win
condition that quietly changes between phases is the kind of thing that ruins
a game night mid-game.

---

## ~~Phase 2 — the money spec, part two: the economy~~ — done 2026-08-23

**Done 2026-08-23** — [spec](../specs/2026-08-23-money-phase-2.md),
[plan](plans/2026-08-23-money-phase-2.md), built from the three rulebook
transcriptions in `games/railbaron/docs/rules/`. What landed: the 28
railroad prices pinned by digest, `bought`/`declared`/`sold` events, user
fees as a pure derivation (three tiers, one fee per owner, settled at turn
close, negative balances legal), the endgame the rulebook actually has —
an announced **declare** with a rolled alternate, the **rover** as a
$50,000 derivation, un-declaring by poverty, the immediate win at home —
and the liquidation stub (forced sale to the bank at half price). Phase
1's silent-homeward win was retired; its three goldens were deleted, not
patched, per the fixture policy. **The win-condition question this phase
was assigned answered itself in the transcription: there is no ownership
clause.** Winning is declare + home + the target after fees.

Still owed, each a marked assumption or an unbuilt gate: the forced-sale
and elimination text (half price is a placeholder; a short seat with
nothing to sell just rides negative and the table resolves it), **starting
cash** (discovered during implementation — the published game must grant
some, or the first trips dip negative on bank fees alone; the fold allows
that dip deliberately until the figure is transcribed), train purchase
timing (`trainBought` designed, not built), the own-track and mixed-turn
fee confirms, and the shared-trackage attribution confirm (cheapest-legal
is an assumption the log preserves enough to revisit). The original slice
text follows for the record.

- **Buying railroads** — 28 of them, at published prices, from the bank.
- **Rent** for running on track you do not own, which is what finally makes
  the map matter and makes route choice a real decision.
- **Train upgrades** — Express and Superchief, retiring both hardcoded
  `'freight'` constants and turning them into the lookup their comments
  promise. `earnsBonus()` already implements the payoff, so the upgrade is
  mostly commerce and UI. *(Gated on the still-owed timing rule; not built.)*
- **The ownership clause** of the win condition, if phase 1 deferred it.
  *(Retired: the rulebook has no such clause.)*

---

## Phase 3 — the map, made bearable to play on

**Size: medium.** Three backlog items that are really one piece of work, and
that phases 1–2 make urgent rather than optional: a game you can actually
finish is a game people will sit through, and the map is what they will be
looking at.

- Map animation for destination rolls and region picking
- Auto pan/zoom when moving
- Better controls to select the next node

All three land in [`src/map/MapView.tsx`](../games/railbaron/src/map/MapView.tsx),
**853 lines and the largest component in the repo**. Expect the plan to open by
splitting it; three separate features editing one file that size, in sequence,
is how it becomes a thousand lines nobody wants to touch. Note also that its
two hooks — `usePlayback.ts` and `useRoute.ts` — carry the change-token
dependency pattern with `eslint-disable` comments and reasons
([the linter](plans/2026-08-20-the-linter.md)); animation work will be tempted
to change those arrays, and should read the reasons first.

**Ordering note:** phase 2 and phase 3 both touch Rail Baron's UI. If they run
back to back, do phase 3's `MapView` split *before* phase 2's ownership UI
rather than after, so the commerce screens are built against the split file.

---

## Not sequenced: the other two games

Deliberately unscheduled while Rail Baron is finished. Recorded so the order
above is understood as a choice and not an oversight.

**Acquire** — three unrelated things that should never share a plan:

- *Broadcast per-step moves to minimize other players' wait times.* The one
  item on the whole list that is a **latency** problem rather than a feature,
  and the most-felt thing at a table. Server and client, protocol-shaped.
  Strongest candidate to jump the queue if a game night is imminent.
- *Finish applying the reskin.* Blocked on a decision, not on effort: there is
  not a single `TODO` marker in Acquire's source, so which screens still look
  old is a visual judgement that has to be made by looking, not by grepping.
  Needs a list before it needs a plan.
- *Move lobby in game?* — carries its own question mark. Undecided.

**Marco Polo** — splashing water, tap-to-move-farther-with-a-splash, and a
turbo meter are **three facets of one movement mechanic**, not three features,
and should get one design conversation. The turbo meter carries a question
mark and may not survive it.

**Spectator mode** (lobby, all three games) — the largest cross-cutting
feature and genuinely blocked by nothing, but it wants phase 1's end rule to
know what "watching a finished game" means, and it is the sort of feature that
is much easier to design once one game is complete. Task 5's wire-level
conformance suite in [the lobby pass](plans/2026-08-20-the-lobby-pass.md) is
real groundwork for it.

---

## New item: house rules, for all three games

**Raised 2026-08-21**, while deciding how phase 1 gets its win target.

Every game will eventually want settings a host can change — Rail Baron's win
target and starting train first, but the pattern is general. **No UI for this
now**: a config file that gets edited by hand is enough, and building settings
screens before knowing which settings matter is backwards.

**One constraint the design has to solve, because it is not obvious.** "A file
I can edit" has two readings and only one of them works on the game machine:

- *Checked into the repo* — editing it on the host leaves a dirty tree, and
  `git pull` **is** the deploy there (the `post-merge` hook runs `deploy.sh`).
  A dirty tree makes the next deploy fail or conflict, and `CLAUDE.md` already
  warns against writing files in that clone at all. Workable only if the file
  is edited *here* and reaches the host by pull, like any other change.
- *Read from `DATA_DIR`* — alongside the saves, outside git, editable in place
  on the host and surviving deploys untouched. Costs a read path, a schema, a
  default when the file is absent, and a decision about what happens when it is
  malformed (the room store's quarantine behaviour is the precedent worth
  copying).

The second is what "a config file I can edit" most naturally means for
someone standing at the host machine. The first is less code. Settle it in the
money spec, since that is the first consumer, and generalise afterwards rather
than building a settings system for one caller.

**First consumer landed 2026-08-22:** `DATA_DIR/railbaron/rules.json` — win
target, starting train, optional dice seed — read once at Rail Baron's mount
and stamped into each room's `started` event, absent meaning the published
rules and malformed refusing the mount by field. The DATA_DIR reading won,
for the reason above. The generalisation now has one real example to copy.

**Read `feat/host-env-local` before designing this.** It is a parked branch —
two commits, unmerged, 47 behind `main` as of 2026-08-21 — that already solved
this exact shape for `DATA_DIR`: the host reads it from a gitignored
`.env.local` so you stop retyping it, with a follow-up commit refusing a
relative path *"because .env.local is not a shell"*. That second commit is the
interesting one; it is the failure mode a rules file will hit too. Parked
rather than revived on purpose — it predates the compile plan's rewrite of
`apps/host/main.ts`, so it should be re-decided inside this design rather than
rebased into it. Note also that `.env.local` is **not** gitignored on `main`
today; that branch adds the entry.

---

## Struck from the backlog

- ~~*Better create room feedback while server responding or down*~~ — already
  done. This was the per-game restatement of backlog item 1, closed by
  [the lobby pass](plans/2026-08-20-the-lobby-pass.md) on 2026-08-20: all three
  games drive `useLobbyRoom` with the shared answer timeout, and Rail Baron's
  8-second "no answer through…" message is now the shared behaviour rather than
  the reference implementation. The bullet outlived the fix.

## Decisions still open

Recorded so they are not silently made by whoever implements first.

1. ~~**Phase 1's win condition**~~ — decided 2026-08-22: cash **plus** return
   home; phase 2 was expected to add the ownership clause. The transcription
   (2026-08-23) showed there is no such clause: the published rule is an
   announced declare + home + the target after fees, and phase 2 built that.
2. ~~**Where the rules config lives**~~ — decided 2026-08-22: `DATA_DIR`.
   See house rules.
3. **Marco Polo's turbo meter** — carries a question mark in the backlog.
4. **Acquire's "move lobby in game"** — same.
5. **What is left of Acquire's reskin** — needs a look, not a grep.
