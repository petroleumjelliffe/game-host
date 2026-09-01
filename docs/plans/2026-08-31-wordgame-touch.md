# Wordgame Touch Interactions + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planned (2026-08-31). Follows the redesign (PR #23) and its postmortem PRs (#24–#26).

**Goal:** Drag-and-drop tile placement and rearrangement, pinch-zoom/pan of the board inside a pinned app-shell layout, plus the small polish items deferred from the redesign reviews.

**Architecture:** All client work in `games/wordgame/src`, no server or engine changes except one comment+test on the summaries cap. Gesture math lives in pure modules (`boardTransform.ts`, `dragPlan.ts`) with unit tests — jsdom has no layout, so components stay thin over testable functions and component tests stub `getBoundingClientRect`. Pointer Events by hand; no gesture or drag library.

**Tech Stack:** React 18, Tailwind, vitest + testing-library (jsdom), Pointer Events.

**Spec:** none — the **Design decisions** section below is the binding interaction spec, agreed in conversation 2026-08-31. These interactions were never part of the `.dc.html` designs in `docs/plans/2026-08-31-wordgame-redesign/`.

## Design decisions (the binding spec)

**App-shell layout (prerequisite for zoom).** The game screen stops scrolling: full-viewport column (`h-[100dvh]`), with the title bar, player chips, turn status, and last-move banner pinned to the top; the rack and action buttons pinned to the bottom (with safe-area inset); the board filling the middle. The move history **remains in the code but is hidden** (`hidden` attribute + comment) — Pete wants it back but the reveal mechanism is undecided; do not delete `MoveLog` or its tests.

**Pinch-zoom/pan, board only.** Two fingers pinch (scale clamped 1×–3×) and pan — the point under the fingers stays stationary. One finger never pans: it stays reserved for tap and drag. Double-tap resets to 1×; at 1× the transform is exactly identity (no drift). Translation is clamped so the board edge never pulls inside the viewport. The floating score badge zooms with the board (it anchors to a cell); the invalid-word card stays outside the transform, screen-anchored and readable at any zoom. The viewport is `touch-action: none` — the screen no longer scrolls, so nothing is lost.

