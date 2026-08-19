# Catalog → Claude Design Sync — Design Spec

**Status:** Designed, not built. Written 2026-08-07. Companion to
`plans/2026-08-07-aqua-titanium-reskin.md` (which can consume this as a Task 0, or it can run
independently before/alongside any reskin work).

## Problem

The Claude Design project (`cce01fd6-ffa9-4e50-8457-f01d6d376666`, "Board 10a Aqua Titanium" and
siblings) is a hand-authored parallel universe: mockups with invented data (`board-data.js` fakes
six chains — ZOOB, FLPR, MNCH… — none of them real tickers) and only the happy path. If a reskin
is judged against those mockups, it will skin the happy path and miss exactly the states the
catalog exists to protect: blocked tiles, sold-out buy rows, the four-liquidator merger, staging
parity across steps.

Meanwhile the app already has the state inventory, executable: `/catalog` renders every component
state *replayed from golden games* (14 sections in `src/game/catalog/sections.tsx` today), and it
is already the acceptance surface. The gap is purely that the design project can't see it.

## Goal

Make the running app the single source of truth for "which states and screens exist," and make
the Claude Design project a rendered, always-current mirror of it — so that design-system
coverage is a **mechanical diff between two enumerable lists**, not a judgment call.

## Non-goals

- Not a visual-regression system. Snapshots are for the design pane's eyes, not pixel-diff gates.
- Not re-editable design sources. The mockups stay hand-authored; the synced cards are renders.
- Not a CI gate (v1). The generator is rerunnable and idempotent; a human runs it. See Caveats.

## Design

Five parts, in dependency order.

### 1. The catalog defines the inventory

`sections.tsx` is the canonical list of card-worthy states. Two changes make it machine-usable:

- **Stable slugs.** Every catalog card gets `data-catalog-card="<slug>"` on its root element —
  kebab-case, derived from section title plus variant (`tiles-vocabulary`, `merger-pick-victor`,
  `staging-buy-step`). Slugs are an API: renaming one is a breaking change to the sync and should
  be deliberate.
