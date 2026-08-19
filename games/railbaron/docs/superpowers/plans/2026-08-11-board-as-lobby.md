# The Board as the Lobby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the departures board the whole app — every screen is the same seven-row board, choices live in the destination column, and navigation is that column flapping over to the next screen.

**Architecture:** Screens are *data*, not components: each is a pure function `(state) => ScreenDef` holding exactly seven `Row` descriptors. One `<Board>` renders any `ScreenDef`. The flap animation is a drum of per-tile `{cur, prev, target}` indices advanced on an interval, driven declaratively by a `useFlap(texts)` hook that notices when target texts change. The in-play board and region ballot become `ScreenDef`s like everything else.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (two projects: `engine` under node, `app` under jsdom), `@testing-library/react`, `react-router-dom` v7.

**Spec:** [2026-08-11-board-as-lobby-design.md](../specs/2026-08-11-board-as-lobby-design.md)

## Global Constraints

- **Branch:** `feat/board-as-lobby`, already created off `main`. All work commits there.
- **Seven rows, always.** Every `ScreenDef` holds exactly 7 rows, padded with blanks. This is the invariant the whole design rests on.
- **Only column C animates.** Columns B and E blank for three ticks then reappear; A and D swap instantly.
- **Alphabet is exactly** `" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.-&'"` — 42 characters. Destination width is **14** tiles. Default step **52ms**.
- **Derive, never hardcode.** Every payout, total and name comes from replayed state.
- **No `as any`.** Narrow with the engine's existing type guards and unions.
- **Prove every new test can fail** by breaking the code and reading real output — never by reading the check. Two tests in this plan are hollow by default and each has an explicit break step.
- **`prefers-reduced-motion` snaps instantly.** No exceptions.
- Run `npm test` (vitest run) and `npm run typecheck` before each commit. Never run bare `tsc`.

## File Structure

| Path | Responsibility |
|---|---|
| `basePath.ts` (root) | The one copy of the GitHub Pages base path. Root-level because `vite.config.ts` runs under Node. |
| `src/board/alphabet.ts` | The 42-character alphabet and text→indices conversion. |
| `src/board/drum.ts` | Pure flap logic: build, advance, settle, faces. No React, no timers. |
| `src/board/useFlap.ts` | The hook: timers, cancel-in-flight, unmount cleanup, reduced motion, snap. |
| `src/board/types.ts` | `Row`, `RowAction`, `ScreenDef`, `ScreenId`, `FieldId`, `blankRow`, `padRows`. |
| `src/board/BoardRow.tsx` | One row, five columns, from a `Row`. |
| `src/board/Board.tsx` | Bezel, header, column headings, seven `BoardRow`s. Owns `useFlap`. |
| `src/board/screens/*.ts` | One pure `(state) => ScreenDef` per screen. |
| `src/state/events.ts` | Adds `started` and `renamed`. |
| `src/state/game.ts` | Adds derived `phase` and `earned`; guards `undo`. |
| `src/state/storage.ts` | Adds `savedAt`; v1→v2 migration. |
| `src/state/useGame.ts` | Adds `start`, `rename`; drops `window.prompt`. |
| `src/App.tsx`, `src/main.tsx` | Routes and `BrowserRouter`. |
| *deleted* `src/game/DeparturesBoard.tsx`, `DeparturesRow.tsx`, `RegionBallot.tsx` | Replaced by `Board`/`BoardRow` + screens. Their column-budget test is **ported**, not dropped. |

---

### Task 1: The alphabet and the drum

Pure logic, no React, no timers. Everything else depends on this.

**Files:**
- Create: `src/board/alphabet.ts`
- Create: `src/board/drum.ts`
- Test: `src/board/drum.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ALPHABET: string`, `FLAP_WIDTH: 14`, `toIndexes(text: string, width: number): number[]`, `Tile { cur: number; prev: number; target: number }`, `FlapChar { top: string; bottom: string }`, `buildDrum(from: string, to: string, width?: number): Tile[]`, `advance(tiles: readonly Tile[]): Tile[]`, `isSettled(tiles: readonly Tile[]): boolean`, `faces(tiles: readonly Tile[]): FlapChar[]`, `staticFaces(text: string, width?: number): FlapChar[]`.

- [ ] **Step 1: Write the failing test**

Create `src/board/drum.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ALPHABET, toIndexes } from './alphabet';
import { advance, buildDrum, faces, isSettled, staticFaces } from './drum';

const spin = (tiles: ReturnType<typeof buildDrum>, ticks: number) => {
  let out = tiles;
  for (let i = 0; i < ticks; i++) out = advance(out);
  return out;
};

const ticksToSettle = (from: string, to: string) => {
  let tiles = buildDrum(from, to);
  let n = 0;
  while (!isSettled(tiles) && n < 200) { tiles = advance(tiles); n++; }
  return n;
};

describe('the flap alphabet', () => {
  it('holds 42 characters, starting with a blank', () => {
    expect(ALPHABET).toHaveLength(42);
    expect(ALPHABET[0]).toBe(' ');
  });

  it('pads and truncates to the field width rather than reflowing', () => {
    expect(toIndexes('AB', 4)).toEqual([1, 2, 0, 0]);
    expect(toIndexes('ABCDE', 3)).toEqual([1, 2, 3]);
  });

  it('maps an unknown character to the blank rather than to -1', () => {
    expect(toIndexes('%', 1)).toEqual([0]);
  });
});

describe('a flap drum', () => {
  it('advances one step per tick until it reaches the target', () => {
    expect(ticksToSettle('A', 'C')).toBe(2);
  });

  it('wraps through the end of the alphabet rather than running backwards', () => {
    // Z is index 26; A is 1. Forward-only means 26 -> 41, wrap to 0, then 1.
    expect(ticksToSettle('Z', 'A')).toBe(16);
  });

  it('settles immediately when the text has not changed', () => {
    expect(ticksToSettle('DENVER', 'DENVER')).toBe(0);
    expect(isSettled(buildDrum('DENVER', 'DENVER'))).toBe(true);
  });

  it('lets each tile settle at its own tick — the cascade is not choreographed', () => {
    // 'AA' -> 'BZ': tile 0 travels 1 step, tile 1 travels 25.
    const tiles = buildDrum('AA', 'BZ', 2);
    const afterOne = advance(tiles);
    expect(afterOne[0].cur).toBe(afterOne[0].target);
    expect(afterOne[1].cur).not.toBe(afterOne[1].target);
    expect(isSettled(afterOne)).toBe(false);
  });

  it('shows the outgoing character on the bottom half while spinning', () => {
    const mid = spin(buildDrum('A', 'D', 1), 1);
    expect(faces(mid)[0]).toEqual({ top: 'B', bottom: 'A' });
  });

  it('shows the same character on both halves once settled', () => {
    const done = spin(buildDrum('A', 'C', 1), 2);
    expect(faces(done)[0]).toEqual({ top: 'C', bottom: 'C' });
  });

  it('renders a static field with both halves matching, padded to width', () => {
    expect(staticFaces('HI', 3)).toEqual([
      { top: 'H', bottom: 'H' },
      { top: 'I', bottom: 'I' },
      { top: ' ', bottom: ' ' }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/board/drum.test.ts`
Expected: FAIL — `Cannot find module './alphabet'`.

- [ ] **Step 3: Write the implementation**

Create `src/board/alphabet.ts`:

```ts
/**
 * The flaps physically carry these characters, in this order. A drum can
 * only turn forwards, so the distance from one character to another is
 * always measured going down the list and wrapping — which is why 'Z' to
 * 'A' is sixteen steps rather than one.
 */
export const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.-&'";

/** The destination column, in tiles. Every screen's choice fits inside this. */
export const FLAP_WIDTH = 14;

/** Anything the flaps cannot show becomes a blank, never a negative index. */
function indexOfChar(character: string): number {
  const at = ALPHABET.indexOf(character.toUpperCase());
  return at < 0 ? 0 : at;
}

export function toIndexes(text: string, width: number): number[] {
  const padded = text.toUpperCase().slice(0, width).padEnd(width, ' ');
  return [...padded].map(indexOfChar);
}
```

Create `src/board/drum.ts`:

```ts
import { ALPHABET, FLAP_WIDTH, toIndexes } from './alphabet';

export interface Tile {
  cur: number;
  prev: number;
  target: number;
}

/** A tile shows two half-flaps: the arriving character above, the leaving one below. */
export interface FlapChar {
  top: string;
  bottom: string;
}

export function buildDrum(from: string, to: string, width: number = FLAP_WIDTH): Tile[] {
  const start = toIndexes(from, width);
  return toIndexes(to, width).map((target, i) => ({
    cur: start[i],
    prev: start[i],
    target
  }));
}

/**
 * One tick. Every unsettled tile moves exactly one place forward; settled
 * tiles hold. The cascade an onlooker sees is not choreographed anywhere —
 * it falls out of tiles having different distances left to travel.
 */
export function advance(tiles: readonly Tile[]): Tile[] {
  return tiles.map(tile =>
    tile.cur === tile.target
      ? { cur: tile.cur, prev: tile.cur, target: tile.target }
      : { cur: (tile.cur + 1) % ALPHABET.length, prev: tile.cur, target: tile.target }
  );
}

export function isSettled(tiles: readonly Tile[]): boolean {
  return tiles.every(tile => tile.cur === tile.target);
}

const show = (index: number): string => ALPHABET[index];

export function faces(tiles: readonly Tile[]): FlapChar[] {
  return tiles.map(tile => ({ top: show(tile.cur), bottom: show(tile.prev) }));
}

export function staticFaces(text: string, width: number = FLAP_WIDTH): FlapChar[] {
  return toIndexes(text, width).map(index => ({ top: show(index), bottom: show(index) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/board/drum.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the cascade test can fail**

Temporarily change `advance` so every tile jumps straight to its target:

```ts
export function advance(tiles: readonly Tile[]): Tile[] {
  return tiles.map(tile => ({ cur: tile.target, prev: tile.cur, target: tile.target }));
}
```

Run: `npm test -- src/board/drum.test.ts`
Expected: FAIL on "advances one step per tick" (`expected 1 to be 2`) and on "lets each tile settle at its own tick". **Read the actual failure output**, then revert.

- [ ] **Step 6: Commit**

```bash
git add src/board/alphabet.ts src/board/drum.ts src/board/drum.test.ts
git commit -m "feat(board): the flap alphabet and drum"
```

---

### Task 2: The `useFlap` hook

Timers, cancellation, reduced motion, and tap-to-snap. The riskiest piece.

**Files:**
- Create: `src/board/useFlap.ts`
- Test: `src/board/useFlap.test.tsx`

**Interfaces:**
- Consumes: `buildDrum`, `advance`, `isSettled`, `faces`, `staticFaces`, `Tile`, `FlapChar` from Task 1.
- Produces: `useFlap(texts: readonly string[], stepMs?: number): { rows: FlapChar[][]; flapping: boolean; snap: () => void }`. `rows[i]` is always exactly `FLAP_WIDTH` faces for row `i`.

- [ ] **Step 1: Write the failing test**

Create `src/board/useFlap.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlap } from './useFlap';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