**Drag-and-drop.** Four drags, all starting from a tile press that travels ≥ 8px (under that it's the existing tap, unchanged):

- **rack → board**: drop on an empty cell places the tile; a blank opens the existing BlankPicker on drop.
- **board → board**: a staged tile moves to another empty cell.
- **rack → rack**: manual rearrangement — drop at any slot in the tray.
- **board → rack/off**: a staged tile dropped on the tray recalls it *at that slot*; dropped anywhere else off-board recalls it to the end of the rack.

**No dimmed source tile.** During a drag the source tile vanishes from the rack or cell entirely; the ghost tile under the finger is its only representation. While a drag hovers over the tray, an insertion gap opens at the nearest slot and the neighbouring tiles **slide aside** (~150ms transition); the ghost drops into the gap. Invalid drops (occupied cell, own cell) change nothing — the tile reappears where it was.

Drag has the same permissiveness as tap today: staging is allowed off-turn (Play stays disabled); no dragging in exchange mode. A second finger landing mid-drag cancels the drag (that's a pinch starting). After a completed drag, the click the browser fires on the source element is swallowed so it can't double as a tap.

**Polish riding along:** `ago()` hours use `floor` (kills "24h ago" at 23h59m); the score badge clamps at board edges (right-aligned in the last 3 columns, below the anchor at row 0); `MAX_ROOMS = 20` gets its comment + a pinning test; coverage for the amber confirm-email banner, `maskEmail`, and three `previewPlay` guards.

**Excluded on purpose** (product decisions, not fixes): pass-and-play, host-chosen room size, opponents' rack counts, "link shared Xm ago", the history-reveal design, desktop wheel-zoom.

## Global Constraints

- Branch `feat/wordgame-touch` off `main` **after PR #26 merges** — new tests assume `src/test/setup.ts` already stubs `BASE_URL` to `/wordgame`.
- No new dependencies, runtime or dev. Gestures are hand-rolled Pointer Events.
- `games/wordgame/engine/` is untouched (and stays free of `Date.now`); the only server change is Task 8's comment + test.
- Existing tap flows keep working unchanged: existing tests keep passing except where a task explicitly says to update them.
- Tailwind semantic tokens only (`bg-tile`, `text-ink-soft`, …) — no `gray-*` utilities; match the redesign's inline `boxShadow` idiom for tile chrome.
- Comments follow the repo voice: constraints and why, dated where a problem was found.
- Gates per task: `npx vitest run --root games/wordgame` (suite is 224 green at branch time), `npm run typecheck`, `npm run lint`. Never root `vitest` with projects.
- jsdom has no layout: geometry goes through the pure modules; component tests stub `getBoundingClientRect` on specific elements and dispatch pointer events with explicit `clientX/clientY/pointerId`.
- Known environmental exception: `apps/host` `routes.test.ts` "answers under its own prefix" fails in `.claude/worktrees/*` (dot-segment vs Express dotfiles policy) — not caused by this work.
- Commits: `feat(wordgame): …` / `fix(wordgame): …` / `test(wordgame): …`.

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/game/boardTransform.ts` | Pure pinch/pan/clamp math for the board transform. |
| Create `src/game/boardTransform.test.ts` | Unit tests for that math. |
| Create `src/game/BoardViewport.tsx` | The zoomable viewport component: pointer tracking, double-tap reset, transform rendering. |
| Create `src/game/BoardViewport.test.tsx` | Wiring tests (pinch → scale style, double-tap → identity). |
| Create `src/game/dragPlan.ts` | Pure drag resolution: `DragSource`, `hitCell`, `rackSlot`, `dropAction`, `moveTile`. |
| Create `src/game/dragPlan.test.ts` | Unit tests for drop resolution. |
| Create `src/game/useTileDrag.ts` | The drag lifecycle hook: threshold, window listeners, cancel-on-second-pointer, click swallowing. |
| Create `src/game/useTileDrag.test.tsx` | Hook tests via a probe component. |
| Modify `src/game/GameScreen.tsx` | App-shell layout; drag wiring; ghost tile; badge clamp. |
| Modify `src/game/GameScreen.test.tsx` | Layout/drag/badge tests. |
| Modify `src/game/Board.tsx` | `gridRef`, `onStagedPointerDown`, `hiddenPos` props. |
| Modify `src/game/Rack.tsx` | Slot-positioned tiles, hidden dragged tile, sliding insertion gap. |
| Modify `src/game/Rack.test.tsx` | Gap/hide rendering tests. |
| Modify `src/game/LastMove.tsx` + `LastMove.test.tsx` | `ago()` floor fix. |
| Modify `server/summaries.ts` + `server/summaries.test.ts` | `MAX_ROOMS` comment + pinning test. |
| Modify `src/pages/HomePage.test.tsx`, `src/game/scorePreview.test.ts` | Coverage nits. |

---

### Task 1: Board transform math (pure)

**Files:**
- Create: `games/wordgame/src/game/boardTransform.ts`
- Test: `games/wordgame/src/game/boardTransform.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Point { x: number; y: number }`, `interface BoardTransform { scale: number; tx: number; ty: number }`, `const IDENTITY: BoardTransform`, `const MIN_SCALE = 1`, `const MAX_SCALE = 3`, `function clampTransform(t: BoardTransform, w: number, h: number): BoardTransform`, `function pinch(prev: BoardTransform, a0: Point, b0: Point, a1: Point, b1: Point, w: number, h: number): BoardTransform`. Task 2 consumes all of these.

- [ ] **Step 1: Write the failing tests**

```ts
// games/wordgame/src/game/boardTransform.test.ts
import { describe, expect, it } from 'vitest';
import { IDENTITY, MAX_SCALE, clampTransform, pinch } from './boardTransform';

// Viewport is 300×300 in every case; transform-origin is 0 0.
const W = 300;
const H = 300;

describe('pinch', () => {
  it('doubles the scale when finger distance doubles', () => {
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    expect(t.scale).toBeCloseTo(2);
  });

  it('keeps the point under the pinch midpoint stationary', () => {
    // Midpoint (150,100) before and after; content point under it must map back to it.
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    const contentX = (150 - 0) / 1; // under midpoint before, identity transform
    expect(contentX * t.scale + t.tx).toBeCloseTo(150);
    const contentY = (100 - 0) / 1;
    expect(contentY * t.scale + t.ty).toBeCloseTo(100);
  });

  it('clamps at MAX_SCALE', () => {
    let t = IDENTITY;
    for (let i = 0; i < 5; i += 1) {
      t = pinch(t, { x: 140, y: 150 }, { x: 160, y: 150 }, { x: 50, y: 150 }, { x: 250, y: 150 }, W, H);
    }
    expect(t.scale).toBe(MAX_SCALE);
  });

  it('snaps to exact identity when pinched back out to 1×', () => {
    const zoomed = pinch(IDENTITY, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    const back = pinch(zoomed, { x: 50, y: 100 }, { x: 250, y: 100 }, { x: 120, y: 100 }, { x: 180, y: 100 }, W, H);
    expect(back).toEqual(IDENTITY);
  });

  it('ignores a degenerate pinch with both fingers at one point', () => {
    const t = pinch(IDENTITY, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 }, W, H);
    expect(t).toEqual(IDENTITY);
  });
});

describe('clampTransform', () => {
  it('never lets the board edge pull inside the viewport', () => {
    expect(clampTransform({ scale: 2, tx: 50, ty: -900 }, W, H)).toEqual({ scale: 2, tx: 0, ty: -300 });
  });

  it('collapses scale ≤ 1 to exact identity — no residual drift', () => {
    expect(clampTransform({ scale: 0.8, tx: -20, ty: -20 }, W, H)).toEqual(IDENTITY);
    expect(clampTransform({ scale: 1, tx: -20, ty: 0 }, W, H)).toEqual(IDENTITY);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/boardTransform.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// games/wordgame/src/game/boardTransform.ts
// Pure math for the board's pinch-zoom: no DOM, no React, fully unit-tested
// because jsdom can't do layout and a phone can't do CI. transform-origin is
// 0 0 throughout; the transformed content is the same size as the viewport.

export interface Point { x: number; y: number }
export interface BoardTransform { scale: number; tx: number; ty: number }

export const IDENTITY: BoardTransform = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Clamp scale to [MIN_SCALE, MAX_SCALE] and translation so the content's
 * edges never pull inside the viewport (w×h). Scale ≤ 1 is EXACT identity —
 * returning a not-quite-zero tx here is how zoom UIs accumulate drift. */
export function clampTransform(t: BoardTransform, w: number, h: number): BoardTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
  if (scale <= 1) return IDENTITY;
  return {
    scale,
    tx: Math.min(0, Math.max(w * (1 - scale), t.tx)),
    ty: Math.min(0, Math.max(h * (1 - scale), t.ty)),
  };
}

/** One pinch step: previous transform plus both fingers' previous (a0, b0)
 * and current (a1, b1) viewport-relative positions. The content point under
 * the old midpoint lands under the new midpoint, so the board tracks the
 * fingers through combined zoom + pan. */
export function pinch(
  prev: BoardTransform,
  a0: Point, b0: Point, a1: Point, b1: Point,
  w: number, h: number,
): BoardTransform {
  const d0 = dist(a0, b0);
  if (d0 === 0) return prev;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (dist(a1, b1) / d0)));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return clampTransform({
    scale,
    tx: m1.x - ((m0.x - prev.tx) / prev.scale) * scale,
    ty: m1.y - ((m0.y - prev.ty) / prev.scale) * scale,
  }, w, h);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --root games/wordgame src/game/boardTransform.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/boardTransform.ts games/wordgame/src/game/boardTransform.test.ts
git commit -m "feat(wordgame): pure pinch/pan math for the board transform"
```

---

### Task 2: App-shell layout — pinned chrome, hidden history

**Files:**
- Modify: `games/wordgame/src/game/GameScreen.tsx` (the outer layout, currently `min-h-screen … pb-6` around line 215)
- Test: `games/wordgame/src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the three-region layout Task 3 mounts the viewport into: a top `flex-none` block, a middle `data-testid="board-region"` block (`relative min-h-0 flex-1`), and a bottom `flex-none` block. The move-log `<section>` carries `hidden` and `data-testid="move-history"`.

- [ ] **Step 1: Write the failing tests** (append to `GameScreen.test.tsx`, using its existing render helpers)

```tsx
describe('GameScreen — app-shell layout', () => {
  it('pins chrome and keeps the move history in the DOM but hidden', () => {
    renderScreen(); // the file's existing helper with a playing view
    const screenEl = screen.getByTestId('game-screen');
    expect(screenEl.className).toContain('h-[100dvh]');
    expect(screen.getByTestId('board-region')).toBeInTheDocument();
    const history = screen.getByTestId('move-history');
    expect(history).not.toBeVisible(); // hidden attribute — kept for a future reveal
  });
});
```

(Adapt `renderScreen` to the file's actual helper name — it already renders a playing `GameView`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --root games/wordgame src/game/GameScreen.test.tsx`
Expected: FAIL — no `board-region`/`move-history` testids, `min-h-screen` not `h-[100dvh]`.

- [ ] **Step 3: Restructure the render**

Reshape `GameScreen`'s return to this skeleton — the *contents* of each region are today's JSX, moved, not rewritten:

```tsx
return (
  <div data-testid="game-screen" className="mx-auto flex h-[100dvh] max-w-2xl flex-col bg-paper">
    {/* Pinned top: title bar, chips, status, last move, notes. Scrolls
     * itself only in the over state, where the panel can outgrow a phone. */}
    <div className={`flex-none ${view.stage === 'over' ? 'overflow-y-auto' : ''}`}>
      <header …unchanged… />
      <PlayerChips …unchanged… />
      <div data-testid="turn-status" …unchanged… />
      <LastMove …unchanged… />
      {rejection !== null && rejection.code !== 'invalidWord' && ( …unchanged… )}
      {view.stage === 'over' && ( …unchanged GameOverPanel block… )}
    </div>

    {/* The board region — fills whatever the pinned chrome leaves. The inner
     * wrapper is height-driven and square (aspect-ratio), capped by width,
     * so the board is always the largest square that fits. */}
    <div data-testid="board-region" className="relative min-h-0 flex-1">
      <div className="flex h-full items-center justify-center px-3.5 py-2">
        <div className="mx-auto max-w-full" style={{ height: '100%', aspectRatio: '1 / 1' }}>
          <div className="relative w-full">
            <Board board={view.board} staged={staged} lastPositions={lastPlayPositions} onCellTap={cellTap} />
            {preview !== null && ( …the existing stage-badge block, unchanged in this task… )}
          </div>
        </div>
      </div>
      {/* Screen-anchored, outside any future zoom transform: readable at any scale. */}
      {rejection !== null && rejection.code === 'invalidWord' && ( …the existing invalid-card block… )}
    </div>

    {/* Pinned bottom: rack + actions (or the exchange UI), above the home bar. */}
    <div className="flex-none pb-[max(12px,env(safe-area-inset-bottom))]">
      {view.stage === 'playing' && ( …the existing rack + actions/exchange fragment, minus its old top-level placement… )}
    </div>

    {/* The move history stays in the code but hidden: Pete wants it back,
     * the reveal (drawer? long-press?) is undecided (2026-08-31). */}
    <section hidden data-testid="move-history" className="px-3.5 pb-3 pt-3">
      <h2 className="mb-1 text-sm font-semibold text-ink-soft">Moves</h2>
      <MoveLog view={view} />
    </section>

    {pendingBlank !== null && ( …unchanged… )}
    {notifyOpen && ( …unchanged… )}
  </div>
);
```

Also delete the old `max-w-[600px]` from `Board.tsx`'s root class (`mx-auto grid w-full max-w-[600px] …` → `mx-auto grid w-full …`) — sizing now belongs to the aspect wrapper; add `max-w-[600px]` to the aspect wrapper's className instead.

- [ ] **Step 4: Run the full wordgame suite; fix visibility fallout**

Run: `npx vitest run --root games/wordgame`
Expected: the new test passes; any existing GameScreen assertions that queried move-log text with visibility semantics need `{ hidden: true }` queries or removal — update them, and only them.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/GameScreen.tsx games/wordgame/src/game/GameScreen.test.tsx games/wordgame/src/game/Board.tsx
git commit -m "feat(wordgame): app-shell layout — pinned chrome, board region, hidden history"
```

---

### Task 3: BoardViewport — pinch-zoom in the board region

**Files:**
- Create: `games/wordgame/src/game/BoardViewport.tsx`
- Test: `games/wordgame/src/game/BoardViewport.test.tsx`
- Modify: `games/wordgame/src/game/GameScreen.tsx` (wrap the aspect wrapper's child)

**Interfaces:**
- Consumes: Task 1's `pinch`, `IDENTITY`, `BoardTransform`, `Point`; Task 2's layout.
- Produces: `function BoardViewport({ children }: { children: ReactNode }): JSX.Element` — testids `board-viewport` (outer) and `board-transform` (inner, carries the `transform` style).

- [ ] **Step 1: Write the failing tests**

```tsx
// games/wordgame/src/game/BoardViewport.test.tsx
// jsdom rects are 0×0, so translation clamps to 0 here — scale is the
// observable. The translation math itself is pinned in boardTransform.test.ts.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BoardViewport } from './BoardViewport';

function pinchOut() {
  const vp = screen.getByTestId('board-viewport');
  fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerDown(vp, { pointerId: 2, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(vp, { pointerId: 2, clientX: 300, clientY: 100 });
  fireEvent.pointerUp(vp, { pointerId: 2 });
  fireEvent.pointerUp(vp, { pointerId: 1 });
}

describe('BoardViewport', () => {
  it('scales with a two-pointer pinch', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    pinchOut();
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(2)');
  });

  it('double-tap resets to identity', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    pinchOut();
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 3, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(vp, { pointerId: 3 });
    fireEvent.pointerDown(vp, { pointerId: 4, clientX: 152, clientY: 151 });
    fireEvent.pointerUp(vp, { pointerId: 4 });
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(1)');
  });

  it('one pointer alone never pans or zooms', () => {
    render(<BoardViewport><div>board</div></BoardViewport>);
    const vp = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(vp, { pointerId: 1, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(vp, { pointerId: 1 });
    expect(screen.getByTestId('board-transform').style.transform).toContain('scale(1)');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/BoardViewport.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// games/wordgame/src/game/BoardViewport.tsx
// The zoomable window onto the board. Two fingers pinch AND pan (the point
// under the fingers stays put); one finger is deliberately inert here — it
// belongs to tap and drag. Double-tap resets. touch-action is none: the
// app-shell layout doesn't scroll, so the browser gets no gestures at all.

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IDENTITY, pinch, type BoardTransform, type Point } from './boardTransform';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

export function BoardViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<BoardTransform>(IDENTITY);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const local = (e: ReactPointerEvent): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const down = (e: ReactPointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size !== 1) return;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev !== null && now - prev.at < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < DOUBLE_TAP_SLOP) {
      setT(IDENTITY);
      lastTap.current = null;
    } else {
      lastTap.current = { at: now, ...p };
    }
  };

  const move = (e: ReactPointerEvent) => {
    const before = pointers.current.get(e.pointerId);
    if (before === undefined || pointers.current.size !== 2) return;
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId);
    if (other === undefined) return;
    const after = local(e);
    const r = ref.current?.getBoundingClientRect();
    setT((prev) => pinch(prev, before, other[1], after, other[1], r?.width ?? 0, r?.height ?? 0));
    pointers.current.set(e.pointerId, after);
  };

  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  return (
    <div
      ref={ref}
      data-testid="board-viewport"
      className="h-full w-full overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div
        data-testid="board-transform"
        className="w-full"
        style={{ transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`, transformOrigin: '0 0' }}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in GameScreen**

In the Task-2 skeleton, wrap the board+badge `relative` div:

```tsx
<div className="mx-auto max-w-full max-w-[600px]" style={{ height: '100%', aspectRatio: '1 / 1' }}>
  <BoardViewport>
    <div className="relative w-full">
      <Board … />
      {preview !== null && ( …stage-badge… )}
    </div>
  </BoardViewport>
</div>
```

(The invalid-word card is already outside this wrapper from Task 2 — it stays screen-anchored.)

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npx vitest run --root games/wordgame && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add games/wordgame/src/game/BoardViewport.tsx games/wordgame/src/game/BoardViewport.test.tsx games/wordgame/src/game/GameScreen.tsx
git commit -m "feat(wordgame): pinch-zoom board viewport — two-finger zoom/pan, double-tap reset"
```

---

### Task 4: Drag resolution (pure)

**Files:**
- Create: `games/wordgame/src/game/dragPlan.ts`
- Test: `games/wordgame/src/game/dragPlan.test.ts`

**Interfaces:**
- Consumes: `Tile`, `Square`, `Placement` from `../../session/protocol` / `../../engine/constants`.
- Produces (Tasks 5–7 consume):

```ts
type DragSource =
  | { kind: 'rack'; index: number; tile: Tile }
  | { kind: 'board'; pos: number; tile: Tile };
interface Rect { left: number; top: number; width: number; height: number }
function hitCell(rect: Rect, p: Point): number | null
function rackSlot(rect: Rect, p: Point, count: number): number | null
type DropAction =
  | { kind: 'place'; rackIndex: number; pos: number }
  | { kind: 'moveStaged'; from: number; pos: number }
  | { kind: 'reorderRack'; from: number; slot: number }
  | { kind: 'recallAt'; from: number; slot: number | null }
  | { kind: 'none' }
function dropAction(source: DragSource, cell: number | null, slot: number | null, board: Square[], staged: Placement[]): DropAction
function moveTile<T>(items: T[], from: number, slot: number): T[]
```

- [ ] **Step 1: Write the failing tests**

```ts
// games/wordgame/src/game/dragPlan.test.ts
import { describe, expect, it } from 'vitest';
import { dropAction, hitCell, moveTile, rackSlot, type DragSource } from './dragPlan';
import type { Placement, Square } from '../../session/protocol';

const emptyBoard: Square[] = Array<Square>(225).fill(null);
const grid = { left: 0, top: 0, width: 300, height: 300 }; // 20px cells

describe('hitCell', () => {
  it('maps a point to its cell', () => {
    expect(hitCell(grid, { x: 30, y: 30 })).toBe(16); // col 1, row 1
    expect(hitCell(grid, { x: 299, y: 299 })).toBe(224);
  });
  it('answers null outside the grid or with a zero-size rect (jsdom)', () => {
    expect(hitCell(grid, { x: -5, y: 30 })).toBeNull();
    expect(hitCell(grid, { x: 30, y: 320 })).toBeNull();
    expect(hitCell({ left: 0, top: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('rackSlot', () => {
  const rack = { left: 100, top: 500, width: 288, height: 50 }; // 6 visible tiles, 48px slots
  it('rounds to the nearest insertion slot, 0 through count', () => {
    expect(rackSlot(rack, { x: 100, y: 520 }, 6)).toBe(0);
    expect(rackSlot(rack, { x: 175, y: 520 }, 6)).toBe(2);
    expect(rackSlot(rack, { x: 388, y: 520 }, 6)).toBe(6);
  });
  it('answers null when the point is not near the tray', () => {
    expect(rackSlot(rack, { x: 200, y: 300 }, 6)).toBeNull();
    expect(rackSlot(rack, { x: 500, y: 520 }, 6)).toBeNull();
  });
});

describe('dropAction', () => {
  const fromRack: DragSource = { kind: 'rack', index: 2, tile: 'A' };
  const fromBoard: DragSource = { kind: 'board', pos: 112, tile: 'B' };
  const staged: Placement[] = [{ pos: 112, tile: 'B' }];

  it('rack tile onto an empty cell places it', () => {
    expect(dropAction(fromRack, 113, null, emptyBoard, staged)).toEqual({ kind: 'place', rackIndex: 2, pos: 113 });
  });
  it('rack tile onto an occupied or staged cell is a no-op', () => {
    const board = [...emptyBoard];
    board[50] = { letter: 'Q', isBlank: false };
    expect(dropAction(fromRack, 50, null, board, staged)).toEqual({ kind: 'none' });
    expect(dropAction(fromRack, 112, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
  it('staged tile onto another empty cell moves it; its own cell is a no-op', () => {
    expect(dropAction(fromBoard, 113, null, emptyBoard, staged)).toEqual({ kind: 'moveStaged', from: 112, pos: 113 });
    expect(dropAction(fromBoard, 112, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
  it('rack tile dropped at a tray slot reorders the rack', () => {
    expect(dropAction(fromRack, null, 5, emptyBoard, staged)).toEqual({ kind: 'reorderRack', from: 2, slot: 5 });
  });
  it('staged tile dropped at a tray slot recalls it there; off everything recalls to the end', () => {
    expect(dropAction(fromBoard, null, 3, emptyBoard, staged)).toEqual({ kind: 'recallAt', from: 112, slot: 3 });
    expect(dropAction(fromBoard, null, null, emptyBoard, staged)).toEqual({ kind: 'recallAt', from: 112, slot: null });
  });
  it('rack tile dropped off everything is a no-op — it snaps back', () => {
    expect(dropAction(fromRack, null, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
});

describe('moveTile', () => {
  it('moves an item to an insertion slot counted with the item removed', () => {
    expect(moveTile(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'C', 'A', 'D']);
    expect(moveTile(['A', 'B', 'C', 'D'], 3, 0)).toEqual(['D', 'A', 'B', 'C']);
    expect(moveTile(['A', 'B', 'C', 'D'], 1, 9)).toEqual(['A', 'C', 'D', 'B']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/dragPlan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// games/wordgame/src/game/dragPlan.ts
// Pure drop resolution for tile drags. Geometry works off live
// getBoundingClientRect values, which already reflect the zoom transform —
// so a drop targets the same cell at 1× and 3× with no special casing.

import type { Tile } from '../../engine/constants';
import type { Placement, Square } from '../../session/protocol';
import type { Point } from './boardTransform';

export type DragSource =
  | { kind: 'rack'; index: number; tile: Tile }
  | { kind: 'board'; pos: number; tile: Tile };

export interface Rect { left: number; top: number; width: number; height: number }

/** Which of the 15×15 cells a viewport point lands on; null off-grid or for
 * a zero-size rect (jsdom's default — callers stub rects in tests). */
export function hitCell(rect: Rect, p: Point): number | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = Math.floor(((p.x - rect.left) / rect.width) * 15);
  const row = Math.floor(((p.y - rect.top) / rect.height) * 15);
  if (col < 0 || col > 14 || row < 0 || row > 14) return null;
  return row * 15 + col;
}

/** Insertion slot (0..count) in a tray of `count` visible tiles, or null
 * when the point isn't near the tray. The hit area is padded so a drop "at
 * the rack" doesn't demand pixel accuracy from a thumb. */
export function rackSlot(rect: Rect, p: Point, count: number): number | null {
  const PAD = 24;
  if (rect.width <= 0) return null;
  if (p.x < rect.left - PAD || p.x > rect.left + rect.width + PAD) return null;
  if (p.y < rect.top - PAD || p.y > rect.top + rect.height + PAD) return null;
  const slotWidth = rect.width / Math.max(1, count);
  return Math.max(0, Math.min(count, Math.round((p.x - rect.left) / slotWidth)));
}

export type DropAction =
  | { kind: 'place'; rackIndex: number; pos: number }
  | { kind: 'moveStaged'; from: number; pos: number }
  | { kind: 'reorderRack'; from: number; slot: number }
  | { kind: 'recallAt'; from: number; slot: number | null }
  | { kind: 'none' };

export function dropAction(
  source: DragSource,
  cell: number | null,
  slot: number | null,
  board: Square[],
  staged: Placement[],
): DropAction {
  if (cell !== null) {
    const empty = (board[cell] ?? null) === null && !staged.some((p) => p.pos === cell);
    if (source.kind === 'rack') {
      return empty ? { kind: 'place', rackIndex: source.index, pos: cell } : { kind: 'none' };
    }
    if (cell === source.pos) return { kind: 'none' };
    return empty ? { kind: 'moveStaged', from: source.pos, pos: cell } : { kind: 'none' };
  }
  if (slot !== null) {
    return source.kind === 'rack'
      ? { kind: 'reorderRack', from: source.index, slot }
      : { kind: 'recallAt', from: source.pos, slot };
  }
  return source.kind === 'board' ? { kind: 'recallAt', from: source.pos, slot: null } : { kind: 'none' };
}

/** Reorder: remove `from`, insert at `slot` — slots are counted with the
 * moved item already removed, matching what rackSlot sees on screen. */
export function moveTile<T>(items: T[], from: number, slot: number): T[] {
  const moved = items[from];
  if (moved === undefined) return items;
  const next = items.filter((_, i) => i !== from);
  next.splice(Math.min(slot, next.length), 0, moved);
  return next;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --root games/wordgame src/game/dragPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/dragPlan.ts games/wordgame/src/game/dragPlan.test.ts
git commit -m "feat(wordgame): pure drop resolution for tile drags"
```

---

### Task 5: useTileDrag — the drag lifecycle hook

**Files:**
- Create: `games/wordgame/src/game/useTileDrag.ts`
- Test: `games/wordgame/src/game/useTileDrag.test.tsx`

**Interfaces:**
- Consumes: Task 4's `DragSource`; Task 1's `Point`.
- Produces (Task 7 consumes):

```ts
interface DragState { source: DragSource; x: number; y: number; active: boolean }
function useTileDrag(onDrop: (source: DragSource, p: Point) => void): {
  drag: DragState | null;
  start(source: DragSource, e: { clientX: number; clientY: number; pointerId?: number }): void;
  consumeDragClick(): boolean;
}
```

- [ ] **Step 1: Write the failing tests**

```tsx
// games/wordgame/src/game/useTileDrag.test.tsx
// The hook through a probe component: press, cross the 8px threshold, drop.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useTileDrag } from './useTileDrag';
import type { DragSource } from './dragPlan';

const SOURCE: DragSource = { kind: 'rack', index: 0, tile: 'A' };

function Probe({ onDrop }: { onDrop: (s: DragSource, p: { x: number; y: number }) => void }) {
  const { drag, start, consumeDragClick } = useTileDrag(onDrop);
  return (
    <div>
      <button
        type="button"
        data-testid="tile"
        onPointerDown={(e) => { start(SOURCE, e); }}
        onClick={() => { if (consumeDragClick()) return; document.title = 'tapped'; }}
      >
        A
      </button>
      {drag?.active === true && <div data-testid="dragging" />}
    </div>
  );
}

describe('useTileDrag', () => {
  it('activates after 8px and calls onDrop with the release point', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    fireEvent.pointerDown(screen.getByTestId('tile'), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.queryByTestId('dragging')).toBeNull();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(screen.getByTestId('dragging')).toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 41, clientY: 42 });
    expect(onDrop).toHaveBeenCalledWith(SOURCE, { x: 41, y: 42 });
    expect(screen.queryByTestId('dragging')).toBeNull();
  });

  it('a sub-threshold release is not a drop, and the click stays a tap', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    document.title = '';
    const tile = screen.getByTestId('tile');
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 13, clientY: 12 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 13, clientY: 12 });
    fireEvent.click(tile);
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.title).toBe('tapped');
  });

  it('swallows exactly one click after a completed drag', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    document.title = '';
    const tile = screen.getByTestId('tile');
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.click(tile); // the browser's post-drag click — swallowed
    expect(document.title).toBe('');
    fireEvent.click(tile); // a real tap afterwards — lands
    expect(document.title).toBe('tapped');
  });

  it('a second pointer starting mid-drag cancels it (a pinch is beginning)', () => {
    const onDrop = vi.fn();
    render(<Probe onDrop={onDrop} />);
    fireEvent.pointerDown(screen.getByTestId('tile'), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.pointerDown(window, { pointerId: 2, clientX: 200, clientY: 200 });
    expect(screen.queryByTestId('dragging')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 10 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/useTileDrag.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// games/wordgame/src/game/useTileDrag.ts
// The drag lifecycle: a press becomes a drag only after DRAG_THRESHOLD px,
// so every existing tap stays a tap. Listeners live on window — jsdom has
// no setPointerCapture, and on touch the events land there anyway once the
// source element sets touch-action: none. The pointerId guard tolerates
// undefined because jsdom's synthetic events may omit it.

import { useEffect, useRef, useState } from 'react';
import type { Point } from './boardTransform';
import type { DragSource } from './dragPlan';

const DRAG_THRESHOLD = 8;

export interface DragState {
  source: DragSource;
  x: number;
  y: number;
  active: boolean;
}

interface InternalDrag extends DragState { ox: number; oy: number; pointerId: number | undefined }

export function useTileDrag(onDrop: (source: DragSource, p: Point) => void) {
  const [drag, setDrag] = useState<InternalDrag | null>(null);
  const dragRef = useRef<InternalDrag | null>(null);
  dragRef.current = drag;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const swallowClick = useRef(false);

  const start = (source: DragSource, e: { clientX: number; clientY: number; pointerId?: number }) => {
    setDrag({ source, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, pointerId: e.pointerId, active: false });
  };

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const samePointer = (e: PointerEvent) => {
      const id = dragRef.current?.pointerId;
      return id === undefined || e.pointerId === undefined || e.pointerId === id;
    };
    const move = (e: PointerEvent) => {
      if (!samePointer(e)) return;
      setDrag((d) => d === null ? null : {
        ...d,
        x: e.clientX,
        y: e.clientY,
        active: d.active || Math.hypot(e.clientX - d.ox, e.clientY - d.oy) >= DRAG_THRESHOLD,
      });
    };
    const up = (e: PointerEvent) => {
      if (!samePointer(e)) return;
      const d = dragRef.current;
      setDrag(null);
      if (d !== null && d.active) {
        swallowClick.current = true;
        onDropRef.current(d.source, { x: e.clientX, y: e.clientY });
      }
    };
    // A second finger mid-drag means a pinch is starting — abort, drop nothing.
    const down = (e: PointerEvent) => { if (!samePointer(e)) setDrag(null); };
    const cancel = () => { setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [dragging]);

  /** True exactly once after a completed drag — tap handlers call this
   * first to swallow the click the browser fires on the source element. */
  const consumeDragClick = () => {
    const v = swallowClick.current;
    swallowClick.current = false;
    return v;
  };

  return { drag: drag as DragState | null, start, consumeDragClick };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run --root games/wordgame src/game/useTileDrag.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/useTileDrag.ts games/wordgame/src/game/useTileDrag.test.tsx
git commit -m "feat(wordgame): drag lifecycle hook — threshold, pinch-cancel, click swallowing"
```

---

### Task 6: Rack — slot-positioned tiles, hidden source, sliding gap

**Files:**
- Modify: `games/wordgame/src/game/Rack.tsx` (full rewrite of the tile row; the bag tile is unchanged)
- Test: `games/wordgame/src/game/Rack.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 7 consumes): three new optional props on `RackProps` —

```ts
onTilePointerDown?(index: number, e: React.PointerEvent<HTMLButtonElement>): void;
/** The tile being dragged: removed from the row entirely (the ghost under
 * the finger is its only representation — nothing dims in place). */
draggingIndex?: number | null;
/** Open an insertion gap at this slot; neighbours slide aside. */
insertionSlot?: number | null;
/** Ref to the tiles-only wrapper — drop targeting measures this rect. */
tilesRef?: React.Ref<HTMLDivElement>;
```

Slot geometry constants (exported for tests): `RACK_TILE_W = 44`, `RACK_SLOT_W = 48` (tile + 4px gap), tile height 50.

- [ ] **Step 1: Write the failing tests** (append to `Rack.test.tsx`)

```tsx
describe('Rack — drag rendering', () => {
  const tiles: Tile[] = ['A', 'B', 'C', 'D'];

  it('removes the dragged tile from the row — no dimmed placeholder', () => {
    render(<Rack tiles={tiles} selected={[]} onTileTap={() => {}} bagCount={10} draggingIndex={1} insertionSlot={null} />);
    expect(screen.queryByTestId('rack-tile-1')).toBeNull();
    expect(screen.getByTestId('rack-tile-0')).toHaveStyle({ left: '0px' });
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '48px' });
  });

  it('opens an insertion gap: tiles at and after the slot slide one slot right', () => {
    render(<Rack tiles={tiles} selected={[]} onTileTap={() => {}} bagCount={10} draggingIndex={1} insertionSlot={1} />);
    expect(screen.getByTestId('rack-tile-0')).toHaveStyle({ left: '0px' });
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '96px' }); // slid past the gap
    expect(screen.getByTestId('rack-tile-3')).toHaveStyle({ left: '144px' });
  });

  it('renders exactly as before when no drag props are given', () => {
    render(<Rack tiles={tiles} selected={[2]} onTileTap={() => {}} bagCount={10} />);
    expect(screen.getByTestId('rack-tile-2')).toHaveStyle({ left: '96px' });
    expect(screen.getByTestId('bag-tile')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/Rack.test.tsx`
Expected: FAIL — no `left` styles, `draggingIndex` unknown.

- [ ] **Step 3: Rewrite the tile row**

Tiles become absolutely positioned at `left = slot * RACK_SLOT_W` inside a fixed-height wrapper, with `transition: left 150ms ease` — that transition IS the slide. Keys stay `${tile}-${index}` (indices don't change during a drag, so identity is stable exactly when the animation matters).

```tsx
import { TILE_VALUES, type Tile } from '../../engine/constants';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';

export const RACK_TILE_W = 44;
export const RACK_SLOT_W = 48; // tile + 4px gap; rackSlot() in dragPlan.ts assumes this rhythm

export interface RackProps {
  tiles: Tile[];
  /** Selected indices — one in placement mode, several in exchange mode. */
  selected: number[];
  onTileTap(index: number): void;
  /** Tiles remaining in the bag, drawn as a tile of its own at the row's end. */
  bagCount: number;
  onTilePointerDown?(index: number, e: ReactPointerEvent<HTMLButtonElement>): void;
  draggingIndex?: number | null;
  insertionSlot?: number | null;
  tilesRef?: Ref<HTMLDivElement>;
}

/** The viewer's own tiles plus the bag. Tiles sit at fixed 48px slots so a
 * drag can open an insertion gap and the neighbours slide aside (the left
 * transition); the dragged tile is removed outright — the ghost under the
 * finger is its only representation (decided 2026-08-31). */
export function Rack({
  tiles, selected, onTileTap, bagCount,
  onTilePointerDown, draggingIndex = null, insertionSlot = null, tilesRef,
}: RackProps) {
  const visibleCount = tiles.length - (draggingIndex === null ? 0 : 1);
  const slots = visibleCount + (insertionSlot === null ? 0 : 1);
  let nextSlot = 0;

  return (
    <div data-testid="rack" className="flex items-center justify-center gap-1">
      <div
        ref={tilesRef}
        data-testid="rack-tiles"
        className="relative h-[50px]"
        style={{ width: Math.max(RACK_TILE_W, slots * RACK_SLOT_W - 4) }}
      >
        {tiles.map((tile, index) => {
          if (index === draggingIndex) return null;
          let slot = nextSlot;
          nextSlot += 1;
          if (insertionSlot !== null && slot >= insertionSlot) slot += 1;
          const isSelected = selected.includes(index);
          const shadow = isSelected
            ? 'inset 0 -3px 0 #d9bf8a, 0 0 0 2px #2563eb, 0 2px 6px rgba(37,99,235,.4)'
            : 'inset 0 -3px 0 #d9bf8a, 0 1px 3px rgba(0,0,0,.2)';
          return (
            <button
              key={`${tile}-${index}`}
              type="button"
              data-testid={`rack-tile-${index}`}
              onClick={() => { onTileTap(index); }}
              onPointerDown={onTilePointerDown === undefined ? undefined : (e) => { onTilePointerDown(index, e); }}
              className={`absolute top-0 flex h-[50px] w-11 items-center justify-center rounded-md bg-tile font-tile text-lg font-bold ${
                tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
              }`}
              style={{
                left: slot * RACK_SLOT_W,
                transition: 'left 150ms ease',
                boxShadow: shadow,
                touchAction: onTilePointerDown === undefined ? undefined : 'none',
              }}
            >
              {tile === '_' ? '·' : tile}
              <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
                {TILE_VALUES[tile]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="w-2 flex-none" />
      {/* …the bag tile block, byte-for-byte as it is today… */}
    </div>
  );
}
```

- [ ] **Step 4: Run the Rack and GameScreen suites; fix fallout**

Run: `npx vitest run --root games/wordgame src/game/Rack.test.tsx src/game/GameScreen.test.tsx`
Expected: new tests pass; any existing assertion on the rack's flex layout updates to the slot layout (content and testids are unchanged, so fallout should be nil-to-minimal).

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/Rack.tsx games/wordgame/src/game/Rack.test.tsx
git commit -m "feat(wordgame): rack renders fixed slots with a sliding insertion gap"
```

---

### Task 7: GameScreen drag wiring — ghost tile, board props, drop dispatch

**Files:**
- Modify: `games/wordgame/src/game/GameScreen.tsx`
- Modify: `games/wordgame/src/game/Board.tsx`
- Test: `games/wordgame/src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: Task 4's `hitCell`/`rackSlot`/`dropAction`/`moveTile`/`DragSource`; Task 5's `useTileDrag`; Task 6's Rack props.
- Produces: Board gains `gridRef?: Ref<HTMLDivElement>`, `onStagedPointerDown?(pos: number, e: React.PointerEvent): void`, `hiddenPos?: number | null` (that staged tile renders as if unstaged — the source vanishes during its drag).

- [ ] **Step 1: Write the failing tests** (append to `GameScreen.test.tsx`; use the file's existing view/render helpers)

```tsx
// jsdom rects are 0×0 — stub the two rects drops are resolved against.
function stubRect(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
}
function stubGeometry() {
  stubRect(screen.getByTestId('board'), { left: 0, top: 0, width: 300, height: 300 }); // 20px cells
  stubRect(screen.getByTestId('rack-tiles'), { left: 0, top: 400, width: 288, height: 50 });
}
function dragFromTo(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('GameScreen — drag and drop', () => {
  it('drags a rack tile onto an empty cell and stages it', () => {
    renderScreen(); // playing view, viewer's turn, rack starts with known tiles
    stubGeometry();
    dragFromTo(screen.getByTestId('rack-tile-0'), { x: 22, y: 425 }, { x: 30, y: 30 });
    expect(screen.getByTestId('cell-16')).toHaveAttribute('data-staged');
  });

  it('shows the ghost while dragging and no dimmed source', () => {
    renderScreen();
    stubGeometry();
    const tile = screen.getByTestId('rack-tile-0');
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 22, clientY: 425 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 200 });
    expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
    expect(screen.queryByTestId('rack-tile-0')).toBeNull(); // gone, not dimmed
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 200 });
  });

  it('rearranges the rack by dragging within the tray', () => {
    renderScreen();
    stubGeometry();
    const before = screen.getAllByTestId(/rack-tile-/).map((el) => el.textContent);
    dragFromTo(screen.getByTestId('rack-tile-0'), { x: 22, y: 425 }, { x: 150, y: 425 }); // slot 3 of 6 visible
    const after = screen.getAllByTestId(/rack-tile-/).map((el) => el.textContent);
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort()); // same tiles, new order
  });

  it('drags a staged tile back to the tray to recall it', () => {
    renderScreen();
    stubGeometry();
    dragFromTo(screen.getByTestId('rack-tile-0'), { x: 22, y: 425 }, { x: 30, y: 30 }); // stage at 16
    const rackBefore = screen.getAllByTestId(/rack-tile-/).length;
    dragFromTo(screen.getByTestId('cell-16'), { x: 30, y: 30 }, { x: 150, y: 425 });
    expect(screen.getByTestId('cell-16')).not.toHaveAttribute('data-staged');
    expect(screen.getAllByTestId(/rack-tile-/).length).toBe(rackBefore + 1);
  });

  it('a drag onto an occupied cell snaps back — nothing changes', () => {
    renderScreen(); // its view has a committed tile; use its position (occupiedPos)
    stubGeometry();
    const rackBefore = screen.getAllByTestId(/rack-tile-/).length;
    const col = occupiedPos % 15;
    const row = Math.floor(occupiedPos / 15);
    dragFromTo(screen.getByTestId('rack-tile-0'), { x: 22, y: 425 }, { x: col * 20 + 10, y: row * 20 + 10 });
    expect(screen.getAllByTestId(/rack-tile-/).length).toBe(rackBefore);
  });

  it('dropping a blank on a cell opens the blank picker', () => {
    renderScreen(); // a view whose rack includes '_' at a known index (rackBlankIndex)
    stubGeometry();
    dragFromTo(screen.getByTestId(`rack-tile-${rackBlankIndex}`), { x: 22, y: 425 }, { x: 30, y: 30 });
    expect(screen.getByText(/pick a letter/i)).toBeInTheDocument(); // BlankPicker's prompt — match its actual copy
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/GameScreen.test.tsx`
Expected: FAIL — no drag handling, no `rack-tiles`/`drag-ghost` testids.

- [ ] **Step 3: Extend Board.tsx**

Add to `BoardProps`:

```ts
gridRef?: Ref<HTMLDivElement>;
/** Pointerdown on a staged tile begins a board→board / board→rack drag. */
onStagedPointerDown?(pos: number, e: ReactPointerEvent<HTMLButtonElement>): void;
/** The staged tile being dragged — its cell renders as if unstaged. */
hiddenPos?: number | null;
```

In the component: `ref={gridRef}` on the grid div; build `stagedAt` from `staged.filter((p) => p.pos !== hiddenPos)`; on each cell button add

```tsx
onPointerDown={stagedHere !== undefined && onStagedPointerDown !== undefined
  ? (e) => { onStagedPointerDown(pos, e); }
  : undefined}
style={stagedHere !== undefined && onStagedPointerDown !== undefined ? { touchAction: 'none' } : undefined}
```

- [ ] **Step 4: Wire GameScreen**

Refactor first (behaviour identical): extract from `cellTap` a `placeFromRack(rackIndex: number, pos: number)` (the blank-vs-letter branch: sets `pendingBlank` or stages + `removeRackAt` + clears selection) and a `recallOne(pos: number, slot: number | null)` (removes from `staged`, inserts the tile into `localRack` at `slot ?? end`) — `cellTap`'s take-back branch calls `recallOne(pos, null)`.

Then the drag itself:

```tsx
const boardGridRef = useRef<HTMLDivElement>(null);
const rackTilesRef = useRef<HTMLDivElement>(null);
const dragEnabled = view.stage === 'playing' && !exchangeOn;

const resolveDrop = (source: DragSource, p: Point) => {
  const bRect = boardGridRef.current?.getBoundingClientRect();
  const cell = bRect === undefined ? null : hitCell(bRect, p);
  const rRect = rackTilesRef.current?.getBoundingClientRect();
  const visible = localRack.length - (source.kind === 'rack' ? 1 : 0);
  const slot = cell !== null || rRect === undefined ? null : rackSlot(rRect, p, visible);
  return dropAction(source, cell, slot, view.board, staged);
};

const { drag, start, consumeDragClick } = useTileDrag((source, p) => {
  const action = resolveDrop(source, p);
  switch (action.kind) {
    case 'place': placeFromRack(action.rackIndex, action.pos); break;
    case 'moveStaged':
      setStaged((prev) => prev.map((pl) => (pl.pos === action.from ? { ...pl, pos: action.pos } : pl)));
      break;
    case 'reorderRack': setLocalRack((rack) => moveTile(rack, action.from, action.slot)); break;
    case 'recallAt': recallOne(action.from, action.slot); break;
    case 'none': break;
  }
});

// Live hover: which tray slot the current drag would drop into — drives the gap.
const hoverSlot = (() => {
  if (drag === null || !drag.active) return null;
  const rRect = rackTilesRef.current?.getBoundingClientRect();
  if (rRect === undefined) return null;
  const visible = localRack.length - (drag.source.kind === 'rack' ? 1 : 0);
  return rackSlot(rRect, drag, visible);
})();
```

Tap handlers get the swallow guard as their first line: `if (consumeDragClick()) return;` in both `rackTap` and `cellTap`.

Component wiring:

```tsx
<Board
  … gridRef={boardGridRef}
  onStagedPointerDown={dragEnabled ? (pos, e) => {
    const pl = staged.find((p) => p.pos === pos);
    if (pl !== undefined) start({ kind: 'board', pos, tile: pl.tile }, e);
  } : undefined}
  hiddenPos={drag?.active === true && drag.source.kind === 'board' ? drag.source.pos : null}
/>

<Rack
  … tilesRef={rackTilesRef}
  onTilePointerDown={dragEnabled ? (index, e) => {
    const tile = localRack[index];
    if (tile !== undefined) start({ kind: 'rack', index, tile }, e);
  } : undefined}
  draggingIndex={drag?.active === true && drag.source.kind === 'rack' ? drag.source.index : null}
  insertionSlot={hoverSlot}
/>
```

The ghost, rendered last inside the root div (import `TILE_VALUES`):

```tsx
{drag !== null && drag.active && (
  <div
    data-testid="drag-ghost"
    className={`pointer-events-none fixed z-50 flex h-[50px] w-11 items-center justify-center rounded-md bg-tile font-tile text-lg font-bold ${
      drag.source.tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
    }`}
    style={{ left: drag.x - 22, top: drag.y - 25, boxShadow: 'inset 0 -3px 0 #d9bf8a, 0 6px 14px rgba(0,0,0,.35)' }}
  >
    {drag.source.tile === '_' ? '·' : drag.source.tile}
    <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
      {TILE_VALUES[drag.source.tile]}
    </span>
  </div>
)}
```

- [ ] **Step 5: Run the full suite, typecheck, lint**

Run: `npx vitest run --root games/wordgame && npm run typecheck && npm run lint`
Expected: all green — including every pre-existing tap test, untouched.

- [ ] **Step 6: Commit**

```bash
git add games/wordgame/src/game/GameScreen.tsx games/wordgame/src/game/GameScreen.test.tsx games/wordgame/src/game/Board.tsx
git commit -m "feat(wordgame): drag tiles — rack→board, board→board, tray rearrange, recall-at-slot"
```

---

### Task 8: Polish — ago() floor, badge clamp, summaries-cap comment

**Files:**
- Modify: `games/wordgame/src/game/LastMove.tsx:4-14`, `games/wordgame/src/game/LastMove.test.tsx`
- Modify: `games/wordgame/src/game/GameScreen.tsx` (stage-badge block), `games/wordgame/src/game/GameScreen.test.tsx`
- Modify: `games/wordgame/server/summaries.ts:13`, `games/wordgame/server/summaries.test.ts`

- [ ] **Step 1: Write the failing tests**

In `LastMove.test.tsx`:

```ts
it('floors hours — never "24h ago" before a day has passed', () => {
  const now = Date.now();
  expect(ago(now - 1439 * 60000, now)).toBe('23h ago');
  expect(ago(now - 90 * 60000, now)).toBe('1h ago');
  expect(ago(now - 1440 * 60000, now)).toBe('yesterday');
});
```

In `GameScreen.test.tsx` (uses Task 7's `stubGeometry`/`dragFromTo`; the view needs a committed tile at pos 29 — row 1, col 14 — so a tile staged at pos 14 forms a two-letter word and the preview anchors top-right):

```tsx
it('clamps the score badge at the top-right corner', () => {
  renderScreen(/* view with a committed tile at pos 29 */);
  stubGeometry();
  dragFromTo(screen.getByTestId('rack-tile-0'), { x: 22, y: 425 }, { x: 290, y: 10 }); // cell 14
  const badge = screen.getByTestId('stage-badge');
  expect(badge.className).not.toContain('-translate-y-full'); // row 0: below the anchor
  expect(badge.style.right).toBe('0px'); // col 14: right-aligned
});
```

In `summaries.test.ts` (follow the file's existing request-building pattern):

```ts
it('silently caps a request at 20 rooms — extras dropped, not an error', () => {
  const rooms = Array.from({ length: 21 }, (_, i) => ({ roomId: `R${i}`, playerId: 'p', token: 't' }));
  // …post via the file's existing handler harness…
  expect(res.body.summaries).toHaveLength(20);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --root games/wordgame src/game/LastMove.test.tsx src/game/GameScreen.test.tsx server/summaries.test.ts`
Expected: FAIL — `24h ago`, unclamped badge, no cap test… (the cap test may pass immediately; if so it is pinning, keep it).

- [ ] **Step 3: Implement all three**

`ago()` (replacing lines 8-13):

```ts
if (m < 60) return `${m}m ago`;
// Hours floor rather than round: rounding showed "24h ago" at 23h59m and
// "2h ago" at 1h31m (2026-08-31). The day boundary stays gated on minutes.
const h = Math.floor(m / 60);
if (h < 24) return `${h}h ago`;
const d = Math.round(m / 1440);
return d <= 1 ? 'yesterday' : `${d}d ago`;
```

The stage badge (replacing the block from Task 3's mount):

```tsx
{preview !== null && (() => {
  const col = colOf(preview.anchorPos);
  const row = rowOf(preview.anchorPos);
  const flushRight = col >= 12; // the badge is wider than a cell — hug the edge
  const belowAnchor = row === 0; // no room above row 0 — sit under the anchor
  return (
    <div
      data-testid="stage-badge"
      className={`pointer-events-none absolute z-10 rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-bold text-white shadow ${
        belowAnchor ? '' : '-translate-y-full'
      }`}
      style={{
        ...(flushRight ? { right: 0 } : { left: `${((col + 1) / 15) * 100}%` }),
        top: `${((belowAnchor ? row + 1 : row) / 15) * 100}%`,
      }}
    >
      {preview.bingo ? `+${preview.total} · BINGO` : `+${preview.total}`}
    </div>
  );
})()}
```

`summaries.ts:13`:

```ts
// Cap the per-request workload: 20 covers any honest device's localStorage
// several times over, and extra entries are dropped rather than erroring so
// a wild client still gets its first 20 answered (documented 2026-08-31;
// the silent-drop shape was a review finding on PR #23).
const MAX_ROOMS = 20;
```

- [ ] **Step 4: Run to verify everything passes**

Run: `npx vitest run --root games/wordgame`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/LastMove.tsx games/wordgame/src/game/LastMove.test.tsx games/wordgame/src/game/GameScreen.tsx games/wordgame/src/game/GameScreen.test.tsx games/wordgame/server/summaries.ts games/wordgame/server/summaries.test.ts
git commit -m "fix(wordgame): floor ago() hours, clamp the score badge at board edges, document the summaries cap"
```

---

### Task 9: Coverage — pending banner, maskEmail, preview guards

**Files:**
- Modify: `games/wordgame/src/pages/HomePage.test.tsx`
- Modify: `games/wordgame/src/game/scorePreview.test.ts`

- [ ] **Step 1: Write the tests** (these pin existing behaviour — they should pass on first run; any failure is a real find, investigate before touching code)

In `HomePage.test.tsx` (the file's mocks already expose `notifyStatusValue` / `emailAddressValue`):

```tsx
describe('HomePage — the pending-email banner', () => {
  it('shows the amber confirm banner with the address masked', async () => {
    mockRooms([]);
    notifyStatusValue = 'pending';
    emailAddressValue = 'pete@example.com';
    renderHome();
    expect(await screen.findByText(/Confirm your email/)).toBeInTheDocument();
    expect(screen.getByText(/p•••@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  it('masks degenerate addresses without crashing', async () => {
    mockRooms([]);
    notifyStatusValue = 'pending';
    emailAddressValue = null;
    renderHome();
    expect(await screen.findByText(/we sent a link to your email/)).toBeInTheDocument();
  });
});
```

In `scorePreview.test.ts` (reuse the file's board helpers):

```ts
describe('previewPlay — guards', () => {
  const empty: Square[] = Array<Square>(225).fill(null);

  it('answers null for duplicate positions', () => {
    expect(previewPlay(empty, [{ pos: 112, tile: 'A' }, { pos: 112, tile: 'B' }])).toBeNull();
  });

  it('answers null when staging onto an occupied square', () => {
    const board = [...empty];
    board[112] = { letter: 'Q', isBlank: false };
    expect(previewPlay(board, [{ pos: 112, tile: 'A' }])).toBeNull();
  });

  it('answers null for a wordless single-tile first move', () => {
    expect(previewPlay(empty, [{ pos: 112, tile: 'A' }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run --root games/wordgame src/pages/HomePage.test.tsx src/game/scorePreview.test.ts`
Expected: PASS on first run (pinning tests). A failure here is a discovered bug — stop and report it rather than adjusting the assertion.

- [ ] **Step 3: Commit**

```bash
git add games/wordgame/src/pages/HomePage.test.tsx games/wordgame/src/game/scorePreview.test.ts
git commit -m "test(wordgame): pin the pending-email banner, maskEmail, and previewPlay guards"
```

---

### Task 10: Artifact pass — build, composed host, phone checklist

Green jsdom suites cannot vouch for gestures — this is the load-bearing verification step (see the entry-list postmortem: 220 green tests shipped a 100%-broken fetch).

- [ ] **Step 1: Full gates**

Run: `npm test && npm run typecheck && npm run lint` (from the worktree root).
Expected: all packages green except the documented environmental apps-host worktree failure; railbaron/acquire golden-replay timeouts under contention are known flakes — rerun those packages in isolation before treating them as real.

- [ ] **Step 2: Build and boot the composed host**

Run: `npm run build && DATA_DIR=$(mktemp -d) PORT=4100 npm run start:host` (background; kill by the PID the shell gave — **never `pkill -f`**, this machine is production).
Expected: `curl -s localhost:4100/health` shows all games mounted; `/wordgame/` serves the new bundle.

- [ ] **Step 3: Phone checklist** (hand to Pete against the 4100 instance or after his deploy)

- [ ] Drag a rack tile onto the board; drop on an empty cell → placed, score badge follows.
- [ ] Press a tile and release under 8px → still a tap-select, as before.
- [ ] Drag within the tray → neighbours slide open a gap; drop reorders.
- [ ] Drag a staged tile to another cell, then back to the tray at a chosen spot.
- [ ] Drag a blank onto the board → BlankPicker opens on drop.
- [ ] Pinch to zoom the board; pan with two fingers; drop a tile accurately while zoomed.
- [ ] Double-tap the board → back to 1×, no drift after repeated zoom cycles.
- [ ] Start a drag, land a second finger → drag cancels, pinch takes over.
- [ ] Header/chips/status pinned top, rack/buttons pinned bottom, no page scroll; move history absent.
- [ ] Board fills the middle region on a tall phone and a squat browser window alike.
- [ ] Play a word at the top-right corner → badge visible, inside the board.

- [ ] **Step 4: Fix-forward anything the checklist catches, then finish the branch** (push, PR against `main` per the execution-workflow memory — no local merges).

---

## Self-review (2026-08-31)

- **Spec coverage:** app-shell layout → Task 2; zoom → Tasks 1, 3; four drags + ghost + gap + swallow + pinch-cancel → Tasks 4–7; polish trio → Task 8; coverage nits → Task 9; artifact pass → Task 10. Hidden-history requirement → Task 2. Exclusions listed are excluded.
- **Type consistency:** `pinch(prev, a0, b0, a1, b1, w, h)` matches between Tasks 1/3; `DragSource`/`DropAction`/`rackSlot(rect, p, count)` match between Tasks 4/5/7; Rack props match between Tasks 6/7; `recallOne(pos, slot)` defined and consumed in Task 7.
- **Known softness (deliberate, flagged for implementers):** Task 2's aspect-ratio sizing trick and Task 6's slot-width rhythm (48px) are verified on-device in Task 10, not in jsdom; test snippets that reference existing helpers (`renderScreen`, `occupiedPos`, `rackBlankIndex`, BlankPicker copy) must be adapted to the actual helper names and fixture views in each test file — the behaviour asserted is normative, the helper names are not.