- **Close the known blind spots.** States not reachable from `/catalog` are invisible to the
  pipeline, so the enforced discipline becomes: *a state that isn't in the catalog doesn't exist
  for design purposes.* Sections to add (this is the real work; the sync is plumbing):
  - Lobby: `online/LobbyCard.tsx` in both modes (code typed vs. code shown), `RoomRefused` +
    retry, `versionMismatch` screen, gone-room ending.
  - Setup: `LocalSetupScreen` / `PlayerRoster` / `SeatRow` states, including the Continue card.
  - Presence: the seat pill, the away dot (including the clipping case — Stage 0's open finding),
    the disconnect toast.
  - Final scoring — with presence (known gap: final scoring has no presence at all today).
  - Online-only phases: `connecting`, `resume` (open draft restored), `error`, `gone`.
  - `RevealOverlay`.

### 2. Snapshot each card from the running app

A generator script (working name `scripts/catalog-snapshots.mjs`), sibling to `verify-layout.mjs`
but with these deliberate differences:

- **Fresh Chrome profile per run.** `verify-layout.mjs` drives a *persistent* profile and that is
  the live lead on its flakiness (Stage 2 tripped over its own saved game). The generator must
  not inherit that: temp profile, created and destroyed per run.
- **Fixed viewport width** (1280px), because tile labels size in `cqi` — text scales with the
  board, so a snapshot is only reproducible at a pinned width.
- For each `[data-catalog-card]` element on `/catalog`: capture a **screenshot PNG**, one file
  per slug, into a gitignored `snapshots/` directory, plus one `manifest.json` listing
  `{ slug, section, pngPath, width, height }`.

Screenshots, not serialized HTML, for v1: computed-style inlining loses hover/focus states and
`cqi` scaling, and the design pane needs to *show* states, not be re-editable. (v2 could add
style-inlined HTML per card if editable references turn out to be wanted.)

Because the catalog replays golden games, snapshots regenerate deterministically — same golden
data, same cards. Any nondeterminism observed (fonts loading, animation frames) is a bug in the
generator, handled by waiting for `document.fonts.ready` and honouring reduced motion
(`prefers-reduced-motion: reduce` emulation, which the app already respects by skipping enter
animations).

### 3. Push snapshots into the Claude Design project

Via the DesignSync MCP tool, following its required ordering (`list_files` →
`finalize_plan` → `write_files`):

- Each card is written to `current/<section>/<slug>.html` — a minimal HTML wrapper embedding the
  PNG, with the first line `<!-- @dsCard group="Current — <Section>" -->` so the Design System
  pane indexes it without explicit registration.
- Groups mirror catalog sections: Current — Tiles, Current — Buy rows, Current — Panel,
  Current — Merger, Current — Lobby, …
- The hand-authored mockups stay where they are, untouched. The pane then shows two populations
  side by side: aspirational (Board 10a/10b/10c) and real-as-rendered-today.
- Writes are **incremental by slug** — only changed/new/removed cards, never a wholesale replace
  (DesignSync's own contract).

### 4. Coverage is a diff

A check script (working name `scripts/check-design-coverage.mjs`) compares two lists:

- **App side:** slugs extracted from `sections.tsx` (statically — grep for
  `data-catalog-card="…"` — so the check runs without a browser).
- **Design side:** `DesignSync list_files` on the project, filtered to `current/**` and to
  whatever convention marks a reskin treatment (proposed: `aqua/<section>/<slug>.html` — one
  treatment card per current card).

Failure modes it reports, same shape as `check:bundle` (two enumerable lists, exit nonzero on
mismatch):

| Finding | Meaning |
|---|---|
| Slug in catalog, no `current/` card | Generator hasn't run / sync stale |
| Slug in catalog, no `aqua/` card | Reskin coverage gap — the actual gate |
| `aqua/` card with no catalog slug | Scope creep (ticker strip, ACTIVITY feed) **or** a missing catalog section — either way, surfaced |

### 5. The loop closes through the catalog

Once a reskin task lands in the app, the generator re-runs and re-pushes: the `current/` cards
*become* the aqua-skinned renders, and the corresponding `aqua/` treatment cards retire (deleted
in the same DesignSync plan). End state: the design project is a rendered mirror of the catalog,
the app remains the only source of truth, and drift is structurally impossible as long as the
generator runs — which is why it must stay a one-command, idempotent operation.

## Interfaces (proposed, for the plan that builds this)

- `npm run design:snapshot` → `scripts/catalog-snapshots.mjs` → `snapshots/*.png` + manifest.
- `npm run design:check` → `scripts/check-design-coverage.mjs` → exit 0/1 + table.
- Push step is agent-driven (DesignSync requires a finalized plan and a permission prompt), so it
  is a documented procedure, not an npm script: snapshot → `list_files` → `finalize_plan`
  (writes `current/**`, localDir `snapshots/`) → `write_files` with `localPath` per card.

## Caveats, stated up front

- **Second Chrome-driving script.** The first one was *believed* famously flaky; on 2026-08-08 the
  cause turned out to be the gate's own pixel rounding, not Chrome — see `CLAUDE.md` under
  Commands. So the risk this bullet guards against is smaller than it looked, and the designed
  mitigations point the wrong way: a fresh profile is worth having (it removes a real run-history
  hazard) but it was never what made runs disagree. **The transferable lesson is the opposite one:
  compare measurements with a tolerance, and never round before comparing.** Still fair to treat the
  generator as rerunnable tooling rather than a CI gate until it has a track record.
- **Fidelity limits.** Screenshots capture one state at one width; hover/focus/active variants
  need their own catalog cards to be seen at all (the catalog already leans this way — e.g.
  staging renders one card per step deliberately).
- **The catalog's blind spots are the pipeline's blind spots.** Section 1's additions are load-
  bearing; skipping them ships a coverage checker that certifies incomplete coverage.
- **Slug stability.** A slug rename orphans a design card. The check script catches it (both
  directions mismatch), which is acceptable — but renames should be rare and intentional.

## Sequencing

1. Slugs + new catalog sections (app work, testable in jsdom for presence-of-attribute, verified
   in a browser for rendering).
2. Generator script.
3. First push; eyeball the pane.
4. Coverage checker.
5. Adopt as the per-task done-check for the aqua reskin plan (its Tasks 3–8 each finish with
   "design:check shows no gap in the sections this task painted").