function Probe({ texts }: { texts: string[] }) {
  const { rows, flapping, snap } = useFlap(texts);
  return (
    <div>
      <span data-testid="row0">{rows[0].map(f => f.top).join('').trimEnd()}</span>
      <span data-testid="flapping">{String(flapping)}</span>
      <button onClick={snap}>snap</button>
    </div>
  );
}

const row0 = () => screen.getByTestId('row0').textContent;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  setReducedMotion(false);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('the flap hook', () => {
  it('shows the text straight away when nothing has changed yet', () => {
    render(<Probe texts={['DENVER']} />);
    expect(row0()).toBe('DENVER');
    expect(screen.getByTestId('flapping').textContent).toBe('false');
  });

  it('spins through intermediate characters before arriving', () => {
    const { rerender } = render(<Probe texts={['A']} />);
    rerender(<Probe texts={['D']} />);

    act(() => { vi.advanceTimersByTime(52); });
    expect(row0()).toBe('B');            // en route, not yet arrived
    expect(screen.getByTestId('flapping').textContent).toBe('true');

    act(() => { vi.advanceTimersByTime(52 * 2); });
    expect(row0()).toBe('D');
    expect(screen.getByTestId('flapping').textContent).toBe('false');
  });

  it('snaps instantly and never spins when reduced motion is asked for', () => {
    setReducedMotion(true);
    const { rerender } = render(<Probe texts={['A']} />);
    rerender(<Probe texts={['D']} />);

    // No timer advance at all: it must already be there.
    expect(row0()).toBe('D');
    expect(screen.getByTestId('flapping').textContent).toBe('false');
  });

  it('abandons a transition in flight when a new one starts', () => {
    const { rerender } = render(<Probe texts={['A']} />);
    rerender(<Probe texts={['Z']} />);
    act(() => { vi.advanceTimersByTime(52 * 3); });
    expect(row0()).not.toBe('Z');

    rerender(<Probe texts={['B']} />);
    act(() => { vi.advanceTimersByTime(52 * 30); });
    expect(row0()).toBe('B');           // the abandoned run did not win
  });

  it('settles immediately when tapped mid-flap', () => {
    const { rerender } = render(<Probe texts={['A']} />);
    rerender(<Probe texts={['Z']} />);
    act(() => { vi.advanceTimersByTime(52 * 2); });
    expect(row0()).not.toBe('Z');

    act(() => { screen.getByText('snap').click(); });
    expect(row0()).toBe('Z');
    expect(screen.getByTestId('flapping').textContent).toBe('false');
  });

  it('stops its timers when unmounted', () => {
    const { rerender, unmount } = render(<Probe texts={['A']} />);
    rerender(<Probe texts={['Z']} />);
    act(() => { vi.advanceTimersByTime(52); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/board/useFlap.test.tsx`
Expected: FAIL — `Cannot find module './useFlap'`.

- [ ] **Step 3: Write the implementation**

Create `src/board/useFlap.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { FLAP_WIDTH } from './alphabet';
import { advance, buildDrum, faces, isSettled, staticFaces, type FlapChar, type Tile } from './drum';

export const STEP_MS = 52;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Declarative flapping: hand it the texts a screen wants to show and it
 * animates whenever they change, holding the outgoing text itself.
 *
 * The alternative — an imperative `flap(from, to)` — obliges every call
 * site to capture the outgoing text before changing state, which is a
 * thing every future caller has to remember and one of them will not.
 */
export function useFlap(
  texts: readonly string[],
  stepMs: number = STEP_MS
): { rows: FlapChar[][]; flapping: boolean; snap: () => void } {
  const [drums, setDrums] = useState<Tile[][] | null>(null);
  const previous = useRef<readonly string[]>(texts);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    const from = previous.current;
    const changed =
      from.length !== texts.length || texts.some((text, i) => text !== from[i]);
    previous.current = texts;
    if (!changed) return;

    // Any run still in flight loses to the new one.
    stop();

    if (prefersReducedMotion()) {
      setDrums(null);
      return;
    }

    setDrums(texts.map((text, i) => buildDrum(from[i] ?? '', text)));
    timer.current = setInterval(() => {
      setDrums(current => {
        if (current === null) return null;
        const next = current.map(advance);
        if (next.every(isSettled)) {
          stop();
          return null;
        }
        return next;
      });
    }, stepMs);

    return stop;
  }, [texts, stepMs]);

  useEffect(() => stop, []);

  const rows = texts.map((text, i) =>
    drums && drums[i] ? faces(drums[i]) : staticFaces(text, FLAP_WIDTH)
  );

  return {
    rows,
    flapping: drums !== null,
    snap: () => {
      stop();
      setDrums(null);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/board/useFlap.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the reduced-motion test is not hollow**

This test passes trivially if the animation never runs for an unrelated reason, so prove the *other* half of it is live. Temporarily invert the guard:

```ts
if (!prefersReducedMotion()) {   // inverted
```

Run: `npm test -- src/board/useFlap.test.tsx`
Expected: FAIL on **"spins through intermediate characters"** (`expected 'D' to be 'B'`) — proving that test genuinely observes spinning, so the reduced-motion assertion means something. **Read the output**, then revert.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/board/useFlap.ts src/board/useFlap.test.tsx
git commit -m "feat(board): useFlap — declarative drum with reduced-motion and snap"
```

---

### Task 3: Row types and `BoardRow`

**Files:**
- Create: `src/board/types.ts`
- Create: `src/board/BoardRow.tsx`
- Test: `src/board/BoardRow.test.tsx`

**Interfaces:**
- Consumes: `FlapChar` (Task 1), `SEAT_COLORS`/`TOKENS` from `src/game/tokens.ts`, `SeatId` from `src/state/events.ts`.
- Produces: `Row`, `RowAction`, `ScreenId`, `FieldId`, `ScreenDef`, `BOARD_ROWS = 7`, `blankRow()`, `padRows(rows)`, `BOARD_COLUMN_WIDTHS`, `<BoardRow row faces onAct />`.

- [ ] **Step 1: Write the failing test**

Create `src/board/BoardRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardRow, BOARD_COLUMN_WIDTHS } from './BoardRow';
import { staticFaces } from './drum';
import { blankRow, type Row } from './types';
import { TOKENS } from '../game/tokens';

const row: Row = {
  label: 'Seat 1', status: 'Ready', text: 'ADA',
  amount: '42,000', showDollar: true, right: 'Tap to edit',
  chip: '#e02b1d', tone: 'normal',
  action: { kind: 'navigate', to: 'play' }
};

const render1 = (r: Row, onAct = () => {}) =>
  render(<BoardRow row={r} faces={staticFaces(r.text)} onAct={onAct} />);

/**
 * jsdom runs no layout, so it cannot see tiles spilling out of a column —
 * the way a human looking at the running app did, in the bug that produced
 * DEPARTURES_COLUMN_WIDTHS. But a per-character field's occupied width is
 * knowable by arithmetic from what actually rendered.
 */
function occupiedWidth(container: Element): number {
  const tiles = container.querySelectorAll('[data-flap]');
  return tiles.length * TOKENS.tileWidth + Math.max(0, tiles.length - 1) * TOKENS.tileGap;
}

describe('a board row', () => {
  it('renders one tile per character of the destination field', () => {
    const { container } = render1(row);
    expect(container.querySelectorAll('[data-flap]')).toHaveLength(14);
  });

  it('fits the destination field inside its declared column', () => {
    const { container } = render1(row);
    const column = container.querySelector('[data-column="destination"]')!;
    expect(occupiedWidth(column)).toBeLessThanOrEqual(BOARD_COLUMN_WIDTHS.destination);
  });

  it('reads out as plain text for anything not looking at pixels', () => {
    render1(row);
    expect(screen.getByText('ADA')).toBeInTheDocument();
  });

  it('is a button when it has an action', () => {
    render1(row);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls back when tapped', () => {
    const onAct = vi.fn();
    render1(row, onAct);
    screen.getByRole('button').click();
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it('is not a button when it has no action', () => {
    render1({ ...row, action: null });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not call back when disabled, even though it still shows an action', () => {
    const onAct = vi.fn();
    render1({ ...row, tone: 'disabled' }, onAct);
    screen.getByRole('button').click();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('shows the dollar sign only when the row asks for one', () => {
    const { container } = render1(row);
    expect(container.querySelector('[data-dollar]')).not.toBeNull();
    const without = render1({ ...row, showDollar: false });
    expect(without.container.querySelector('[data-dollar]')).toBeNull();
  });

  it('renders a blank row with no action and no visible text', () => {
    const { container } = render1(blankRow());
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('[data-flap]')).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/board/BoardRow.test.tsx`
Expected: FAIL — `Cannot find module './BoardRow'`.

- [ ] **Step 3: Write the types**

Create `src/board/types.ts`:

```ts
import type { SeatId } from '../state/events';

/** Every screen the board can show. Only some have routes. */
export type ScreenId =
  | 'home' | 'passAndPlay' | 'saved' | 'confirm' | 'play' | 'regionBallot';

/** What an editable row is editing. Seat names today. */
export type FieldId = `seat:${SeatId}`;

export type RowAction =
  | { kind: 'navigate'; to: ScreenId }
  | { kind: 'edit'; field: FieldId; placeholder: string }
  | { kind: 'act'; seat: SeatId }
  | null;

/**
 * One of seven. A union for the action rather than independent `go`,
 * `edit` and `disabled` fields, because those can contradict each other
 * and this cannot.
 */
export interface Row {
  label: string;
  status: string;
  text: string;
  amount: string;
  showDollar: boolean;
  right: string;
  chip: string | null;
  tone: 'normal' | 'dim' | 'disabled';
  action: RowAction;
}

export interface ScreenDef {
  title: string;
  sub: string;
  back: ScreenId | null;
  cols: [string, string, string, string, string];
  rows: Row[];
}

/** The board is this many rows on every screen, without exception. */
export const BOARD_ROWS = 7;

export function blankRow(): Row {
  return {
    label: '', status: '', text: '', amount: '', showDollar: false,
    right: '', chip: null, tone: 'dim', action: null
  };
}

/** Truncating as well as padding: a screen that overruns is a design bug,
 *  and silently dropping a row is better caught by a test than by a player. */
export function padRows(rows: readonly Row[]): Row[] {
  const out = rows.slice(0, BOARD_ROWS);
  while (out.length < BOARD_ROWS) out.push(blankRow());
  return out;
}
```

- [ ] **Step 4: Write `BoardRow`**

Create `src/board/BoardRow.tsx`:

```tsx
import type { FlapChar } from './drum';
import type { Row } from './types';
import { TOKENS } from '../game/tokens';

/** Exported so the layout-budget test derives its expectations from the
 *  same numbers the row is built with, rather than restating them. */
export const BOARD_COLUMN_WIDTHS = {
  chip: 22, label: 168, status: 170, destination: 406, amount: 219, right: 178
} as const;

export interface BoardRowProps {
  row: Row;
  faces: FlapChar[];
  onAct: () => void;
}

function Panel({ value, width }: { value: string; width: number }) {
  return (
    <span
      style={{
        display: 'inline-block', width, height: TOKENS.tileHeight,
        lineHeight: `${TOKENS.tileHeight}px`, paddingLeft: 11,
        boxSizing: 'border-box', borderRadius: 3, overflow: 'hidden',
        whiteSpace: 'nowrap', fontSize: 18, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: TOKENS.pale,
        background: `linear-gradient(180deg, ${TOKENS.flapTop} 0 50%, ${TOKENS.flapBottom} 50% 100%)`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)'
      }}
    >
      {value.toUpperCase()}
    </span>
  );
}

export function BoardRow({ row, faces, onAct }: BoardRowProps) {
  const interactive = row.action !== null && row.tone !== 'disabled';
  const colour =
    row.tone === 'disabled' ? '#4a463e' : row.tone === 'dim' ? TOKENS.dim : TOKENS.pale;

  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: BOARD_COLUMN_WIDTHS.chip, height: 74, flex: `0 0 ${BOARD_COLUMN_WIDTHS.chip}px`,
          borderRadius: 2, background: row.chip ?? '#141414',
          boxShadow: row.chip ? '0 0 0 2px rgba(255,255,255,0.14)' : 'inset 0 0 0 1px #2c2c2c'
        }}
      />
      <span style={{ width: BOARD_COLUMN_WIDTHS.label, flex: `0 0 ${BOARD_COLUMN_WIDTHS.label}px`,
                     fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
                     color: TOKENS.dim }}>
        {row.label.toUpperCase()}
      </span>
      <span data-column="status" style={{ width: BOARD_COLUMN_WIDTHS.status,
                                          flex: `0 0 ${BOARD_COLUMN_WIDTHS.status}px` }}>
        <Panel value={row.status} width={BOARD_COLUMN_WIDTHS.status - 2} />
      </span>
      <span data-column="destination" style={{ width: BOARD_COLUMN_WIDTHS.destination,
                                               flex: `0 0 ${BOARD_COLUMN_WIDTHS.destination}px`,
                                               whiteSpace: 'nowrap' }}>
        <span style={{ position: 'absolute', width: 1, height: 1,
                       overflow: 'hidden', clipPath: 'inset(50%)' }}>
          {row.text.toUpperCase()}
        </span>
        {faces.map((face, i) => (
          <span
            key={i}
            data-flap={face.top}
            aria-hidden="true"
            style={{
              display: 'inline-block', width: TOKENS.tileWidth, height: TOKENS.tileHeight,
              marginLeft: TOKENS.tileGap, lineHeight: `${TOKENS.tileHeight}px`,
              textAlign: 'center', fontSize: 29, borderRadius: 3, color: colour,
              background: `linear-gradient(180deg, ${TOKENS.flapTop} 0 50%, ${TOKENS.flapBottom} 50% 100%)`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)'
            }}
          >
            {face.top === ' ' ? ' ' : face.top}
          </span>
        ))}
      </span>
      <span data-column="amount" style={{ width: BOARD_COLUMN_WIDTHS.amount,
                                          flex: `0 0 ${BOARD_COLUMN_WIDTHS.amount}px`,
                                          fontSize: 27, color: TOKENS.amber }}>
        {row.showDollar && <span data-dollar="">$</span>}
        {row.amount}
      </span>
      <span data-column="right" style={{ width: BOARD_COLUMN_WIDTHS.right,
                                         flex: `0 0 ${BOARD_COLUMN_WIDTHS.right}px` }}>
        <Panel value={row.right} width={BOARD_COLUMN_WIDTHS.right - 2} />
      </span>
    </>
  );

  const shared = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 22,
    flex: 1,
    width: '100%',
    padding: '0 14px',
    boxSizing: 'border-box' as const,
    borderBottom: `1px solid ${TOKENS.rule}`,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left' as const
  };

  if (row.action === null) return <div style={shared}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => { if (interactive) onAct(); }}
      aria-disabled={!interactive}
      style={{ ...shared, border: 0, cursor: interactive ? 'pointer' : 'default' }}
    >
      {body}
    </button>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/board/BoardRow.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Prove the column-budget test can fail**

Temporarily narrow the destination column:

```ts
export const BOARD_COLUMN_WIDTHS = { ..., destination: 200, ... } as const;
```

Run: `npm test -- src/board/BoardRow.test.tsx`
Expected: FAIL on "fits the destination field inside its declared column" (`expected 433 to be less than or equal to 200`). **Read it**, then revert.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/board/types.ts src/board/BoardRow.tsx src/board/BoardRow.test.tsx
git commit -m "feat(board): Row/ScreenDef types and BoardRow"
```

---

### Task 4: `Board`

**Files:**
- Create: `src/board/Board.tsx`
- Test: `src/board/Board.test.tsx`

**Interfaces:**
- Consumes: `useFlap` (Task 2), `BoardRow`, `padRows`, `ScreenDef`, `Row` (Task 3).
- Produces: `<Board screen onRowAct onBack />` where `onRowAct(row: Row, index: number)`.

- [ ] **Step 1: Write the failing test**

Create `src/board/Board.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { blankRow, type Row, type ScreenDef } from './types';

const choice = (text: string): Row => ({
  label: 'Mode 01', status: 'Local', text, amount: '2-6', showDollar: false,
  right: 'One device', chip: '#f5c451', tone: 'normal',
  action: { kind: 'navigate', to: 'passAndPlay' }
});

const screenDef = (rows: Row[]): ScreenDef => ({
  title: 'Departures', sub: 'CHOOSE A MODE', back: null,
  cols: ['Mode', 'Where', 'Select', 'Players', 'Notes'],
  rows
});

describe('the board', () => {
  it('always renders seven rows, however few the screen defines', () => {
    const { container } = render(
      <Board screen={screenDef([choice('PASS AND PLAY')])} onRowAct={() => {}} onBack={() => {}} />
    );
    expect(container.querySelectorAll('[data-board-row]')).toHaveLength(7);
  });

  it('still renders seven rows when the screen defines too many', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => choice(`ROW ${i}`));
    const { container } = render(
      <Board screen={screenDef(tooMany)} onRowAct={() => {}} onBack={() => {}} />
    );
    expect(container.querySelectorAll('[data-board-row]')).toHaveLength(7);
  });

  it('reports which row was acted on', () => {
    const onRowAct = vi.fn();
    render(
      <Board
        screen={screenDef([blankRow(), choice('PLAY ONLINE')])}
        onRowAct={onRowAct}
        onBack={() => {}}
      />
    );
    screen.getByText('PLAY ONLINE').click();
    expect(onRowAct).toHaveBeenCalledWith(expect.objectContaining({ text: 'PLAY ONLINE' }), 1);
  });

  it('shows a back control only when the screen has somewhere to go back to', () => {
    const { rerender } = render(
      <Board screen={screenDef([])} onRowAct={() => {}} onBack={() => {}} />
    );
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();

    rerender(
      <Board
        screen={{ ...screenDef([]), back: 'home' }}
        onRowAct={() => {}}
        onBack={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('shows the screen title and its column headings', () => {
    render(<Board screen={screenDef([])} onRowAct={() => {}} onBack={() => {}} />);
    expect(screen.getByText('CHOOSE A MODE')).toBeInTheDocument();
    expect(screen.getByText('Select')).toBeInTheDocument();
  });

  it('reads out the destination throughout a flap, not the spinning tiles', () => {
    // A screen reader must not narrate two seconds of noise.
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <Board screen={screenDef([choice('PASS AND PLAY')])} onRowAct={() => {}} onBack={() => {}} />
      );
      rerender(
        <Board screen={screenDef([choice('PLAY ONLINE')])} onRowAct={() => {}} onBack={() => {}} />
      );
      act(() => { vi.advanceTimersByTime(52); });

      // Mid-flap: the tiles are somewhere in the alphabet…
      const tiles = [...container.querySelectorAll('[data-flap]')]
        .map(el => el.getAttribute('data-flap')).join('').trimEnd();
      expect(tiles).not.toBe('PLAY ONLINE');
      // …but the accessible text is already the destination.
      expect(screen.getByText('PLAY ONLINE')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Add `act` to the `@testing-library/react` import and `vi` to the `vitest` import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/board/Board.test.tsx`
Expected: FAIL — `Cannot find module './Board'`.

- [ ] **Step 3: Write the implementation**

Create `src/board/Board.tsx`:

```tsx
import { useMemo } from 'react';
import { BoardRow, BOARD_COLUMN_WIDTHS } from './BoardRow';
import { useFlap } from './useFlap';
import { padRows, type Row, type ScreenDef } from './types';
import { TOKENS } from '../game/tokens';

export interface BoardProps {
  screen: ScreenDef;
  onRowAct: (row: Row, index: number) => void;
  onBack: () => void;
}

export function Board({ screen, onRowAct, onBack }: BoardProps) {
  const rows = useMemo(() => padRows(screen.rows), [screen.rows]);
  const texts = useMemo(() => rows.map(row => row.text), [rows]);
  const { rows: faces, flapping, snap } = useFlap(texts);

  // Columns B and E clear while the destination column is spinning, then
  // return. That asymmetry is the effect; without it every field changes
  // at once and the board reads as a page swap.
  const settledOnly = (value: string) => (flapping ? '' : value);

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: TOKENS.board, border: `14px solid ${TOKENS.bezel}`,
        boxShadow: 'inset 0 0 0 1px #262626'
      }}
    >
      <header
        style={{
          flex: '0 0 78px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 34px',
          background: TOKENS.header, borderBottom: '1px solid #2a2a2a'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.22em',
                         color: TOKENS.amber, textTransform: 'uppercase' }}>
            Rail Baron
          </span>
          <span style={{ fontSize: 12, letterSpacing: '0.22em', color: TOKENS.dim,
                         textTransform: 'uppercase' }}>
            {screen.title}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                       letterSpacing: '0.18em', color: TOKENS.dim }}>
          <span>{screen.sub}</span>
          {screen.back !== null && (
            <button
              type="button"
              onClick={onBack}
              style={{ cursor: 'pointer', color: TOKENS.dim, background: 'transparent',
                       border: '1px solid #2a2a2a', borderRadius: 3, padding: '8px 12px',
                       font: 'inherit', letterSpacing: 'inherit' }}
            >
              BACK
            </button>
          )}
        </span>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '16px 48px 10px',
                    fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase',
                    color: '#7d7669' }}>
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.chip}px` }} />
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.label}px` }}>{screen.cols[0]}</span>
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.status}px` }}>{screen.cols[1]}</span>
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.destination}px` }}>{screen.cols[2]}</span>
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.amount}px` }}>{screen.cols[3]}</span>
        <span style={{ flex: `0 0 ${BOARD_COLUMN_WIDTHS.right}px` }}>{screen.cols[4]}</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 34px 20px' }}>
        {rows.map((row, index) => (
          <div key={index} data-board-row="" style={{ display: 'flex', flex: 1 }}>
            <BoardRow
              row={{ ...row, status: settledOnly(row.status), right: settledOnly(row.right) }}
              faces={faces[index]}
              onAct={() => {
                // A tap during a flap finishes it rather than being ignored:
                // an inert menu is a worse trade than a cut-short animation.
                if (flapping) snap();
                onRowAct(row, index);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/board/Board.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the seven-row test can fail**

Temporarily change `padRows` in `src/board/types.ts` to `return rows.slice();`.

Run: `npm test -- src/board/Board.test.tsx`
Expected: FAIL on both row-count tests (`expected 1 to have length 7`, `expected 9 to have length 7`). **Read it**, then revert.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/board/Board.tsx src/board/Board.test.tsx
git commit -m "feat(board): Board — seven rows, one animation, back control"
```

---

### Task 5: The `home` screen, the router, and the base path

The first screen driven by the drum. Proves the model end to end.

**Files:**
- Create: `basePath.ts` (repo root)
- Create: `src/board/screens/home.ts`
- Test: `src/board/screens/home.test.ts`
- Modify: `vite.config.ts`, `src/main.tsx`, `src/App.tsx`
- Install: `react-router-dom`

**Interfaces:**
- Consumes: `ScreenDef`, `padRows` (Task 3), `Board` (Task 4).
- Produces: `BASE_PATH`, `home(): ScreenDef`, routes `/` and `/pass-and-play`.

- [ ] **Step 1: Install the router**

```bash
npm install react-router-dom@^7
```

`react-router-dom` v7 declares `react: '>=18'`, which React 19 satisfies.

- [ ] **Step 2: Write the failing test**

Create `src/board/screens/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { home } from './home';

describe('the home screen', () => {
  it('states both modes as destinations', () => {
    const rows = home().rows;
    expect(rows[0].text).toBe('PASS AND PLAY');
    expect(rows[1].text).toBe('PLAY ONLINE');
  });

  it('sends pass-and-play somewhere real', () => {
    expect(home().rows[0].action).toEqual({ kind: 'navigate', to: 'passAndPlay' });
  });

  it('shows online as coming rather than hiding it', () => {
    // The mode select's whole statement is that both modes exist.
    const online = home().rows[1];
    expect(online.tone).toBe('disabled');
    expect(online.right).toBe('Soon');
    expect(online.action).toBeNull();
  });

  it('has nowhere to go back to', () => {
    expect(home().back).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/board/screens/home.test.ts`
Expected: FAIL — `Cannot find module './home'`.

- [ ] **Step 4: Write the screen**

Create `src/board/screens/home.ts`:

```ts
import { padRows, type ScreenDef } from '../types';

/**
 * Online is shown disabled rather than hidden. The mode select's whole
 * statement is that both modes exist; concealing one misstates it, and a
 * player who has heard the game is online-capable should see where it
 * will be rather than wonder whether they misremembered.
 */
export function home(): ScreenDef {
  return {
    title: 'Departures',
    sub: 'CHOOSE A MODE',
    back: null,
    cols: ['Mode', 'Where', 'Select', 'Players', 'Notes'],
    rows: padRows([
      {
        label: 'Mode 01', status: 'Local', text: 'PASS AND PLAY',
        amount: '2-6', showDollar: false, right: 'One device',
        chip: '#f5c451', tone: 'normal',
        action: { kind: 'navigate', to: 'passAndPlay' }
      },
      {
        label: 'Mode 02', status: 'Remote', text: 'PLAY ONLINE',
        amount: '2-6', showDollar: false, right: 'Soon',
        chip: '#2f7fe8', tone: 'disabled',
        action: null
      }
    ])
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/board/screens/home.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the base path**

Create `basePath.ts` at the repo root:

```ts
/**
 * The one copy of the GitHub Pages base path.
 *
 * Root-level rather than in `src/` because `vite.config.ts` and build
 * scripts run under Node, outside the app graph. Acquire's equivalent
 * records having lived in three places before it was consolidated; this
 * file exists before that can happen here.
 */
export const BASE_PATH = '/railbaron';
```

Modify `vite.config.ts` — add the import and the `base` key:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { BASE_PATH } from './basePath';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  // ...test config unchanged
});
```

- [ ] **Step 7: Wire the router**

Modify `src/main.tsx` — wrap `<App />`:

```tsx
import { BrowserRouter } from 'react-router-dom';

// The basename comes from Vite's own BASE_URL, which Vite builds from the
// config's `base` — so this does not hold a second hardcoded copy.
// BASE_URL carries a trailing slash; the router wants none.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
```

…and wrap the existing render in `<BrowserRouter basename={basename}>…</BrowserRouter>`.

Replace `src/App.tsx` entirely:

```tsx
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Board } from './board/Board';
import { home } from './board/screens/home';
import type { Row } from './board/types';

function HomePage() {
  const navigate = useNavigate();
  return (
    <Board
      screen={home()}
      onBack={() => {}}
      onRowAct={(row: Row) => {
        if (row.action?.kind === 'navigate' && row.action.to === 'passAndPlay') {
          navigate('/pass-and-play');
        }
      }}
    />
  );
}

export default function App() {
  return (
    <main style={{ height: '100%' }}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/pass-and-play" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}
```

`/pass-and-play` points at `HomePage` only until Task 7 gives it its own screen.

**`src/App.test.tsx` must not be deleted.** It drives the old prompt-based flow so it cannot pass here, but it holds three things nothing else covers: a StrictMode guard that one roll appends exactly one event (the *roll* side effect, which does **not** go away with `window.prompt`), an integration test scripting the dice through the whole roll→ballot→payout path with a hand-verified RNG queue, and the reset confirm/decline behaviour.

Park it, don't drop it:

```bash
git mv src/App.test.tsx src/App.legacy.test.tsx
```

…and change its top-level `describe('the app', ...)` to `describe.skip('the app — superseded, migrated in Task 10', ...)`. Task 10 rewrites each test against the new board and deletes this file; its Step 6 verifies no `.skip` and no `App.legacy.test.tsx` survive, so this cannot be forgotten.

- [ ] **Step 8: Verify the whole suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: PASS. `DeparturesBoard.test.tsx`, `DeparturesRow.test.tsx` and `RegionBallot.test.tsx` still pass — those components are untouched until Task 10.

- [ ] **Step 9: Look at it in a browser**

```bash
npm run dev
```

Open the dev server URL (note it now serves under `/railbaron/`). Confirm: the home board shows two modes and five blank rows; `PLAY ONLINE` is visibly dim and does nothing; clicking `PASS AND PLAY` changes the URL. **The flap will not animate yet** — both screens render `home()`, so the texts do not change. That is expected and Task 7 is where it first moves.

- [ ] **Step 10: Commit**

```bash
git add basePath.ts vite.config.ts src/main.tsx src/App.tsx package.json package-lock.json \
        src/board/screens/home.ts src/board/screens/home.test.ts src/App.legacy.test.tsx
git commit -m "feat(board): home screen, router and base path"
```

---

### Task 6: The begin gate, rename, and derived state

**Files:**
- Modify: `src/state/events.ts`
- Modify: `src/state/game.ts`
- Test: `src/state/game.test.ts` (existing file — add to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: events `{ type: 'started' }` and `{ type: 'renamed'; seat: SeatId; name: string | null }`; `GameState.phase: 'setup' | 'playing'`; `Seat.earned: number`; guarded `undo`.

- [ ] **Step 1: Write the failing tests**

Append to `src/state/game.test.ts`:

```ts
describe('the begin gate', () => {
  it('starts in setup, with no game under way', () => {
    expect(replay([]).phase).toBe('setup');
    expect(replay([{ type: 'joined', seat: 'red', name: 'ADA' }]).phase).toBe('setup');
  });

  it('is playing once the log says it started', () => {
    expect(replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' }
    ]).phase).toBe('playing');
  });
});

describe('renaming a seat', () => {
  it('changes the name without disturbing the journeys', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
      { type: 'renamed', seat: 'red', name: 'MARGO' }
    ]);
    expect(state.seats.red.name).toBe('MARGO');
    expect(state.seats.red.stops).toHaveLength(1);
  });

  it('vacates the seat when the name is cleared', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'renamed', seat: 'red', name: null }
    ]);
    expect(state.seats.red.name).toBeNull();
  });
});

describe('what a seat has earned', () => {
  it('sums the payouts, counting a zero-paying journey as zero', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: 21, region: 'NC', payout: 0 },
      { type: 'arrived', seat: 'red', city: 22, region: 'SE', payout: 8500 }
    ]);
    expect(state.seats.red.earned).toBe(13000);
  });

  it('ignores home towns, which pay nothing at all', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    expect(state.seats.red.earned).toBe(0);
  });
});

describe('undo', () => {
  it('does nothing during setup — a taken seat is renamed, not undone', () => {
    const log: GameEvent[] = [{ type: 'joined', seat: 'red', name: 'ADA' }];
    expect(undo(log)).toEqual(log);
  });

  it('refuses to rewind back across the start of the game', () => {
    const log: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' }
    ];
    expect(undo(log)).toEqual(log);
  });

  it('takes back the last move once play is under way', () => {
    const log: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 }
    ];
    expect(undo(log)).toHaveLength(2);
  });
});
```

Add `import type { GameEvent } from './events';` to the test file's imports if it is not already there, and ensure `undo` is imported alongside `replay`.

**Also add this to `src/state/storage.test.ts`.** It is the most important test in this task:

```ts
describe('the new events survive being saved and loaded', () => {
  it('keeps a log containing started and renamed, rather than discarding it', () => {
    // isGameEvent is applied all-or-nothing by loadLog: one unrecognised
    // event and the WHOLE log becomes []. A new event type that the
    // validator does not know about therefore does not degrade the save —
    // it silently destroys it, and only on the next reload.
    const log: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'renamed', seat: 'red', name: 'MARGO' },
      { type: 'started' }
    ];
    saveLog(log);
    expect(loadLog().events).toHaveLength(3);
  });
});
```

Note this test needs `loadLog().events`, which is Task 8's return shape. Until Task 8 lands, write it as `loadLog()` and change it there — Task 8's step 4 already updates every caller.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/state/game.test.ts`
Expected: FAIL — `phase` undefined, `renamed` not assignable to `GameEvent`, `earned` undefined, undo returning a shortened log.

- [ ] **Step 3: Add the events**

Modify `src/state/events.ts` — extend the `GameEvent` union:

```ts
export type GameEvent =
  | { type: 'joined'; seat: SeatId; name: string }
  | { type: 'renamed'; seat: SeatId; name: string | null }
  | { type: 'started' }
  | { type: 'regionRequested'; seat: SeatId; rolled: RegionId }
  | { type: 'arrived'; seat: SeatId; city: CityId; region: RegionId; payout: number | null };
```

Note `started` carries no `seat`, so any code narrowing on `event.seat` must handle it — `replay` does below.

**Then extend `isGameEvent` in the same file.** Its `default: return false`, combined with `loadLog`'s all-or-nothing `events.every(isGameEvent)`, means an event type the validator does not recognise does not degrade a save — it destroys it, silently, on the next load:

```ts
    case 'started':
      // No payload to check: its presence is the whole fact.
      return true;
    case 'renamed':
      // null is a real value here — it vacates the seat.
      return (
        VALID_SEATS.has(event.seat as string) &&
        (event.name === null || typeof event.name === 'string')
      );
```

Add both cases above the existing `default:`.

- [ ] **Step 4: Update `game.ts`**

Modify `src/state/game.ts`:

```ts
export interface Seat {
  id: SeatId;
  name: string | null;
  stops: readonly Stop[];
  awaiting: RegionId | null;
  /** Derived at replay, never stored: sum of payouts, home towns counting nothing. */
  earned: number;
}

export interface GameState {
  seats: Record<SeatId, Seat>;
  phase: 'setup' | 'playing';
}

function emptyState(): GameState {
  const seats = {} as Record<SeatId, Seat>;
  for (const id of SEATS) seats[id] = { id, name: null, stops: [], awaiting: null, earned: 0 };
  return { seats, phase: 'setup' };
}

export function replay(events: readonly GameEvent[]): GameState {
  const state = emptyState();
  for (const event of events) {
    if (event.type === 'started') { state.phase = 'playing'; continue; }
    const seat = state.seats[event.seat];
    switch (event.type) {
      case 'joined':
        state.seats[event.seat] = { ...seat, name: event.name };
        break;
      case 'renamed':
        state.seats[event.seat] = { ...seat, name: event.name };
        break;
      case 'regionRequested':
        state.seats[event.seat] = { ...seat, awaiting: event.rolled };
        break;
      case 'arrived':
        state.seats[event.seat] = {
          ...seat,
          awaiting: null,
          earned: seat.earned + (event.payout ?? 0),
          stops: [...seat.stops,
                  { city: event.city, region: event.region, payout: event.payout }]
        };
        break;
    }
  }
  return state;
}

/**
 * Undo is a play-phase affordance, matching Acquire. Setup has none: a
 * taken row is tapped to rename, which corrects directly. Two guards —
 * refuse before the game has started, and refuse to cross back over the
 * moment it did.
 */
export function undo(events: readonly GameEvent[]): GameEvent[] {
  const startedAt = events.findIndex(event => event.type === 'started');
  if (startedAt < 0) return [...events];
  if (events.length <= startedAt + 1) return [...events];
  return events.slice(0, -1);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/state/game.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the undo-floor test is not hollow**

The setup-phase assertion passes vacuously against a log with no `started` to cross, so prove the crossing guard specifically. Temporarily drop the second guard:

```ts
if (startedAt < 0) return [...events];
return events.slice(0, -1);
```

Run: `npm test -- src/state/game.test.ts`
Expected: FAIL on **"refuses to rewind back across the start of the game"** (received an array of length 1). **Read it**, then revert.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm test
npm run typecheck
git add src/state/events.ts src/state/game.ts src/state/game.test.ts
git commit -m "feat(state): begin gate, rename, derived earnings, guarded undo"
```

---

### Task 7: The pass-and-play setup screen

Seat rows, inline naming, and the start gate. This is where `window.prompt` dies and where the flap first moves.

**Files:**
- Create: `src/board/screens/passAndPlay.ts`
- Test: `src/board/screens/passAndPlay.test.ts`
- Create: `src/board/RowInput.tsx`
- Modify: `src/state/useGame.ts`, `src/App.tsx`

**Interfaces:**
- Consumes: `ScreenDef`, `padRows`, `FieldId` (Task 3); `GameState` with `phase` (Task 6).
- Produces: `passAndPlay(state: GameState): ScreenDef`; `useGame` gains `start()`, `rename(seat, name)`, and no longer calls `window.prompt`; `<RowInput value onCommit onCancel />`.

- [ ] **Step 1: Write the failing test**

Create `src/board/screens/passAndPlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { passAndPlay } from './passAndPlay';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';

const state = (events: GameEvent[]) => replay(events);
const startRow = (events: GameEvent[]) => passAndPlay(state(events)).rows[6];

describe('the pass-and-play setup screen', () => {
  it('offers all six seats plus a start row', () => {
    const rows = passAndPlay(state([])).rows;
    expect(rows).toHaveLength(7);
    expect(rows[0].text).toBe('TAP TO JOIN');
    expect(rows[5].text).toBe('TAP TO JOIN');
    expect(rows[6].text).toBe('START GAME');
  });

  it('lets an empty seat be typed into', () => {
    expect(passAndPlay(state([])).rows[0].action)
      .toEqual({ kind: 'edit', field: 'seat:red', placeholder: 'Type a name, press Enter' });
  });

  it('shows a taken seat by name and still lets it be edited', () => {
    const rows = passAndPlay(state([{ type: 'joined', seat: 'red', name: 'ADA' }])).rows;
    expect(rows[0].text).toBe('ADA');
    expect(rows[0].right).toBe('Tap to edit');
    expect(rows[0].action).toEqual(
      { kind: 'edit', field: 'seat:red', placeholder: 'Type a name, press Enter' }
    );
  });

  it('holds the start row shut below two barons', () => {
    expect(startRow([]).tone).toBe('disabled');
    expect(startRow([]).action).toBeNull();
    expect(startRow([]).right).toBe('Need 2 seats');

    const one: GameEvent[] = [{ type: 'joined', seat: 'red', name: 'ADA' }];
    expect(startRow(one).tone).toBe('disabled');
  });

  it('opens the start row at two barons', () => {
    const two: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'blue', name: 'MARGO' }
    ];
    expect(startRow(two).tone).toBe('normal');
    expect(startRow(two).action).toEqual({ kind: 'navigate', to: 'play' });
  });

  it('carries each seat its own colour once taken', () => {
    const rows = passAndPlay(state([{ type: 'joined', seat: 'green', name: 'DEV' }])).rows;
    expect(rows[1].chip).toBe('#5fbb2e');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/board/screens/passAndPlay.test.ts`
Expected: FAIL — `Cannot find module './passAndPlay'`.

- [ ] **Step 3: Write the screen**

Create `src/board/screens/passAndPlay.ts`:

```ts
import { SEATS } from '../../state/events';
import type { GameState } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type Row, type ScreenDef } from '../types';

const MINIMUM_BARONS = 2;

export function passAndPlay(state: GameState): ScreenDef {
  const seats: Row[] = SEATS.map((id, index) => {
    const seat = state.seats[id];
    const taken = seat.name !== null;
    return {
      label: `Seat ${index + 1}`,
      status: taken ? 'Ready' : 'Open',
      text: taken ? seat.name! : 'TAP TO JOIN',
      amount: '',
      showDollar: false,
      right: taken ? 'Tap to edit' : '',
      chip: taken ? SEAT_COLORS[id] : null,
      tone: taken ? 'normal' : 'dim',
      action: { kind: 'edit', field: `seat:${id}`, placeholder: 'Type a name, press Enter' }
    };
  });

  const ready = SEATS.filter(id => state.seats[id].name !== null).length >= MINIMUM_BARONS;

  return {
    title: 'Pass & Play',
    sub: 'THIS DEVICE',
    back: 'home',
    cols: ['Seat', 'State', 'Player name', '', 'Action'],
    rows: padRows([
      ...seats,
      {
        label: '',
        status: ready ? 'Ready' : 'Waiting',
        text: 'START GAME',
        amount: '',
        showDollar: false,
        right: ready ? 'Deals seat 1' : 'Need 2 seats',
        chip: null,
        tone: ready ? 'normal' : 'disabled',
        action: ready ? { kind: 'navigate', to: 'play' } : null
      }
    ])
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/board/screens/passAndPlay.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the inline input**

Create `src/board/RowInput.tsx`:

```tsx
import { useState } from 'react';
import { BOARD_COLUMN_WIDTHS } from './BoardRow';
import { TOKENS } from '../game/tokens';

export interface RowInputProps {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Replaces the destination plate in place. Enter commits, Escape abandons,
 *  blur commits — the same three ways the design's canvas behaves. */
export function RowInput({ initial, placeholder, onCommit, onCancel }: RowInputProps) {
  const [draft, setDraft] = useState(initial);

  return (
    <input
      autoFocus
      maxLength={14}
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim().toUpperCase())}
      onKeyDown={event => {
        if (event.key === 'Enter') onCommit(draft.trim().toUpperCase());
        if (event.key === 'Escape') onCancel();
      }}
      style={{
        width: BOARD_COLUMN_WIDTHS.destination - 2, height: TOKENS.tileHeight,
        boxSizing: 'border-box', padding: '0 12px', border: 0, borderRadius: 3,
        outline: `2px solid ${TOKENS.amber}`, outlineOffset: -2, background: '#232323',
        font: 'inherit', fontSize: 27, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: TOKENS.amber
      }}
    />
  );
}
```

- [ ] **Step 6: Update `useGame`**

Modify `src/state/useGame.ts` — replace the `window.prompt` branch in `activate` and add two actions:

```ts
// `activate` now only rolls. Naming happens through the board's inline
// input, so the prompt() that used to live here is gone — and with it the
// StrictMode double-fire hazard the long comment above described.
const activate = useCallback((seat: SeatId) => {
  const current = state.seats[seat];
  if (current.awaiting !== null || current.name === null) return;
  // ...existing rollDestination switch, unchanged
}, [state, rng]);

const rename = useCallback((seat: SeatId, name: string | null) => {
  setEvents(log => {
    const seated = replay(log).seats[seat].name !== null;
    if (!seated && name) return [...log, { type: 'joined', seat, name }];
    return [...log, { type: 'renamed', seat, name: name || null }];
  });
}, []);

const start = useCallback(() => {
  setEvents(log => (log.some(e => e.type === 'started') ? log : [...log, { type: 'started' }]));
}, []);
```

Return `rename` and `start` alongside the existing values. Delete the now-stale paragraph of the `activate` comment that describes `window.prompt`, keeping the part about updater purity.

- [ ] **Step 7: Route the screen**

Modify `src/App.tsx` — give `/pass-and-play` a real page:

```tsx
function PassAndPlayPage() {
  const navigate = useNavigate();
  const { state, rename, start } = useGame();
  const [editing, setEditing] = useState<{ seat: SeatId; placeholder: string } | null>(null);

  return (
    <Board
      screen={passAndPlay(state)}
      onBack={() => navigate('/')}
      editing={editing}
      onCommit={value => {
        if (editing) rename(editing.seat, value || null);
        setEditing(null);
      }}
      onCancel={() => setEditing(null)}
      onRowAct={row => {
        if (row.action?.kind === 'edit') {
          const seat = row.action.field.slice('seat:'.length) as SeatId;
          setEditing({ seat, placeholder: row.action.placeholder });
        }
        if (row.action?.kind === 'navigate' && row.action.to === 'play') {
          start();
          navigate('/pass-and-play/game');
        }
      }}
    />
  );
}
```

`Board` gains three optional props. Add to `BoardProps` in `src/board/Board.tsx`:

```tsx
export interface BoardProps {
  screen: ScreenDef;
  onRowAct: (row: Row, index: number) => void;
  onBack: () => void;
  editing?: { seat: SeatId; placeholder: string } | null;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
}
```

…and inside the row loop, render the input in place of the row when it is the one being edited:

```tsx
{rows.map((row, index) => {
  const isEditing =
    editing != null &&
    row.action?.kind === 'edit' &&
    row.action.field === `seat:${editing.seat}`;

  return (
    <div key={index} data-board-row="" style={{ display: 'flex', flex: 1 }}>
      {isEditing ? (
        <RowInput
          initial={row.text === 'TAP TO JOIN' ? '' : row.text}
          placeholder={editing!.placeholder}
          onCommit={value => onCommit?.(value)}
          onCancel={() => onCancel?.()}
        />
      ) : (
        <BoardRow
          row={{ ...row, status: settledOnly(row.status), right: settledOnly(row.right) }}
          faces={faces[index]}
          onAct={() => {
            if (flapping) snap();
            onRowAct(row, index);
          }}
        />
      )}
    </div>
  );
})}
```

Import `RowInput` and `type SeatId` at the top of `Board.tsx`. The cast on `row.action.field` in `App.tsx` needs no `as any` because `FieldId` is the template literal type `` `seat:${SeatId}` ``, so slicing the prefix yields a `SeatId` by construction.

- [ ] **Step 8: Full suite, typecheck, browser**

```bash
npm test
npm run typecheck
npm run dev
```

In the browser: from home, tap `PASS AND PLAY` and **watch the destination column flap** — this is the first transition where the texts actually change. Name two barons; confirm the start row lights up at the second. Confirm no `window.prompt` appears anywhere.

- [ ] **Step 9: Commit**

```bash
git add src/board/screens/passAndPlay.ts src/board/screens/passAndPlay.test.ts \
        src/board/RowInput.tsx src/board/Board.tsx src/state/useGame.ts src/App.tsx
git commit -m "feat(board): pass-and-play setup, inline naming, start gate"
```

---

### Task 8: The save record gains an age

**Files:**
- Modify: `src/state/storage.ts`
- Test: `src/state/storage.test.ts` (existing file — add to it)

**Interfaces:**
- Consumes: `GameEvent` (Task 6).
- Produces: `SAVE_VERSION = 2`; `saveLog(events)` writes `savedAt`; `loadLog(): { events: GameEvent[]; savedAt: number | null }`.

**Note:** `loadLog`'s return type changes from `GameEvent[]` to an object. Its only caller is `useGame`, updated in Step 4.

- [ ] **Step 1: Write the failing tests**

Append to `src/state/storage.test.ts`:

```ts
describe('the save record across versions', () => {
  it('stamps the time a game was saved', () => {
    saveLog([{ type: 'joined', seat: 'red', name: 'ADA' }]);
    expect(loadLog().savedAt).toBeTypeOf('number');
  });

  it('still reads a version 1 record rather than discarding the game', () => {
    // The screen that shows this record exists to protect the game in it.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      events: [{ type: 'joined', seat: 'red', name: 'ADA' }]
    }));
    const loaded = loadLog();
    expect(loaded.events).toHaveLength(1);
    expect(loaded.savedAt).toBeNull();
  });

  it('discards a record it cannot understand at all', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, events: [] }));
    expect(loadLog().events).toEqual([]);
  });
});
```

Ensure `STORAGE_KEY`, `saveLog` and `loadLog` are imported, and that a `beforeEach(() => localStorage.clear())` exists in the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/state/storage.test.ts`
Expected: FAIL — `loadLog(...).savedAt` is undefined (`loadLog` still returns an array).

- [ ] **Step 3: Write the implementation**

Modify `src/state/storage.ts`:

```ts
export const STORAGE_KEY = 'railbaron:log:v1';

/** 2 adds `savedAt`. Version 1 records are migrated, not discarded — the
 *  saved-game screen exists to protect the game inside them, and bouncing
 *  the version would throw away exactly what it is there to offer back. */
export const SAVE_VERSION = 2;

export interface SavedGame {
  events: GameEvent[];
  /** null for a version 1 record, whose age was never recorded. */
  savedAt: number | null;
}

const EMPTY: SavedGame = { events: [], savedAt: null };

export function saveLog(events: readonly GameEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), events })
    );
  } catch {
    // A full or disabled store loses the save, not the game in progress.
  }
}

export function loadLog(): SavedGame {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const { version, events, savedAt } =
      parsed as { version?: number; events?: unknown; savedAt?: unknown };
    if (!Array.isArray(events)) return EMPTY;
    if (version !== 1 && version !== SAVE_VERSION) return EMPTY;

    // All-or-nothing, unchanged from before: a log with one bad event and
    // the rest filtered out would replay into a state that never existed
    // (a seat arriving somewhere it never departed from). An empty board is
    // an honest failure; a silently-repaired one isn't.
    if (!events.every(isGameEvent)) return EMPTY;

    return {
      events,
      // Version 1 records never carried a time.
      savedAt: version === 1 || typeof savedAt !== 'number' ? null : savedAt
    };
  } catch {
    return EMPTY;
  }
}
```

**Keep the `isGameEvent` import** at the top of the file — `import { isGameEvent, type GameEvent } from './events';`. Dropping it would revert `8e282f6`, which exists because a structurally-valid-but-wrong log throws deep inside `cityById` on every replay and bricks the app with no recovery short of clearing site data by hand.

- [ ] **Step 4: Update the caller**

Modify `src/state/useGame.ts` — `useState<GameEvent[]>(() => loadLog())` becomes `useState<GameEvent[]>(() => loadLog().events)`. Expose the age too: `const [savedAt] = useState(() => loadLog().savedAt);` and return it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/state/storage.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Prove the migration test can fail**

Temporarily delete the `if (version === 1)` line.

Run: `npm test -- src/state/storage.test.ts`
Expected: FAIL on "still reads a version 1 record" (`expected [] to have length 1`). **Read it**, then revert.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/state/storage.ts src/state/storage.test.ts src/state/useGame.ts
git commit -m "feat(state): save records carry an age, with a v1 migration"
```

