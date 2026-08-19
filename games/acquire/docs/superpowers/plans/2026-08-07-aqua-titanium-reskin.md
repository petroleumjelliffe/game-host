# Aqua Titanium Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the game screen in the "Board 10a Aqua Titanium" visual language from the Claude Design project (`cce01fd6-ffa9-4e50-8457-f01d6d376666`, file `Board 10a Aqua Titanium.dc.html`) — Lucida Grande throughout, glossy gradient tiles and stock certificates, lozenge (pill) controls, pinstripe backdrop, inset "well" surfaces — without changing any layout, behaviour, zone order, or animation.

**Architecture:** A new stylesheet `src/styles/aqua.css` holds every gradient/gloss recipe as a named class (`.aqua-*`) plus per-brand CSS custom properties; `tokens.ts` grows a `grad` class per brand so components keep getting their paint through the token map. Components swap Tailwind flat-color literals for the `.aqua-*` classes; structure, props, and data attributes are untouched. This is a **replacement on the branch, not a theme toggle** (YAGNI — the branch *is* the theme decision).

**Tech Stack:** React 18, Tailwind (JIT — literal class strings only), plain CSS for gradients, Vitest (two projects: `node` / `app`), `verify-layout.mjs` over CDP.

## Global Constraints

- Branch off **`main`** — name it `revamp/aqua-titanium-reskin`. (This plan originally said to
  branch off `revamp/online-lobby-mockup`, which was merged and deployed on 2026-08-07; `main` has
  carried the headerless board ever since, plus the turn-order draw (v3) and the per-draw panel
  state, which Task 8's sweep should include.)
- **Skin only.** The mockup's *layout* inventions — the ticker strip, right-hand ACTIVITY feed, header player chips row — are **out of scope**. The existing GameScreen layout, panel zone order (`stepstack → active → staging → hand → players`), and slot semantics stay exactly as they are.
- **The panel has exactly one animation** (active-zone height via `panel/StepReveal`). This plan adds **zero** transitions/transforms. If a step to "polish" tempts you to animate gloss, don't.
- Panel-height stability: no zone may change height without gaining a row. New paint must not change box heights — pad/border deltas must be compensated in the same class.
- Tailwind JIT scans for **literal** class strings; never interpolate a class name. Every `.aqua-*` class is defined in plain CSS so this constraint mostly disappears for the new paint.
- No `as any`; narrow with engine guards (`isStartupId`, …).
- Font stack everywhere on the game screen: `'Lucida Grande', 'Trebuchet MS', Verdana, sans-serif`. No monospace anywhere (mockup's explicit rule).
- Blue stays reserved for hand/selection, green for cash — the brand gradient map must not use either as a brand hue.
- Semantics carried by outlines must survive: the blue `outline` for placed-this-turn, brand `ring` group outlines on chains, the 🚫 blocked overlay, `data-tile-state` / `data-slot` / `data-board` attributes (tests and verify-layout read them).
- Verify in a real browser (`/catalog`, `/scenarios` — **dev server only**; as of the PWA plan's
  Task 1 they are not in production builds); jsdom sees no layout. `npm run typecheck`,
  `npx vitest run`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout` all green
  before merge. (This bullet used to say a green verify:layout is weak evidence — that was fixed
  on 2026-08-08; the flakiness was the gate's own rounding, and green is ordinary evidence now.
  One real consequence for *this* branch: the gate compares zone heights with a 1px tolerance, so
  new paint must keep every box height within 1px, not merely "compensated".)
- `prefers-reduced-motion` behaviour is unchanged (nothing new animates, so nothing new to guard).

## Design tokens (extracted from the mockup — copy these verbatim)

| Token | Value |
|---|---|
| Backdrop pinstripe | `repeating-linear-gradient(180deg, #eef1f6 0 2px, #e6ebf2 2px 4px)` |
| Page ground | `#d9dde3` |
| Board well | `linear-gradient(#dfe5ec, #eef2f7)`, `box-shadow: inset 0 2px 5px rgba(0,0,0,.22), inset 0 0 0 1px #c9d1da`, radius 10px |
| Tile empty | `linear-gradient(#e4e9f0, #d3dae3)`, `inset 0 1px 0 #fff, inset 0 0 0 1px #c6ced8`, label `rgba(70,80,95,.42)` |
| Tile played | `linear-gradient(#ffffff, #c4cfdb)`, `inset 0 1px 0 #fff, 0 2px 4px rgba(0,0,0,.22)`, label `#39424e` |
| Tile chain | brand two-stop gradient + `inset 0 1px 0 rgba(255,255,255,.6), 0 2px 5px rgba(0,0,0,.35)`, white label, `text-shadow: 0 -1px 0 rgba(0,0,0,.35)` |
| Tile founder (HQ) | chain + `inset 0 0 0 2px rgba(255,255,255,.9)` inner ring |
| Card surface | white, `inset 0 0 0 1px #d3dae2, 0 1px 3px rgba(0,0,0,.12)`, radius 8px |
| Active ("parchment") card | `linear-gradient(#fdf6e3, #f5ead0)`, `inset 0 0 0 1px #e0d3af, 0 1px 3px rgba(0,0,0,.12)` |
| Primary lozenge button | radius 16px, `linear-gradient(#8ec8fa, #1a6ecb)`, `inset 0 1px 0 rgba(255,255,255,.75), 0 1px 3px rgba(0,0,0,.28)`, white bold text, `text-shadow: 0 -1px 0 rgba(0,0,0,.3)` |
| Neutral lozenge / chip | `linear-gradient(#ffffff, #dee4ec)`, `inset 0 1px 0 #fff, 0 1px 3px rgba(0,0,0,.2)`; active adds `0 0 0 2px #6aa9e6` |
| Stock certificate | radius 6px, brand gradient, `inset 0 1px 0 rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.25)`, white bold label with down text-shadow |
| Sunken tray (hand/staging wells) | `linear-gradient(#f7f9fc, #e7ecf2)`, `inset 0 1px 3px rgba(0,0,0,.18), inset 0 0 0 1px #cdd5de` |
| Muted label | bold 10px, `letter-spacing: .14em`, `#7c8492`, uppercase |

**Brand gradient map.** The mockup ships six chain hues + a gray; our palette is seven startups + Cash, hue identity already approved (memory: tile-colour-system). Keep each startup's *hue family*, re-expressed as a two-stop gloss pair in the mockup's saturation/derivation style (light top ≈ hue at high lightness, dark bottom ≈ same hue deep):

| Brand | top → bottom |
|---|---|
| Gobble (red) | `#ff6f8e → #b31038` (mockup's pink-red pair, verbatim) |
| Scrapple (orange) | `#ffa04d → #c25410` (derived — mockup has no orange chain) |
| WrecksonMobil (amber) | `#ffc247 → #d97d00` (verbatim) |
| PaperfulPost (lime) | `#8fdc57 → #348708` (verbatim) |
| ZuckFace (teal) | `#63dcf7 → #0d9ec6` (verbatim, cyan-teal) |
| Messla (purple) | `#b98bf0 → #5b2fae` (verbatim) |
| CamCrooned (pink) | `#ffbfd4 → #c22a5e` (from the mockup's pink avatar radial) |
| Cash (green) | `#7ed957 → #2e7d32` (green stays cash-only) |

> One deliberate divergence: the mockup uses `#57a9f2 → #0a56ad` (blue) for a chain. Blue is reserved here for hand/selection, so no startup takes it; the hand-tile paint (Task 3) uses that blue pair instead, which keeps the mockup's blue on screen in the role our system reserves it for.

## File Structure

- Create: `src/styles/aqua.css` — every `.aqua-*` recipe and per-brand custom properties. One file so a future reskin is one file to swap.
- Modify: `src/styles/index.css` — `@import './aqua.css';`, page font stack and pinstripe ground.
- Modify: `src/game/tokens.ts` (+ `tokens.test.ts`) — add `grad` to `BrandClasses`.
- Modify: `src/game/atoms/Tile.tsx` (+ test) — STATE_CLASSES swap.
- Modify: `src/game/Board.tsx` (+ test) — board well.
- Modify: `src/game/atoms/StockCard.tsx`, `StockStack.tsx`, `Brand.tsx` (+ tests) — certificates and brand chips.
- Modify: `src/game/panel/Panel.tsx`, `ActiveStep.tsx`, `HandZone.tsx`, `StagingZone.tsx`, `StepStack.tsx`, `PlayersStrip.tsx` (+ tests) — card surfaces, trays, lozenges, chips.
- Not touched: `stepMotion.ts`, `StepReveal.tsx` (the one animation), everything under `engine/`, `session/`, `server/`, `src/net/`.

---

### Task 1: Branch + theme foundation (`aqua.css`, page ground, font stack)

**Files:**
- Create: `src/styles/aqua.css`
- Modify: `src/styles/index.css`

**Interfaces:**
- Produces: class names `aqua-well`, `aqua-card`, `aqua-card-parchment`, `aqua-tray`, `aqua-pill`, `aqua-pill-primary`, `aqua-chip`, `aqua-chip-active`, `aqua-tile-empty`, `aqua-tile-played`, `aqua-tile-chain`, `aqua-tile-founder`, `aqua-tile-hand`, `aqua-cert`, `aqua-label`, and per-brand `aqua-brand-<StartupId>` / `aqua-brand-Cash` (exact spellings; later tasks depend on them).

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b revamp/aqua-titanium-reskin
```

- [ ] **Step 2: Write `src/styles/aqua.css`**

```css
/* Aqua Titanium reskin — every gradient/gloss recipe in one file.
   Class names are literal (Tailwind JIT never sees interpolation). */

:root {
  --aqua-font: 'Lucida Grande', 'Trebuchet MS', Verdana, sans-serif;
}

/* Brand gradient stops. Blue is reserved for hand/selection, green for cash. */
.aqua-brand-Gobble        { --aqua-top: #ff6f8e; --aqua-bot: #b31038; }
.aqua-brand-Scrapple      { --aqua-top: #ffa04d; --aqua-bot: #c25410; }
.aqua-brand-WrecksonMobil { --aqua-top: #ffc247; --aqua-bot: #d97d00; }
.aqua-brand-PaperfulPost  { --aqua-top: #8fdc57; --aqua-bot: #348708; }
.aqua-brand-ZuckFace      { --aqua-top: #63dcf7; --aqua-bot: #0d9ec6; }
.aqua-brand-Messla        { --aqua-top: #b98bf0; --aqua-bot: #5b2fae; }
.aqua-brand-CamCrooned    { --aqua-top: #ffbfd4; --aqua-bot: #c22a5e; }
.aqua-brand-Cash          { --aqua-top: #7ed957; --aqua-bot: #2e7d32; }

/* Surfaces */
.aqua-well {
  background: linear-gradient(#dfe5ec, #eef2f7);
  box-shadow: inset 0 2px 5px rgba(0,0,0,.22), inset 0 0 0 1px #c9d1da;
  border-radius: 10px;
}
.aqua-card {
  background: #fff;
  box-shadow: inset 0 0 0 1px #d3dae2, 0 1px 3px rgba(0,0,0,.12);
  border-radius: 8px;
}
.aqua-card-parchment {
  background: linear-gradient(#fdf6e3, #f5ead0);
  box-shadow: inset 0 0 0 1px #e0d3af, 0 1px 3px rgba(0,0,0,.12);
  border-radius: 8px;
}
.aqua-tray {
  background: linear-gradient(#f7f9fc, #e7ecf2);
  box-shadow: inset 0 1px 3px rgba(0,0,0,.18), inset 0 0 0 1px #cdd5de;
  border-radius: 15px;
}

/* Controls */
.aqua-pill {
  border-radius: 16px;
  background: linear-gradient(#ffffff, #dee4ec);
  box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(0,0,0,.2);
}
.aqua-pill-primary {
  border-radius: 16px;
  background: linear-gradient(#8ec8fa, #1a6ecb);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.75), 0 1px 3px rgba(0,0,0,.28);
  color: #fff;
  text-shadow: 0 -1px 0 rgba(0,0,0,.3);
}
.aqua-chip {
  border-radius: 18px;
  background: linear-gradient(#f7f9fc, #dbe1e9);
  box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(0,0,0,.16);
}
.aqua-chip-active {
  background: linear-gradient(#ffffff, #dee4ec);
  box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(0,0,0,.2), 0 0 0 2px #6aa9e6;
}

/* Board tiles. State classes compose with .aqua-brand-* for the gradient. */
.aqua-tile-empty {
  background: linear-gradient(#e4e9f0, #d3dae3);
  box-shadow: inset 0 1px 0 #fff, inset 0 0 0 1px #c6ced8;
  color: rgba(70,80,95,.42);
}
.aqua-tile-played {
  background: linear-gradient(#ffffff, #c4cfdb);
  box-shadow: inset 0 1px 0 #fff, 0 2px 4px rgba(0,0,0,.22);
  color: #39424e;
}
.aqua-tile-hand {
  background: linear-gradient(#8ec8fa, #2f7fd4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.25);
  color: #fff;
  text-shadow: 0 -1px 0 rgba(0,0,0,.3);
}
.aqua-tile-chain {
  background: linear-gradient(var(--aqua-top), var(--aqua-bot));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 2px 5px rgba(0,0,0,.35);
  color: #fff;
  text-shadow: 0 -1px 0 rgba(0,0,0,.35);
}
.aqua-tile-founder {
  background: linear-gradient(var(--aqua-top), var(--aqua-bot));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 2px 5px rgba(0,0,0,.35),
              inset 0 0 0 2px rgba(255,255,255,.9);
  color: #fff;
  text-shadow: 0 -1px 0 rgba(0,0,0,.45);
}

/* Stock certificate */
.aqua-cert {
  border-radius: 6px;
  background: linear-gradient(var(--aqua-top), var(--aqua-bot));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.25);
  color: #fff;
  text-shadow: 0 -1px 0 rgba(0,0,0,.4);
}

/* Typography */
.aqua-label {
  font: bold 10px/1 var(--aqua-font);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: #7c8492;
}
```

- [ ] **Step 3: Wire it into `src/styles/index.css`** — add at the top: `@import './aqua.css';`, and on the game screen root apply the pinstripe ground and font. Read `index.css` first and follow its existing pattern for globals; the ground goes on whatever element carries the game-screen background today (find it — likely in `GameScreen.tsx` — and give it `font-[family-name:var(--aqua-font)]` via a literal class or a `.aqua-ground` class: `background: repeating-linear-gradient(180deg, #eef1f6 0 2px, #e6ebf2 2px 4px); font-family: var(--aqua-font);`).

- [ ] **Step 4: Verify** — `npm run typecheck && npx vite build`, then `npm run dev`, open `/catalog` (check which tree serves the port first!): pinstripe ground and Lucida Grande visible, nothing else changed.

- [ ] **Step 5: Commit** — `git add src/styles && git commit -m "feat(skin): aqua titanium theme foundation — recipes, ground, font stack"`

### Task 2: Brand gradients through the token map

**Files:**
- Modify: `src/game/tokens.ts`
- Test: `src/game/tokens.test.ts`

**Interfaces:**
- Produces: `BrandClasses.grad: string` — the literal `aqua-brand-<key>` class; consumed by Tasks 3–5.

- [ ] **Step 1: Failing test** — in `tokens.test.ts` add:

```ts
it('every brand carries its aqua gradient class, literally', () => {
  for (const [key, classes] of Object.entries(BRAND_CLASSES)) {
    expect(classes.grad).toBe(`aqua-brand-${key}`);
  }
});
```

- [ ] **Step 2: Run** `npx vitest run src/game/tokens.test.ts` — FAIL (`grad` undefined).
- [ ] **Step 3: Implement** — add `grad: string` to `BrandClasses` and the literal value on all 8 entries (e.g. `grad: 'aqua-brand-Gobble'`). Literal strings, one per line, matching the existing table style.
- [ ] **Step 4: Run** the file again — PASS. Then the whole app project: `npx vitest run --project app`.
- [ ] **Step 5: Commit** — `git commit -am "feat(skin): brand gradient classes in the token map"`

### Task 3: Tile reskin

**Files:**
- Modify: `src/game/atoms/Tile.tsx`
- Test: `src/game/atoms/Tile.test.tsx`

**Interfaces:**
- Consumes: `BRAND_CLASSES[brand].grad` (Task 2), `.aqua-tile-*` (Task 1).
- Produces: unchanged `TileProps` / `data-tile-state` — nothing downstream changes.

- [ ] **Step 1: Read `Tile.test.tsx`** and list every assertion on class names; those assertions change with the paint (behavioural assertions — labels, disabled, 🚫 overlay, title — must not).
- [ ] **Step 2: Update `STATE_CLASSES`** in `Tile.tsx:41-49`:

```ts
const STATE_CLASSES: Record<TileState, string> = {
  empty: 'aqua-tile-empty font-medium',
  filled: 'aqua-tile-played font-bold',
  placed: 'aqua-tile-played font-bold outline outline-[3px] -outline-offset-[3px] outline-blue-600 z-[3]',
  hand: 'aqua-tile-hand font-bold',
  blocked: 'aqua-tile-hand font-bold opacity-60 cursor-not-allowed',
  chain: 'aqua-tile-chain z-[1]',
  founded: 'aqua-tile-founder font-extrabold z-[2]',
};
```

and in `brandPaint` keep the `ring-[3px] ${brandClasses.ring}` group outline but add `${brandClasses.grad}` for both `chain` and `founded` (the gradient needs the custom properties; the ring still merges neighbours into one group outline). Drop `brandClasses.tint/stroke/text` from `founded` — the white-on-gradient recipe replaces them. Keep `border` handling: the aqua recipes carry their own inset 1px ring, so change `BASE`'s `border border-solid` to `border-0` **and** verify in the browser that tile boxes did not shrink/grow (border-box: removing a 1px border changes content size, not box size — confirm `box-sizing` is border-box in this codebase before assuming).
- [ ] **Step 3: Update the hover affordance** — `hover:bg-blue-200` fights a gradient background; replace with `hover:brightness-110` (filter, does not move layout).
- [ ] **Step 4: Fix the tests** you listed in Step 1 (assert the new literal classes), run `npx vitest run src/game/atoms/Tile.test.tsx` — PASS.
- [ ] **Step 5: Browser check** — `/catalog` tile section: all 7 states, founder shows ticker + inner white ring, blocked shows 🚫 over a dimmed blue tile, placed-this-turn outline still visible **on top of** the gloss. Screenshot for the record.
- [ ] **Step 6: Commit** — `git commit -am "feat(skin): glossy aqua tiles, all seven states"`

### Task 4: Board well

**Files:**
- Modify: `src/game/Board.tsx:63-67`
- Test: `src/game/Board.test.tsx` (only if it asserts the container classes)

- [ ] **Step 1:** Swap the grid container's `rounded-xl bg-gray-200` for `aqua-well`, keeping `data-board="grid"`, the grid template, `gap-[5px]`, `p-2` → `p-3` (mockup breathes 12px), `aspect-[12/9]`, `[container-type:inline-size]`, and `GRID_VARS` untouched. `p-2 → p-3` grows the well by 8px total — acceptable because the board scales inside its flex cell; confirm no overflow in the browser.
- [ ] **Step 2:** `npx vitest run src/game/Board.test.tsx` — fix any class assertion, PASS.
- [ ] **Step 3:** Browser: `/scenarios`, load a mid-game golden state — chains read as glossy islands in a sunken well; owner badges still legible top-right.
- [ ] **Step 4: Commit** — `git commit -am "feat(skin): the board is a sunken aqua well"`

### Task 5: Certificates — StockCard, StockStack, Brand chip

**Files:**
- Modify: `src/game/atoms/StockCard.tsx`, `src/game/atoms/StockStack.tsx`, `src/game/atoms/Brand.tsx`
- Test: their three `.test.tsx` siblings

- [ ] **Step 1: Read all three components + tests.** Map each flat-color usage (`tint`/`stroke`/`text` from tokens) to the certificate recipe: root gets `aqua-cert ${BRAND_CLASSES[brand].grad}`; the ticker label becomes white bold (recipe carries color and text-shadow, so *remove* the `text-*-700` class rather than fighting it). Brand chips (inline brand mentions in the log) become small gradient lozenges: `aqua-cert` + existing padding. Keep every `data-*` attribute and count/price text node exactly where it is.
- [ ] **Step 2:** Component sizes must not change — certificates keep their current width/height classes; only paint moves.
- [ ] **Step 3:** Update class assertions in the three test files; `npx vitest run --project app` — PASS.
- [ ] **Step 4:** Browser: `/catalog` stock sections — stacks, counts, sold-out/dimmed states all render; dimming via `opacity` still reads on gradients.
- [ ] **Step 5: Commit** — `git commit -am "feat(skin): gradient stock certificates and brand lozenges"`

### Task 6: Panel surfaces, trays, and lozenge controls

**Files:**
- Modify: `src/game/panel/Panel.tsx`, `ActiveStep.tsx`, `HandZone.tsx`, `StagingZone.tsx`, `StepStack.tsx`
- Test: `Panel.test.tsx`, `StagingZone.test.tsx`, `StepStack.test.tsx`

**Interfaces:**
- Consumes: `aqua-card`, `aqua-card-parchment`, `aqua-tray`, `aqua-pill`, `aqua-pill-primary`, `aqua-label` (Task 1).

- [ ] **Step 1: Read `2026-08-06-phase-5-online-ui.md` first** (CLAUDE.md requires it before touching `src/game/panel/`). List which of its 26 findings touch classes you're about to edit; do not reverse any of them.
- [ ] **Step 2: Paint the zones.** Panel column keeps its width/scroll classes; each zone body gets a surface: step stack entries on `aqua-card` rows, **active zone on `aqua-card-parchment`** (the mockup's "what you're doing now" card), hand and staging piles inside `aqua-tray` wells, zone headings get `aqua-label`. Padding compensations: wherever a surface class replaces a `border` + `bg-*`, keep the box's total padding+border constant (panel-height stability is a merge gate, and `verify-layout` measures it).
- [ ] **Step 3: Buttons.** Primary action buttons (Buy shares / End turn / confirm) → `aqua-pill-primary` + existing sizing classes; secondary/ghost buttons (undo, pass, remove-from-staging ×) → `aqua-pill`. Height of every button stays what it is today — set the same `h-*` class explicitly. The Pass gate button added on this branch is included.
- [ ] **Step 4: What not to touch:** `StepReveal.tsx`, `stepMotion.ts`, any `transition`/`transform` class. If a diff line adds one, revert it.
- [ ] **Step 5:** `npx vitest run --project app` — fix class assertions only; behavioural tests must pass unmodified. Then `npm run verify:layout` on a real Chrome — twice.
- [ ] **Step 6:** Browser pass on `/scenarios`: walk a turn (place, buy, end) and a merger state; check the parchment card, trays, and that nothing jitters between steps.
- [ ] **Step 7: Commit** — `git commit -am "feat(skin): aqua panel — parchment active card, trays, lozenge controls"`

### Task 7: PlayersStrip chips

**Files:**
- Modify: `src/game/panel/PlayersStrip.tsx`
- Test: `src/game/panel/PlayersStrip.test.tsx`

- [ ] **Step 1:** Each player row/chip → `aqua-chip`, the actor's chip → additionally `aqua-chip-active`; keep emoji avatar, name, cash, and the presence/away dot exactly where they are (Stage 0 has an open finding that the away dot rides a clipping row — don't fix it here, don't make it worse: verify the chip's `overflow` doesn't newly clip the dot).
- [ ] **Step 2:** Non-actors dim via `opacity-75` (mockup uses .78/.58 by recency; we have no recency signal — one level, YAGNI).
- [ ] **Step 3:** Tests: class assertions updated, behaviour untouched; run the file — PASS.
- [ ] **Step 4:** Browser: two-browser quick check (`npm run dev:all`) that the *active* ring follows the turn and the disconnected state still shows.
- [ ] **Step 5: Commit** — `git commit -am "feat(skin): player lozenge chips with active ring"`

### Task 8: Sweep the remaining game surfaces

**Files:**
- Modify (audit, likely touch): `src/game/FinalScoring.tsx`, `RevealOverlay.tsx`, `FoundGroups.tsx`, `merger/*.tsx`, `setup/*.tsx`, `src/game/online/*` lobby components
- Test: their siblings

- [ ] **Step 1:** `grep -rn "bg-gray-\|bg-white\|border-gray-\|rounded-\(lg\|xl\)" src/game --include='*.tsx' -l` minus files already done — that's the audit list. For each: cards → `aqua-card`, primary buttons → `aqua-pill-primary`, headings → `aqua-label`, brand color usages → check whether the flat `tint/text` still belongs (log text, FoundGroups swatches may legitimately stay flat for readability — decide per surface, note the decision in the commit message).
- [ ] **Step 2:** The lobby (this branch's own new UI — editable row, ×) gets chips/pills so the reskin doesn't stop at the game screen door.
- [ ] **Step 3:** Full gates: `npx vitest run && npm run typecheck && npx vite build && npm run check:bundle`.
- [ ] **Step 4: Commit** — `git commit -am "feat(skin): aqua across scoring, merger, setup and lobby surfaces"`

### Task 9: Whole-branch review and by-hand acceptance

- [ ] **Step 1:** Full suite + typecheck + build + check:bundle + verify:layout (twice) — all green, outputs read, not assumed.
- [ ] **Step 2:** By-hand browser pass (the thing that actually finds bugs here): `/catalog` end-to-end scroll; `/scenarios` merger state; one full two-browser turn cycle via `npm run dev:all` including a refresh mid-turn (presence + resume must still render correctly under the new paint). Screenshot the board, panel, and lobby against the mockup side by side.
- [ ] **Step 3:** Review the whole branch diff (`git diff main...HEAD`) for: any new `transition`/`transform`/`animation`; any interpolated class name; any changed `data-*` attribute; any component whose box size changed. CLAUDE.md's rule exists because both of Phase 4's worst bugs spanned tasks.
- [ ] **Step 4:** Use superpowers:requesting-code-review, then superpowers:finishing-a-development-branch. (The old merge dependency on `revamp/online-lobby-mockup` is gone — that branch merged on 2026-08-07. This branch stands alone off `main`.)

## Self-review notes

- Spec coverage: mockup elements deliberately **not** implemented — ticker strip, ACTIVITY feed, header chips row, "TURN 14" indicator, stacked/fanned share cards with ×N badges — all layout, all out of scope per the reskin brief; the *paint* of every one of them is covered by the recipes.
- Fixed inline: an earlier draft borrowed the mockup's blue chain gradient for a brand — removed; blue stays selection-only.
- Type consistency: `grad` is the only new token field; every consumer spelled `BRAND_CLASSES[brand].grad`.

## Working alongside the PWA branch (added 2026-08-08)

`revamp/pwa` ([2026-08-08-pwa.md](./2026-08-08-pwa.md)) may run in parallel. The full conflict
analysis is in the PWA design spec; the short version for this branch:

- **`tokens.ts` is safe to rewrite freely.** The PWA *reads* it through a build-time manifest
  generator and hand-copies nothing, so this branch's palette flows into the installed app's
  theme colour on the next build. Do not add manifest-related values here; the generator derives
  them.
- **`StaleClient.tsx` is the one shared file.** The PWA adds an `Update now` button to it; Task 8's
  sweep may restyle it. Whoever merges second reapplies — it is a small, mechanical conflict.
- **Merge order, if sequential: this branch first**, so the manifest generator's first run picks up
  the final palette and nobody has to remember to regenerate.

**Optional Task 0:** [../specs/2026-08-07-catalog-design-sync-design.md](../specs/2026-08-07-catalog-design-sync-design.md)
— sync the real catalog states into the design project before skinning, so the reskin is judged
against the states the catalog protects rather than the mockup's invented happy path. Designed,
not built; this plan works with or without it.
