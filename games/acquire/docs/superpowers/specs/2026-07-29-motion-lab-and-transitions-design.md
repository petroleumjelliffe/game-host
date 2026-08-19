# Motion lab & step transitions — design

Two signature panel transitions for the live prototype, plus a **motion lab** that
makes tuning them a browser-only loop. Extends the iteration workflow in
[2026-07-28-prototype-refinement-workflow-design.md](2026-07-28-prototype-refinement-workflow-design.md)
(the states-catalog "transition player" grows into a dedicated tuning surface).

## Why

The panel has no motion — steps swap instantly because `render()` replaces
`#panel.innerHTML` wholesale. Animation is *felt and temporal*, but AI review sees
only single frames, so tuning motion through code round-trips is slow. The lab makes
the loop tight: **you tune by feel in the browser; params are data, not logic; and a
scrubber freezes any frame for AI to inspect.**

## The two transitions

- **T1 — tile resolve-to-complete (tile-specific).** On tap, the unused hand tiles
  slide right and tuck *behind* the selected tile (descending z-index, slight
  scale + fade); the selected tile slides right, then rises into the step-stack as
  the new completed log entry (a FLIP from its resolved spot to the log row).
- **T2 — reveal (universal).** The next active-step toasts up from behind the
  staging band (staging sits at higher z-index with its opaque background, so the
  step appears to emerge from underneath it). **Sequenced strictly after T1.**

Other stages (found / merger / buy) will each get their *own* resolve-to-complete
transition later; for now they commit instantly but still flow through the shared
orchestrator, so they get T2 today.

`prefers-reduced-motion` → skip all motion, straight to `render()`.

## Architecture

### The continuity problem
`render()` blows away `#panel`, so no node survives a state change and native CSS
transitions have nothing to interpolate. We animate *around* it: play the **out**
transition on the DOM that exists at click time, **then** commit state + `render()`,
**then** play the **in** transition on the fresh DOM. Motion uses measured pixel
deltas via the Web Animations API (`element.animate`) — not CSS transitions between
renders. The T1→log FLIP survives the innerHTML swap by animating a **clone** of the
selected tile from its old rect to the post-render log rect.

### New files

- **`prototype/transitions.js`** — shared by app *and* lab (the lab runs the real
  motion, never a mock of it). Exports:
  - `MOTION` — token object of tunable defaults (durations, easings, distances,
    stagger).
  - `applyMotionVars(root?)` — mirror `MOTION` onto CSS custom properties.
  - `t1TileResolve(rowEl, selectedEl, { logRect } = {})` → `Promise` — measure sibling
    rects; animate unused tiles to the selected's x + tuck behind (z desc, scale,
    fade) with stagger; slide the selected right; if `logRect` given, FLIP a clone
    of the selected to it. Resolves on finish.
  - `t2Toaster(activeStepEl)` → `Promise` — translateY(`MOTION.t2.rise` → 0) + fade;
    resolves on finish.
  - `reducedMotion()` — guard; when true every transition resolves immediately.
- **`prototype/motion.html`** — the lab. New "Motion" nav tab (alongside
  Prototype / States). Links `components.css` + `components.js` + `transitions.js`.
  Renders the real before/after DOM for each transition and drives it through the
  same exported functions.

### App integration (`index.html`)

- Add an **`advance(mutator)`** orchestrator:
  1. If the current interactive step has an out-transition (tiles → `t1TileResolve`),
     `await` it on the live DOM.
  2. `mutator()` (the state change) + `render()`.
  3. Find the new `.active-step`; `await t2Toaster`.
- The tile path (`switchPlacement` → `placeTile`) routes through `advance`:
  measure the selected tile's rect **before** render, render, measure the new log
  tile's rect **after**, and FLIP a clone old→new for the "rises into the log" beat.
- Non-tile stages call `advance` with no out-transition → `render()` + `t2Toaster`.
- An `animating` flag ignores input while a transition is in flight.

### Layout / z-index for the T2 mask
`.active-step` → `position:relative; z-index:1`. `.staging-zone` →
`position:relative; z-index:2` with its existing opaque bg, so it masks the toaster's
emergence.

### Tokens (`MOTION` defaults — starting points, tuned in the lab)
- `t1`: `{ slide: 140, tuckScale: .9, stagger: 30, dur: 320, ease: 'cubic-bezier(.2,.7,.3,1)' }`
- `t2`: `{ rise: 40, dur: 280, ease: 'cubic-bezier(.2,.7,.3,1)' }`
- lab-only `speed` multiplier (1 / .5 / .25) scales durations for slow-mo review.

### Lab controls (only what each transition needs)
replay · loop · speed · duration · easing · (T1) slide distance / tuck scale / stagger
· **scrub** (pause + set `currentTime` to freeze a frame) · **copy tokens** (dump the
current `MOTION` values to paste back as new defaults in `transitions.js`).

## Data flow
- **Lab:** control change → update `MOTION` / CSS vars → replay on the fixture
  before/after DOM (real component atoms, lab-arranged).
- **App:** `advance()` reads `MOTION` at play time. No live coupling to the lab — the
  lab's product is the settled default values committed into `transitions.js`.

## Testing / validation
No automated tests (throwaway prototype). Validate by: lab replay + scrub screenshots
for keyframes; a live-app walkthrough (place a tile → merger / found / isolated)
confirming the T1-then-T2 sequence; and `prefers-reduced-motion` on → instant swaps.

## Risks & mitigations
- **Cross-container FLIP (T1 → log)** is the fanciest beat. Fallback: if the log rect
  is unavailable or off on the first frame, degrade to a selected fade-up without the
  exact FLIP.
- **Lab / app drift** — mitigated by sharing `components.js` + `transitions.js`; the
  lab's fixture DOM must mirror the real class structure.
- **innerHTML swap mid-animation** — mitigated by clone-based FLIP + the `animating`
  flag.

## Build order
1. `transitions.js`: `MOTION`, `applyMotionVars`, `reducedMotion`, `t2Toaster`.
2. `motion.html` shell + "Motion" nav + T2 wired with controls + scrub.
3. `t1TileResolve` (slide / stash + FLIP) in the lab.
4. App `advance()` + `t2Toaster` on every stage.
5. App tile path → `t1TileResolve` + FLIP-to-log.
6. Tune tokens in the lab; commit the settled defaults.