---

### Task 9: The saved-game and confirm screens

**Files:**
- Create: `src/board/screens/saved.ts`, `src/board/screens/confirm.ts`
- Test: `src/board/screens/saved.test.ts`, `src/board/screens/confirm.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `GameState` with `earned` (Task 6), `SavedGame` (Task 8).
- Produces: `saved(state: GameState, savedAt: number | null, now?: number): ScreenDef`; `confirm(): ScreenDef`.

- [ ] **Step 1: Write the failing tests**

Create `src/board/screens/saved.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { saved } from './saved';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';

const DAY = 86_400_000;
const game: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
  { type: 'arrived', seat: 'blue', city: 21, region: 'SE', payout: 8500 }
];
const screen = (now = 0, savedAt: number | null = 0) => saved(replay(game), savedAt, now);

describe('the saved-game screen', () => {
  it('offers continue and new game as the first two choices', () => {
    expect(screen().rows[0].text).toBe('CONTINUE GAME');
    expect(screen().rows[1].text).toBe('NEW GAME');
  });

  it('sends new game through a confirmation rather than discarding at once', () => {
    expect(screen().rows[1].action).toEqual({ kind: 'navigate', to: 'confirm' });
  });

  it('summarises the roster in one row, so six barons still fit seven rows', () => {
    const rows = screen().rows;
    expect(rows).toHaveLength(7);
    expect(rows[2].right).toBe('2 barons · Turn 1');
  });

  it('names the leader and what they have earned', () => {
    const summary = screen().rows[2];
    expect(summary.text).toBe('MARGO');
    expect(summary.amount).toBe('8,500');
    expect(summary.showDollar).toBe(true);
    expect(summary.chip).toBe('#2f7fe8');
  });

  it('says how long ago the game was saved', () => {
    expect(screen(2 * DAY, 0).rows[0].status).toBe('2 days ago');
    expect(screen(0, 0).rows[0].status).toBe('Just now');
  });

  it('says only that it is saved when the record predates timestamps', () => {
    expect(screen(0, null).rows[0].status).toBe('Saved');
  });
});
```

Create `src/board/screens/confirm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { confirm } from './confirm';

