# Wordgame Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planned (2026-09-01), executing inline on `feat/wordgame-touch` (PR #27, still open — motion is the same feature's final layer).

**Goal:** Implement `Word Game Motion.dc.html` — one motion language for every tile interaction: grow on lift, direct travel, settle with a small overshoot on landing.

**Architecture:** Motion is presentational only — every state commit stays instant and synchronous, so the existing 270 tests keep their truth. CSS keyframes carry mount-triggered animations (settle, badge, refill); a screen-space flight layer carries cross-container travel (tap-to-board, snap-back), skipping itself under zero rects (jsdom) or reduced motion. The one *behavioral* change the spec demands — **rack slots stay reserved while a tile is on the board** — is a state-model refactor (`RackEntry[]`), and lands first because everything else keys off its stable ids.

**Tech Stack:** CSS keyframes + transitions, Pointer Events (existing), no new dependencies.

**Spec:** `Word Game Motion.dc.html` in the Claude Design project (saved values inlined below — durations, easings, and behavior prose are copied verbatim into the tasks).

## Global Constraints

- Branch: `feat/wordgame-touch` (continues PR #27). Commits carry the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Motion tokens, verbatim from the spec: **Lift** 120ms `cubic-bezier(.34,1.56,.64,1)` scale 1.14 / y −12 / tilt 4°; **Drop** 160ms `cubic-bezier(.22,1,.36,1)` scale .96→1.04→1; **Travel** 220ms `cubic-bezier(.2,.8,.2,1)`; **Reflow** 180ms `cubic-bezier(.4,0,.2,1)` (already the rack's 150ms — bump to 180); **Stagger** 60ms/tile; snap-back 200ms; badge in 260ms after an 80ms delay, out 120ms; refill 300ms from 36px below at 0.82 scale.
- State commits never wait on animation. Flights and keyframes are skippable garnish; a test asserting state right after an event must pass unchanged (except where Task 2's reservation *behavior* change explicitly updates it).
- `prefers-reduced-motion: reduce` disables all of it via one CSS media block plus `reducedMotion()` guards in JS-driven flights.
- Deliberate omission, ruled here: the spec's "Play button's total counts up on the same beat" is **not implemented** — a rAF count-up fights every synchronous `Play · +N` assertion in the suite for a minor beat the badge already carries. Recorded in the PR.
- Gates per task: `npx vitest run --root games/wordgame`, then typecheck + lint at the end. jsdom runs CSS animations as inert and flights skip on zero rects — no waits, no fake timers needed.

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/game/motion.ts` | Duration/easing constants + `reducedMotion()`. |
| Modify `src/styles/index.css` | `wg-*` keyframes and animation classes + reduced-motion kill block. |
| Modify `src/game/GameScreen.tsx` | `RackEntry[]` model, flight wiring, ghost polish, badge structure. |
| Modify `src/game/Rack.tsx` | Reserved slots, per-entry keys/ids, fresh-tile refill animation, bag pulse. |
| Modify `src/game/Board.tsx` | Settle animation class on staged tile mount. |
| Create `src/game/TileFlightLayer.tsx` + `useTileFlights.ts` | Screen-space FLIP flights (travel / snap-back). |
| Tests | `GameScreen.test.tsx`, `Rack.test.tsx` updated for reservation; new flight-skip assertions. |

---

### Task 1: Motion tokens + keyframes

**Files:** Create `src/game/motion.ts`; modify `src/styles/index.css`.

- [ ] `motion.ts`:

```ts
// The spec's motion tokens (Word Game Motion.dc.html): one idea everywhere —
// grow on lift, direct travel, settle with a small overshoot on landing.
export const LIFT_MS = 120;
export const DROP_MS = 160;
export const TRAVEL_MS = 220;
export const REFLOW_MS = 180;
export const STAGGER_MS = 60;
export const SNAPBACK_MS = 200;
export const EASE_LIFT = 'cubic-bezier(.34,1.56,.64,1)';
export const EASE_DROP = 'cubic-bezier(.22,1,.36,1)';
export const EASE_TRAVEL = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_REFLOW = 'cubic-bezier(.4,0,.2,1)';

/** True when the OS asks for less motion — JS-driven flights check this;
 * CSS animations die under the media block in index.css. Absent matchMedia
 * (jsdom) reads as no preference; flights there skip on zero rects anyway. */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

- [ ] Append to `src/styles/index.css`:

```css
/* Motion (Word Game Motion.dc.html): mount-triggered keyframes. A staged
 * tile settles on mount, the badge rises on (re)mount, fresh rack tiles
 * rise from the bag. All die under prefers-reduced-motion below. */
@keyframes wg-settle { 0% { transform: scale(.96); } 45% { transform: scale(1.04); } 100% { transform: scale(1); } }
@keyframes wg-badge-in {
  0% { opacity: 0; transform: translateY(8px) scale(.8); }
  46% { opacity: 1; transform: translateY(-4px) scale(1.12); }
  62% { transform: translateY(-8px) scale(1); }
  100% { opacity: 1; transform: translateY(-8px) scale(1); }
}
@keyframes wg-badge-out { to { opacity: 0; } }
@keyframes wg-refill {
  0% { opacity: 0; transform: translateY(36px) scale(.82); }
  55% { opacity: 1; transform: translateY(-5px) scale(1.05); }
  75% { transform: translateY(0) scale(1); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wg-bag-pulse { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
.wg-settle { animation: wg-settle 160ms cubic-bezier(.22,1,.36,1); }
.wg-badge-in { animation: wg-badge-in 260ms cubic-bezier(.22,1,.36,1) 80ms backwards; }
.wg-badge-out { animation: wg-badge-out 120ms ease-out forwards; }
.wg-refill { animation: wg-refill 300ms cubic-bezier(.22,1,.36,1) backwards; }
.wg-bag-pulse { animation: wg-bag-pulse 300ms cubic-bezier(.34,1.56,.64,1); }
@media (prefers-reduced-motion: reduce) {
  .wg-settle, .wg-badge-in, .wg-badge-out, .wg-refill, .wg-bag-pulse, .wg-flight, .wg-ghost { animation: none !important; transition: none !important; }
}
```

- [ ] Commit: `feat(wordgame): motion tokens and keyframes from the motion spec`.

---

### Task 2: Rack reservation — the behavior change

The spec: *"The rack slot stays reserved while the tile is on the board"* and tap-return *"sends it back to the slot it came from."*

**Model:** replace `localRack: Tile[]` + `staged: Placement[]` with one source of truth in GameScreen:

```ts
interface RackEntry { id: number; tile: Tile; stagedAt: number | null; as?: Letter }
```

- View arrival rebuilds entries (ids from a counter — stable keys are what lets every later animation know a tile is *the same tile*). `staged` becomes a derivation (`entries with stagedAt !== null → Placement[]`), so the wire shape and everything downstream (preview, sendMove, Board) is unchanged.
- `placeFromRack(entryIndex, pos)` sets `stagedAt` (blank → `pendingBlank {pos, entryIndex}` → `as`); `recallOne(pos)` clears `stagedAt` — the tile reappears **in its own slot**, no insertion arithmetic. `recallAt(pos, slot)` (drag-to-tray) additionally `moveTile`s the entry to that slot. Exchange recalls all first (as today); shuffle shuffles entries; bingo staging = `rack.length === 7 && rack.every((e) => e.stagedAt !== null)`.
- **Rack props:** `tiles: Tile[]` → `entries: { id: number; tile: Tile | null }[]` (null = reserved slot, rendered as a `1.5px dashed` outline div, `data-testid="rack-slot-reserved-<i>"`, not a button). Keys switch from `${tile}-${index}` to `id` — reorder now animates too, free.
- `rackSlot` counts ALL slots (tiles + reserved); `draggingIndex` still hides one entry.

**Test updates (behavioral, deliberate):** staging no longer shrinks the tray — assertions change from "6 tiles left" to "6 tiles + 1 reserved slot"; `stageFirstTwoTiles` clicks `rack-tile-1` for its second tile (indices no longer shift); recall tests assert the tile returns to its **original index**. New test: `it('reserves the slot while the tile is on the board and returns it there', …)`.

- [ ] Refactor GameScreen state + handlers; adapt drag-drop dispatch (`reorderRack`/`recallAt` operate on entries).
- [ ] Rewrite Rack's tile row for `entries` (reserved slots render the dashed outline at their slot position; everything else unchanged).
- [ ] Update the affected GameScreen/Rack tests; add the reservation test; full wordgame suite green.
- [ ] Commit: `feat(wordgame): rack slots stay reserved while their tile is on the board`.

---

### Task 3: Ghost lift + landing settle + flight layer with snap-back

- [ ] **Ghost polish** (GameScreen's `drag-ghost` div): add class `wg-ghost`, and

```tsx
style={{
  left: drag.x - 22, top: drag.y - 25,
  transform: `translateY(-12px) scale(1.14) rotate(${drag.x >= drag.ox ? -4 : 4}deg)`,
  transition: `transform ${LIFT_MS}ms ${EASE_LIFT}`,
  boxShadow: 'inset 0 -3px 0 #d9bf8a, 0 14px 22px rgba(0,0,0,.32)',
}}
```

(tilt toward the drag direction, per the spec's ±4°; the mount transition gives the 120ms springy lift).

- [ ] **Landing settle**: staged `TileFace` in Board gets `wg-settle` — staged tiles are keyed by position, so placement and board→board moves each mount fresh and the 160ms settle plays itself. Zero bookkeeping.

- [ ] **Flight layer** — `useTileFlights.ts` + `TileFlightLayer.tsx`:

```ts
interface Flight { id: number; tile: Tile; from: Rect; to: Rect }
// launch(): skips (returns false) under reducedMotion() or zero-size rects
// (jsdom) — callers treat a skipped flight as already landed.
```

`TileFlightLayer` renders each flight as a fixed `wg-flight` tile at `from`, then on the next frame transitions `transform: translate(dx, dy) scale(to.width / from.width)` over `TRAVEL_MS` `EASE_TRAVEL` (`SNAPBACK_MS` for snap-backs), removing itself on `transitionend` (with a `setTimeout` fallback at duration + 80ms).

- [ ] **Snap-back**: when a drag's `dropAction` is `none`, launch a flight from the release point (a 44×50 rect at the pointer) back to the source rect (rack slot / board cell, measured by testid). Purely presentational — no state.

- [ ] Tests: flight-skip guard (`launch` returns false for zero rects); ghost carries the lift transform. Suite green; commit: `feat(wordgame): drag lift, landing settle, and animated snap-back`.

---

### Task 4: Tap travel — rack→board and back

The spec: tap pops 1.12 in 90ms, the tile **flies** to the square in 220ms and lands with the settle; tapping a staged tile flies it home on the identical curve.

- [ ] In `placeFromRack` (tap path only — drag already carries the tile) and `recallOne` (tap path): before the state commit, measure source and target rects (`rack-tile-<i>` / reserved slot / `cell-<pos>` via `querySelector` on the refs' subtrees); commit state; if `launch()` accepts the flight, hide the real landed tile for the flight's duration — board side via the existing `hiddenPos` (a second, flight-owned value OR'd with the drag's), rack side via a new `hiddenIds: number[]` Rack prop (opacity 0, still occupies its slot — reservation makes this trivial).
- [ ] The rack tile's 90ms 1.12 tap-pop: `transition: transform 90ms` + a transient `data-popped` toggle on pointerdown-tap… simplest: `active:scale-[1.12]` utility on the tile button (`:active` is the press itself).
- [ ] Tests: tap-to-place and tap-to-recall still commit synchronously (existing tests are the proof — they must pass untouched beyond Task 2's edits). Commit: `feat(wordgame): tap travel — tiles fly to the board and home again`.

---

### Task 5: Score badge motion

- [ ] Restructure the stage-badge: outer div keeps the clamped position (Task 8 of the touch plan), inner span carries the animation — transforms must not fight the `-translate-y-full` positioning class. Key the inner span by `` `${preview.total}-${preview.anchorPos}` `` so each new landing remounts it and `wg-badge-in` replays (260ms, 80ms after the settle starts — the spec's sequence).
- [ ] Fade-out: when `preview` goes non-null → null (recall/invalid staging), keep the last badge mounted for 120ms with `wg-badge-out` (a `useEffect` + `setTimeout(120)` holding `lastPreview`), then unmount. Reduced motion: the CSS block freezes it; the timeout is harmless.
- [ ] Tests: badge still appears/disappears per existing assertions (the out-animation holds it ≤120ms — assertions that check absence use `queryBy` right after recall… verify; if one races the 120ms hold, assert via `waitFor`). Commit: `feat(wordgame): score badge rises on landing, fades on recall`.

---

### Task 6: Refill stagger + bag pulse

- [ ] In GameScreen's view-arrival effect: diff the previous server rack (multiset) against the new one; entries left over after consuming the old counts are `fresh`. Pass `fresh` per entry to Rack; fresh tiles get `wg-refill` with `animationDelay: freshIndex * STAGGER_MS`. (Opponent's play leaves your rack identical — nothing animates; your play or exchange animates exactly the drawn tiles. "Starts only after the board confirmed the play" is free: the diff runs on server-view arrival.)
- [ ] Bag pulse: key the bag tile by `view.bagCount` and give it `wg-bag-pulse` — a count change remounts it and the pulse plays; the badge number is already the new count ("decrements as the last tile lands" approximated to the pulse beat).
- [ ] Tests: a new view with a bigger rack renders fresh tiles with the `wg-refill` class (class assertion — animations are inert in jsdom); unchanged rack renders none. Commit: `feat(wordgame): staggered refill from the bag, bag pulse on the draw`.

---

### Task 7: Gates + artifact pass

- [ ] Full wordgame suite, typecheck, lint. Full `npm test` (known environmental exceptions apply).
- [ ] `npm run build`; grep the bundle for `wg-settle`/`wg-refill`/`wg-flight`; boot the compiled host on :4100, `/health`, served bundle carries the classes; stop by task id.
- [ ] Push to `feat/wordgame-touch` (PR #27 updates in place); comment/edit the PR body noting the motion layer and the count-up omission.
- [ ] Phone checklist addendum: lift/tilt feel on press; settle on every landing; tap-flight to board and home; reserved slot visible while a tile is out; snap-back from an invalid drop; badge rise then fade on recall; refill stagger after a play; everything still calm under Reduce Motion.

## Self-review (2026-09-01)

- Spec coverage: 5 demo cards → Tasks 3 (pick-up/drop + snap-back), 4 (tap travel), 2+touch-plan (rearrange reflow — bump 150→180ms in Task 2), 5 (scoring badge), 6 (refill + bag). Token strip → Task 1. Reservation prose → Task 2. Omission (Play count-up) ruled and recorded.
- Types consistent: `RackEntry` defined once (Task 2), consumed by 3/4/6; `Flight`/`launch` defined in 3, consumed by 4.
- Honest softness: exact keyframe percentages are tuned interpolations of the demo's timelines (the demo loops padded with idle time; percentages here are re-normalized to the stated durations) — the phone pass judges feel, and the tokens are the contract.