describe('the discard confirmation', () => {
  it('offers discard and keep, in that order', () => {
    expect(confirm().rows[0].text).toBe('YES, DISCARD');
    expect(confirm().rows[1].text).toBe('KEEP PLAYING');
  });

  it('says plainly that discarding cannot be undone', () => {
    expect(confirm().rows[0].right).toBe('Cannot undo');
  });

  it('goes back to the saved game rather than to the setup board', () => {
    expect(confirm().back).toBe('saved');
    expect(confirm().rows[1].action).toEqual({ kind: 'navigate', to: 'saved' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/board/screens/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the screens**

Create `src/board/screens/saved.ts`:

```ts
import { SEATS } from '../../state/events';
import type { GameState } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type ScreenDef } from '../types';

const DAY = 86_400_000;

function howLongAgo(savedAt: number | null, now: number): string {
  if (savedAt === null) return 'Saved';
  const days = Math.floor((now - savedAt) / DAY);
  if (days <= 0) return 'Just now';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * One summary row, not one row per baron. Two action rows plus six barons
 * is eight rows, and the seven-row invariant is what makes the board read
 * as a single physical object. The leader is the most informative single
 * fact about a game you are deciding whether to return to.
 */
export function saved(
  state: GameState,
  savedAt: number | null,
  now: number = Date.now()
): ScreenDef {
  const seated = SEATS.map(id => state.seats[id]).filter(seat => seat.name !== null);
  const turns = Math.max(...seated.map(seat => seat.stops.length), 0);
  const leader = seated.reduce(
    (best, seat) => (best === null || seat.earned > best.earned ? seat : best),
    null as (typeof seated)[number] | null
  );

  return {
    title: 'Pass & Play',
    sub: 'SAVED GAME',
    back: 'home',
    cols: ['Saved game', 'State', 'Player', 'Earned', ''],
    rows: padRows([
      {
        label: 'In progress', status: howLongAgo(savedAt, now), text: 'CONTINUE GAME',
        amount: '', showDollar: false, right: `Turn ${turns}`,
        chip: '#f5c451', tone: 'normal', action: { kind: 'navigate', to: 'play' }
      },
      {
        label: 'Start over', status: 'Discards', text: 'NEW GAME',
        amount: '', showDollar: false, right: 'Confirms first',
        chip: '#e02b1d', tone: 'normal', action: { kind: 'navigate', to: 'confirm' }
      },
      {
        label: 'Leading', status: 'Saved', text: leader?.name ?? '',
        amount: leader ? leader.earned.toLocaleString('en-US') : '',
        showDollar: leader !== null,
        right: `${seated.length} barons · Turn ${turns}`,
        chip: leader ? SEAT_COLORS[leader.id] : null,
        tone: 'dim', action: null
      }
    ])
  };
}
```

Create `src/board/screens/confirm.ts`:

```ts
import { padRows, type ScreenDef } from '../types';

export function confirm(): ScreenDef {
  return {
    title: 'Pass & Play',
    sub: 'DISCARD SAVED GAME?',
    back: 'saved',
    cols: ['Confirm', 'State', 'Choose', '', ''],
    rows: padRows([
      {
        label: 'Discard', status: 'Permanent', text: 'YES, DISCARD',
        amount: '', showDollar: false, right: 'Cannot undo',
        chip: '#e02b1d', tone: 'normal', action: { kind: 'navigate', to: 'passAndPlay' }
      },
      {
        label: 'Keep', status: 'Saved', text: 'KEEP PLAYING',
        amount: '', showDollar: false, right: 'Back to game',
        chip: '#f5c451', tone: 'normal', action: { kind: 'navigate', to: 'saved' }
      }
    ])
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/board/screens/`
Expected: PASS.

- [ ] **Step 5: Route them**

Replace `PassAndPlayPage` in `src/App.tsx`. `confirm` is **local state, not a route** — a discard confirmation must not be bookmarkable, and the back button out of one must be harmless:

```tsx
function PassAndPlayPage() {
  const navigate = useNavigate();
  const { state, savedAt, rename, start, reset } = useGame();
  const [editing, setEditing] = useState<{ seat: SeatId; placeholder: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const resuming = state.phase === 'playing';
  const screen = confirming ? confirm() : resuming ? saved(state, savedAt) : passAndPlay(state);

  return (
    <Board
      screen={screen}
      editing={editing}
      onCommit={value => { if (editing) rename(editing.seat, value || null); setEditing(null); }}
      onCancel={() => setEditing(null)}
      onBack={() => (confirming ? setConfirming(false) : navigate('/'))}
      onRowAct={row => {
        if (row.action === null) return;
        if (row.action.kind === 'edit') {
          setEditing({
            seat: row.action.field.slice('seat:'.length) as SeatId,
            placeholder: row.action.placeholder
          });
          return;
        }
        if (row.action.kind !== 'navigate') return;
        switch (row.action.to) {
          case 'confirm':
            setConfirming(true);
            break;
          case 'saved':
            setConfirming(false);
            break;
          case 'passAndPlay':
            // Only reachable from the confirm screen's YES, DISCARD row.
            reset();
            setConfirming(false);
            break;
          case 'play':
            if (!resuming) start();
            navigate('/pass-and-play/game');
            break;
        }
      }}
    />
  );
}
```

- [ ] **Step 6: Full suite, typecheck, browser, commit**

```bash
npm test && npm run typecheck
```

In the browser: start a game, roll a couple of journeys, reload. Confirm the saved board appears with the right leader, earnings and turn count; that `NEW GAME` asks first; and that `KEEP PLAYING` returns without discarding.

```bash
git add src/board/screens/saved.ts src/board/screens/saved.test.ts \
        src/board/screens/confirm.ts src/board/screens/confirm.test.ts src/App.tsx
git commit -m "feat(board): saved-game and discard-confirm screens"
```

---

### Task 10: Unify play and the region ballot; retire the old components

**Files:**
- Create: `src/board/screens/play.ts`, `src/board/screens/regionBallot.ts`
- Test: `src/board/screens/play.test.ts`, `src/board/screens/regionBallot.test.ts`
- Delete: `src/game/DeparturesBoard.tsx`, `DeparturesBoard.test.tsx`, `DeparturesRow.tsx`, `DeparturesRow.test.tsx`, `RegionBallot.tsx`, `RegionBallot.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `play(state: GameState): ScreenDef`; `regionBallot(seat: Seat): ScreenDef`.

- [ ] **Step 1: Write the failing tests**

Create `src/board/screens/play.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { play } from './play';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 }
];

describe('the in-play board', () => {
  it('shows one row per seated baron and nothing for empty seats', () => {
    const rows = play(replay(log)).rows;
    expect(rows).toHaveLength(7);
    expect(rows[0].label.toUpperCase()).toBe('ADA');
    expect(rows[1].label.toUpperCase()).toBe('MARGO');
    expect(rows[2].action).toBeNull();
  });

  it('makes a baron row roll when tapped', () => {
    expect(play(replay(log)).rows[0].action).toEqual({ kind: 'act', seat: 'red' });
  });

  it('shows the latest destination and what it paid', () => {
    const row = play(replay(log)).rows[0];
    expect(row.amount).toBe('4,500');
    expect(row.showDollar).toBe(true);
    expect(row.text.length).toBeGreaterThan(0);
  });

  it('leaves a baron who has not travelled with an empty destination', () => {
    expect(play(replay(log)).rows[1].text).toBe('');
  });
});
```

Create `src/board/screens/regionBallot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { regionBallot } from './regionBallot';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
  { type: 'regionRequested', seat: 'red', rolled: 'NC' }
];

describe('the region ballot', () => {
  it('fills the board exactly — seven regions, seven rows', () => {
    const rows = regionBallot(replay(log).seats.red).rows;
    expect(rows).toHaveLength(7);
    expect(rows.every(row => row.text.length > 0)).toBe(true);
  });

  it('offers every region as a choice', () => {
    const rows = regionBallot(replay(log).seats.red).rows;
    expect(rows.map(row => row.text)).toContain('NORTHEAST');
    expect(rows.map(row => row.text)).toContain('SOUTHWEST');
  });

  it('dims the region just rolled, which is why the ballot opened', () => {
    const rows = regionBallot(replay(log).seats.red).rows;
    const northCentral = rows.find(row => row.text === 'NORTH CENTRAL')!;
    expect(northCentral.tone).toBe('dim');
  });

  it('carries the choosing baron′s colour on every row', () => {
    const rows = regionBallot(replay(log).seats.red).rows;
    expect(rows.every(row => row.chip === '#e02b1d')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/board/screens/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the screens**

Create `src/board/screens/play.ts`:

```ts
import { cityById, regionById } from '../../engine';
import { SEATS } from '../../state/events';
import type { GameState } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type Row, type ScreenDef } from '../types';

export function play(state: GameState): ScreenDef {
  const rows: Row[] = SEATS
    .map(id => state.seats[id])
    .filter(seat => seat.name !== null)
    .map(seat => {
      const latest = seat.stops[seat.stops.length - 1];
      return {
        label: seat.name!,
        status: latest ? regionById(latest.region).name : '',
        text: latest ? cityById(latest.city).name : '',
        amount: latest && latest.payout !== null
          ? latest.payout.toLocaleString('en-US')
          : '',
        showDollar: latest !== undefined && latest.payout !== null,
        right: latest && latest.payout === null ? 'Home' : '',
        chip: SEAT_COLORS[seat.id],
        tone: 'normal',
        action: { kind: 'act', seat: seat.id }
      };
    });

  return {
    title: 'Departures',
    sub: 'IN PLAY',
    back: 'home',
    cols: ['Baron', 'Region', 'Destination', 'Payout', ''],
    rows: padRows(rows)
  };
}
```

Create `src/board/screens/regionBallot.ts`:

```ts
import { REGIONS } from '../../engine';
import type { Seat } from '../../state/game';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type ScreenDef } from '../types';

/**
 * Shown when a roll named the region the baron is already in. There are
 * exactly seven regions and exactly seven rows, so the ballot fills the
 * board — which is where this whole design came from: the board keeps its
 * shape instead of opening a dialog over it.
 */
export function regionBallot(seat: Seat): ScreenDef {
  return {
    title: 'Departures',
    sub: `${(seat.name ?? seat.id).toUpperCase()} ROLLED ITS OWN REGION`,
    back: null,
    cols: ['Choose', 'State', 'Region', '', ''],
    rows: padRows(
      REGIONS.map(region => {
        const rolled = region.id === seat.awaiting;
        return {
          label: 'Region',
          status: rolled ? 'Rolled' : 'Choose',
          text: region.name.toUpperCase(),
          amount: '',
          showDollar: false,
          right: '',
          chip: SEAT_COLORS[seat.id],
          tone: rolled ? 'dim' : 'normal',
          action: { kind: 'act', seat: seat.id }
        };
      })
    )
  };
}
```

**Note:** the ballot's `act` action needs the chosen region, which `RowAction` does not carry. Resolve this in `App.tsx` by index — the page knows it is showing the ballot and `REGIONS[index]` is the choice — rather than widening `RowAction` for one screen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/board/screens/`
Expected: PASS.

- [ ] **Step 5: Route them and delete the old components**

Add `GamePage` to `src/App.tsx` and route `/pass-and-play/game` at it. The ballot takes precedence over the play board — the same precedence [DeparturesBoard.tsx:18](../../../src/game/DeparturesBoard.tsx#L18) already used:

```tsx
function GamePage() {
  const navigate = useNavigate();
  const { state, activate, chooseRegion } = useGame();

  // Only one seat can be owed a region at a time; it takes over the board.
  const awaiting = SEATS.map(id => state.seats[id]).find(seat => seat.awaiting !== null);
  const screen = awaiting ? regionBallot(awaiting) : play(state);

  return (
    <Board
      screen={screen}
      onBack={() => navigate('/')}
      onRowAct={(row, index) => {
        if (row.action?.kind !== 'act') return;
        // The ballot's choice is its row position: RowAction carries no
        // region, and widening it for one screen would cost every other
        // screen a field it never sets.
        if (awaiting) chooseRegion(row.action.seat, REGIONS[index].id);
        else activate(row.action.seat);
      }}
    />
  );
}
```

Import `SEATS` from `./state/events` and `REGIONS` from `../engine` (as `./engine` relative to `src/App.tsx`: `import { REGIONS } from '../engine';`). Then delete the old components:

```bash
git rm src/game/DeparturesBoard.tsx src/game/DeparturesBoard.test.tsx \
       src/game/DeparturesRow.tsx src/game/DeparturesRow.test.tsx \
       src/game/RegionBallot.tsx src/game/RegionBallot.test.tsx
```

`src/game/SplitFlap.tsx` and `src/game/tokens.ts` **stay** — `tokens.ts` is imported throughout `src/board/`, and `SplitFlap`'s `formatMoney` is still tested and used.

- [ ] **Step 5b: Migrate the parked legacy tests**

Create `src/App.test.tsx` fresh, carrying forward the three things `App.legacy.test.tsx` covered and nothing else. **Copy the scripted RNG queue and its entire explanatory comment verbatim from the legacy file** — those twelve values were confirmed by direct execution against `engine/roll.ts`, and re-deriving them by hand is how they get silently wrong.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { STORAGE_KEY } from './state/storage';

const at = (path: string, rng?: () => number) =>
  render(<MemoryRouter initialEntries={[path]}><App rng={rng} /></MemoryRouter>);

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('the app end to end', () => {
  it('appends exactly one event per roll under StrictMode', async () => {
    // The roll's side effect still lives in the handler, and StrictMode
    // still double-invokes updaters. Losing window.prompt did not retire
    // this hazard — it only retired the other half of it.
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/pass-and-play']}><App /></MemoryRouter>
      </StrictMode>
    );

    await userEvent.click(screen.getAllByRole('button', { name: /tap to join/i })[0]!);
    await userEvent.keyboard('PETE{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /start game/i }));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { events: unknown[] };
    expect(stored.events).toHaveLength(2);   // joined + started, never doubled
  });
});
```

Then port the scripted-dice ballot test and the two reset tests the same way — driving the board's rows rather than `window.prompt`/`window.confirm`, and reaching the discard path through the `confirm` screen rather than a `window.confirm` spy.

```bash
git rm src/App.legacy.test.tsx
```

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
! git ls-files | grep -q 'App.legacy.test.tsx'   # the parked file is gone
! grep -rn 'describe.skip' src/                  # nothing is still skipped
```

Expected: PASS with no references to the deleted components, and both guards silent. Those two lines are how the Task 5 parking cannot be quietly forgotten.

```bash
git add src/board/screens/play.ts src/board/screens/play.test.ts \
        src/board/screens/regionBallot.ts src/board/screens/regionBallot.test.ts src/App.tsx
git commit -m "feat(board): unify play and the region ballot; retire the old components"
```

---

### Task 11: The by-hand pass

Every one of Acquire's twenty-six Phase 5 findings came from a pass like this and none from its suite.

**Files:**
- Create: `docs/superpowers/specs/2026-08-11-board-as-lobby-by-hand-notes.md`

- [ ] **Step 1: Build and serve the real thing**

```bash
npm run build && npm run preview
```

Not the dev server — the built bundle, which is what a player gets.

- [ ] **Step 2: Walk every path, writing down what you see**

Record the result of each, pass or fail, with what you actually observed:

1. Home → `PASS AND PLAY` → the destination column flaps; the transition completes.
2. `PLAY ONLINE` is visibly dim and does nothing when tapped.
3. Name six barons. Each row takes its colour. The board does not change height.
4. Name a baron, then tap the row again and rename. Escape abandons; Enter commits; clicking away commits.
5. Clear a name to empty — the seat vacates and returns to `TAP TO JOIN`.
6. `START GAME` is dim at zero and one baron, live at two.
7. Start, roll several journeys, force a region ballot (roll until a baron rolls its own region). Seven regions fill the board.
8. Reload mid-game → the saved board, with the right leader, earnings and turn count.
9. `NEW GAME` → confirm → `KEEP PLAYING` returns without discarding. Then `YES, DISCARD` does discard.
10. **Tap a row while the flap is still spinning.** It should settle at once and act, not be ignored.
11. Turn on Reduce Motion (macOS: System Settings → Accessibility → Display). Every transition snaps with no spin.
12. **Measure the board's height on three different screens** with devtools. It must not change between them.

- [ ] **Step 3: Write the notes**

Create the notes file with one section per finding — what you did, what happened, what you expected. Include the measured heights from step 12 as actual numbers, not as "looks stable". A measurement you did not measure is worth nothing.

- [ ] **Step 4: Fix what the pass found, or record it**

Each finding either gets fixed with a test that fails first, or is written down explicitly as deferred with a reason. Nothing found gets silently dropped.

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-08-11-board-as-lobby-by-hand-notes.md
git commit -m "docs: by-hand pass notes for the board-as-lobby branch"
git push -u origin feat/board-as-lobby
gh pr create --title "The board as the lobby" --body "$(cat <<'BODY'
Every screen is now the same seven-row departures board. Choices live in the
destination column, and navigating is that column flapping over to the next
screen's choices — generalizing the pattern `RegionBallot` had already arrived
at on its own.

- Screens are data (`(state) => ScreenDef`), so the flap is a function of
  `(fromTexts, toTexts)` and each screen unit-tests without a DOM.
- The in-play board and the region ballot are unified onto the same row model;
  `DeparturesBoard`, `DeparturesRow` and `RegionBallot` are retired, with their
  column-budget test ported.
- An explicit begin gate lands as a `started` event, so phase is derived and the
  generic lobby's `lifecycle()` has something to map onto at the lift.
- `window.prompt` is gone, and with it the StrictMode double-fire hazard.
- Save records carry `savedAt`, with a v1 migration rather than a version bounce
  that would discard the very game the saved screen exists to offer back.

Online boards (`1d`/`1e`/`1f`) are designed but deliberately not built — they
wait for the lift. By-hand pass notes are in `docs/superpowers/specs/`.

Spec: `docs/superpowers/specs/2026-08-11-board-as-lobby-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: Review the whole branch, not only each task**

Both of Acquire's worst Phase 4 bugs spanned two tasks each and survived ten clean per-task reviews. Read `git diff main...feat/board-as-lobby` end to end before merging.

---

## Deferred — not in this plan

Recorded so they are not mistaken for oversights:

- **Boards `1d`, `1e`, `1f`** (online lobby, new room, join room) — built at the lift, with the five-vs-six-seat question, hosting, reclaim policy and rejection-code naming still open.
- **PWA** — Rail Baron has none, and nothing here builds one. See the spec's TBD.
- **Acquire's `verify:layout` CDP gate** — deliberately not ported; build one later if the by-hand pass shows something moving.
- **Two findings for Acquire** — `1f`'s optional name field would fix its `RoomRefused` dead end, and a fixed seat table would sidestep its duplicate-seat-id bug.
