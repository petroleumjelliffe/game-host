# Phase 1b — Component Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rebuild the game's component layer in React + Tailwind against static fixtures, with a catalog route driven by the golden games as the acceptance surface.

**Architecture:** New components live in `src/game/`, are pure and props-in, and read no game state. They are consumed only by the catalog route at `/catalog`. The existing components in `src/components/` are left untouched — they are on Phase 2's deletion list. Fixtures come from `replayGoldenGame` where a golden game covers the state, and from hand-authored view-only fixtures elsewhere.

**Tech Stack:** React 18, Tailwind 3, react-router 7, vitest + @testing-library/react (all already installed).

**Spec:** [docs/superpowers/specs/2026-08-03-phase-1-component-layer-design.md](../specs/2026-08-03-phase-1-component-layer-design.md) — Plan 1b section.

**Prerequisite:** Plan 1a must be complete. This plan depends on `npm run typecheck` existing and on `replayGoldenGame` being importable without pulling vitest into the bundle.

## Global Constraints

- **Gates:** `npx vitest run`, `npm run typecheck`, `npx vite build`, `npm run check:bundle`. All must pass before any commit. **Never run bare `tsc`.**
- **Locked design decisions.** These are inputs. Do not re-open them; a component that contradicts one is a defect:
  - **Palette:** Gobble red · Scrapple orange · WrecksonMobil amber · PaperfulPost lime · ZuckFace teal · Messla purple · CamCrooned pink · Cash green. Each is stroke `-500` / tint `-100` / text `-700` on Tailwind's default scale.
  - **Tickers:** `$G $S $PP $C $M $Z $W`, and `$$` for cash. They ship in `engine/startups.ts` — read them from there, never redeclare them.
  - **Reserved bands:** blue is hand + selection, true green is cash. No brand hue may collide with either.
  - **Tile-state vocabulary:** `empty`, `filled`, `hand`, `placed`, `blocked`, `chain`, `founded` — one vocabulary shared by board cells and inline tiles. Background = affiliation, border weight = attention, ring = placed this turn.
  - **Chain rendering:** members stay dark and wear an *overlapping* brand ring so neighbours merge into a group outline; the HQ is the single tinted cell showing the ticker. Not a computed polygon silhouette.
  - **Portrait stock cards with depth:** a share is a portrait certificate; a stack shows layered card edges behind the front card, capped at 2 extra layers, scaling with `|count|`.
  - **Two semantic separations:** money (`Cash`) vs a stock's value (`Price`); company (`Brand`, filled) vs a share of it (`StockCard`, outlined).
  - **Panel zone order:** `stepstack → active → staging → hand → players`.
- **Panel-height stability:** panel zones must not resize as content changes. Reveal via transition, never layout jump.
- **`prefers-reduced-motion`:** enter animations are skipped.
- **Viewports:** desktop and tablet, **≥768px**. Phone is out of scope. The full 9×12 grid always fits and nothing scrolls.
- **Do not touch `src/components/`, `src/pages/`, `src/Game.tsx`, `server/`, or `prototype/`.**
- **Do not import `engine/golden/runner`** from anything under `src/` — it pulls vitest into the bundle.
- **Zero `as any`.**
- **Do not push and do not open a PR.**

---

### Task 1: Brand tokens

**Files:**
- Create: `src/game/tokens.ts`
- Create: `src/game/tokens.test.ts`

**Interfaces:**
- Consumes: `AVAILABLE_STARTUPS`, `StartupConfig` from `engine/startups`
- Produces:
  - `type BrandKey = StartupId | 'Cash'`
  - `BRAND_CLASSES: Record<BrandKey, { stroke: string; tint: string; text: string; ring: string }>`
  - `tickerFor(id: BrandKey): string`

  Every later task styles brands through `BRAND_CLASSES`. Nothing else may hardcode a brand colour.

**Context you need:** The approved palette is already Tailwind's default scale — it was built by holding saturation and lightness fixed and varying only hue, which is exactly what Tailwind does. So `tailwind.config.js` needs **no custom colour scale**; it needs a mapping from startup id to hue.

**The footgun this task exists to contain:** Tailwind's JIT scans source for *literal* class strings. `` `bg-${hue}-100` `` produces no CSS at all, and the failure is silent — an unstyled element, not an error. Every class name here must be a complete literal.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { AVAILABLE_STARTUPS } from '../../engine/startups';
import { BRAND_CLASSES, tickerFor } from './tokens';

describe('brand tokens', () => {
  it('covers every startup the engine ships, plus Cash', () => {
    for (const s of AVAILABLE_STARTUPS) {
      expect(BRAND_CLASSES[s.id], `no brand classes for ${s.id}`).toBeDefined();
    }
    expect(BRAND_CLASSES.Cash).toBeDefined();
    expect(Object.keys(BRAND_CLASSES)).toHaveLength(AVAILABLE_STARTUPS.length + 1);
  });

  // Tailwind's JIT only emits classes it can see as literal strings in source.
  it('uses only complete literal class names — no interpolation survivors', () => {
    for (const [id, classes] of Object.entries(BRAND_CLASSES)) {
      for (const [slot, value] of Object.entries(classes)) {
        expect(value, `${id}.${slot}`).not.toMatch(/\$\{|undefined/);
        expect(value, `${id}.${slot}`).toMatch(/^[a-z-]+-(50|100|500|700)$/);
      }
    }
  });

  it('reads tickers from the engine rather than redeclaring them', () => {
    expect(tickerFor('Gobble')).toBe('$G');
    expect(tickerFor('PaperfulPost')).toBe('$PP');
    expect(tickerFor('Cash')).toBe('$$');
  });
});
```

- [x] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/game/tokens.test.ts`
Expected: FAIL — cannot resolve `./tokens`.

- [x] **Step 3: Write the module**

```ts
import type { StartupId } from '../../engine/gameTypes';
import { AVAILABLE_STARTUPS } from '../../engine/startups';

export type BrandKey = StartupId | 'Cash';

/**
 * The approved palette, expressed in Tailwind's default scale: stroke -500,
 * tint -100, text -700. Every value is a complete literal because Tailwind's
 * JIT scans source for literal class strings — an interpolated name emits no
 * CSS and fails silently as an unstyled element.
 *
 * Blue and true green are reserved (hand/selection and cash respectively), so
 * no brand may use them. Cash is registered as a brand so the liquidation
 * sell card can be a green stock card.
 */
export const BRAND_CLASSES: Record<BrandKey, {
  stroke: string; tint: string; text: string; ring: string;
}> = {
  Gobble:        { stroke: 'border-red-500',    tint: 'bg-red-100',    text: 'text-red-700',    ring: 'ring-red-500' },
  Scrapple:      { stroke: 'border-orange-500', tint: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-500' },
  WrecksonMobil: { stroke: 'border-amber-500',  tint: 'bg-amber-100',  text: 'text-amber-700',  ring: 'ring-amber-500' },
  PaperfulPost:  { stroke: 'border-lime-500',   tint: 'bg-lime-100',   text: 'text-lime-700',   ring: 'ring-lime-500' },
  ZuckFace:      { stroke: 'border-teal-500',   tint: 'bg-teal-100',   text: 'text-teal-700',   ring: 'ring-teal-500' },
  Messla:        { stroke: 'border-purple-500', tint: 'bg-purple-100', text: 'text-purple-700', ring: 'ring-purple-500' },
  CamCrooned:    { stroke: 'border-pink-500',   tint: 'bg-pink-100',   text: 'text-pink-700',   ring: 'ring-pink-500' },
  Cash:          { stroke: 'border-green-500',  tint: 'bg-green-100',  text: 'text-green-700',  ring: 'ring-green-500' },
};

const TICKERS = new Map<string, string>(AVAILABLE_STARTUPS.map((s) => [s.id, s.ticker]));

export function tickerFor(id: BrandKey): string {
  return id === 'Cash' ? '$$' : TICKERS.get(id) ?? id;
}
```

- [x] **Step 4: Verify**

Run: `npx vitest run src/game/tokens.test.ts` → Expected: 3 passed
Run: `npm run typecheck` → Expected: exit 0

- [x] **Step 5: Commit**

```bash
git add src/game
git commit -m "feat(game): brand tokens mapping the approved palette to Tailwind literals"
```

---

### Task 2: Money and value atoms — `Cash` and `Price`

**Files:**
- Create: `src/game/atoms/Cash.tsx`, `src/game/atoms/Price.tsx`
- Create: `src/game/atoms/Cash.test.tsx`, `src/game/atoms/Price.test.tsx`

**Interfaces:**
- Produces:
  - `<Cash amount={number} sign?: 'delta' />`
  - `<Price value={number} next?: number />`

**Context you need:** These are the first of the two locked semantic separations. **Money is green/red and signed; a stock's value is neutral, and only its *change* is tinted.** Do not merge them, do not let one call the other.

Reference behaviour from `prototype/components.js:18-35`:
- `Cash`: zero renders `$0` in a muted style. `sign: 'delta'` renders `+$1,200` / `−$1,200` (note: U+2212 MINUS SIGN, not a hyphen). Without `delta`, negative renders `−$1,200` and positive renders `$1,200` with no `+`.
- `Price`: bare is `$300`, neutral. With `next` differing from `value`: `$300 ↑ $600`, arrow and next value tinted green when rising, red when falling.

- [x] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Cash } from './Cash';

describe('Cash', () => {
  it('renders a plain positive amount with no plus sign', () => {
    render(<Cash amount={1200} />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
  });

  it('renders a delta with an explicit sign', () => {
    render(<Cash amount={1200} sign="delta" />);
    expect(screen.getByText('+$1,200')).toBeInTheDocument();
  });

  it('uses a minus sign, not a hyphen, for negatives', () => {
    render(<Cash amount={-1200} sign="delta" />);
    expect(screen.getByText('−$1,200')).toBeInTheDocument();
  });

  it('renders zero as a muted $0', () => {
    const { container } = render(<Cash amount={0} />);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toMatch(/gray/);
  });
});
```

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price } from './Price';

describe('Price', () => {
  it('renders a bare value with no arrow', () => {
    render(<Price value={300} />);
    expect(screen.getByText('$300')).toBeInTheDocument();
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
  });

  it('shows an up arrow and the next value when the price rises', () => {
    render(<Price value={300} next={600} />);
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('$600')).toBeInTheDocument();
  });

  it('shows a down arrow when the price falls', () => {
    render(<Price value={600} next={300} />);
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('omits the arrow when next equals value', () => {
    render(<Price value={300} next={300} />);
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run them to confirm they fail**

Run: `npx vitest run src/game/atoms/`
Expected: FAIL — modules do not resolve.

- [x] **Step 3: Implement both**

Use `toLocaleString('en-US')` for thousands separators, matching `engine/log.ts:26`. Tailwind classes: cash positive `text-green-700`, negative `text-red-700`, zero `text-gray-400`; price base `text-gray-600`, rising `text-green-700`, falling `text-red-700`. Use `tabular-nums` on both so columns of figures align — the final-scoring table depends on it.

- [x] **Step 4: Verify**

Run: `npx vitest run src/game/atoms/` → Expected: 8 passed
Run: `npm run typecheck` → Expected: exit 0

- [x] **Step 5: Commit**

```bash
git add src/game
git commit -m "feat(game): Cash and Price atoms, money and value kept distinct"
```

---

### Task 3: Company and share — `Brand`, `StockCard`, `StockStack`

**Files:**
- Create: `src/game/atoms/Brand.tsx`, `src/game/atoms/StockCard.tsx`, `src/game/atoms/StockStack.tsx`
- Create: matching `.test.tsx` for each

**Interfaces:**
- Consumes: `BRAND_CLASSES`, `tickerFor`, `BrandKey` from `src/game/tokens`; `Price` from Task 2
- Produces:
  - `<Brand id={BrandKey} mode?: 'static' | 'select' selected?: boolean disabled?: boolean size?: 'sm' onClick?: () => void />`
  - `<StockCard id={BrandKey} price?: number size?: 'sm' depth?: 0|1|2 badge?: string mode?: 'static'|'select'|'add'|'remove' disabled?: boolean onClick?: () => void />`
  - `<StockStack id={BrandKey} count={number} price?: number size?: 'sm' leaving?: boolean disabled?: boolean onClick?: () => void onRemove?: () => void />`
  - `stackDepth(count: number): 0 | 1 | 2`

**Context you need:** The second locked separation. **`Brand` is the company — filled. `StockCard` is one share of it — outlined, portrait, always priced.** `StockStack` is the *primary interactive share entity*: a `StockCard` plus a count rendered outside it. `onClick` on the body increments; `onRemove` renders a `×` that decrements and appears only when `count > 0`.

Depth thresholds from `prototype/components.js:70`: `|count| >= 6` → 2 layers, `>= 2` → 1, else 0. Depth layers are the *physical* cue that reinforces the numeric count; they are drawn as offset pseudo-element card edges down-and-right, capped at 2.

Cash is a special case throughout: it renders **landscape** like a dollar bill, shows `$$` with no per-share price, and its stack label is the total dollars (`price × count`) rather than `×N` (`prototype/components.js:79`).

- [x] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Brand } from './Brand';
import { StockCard } from './StockCard';
import { StockStack, stackDepth } from './StockStack';

describe('Brand — the company, filled', () => {
  it('renders the full company name, not the ticker', () => {
    render(<Brand id="PaperfulPost" />);
    expect(screen.getByText('PaperfulPost')).toBeInTheDocument();
    expect(screen.queryByText('$PP')).not.toBeInTheDocument();
  });

  it('carries the brand tint and stroke', () => {
    const { container } = render(<Brand id="Messla" />);
    expect(container.firstElementChild?.className).toMatch(/bg-purple-100/);
    expect(container.firstElementChild?.className).toMatch(/border-purple-500/);
  });

  it('is a button when selectable and not otherwise', () => {
    const { container: sel } = render(<Brand id="Messla" mode="select" />);
    expect(sel.querySelector('button')).toBeTruthy();
    const { container: stat } = render(<Brand id="Messla" />);
    expect(stat.querySelector('button')).toBeFalsy();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Brand id="Messla" mode="select" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('StockCard — one share, outlined', () => {
  it('renders the ticker and the price', () => {
    render(<StockCard id="PaperfulPost" price={300} />);
    expect(screen.getByText('$PP')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();
  });

  it('keeps the full company name reachable on hover', () => {
    const { container } = render(<StockCard id="PaperfulPost" price={300} />);
    expect(container.firstElementChild).toHaveAttribute('title', 'PaperfulPost');
  });

  // Money reads landscape, like a bill: $$ only, never a per-share price.
  it('renders Cash with no price at all', () => {
    render(<StockCard id="Cash" price={400} />);
    expect(screen.getByText('$$')).toBeInTheDocument();
    expect(screen.queryByText('$400')).not.toBeInTheDocument();
  });
});

describe('stackDepth — physical layers behind the front card', () => {
  it.each([
    [0, 0], [1, 0], [2, 1], [5, 1], [6, 2], [25, 2],
  ])('count %i yields %i extra layers', (count, expected) => {
    expect(stackDepth(count)).toBe(expected);
  });

  // A leaving stack layers like its positive twin — magnitude, not sign.
  it.each([[-2, 1], [-6, 2]])('count %i yields %i extra layers', (count, expected) => {
    expect(stackDepth(count)).toBe(expected);
  });
});

describe('StockStack — the primary interactive share entity', () => {
  it('labels a share stack with a multiplier', () => {
    render(<StockStack id="Messla" count={3} price={300} />);
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  // Cash is money: the label under the bills is total dollars, not ×N.
  it('labels a cash stack with the total dollars', () => {
    render(<StockStack id="Cash" count={3} price={400} />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.queryByText('×3')).not.toBeInTheDocument();
  });

  it('shows a leaving stack as a negative count', () => {
    render(<StockStack id="ZuckFace" count={3} price={400} leaving />);
    expect(screen.getByText('−3')).toBeInTheDocument();
  });

  it('renders the remove control only when there is something to remove', () => {
    const { container: withStock } = render(
      <StockStack id="Messla" count={2} price={300} onRemove={() => {}} />,
    );
    expect(withStock.querySelector('[aria-label="Remove one"]')).toBeTruthy();

    const { container: empty } = render(
      <StockStack id="Messla" count={0} price={300} onRemove={() => {}} />,
    );
    expect(empty.querySelector('[aria-label="Remove one"]')).toBeFalsy();

    const { container: noHandler } = render(<StockStack id="Messla" count={2} price={300} />);
    expect(noHandler.querySelector('[aria-label="Remove one"]')).toBeFalsy();
  });

  it('increments on the body and decrements on the remove control', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<StockStack id="Messla" count={2} price={300} onClick={onClick} onRemove={onRemove} />);

    fireEvent.click(screen.getByText('×2'));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Remove one'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('mutes a zero count', () => {
    const { container } = render(<StockStack id="Messla" count={0} price={300} />);
    expect(container.querySelector('[data-qty]')?.className).toMatch(/gray/);
  });
});
```

`fireEvent` is used rather than `@testing-library/user-event`, which is **not** a dependency of this repo. Do not add it — these are click assertions, and `fireEvent` ships with `@testing-library/react`, which is already installed.

- [x] **Step 2: Run them to confirm they fail**

Run: `npx vitest run src/game/atoms/`

- [x] **Step 3: Implement**

Portrait card: fixed width around `w-14`, `flex-col`, ticker bold on top, price small at the bottom. The `sm` variant is proportionally smaller — the buy row, found groups, liquidation lanes and player holdings all need it, and it is the reason the prototype introduced the variant at all.

For depth, use two absolutely-positioned pseudo-elements or sibling `<span>`s offset down-right, behind the card, sharing its border colour. `::before` paints first and therefore furthest back (`prototype/components.css:227`).

- [x] **Step 4: Verify**

Run: `npx vitest run src/game/atoms/` → Expected: all pass
Run: `npm run typecheck` → Expected: exit 0

- [x] **Step 5: Commit**

```bash
git add src/game
git commit -m "feat(game): Brand, StockCard and StockStack — company vs share, with depth"
```

---

### Task 4: The tile vocabulary

**Files:**
- Create: `src/game/atoms/Tile.tsx`, `src/game/atoms/Tile.test.tsx`

**Interfaces:**
- Consumes: `BRAND_CLASSES`, `tickerFor` from `src/game/tokens`; `Coord` from `engine/gameHelpers`
- Produces: `<Tile coord={Coord} state={TileState} brand?: BrandKey onClick?: () => void />` and `type TileState = 'empty' | 'filled' | 'hand' | 'placed' | 'blocked' | 'chain' | 'founded'`

**Context you need:** One vocabulary, shared by board cells and inline tiles in the log. Background carries affiliation (neutral empty · dark placed · brand chain), border weight carries attention (1px settled · 2px actionable), and a ring marks the tile placed *this* turn — the one that is still undoable.

Mapping, all Tailwind defaults:
- `empty` — `bg-gray-100 border-gray-300 text-gray-500`
- `filled` / `placed` — `bg-gray-700 border-gray-700 text-gray-50 font-bold`
- `hand` — `bg-blue-100 border-2 border-blue-500 text-blue-700 font-bold`, hover `bg-blue-200`
- `blocked` — a dimmed hand tile with a neutral 🚫 overlay and `cursor-not-allowed`; **no hue from the brand palette**, because a blocked tile is not about any company
- `chain` — dark like `placed`, plus a 3px brand ring; neighbouring rings overlap into a group outline
- `founded` — the HQ: brand tint fill, brand text, heavier border, and it shows the **ticker** in place of the coord

`founded` is the only state where the label is not the coordinate.

- [x] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile } from './Tile';

describe('Tile', () => {
  it.each(['empty', 'filled', 'hand', 'placed', 'blocked', 'chain'] as const)(
    'renders the coordinate in state %s',
    (state) => {
      render(<Tile coord="E6" state={state} brand="Messla" />);
      expect(screen.getByText('E6')).toBeInTheDocument();
    },
  );

  it('shows the ticker instead of the coordinate when founded', () => {
    render(<Tile coord="E6" state="founded" brand="Messla" />);
    expect(screen.getByText('$M')).toBeInTheDocument();
    expect(screen.queryByText('E6')).not.toBeInTheDocument();
  });

  it('always exposes the coordinate as a title, even when the label is a ticker', () => {
    const { container } = render(<Tile coord="E6" state="founded" brand="Messla" />);
    expect(container.firstElementChild).toHaveAttribute('title', 'E6');
  });

  it('marks a blocked tile as not interactive and borrows no brand hue', () => {
    const { container } = render(<Tile coord="D4" state="blocked" />);
    const el = container.firstElementChild!;
    expect(el.className).toMatch(/cursor-not-allowed/);
    expect(el.className).not.toMatch(/red|orange|amber|lime|teal|purple|pink/);
  });

  it('renders a hand tile as a button and a settled tile as not', () => {
    const { container: hand } = render(<Tile coord="E6" state="hand" onClick={() => {}} />);
    expect(hand.querySelector('button')).toBeTruthy();
    const { container: chain } = render(<Tile coord="E6" state="chain" brand="Messla" />);
    expect(chain.querySelector('button')).toBeFalsy();
  });
});
```

- [x] **Step 2: Run it to confirm it fails, implement, verify**

Run: `npx vitest run src/game/atoms/Tile.test.tsx` → FAIL, then implement, then PASS.

- [x] **Step 3: Commit**

```bash
git add src/game
git commit -m "feat(game): the shared tile-state vocabulary"
```

---

### Task 5: The board, at parity

**Files:**
- Create: `src/game/Board.tsx`, `src/game/Board.test.tsx`

**Interfaces:**
- Consumes: `Tile` from Task 4; `BRAND_CLASSES` from Task 1; `Coord`, `ROWS`, `COLS` from `engine/gameHelpers`; `TileCell` from `engine/gameTypes`
- Produces: `<Board board={Record<Coord, TileCell>} hand?: Coord[] placed?: Coord | null owners?: Record<Coord, string> blocked?: Coord[] hqTiles?: Coord[] onCellClick?: (c: Coord) => void />`

**Context you need — the five parity defects.** `src/components/Board.tsx` diverges from the prototype in ways that are easy to miss. This task closes all five, and each gets a test:

1. Coordinates render as `{r}-{c}`; they must be `A1`.
2. The last-placed tile is badged with the player's **full name**; it must be their **initial**.
3. No chain outlines.
4. No blocked/dead-tile treatment.
5. No hover-reveal of coordinates on founded tiles.

**Layout:** a CSS grid, `22px` row-header column then 12 equal columns, `aspect-ratio: 13/10`, `container-type: inline-size` on the grid so cell labels can size in `cqi` and scale with the board (`prototype/components.css:45-52`). This is what makes one board work from tablet to desktop without breakpoint-specific font sizes — do not replace it with fixed `text-` sizes.

- [x] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Board } from './Board';
import { createEmptyBoard } from '../../engine/gameInit';
import type { Coord } from '../../engine/gameHelpers';

const boardWith = (cells: Record<string, { placed: boolean; startupId?: string }>) => ({
  ...createEmptyBoard(),
  ...cells,
});

describe('Board', () => {
  it('labels cells A1-style, never r-c', () => {
    render(<Board board={createEmptyBoard()} />);
    expect(screen.getByTitle('A1')).toBeInTheDocument();
    expect(screen.queryByText('0-0')).not.toBeInTheDocument();
    expect(screen.queryByText('1-1')).not.toBeInTheDocument();
  });

  it('badges the last-placed tile with an initial, not a full name', () => {
    render(<Board board={boardWith({ E5: { placed: true } })} owners={{ E5: 'A' } as Record<Coord, string>} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });

  it('gives chain members a brand ring so neighbours read as one outline', () => {
    const { container } = render(
      <Board board={boardWith({
        E3: { placed: true, startupId: 'Messla' },
        E4: { placed: true, startupId: 'Messla' },
      })} />,
    );
    const rings = container.querySelectorAll('[class*="ring-purple-500"]');
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });

  it('marks blocked hand tiles and makes them unclickable', () => {
    const { container } = render(
      <Board board={createEmptyBoard()} hand={['C6'] as Coord[]} blocked={['C6'] as Coord[]} />,
    );
    expect(screen.getByTitle('C6').className).toMatch(/cursor-not-allowed/);
    expect(container.querySelector('[title="C6"][disabled]')).toBeTruthy();
  });

  it('shows the ticker on an HQ tile and keeps the coordinate reachable on hover', () => {
    render(<Board board={boardWith({ E3: { placed: true, startupId: 'Messla' } })} hqTiles={['E3'] as Coord[]} />);
    const hq = screen.getByTitle('E3');
    expect(hq.textContent).toContain('$M');
    expect(hq).toHaveAttribute('title', 'E3');
  });

  it('renders 108 cells plus headers', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    expect(container.querySelectorAll('[title]').length).toBe(108);
  });
});
```

- [x] **Step 2: Run, implement, verify**

Run: `npx vitest run src/game/Board.test.tsx` → FAIL, then implement, then PASS.

Only `hand` tiles that are not `blocked`, plus the currently-`placed` tile, are clickable. Everything else gets `tabIndex={-1}` so keyboard traversal does not walk 108 dead cells.

- [x] **Step 3: Commit**

```bash
git add src/game
git commit -m "feat(game): the board, with all five parity defects closed"
```

---

### Task 6: The panel shell and its stable zones

**Files:**
- Create: `src/game/panel/Panel.tsx`, `src/game/panel/StagingZone.tsx`, `src/game/panel/HandZone.tsx`, `src/game/panel/PlayersStrip.tsx`
- Create: `src/game/panel/Panel.test.tsx`, `src/game/panel/StagingZone.test.tsx`

**Interfaces:**
- Consumes: `StockStack` from Task 3; `Cash` from Task 2
- Produces:
  - `<Panel stepstack? active? staging? hand? players? />` — five `ReactNode` slots rendered in that fixed order
  - `<StagingZone label={string} shares?: ReactNode cashDelta?: number action?: ReactNode />`
  - `<HandZone name={string} portfolio={Record<string, number>} cash={number} />`
  - `<PlayersStrip players={{ id: string; emoji: string; name: string; cash: number; active?: boolean }[]} />`

**Context you need:** This is where the **panel-height stability** constraint is enforced, and it is the one Phase 1 regression that would be genuinely annoying to find in Phase 2 — a panel that jumps as content changes is unpleasant in a way no test catches unless you write it deliberately.

Three reserved-space rules, all from `prototype/components.css:113-120`:
- The staging pile has a `min-height` sized to a populated row, so empty ↔ filled does not shift.
- The `Net` total is **always rendered**, showing a muted `$0` when the delta is zero.
- The action slot is **always rendered** with a `min-height`, so button ↔ no-button does not shift.

The panel is `flex-col` with `height: 100%`; the step stack takes the remaining space at the top and the other zones pin to the bottom.

- [x] **Step 1: Write the failing stability test**

This is the load-bearing test of this task.

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StagingZone } from './StagingZone';
import { StockStack } from '../atoms/StockStack';

/** jsdom reports 0 for real layout, so assert the reservations structurally. */
function classesOf(el: Element | null | undefined): string {
  return el?.className ?? '';
}

describe('StagingZone height stability', () => {
  it('reserves the pile height whether empty or filled', () => {
    const { container: empty } = render(<StagingZone label="Staging" />);
    const { container: full } = render(
      <StagingZone label="Staging" shares={<StockStack id="Messla" count={2} price={300} size="sm" />} />,
    );
    const pileOf = (c: HTMLElement) => c.querySelector('[data-zone="pile"]');
    expect(classesOf(pileOf(empty))).toMatch(/min-h-/);
    expect(classesOf(pileOf(empty))).toBe(classesOf(pileOf(full)));
  });

  it('always renders the Net total, muted at zero', () => {
    const { container } = render(<StagingZone label="Staging" cashDelta={0} />);
    const net = container.querySelector('[data-zone="net"]');
    expect(net).toBeTruthy();
    expect(net?.textContent).toContain('$0');
  });

  it('always reserves the action slot, with or without a button', () => {
    const { container: without } = render(<StagingZone label="Staging" />);
    const { container: withBtn } = render(<StagingZone label="Staging" action={<button>Go</button>} />);
    const slotOf = (c: HTMLElement) => c.querySelector('[data-zone="action"]');
    expect(slotOf(without)).toBeTruthy();
    expect(classesOf(slotOf(without))).toMatch(/min-h-/);
    expect(classesOf(slotOf(without))).toBe(classesOf(slotOf(withBtn)));
  });
});
```

The `data-zone` attributes exist for this test. Keep them — they are cheaper than the alternative of asserting on Tailwind class soup, and they document which elements carry the reservation.

- [x] **Step 2: Run, implement all four components, verify**

Also add a `Panel` test asserting the five slots render in the order `stepstack → active → staging → hand → players` regardless of the order the props are passed in.

- [x] **Step 3: Commit**

```bash
git add src/game
git commit -m "feat(game): the panel shell with height-stable zones"
```

---

### Task 7: The step stack

**Files:**
- Create: `src/game/panel/StepEntry.tsx`, `src/game/panel/ActiveStep.tsx`, `src/game/panel/StepStack.tsx`
- Create: `src/game/panel/StepStack.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond styling tokens
- Produces:
  - `<StepEntry phase={string} detail={ReactNode} stepId?: number onUndo?: (stepId: number) => void />`
  - `<ActiveStep label={string} body={ReactNode} button?: ReactNode />`
  - `<StepStack entries={{ stepId: number; phase: string; detail: ReactNode }[]} onUndo?: (stepId: number) => void />`

**Context you need:** The step stack is the centrepiece of the new UI. Each completed step is a rewind point, and `stepId` is its identity — the same `stepId` that Plan 1a's `rewindTo(store, stepId)` takes. The undo affordance renders only when `onUndo` is supplied, which is how the catalog shows both the undoable and the read-only appearance.

`StepStack` is also the flex spacer that pins the zones below it to the bottom of the panel.

Nothing here dispatches. `onUndo` is called with the `stepId` and that is all — Phase 2 wires it.

- [x] **Step 1: Write the failing tests**

Cover: entries render in order; the undo control appears once per entry when `onUndo` is given and not at all when it is not; clicking undo calls back with that entry's `stepId`; `ActiveStep` renders its button slot only when supplied.

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): the step stack, with undo keyed by stepId"
```

---

### Task 8: Merger composites

**Files:**
- Create: `src/game/merger/PayoutLines.tsx`, `src/game/merger/LiqQueue.tsx`, `src/game/merger/LiqActions.tsx`
- Create: `src/game/merger/PayoutLines.test.tsx`, `src/game/merger/LiqActions.test.tsx`

**Interfaces:**
- Consumes: `Cash` (Task 2), `StockCard`, `StockStack` (Task 3), `tickerFor` (Task 1)
- Produces:
  - `<PayoutLines bonuses={{ playerName: string; emoji?: string; qty?: number; type: 'majority' | 'minority' | 'both'; amount: number }[]} />`
  - `<LiqQueue holders={{ emoji?: string; name: string; qty: number; status: 'done' | 'current' | 'pending' }[]} />`
  - `<LiqActions absorbedId={BrandKey} survivorId={BrandKey} unitPrice={number} canSell={boolean} canTrade={boolean} onSell?: () => void onTrade?: () => void />`

**Context you need:** `qty` on a payout line is the number of shares of the *absorbed* chain the player held — it is the reason they earned majority or minority, so it belongs on the line. An empty bonus list renders "No shareholders to pay." rather than nothing.

`type: 'both'` is the sole-holder case, majority and minority combined into one figure. It must render as one line reading **"Majority + minority"** — not the bare word "Both", which is what the old `MergerPayoutModal` does and which reads as a UI bug.

`LiqActions` is two buttons: sell one share for cash, and trade two absorbed shares for one survivor share. The 2-for-1 ratio is `TRADE_RATIO` in `engine/startups.ts` — import it, do not hardcode `2`.

- [x] **Step 1: Write the failing tests**

Cover: an empty bonus list renders the fallback copy; a `both` entry renders "Majority + minority"; the qty appears on each line; `LiqActions` disables the sell button when `canSell` is false and the trade button when `canTrade` is false; the trade button shows a stack of `TRADE_RATIO` absorbed shares.

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): merger payout lines, liquidation queue and exchange actions"
```

---

### Task 9: The founding screen

**Files:**
- Create: `src/game/FoundGroups.tsx`, `src/game/FoundGroups.test.tsx`

**Interfaces:**
- Consumes: `Brand` (Task 3), `Price` (Task 2); `getSharePriceAtSize`, `AVAILABLE_STARTUPS` from `engine/startups`
- Produces: `<FoundGroups available={StartupId[]} taken={StartupId[]} foundSize={number} onSelect?: (id: StartupId) => void />`

**Context you need:** Foundable brands are bucketed under their **starting price** — a function of tier at the founding size — with groups in ascending price order, each headed by the price. At the two-tile start that is `$200 / $300 / $400`.

This is built in the prototype already (`prototype/index.html:504-506`, `prototype/states.html:142-156`); the roadmap's claim that it is "still a flat row" is wrong. It is a port, not a design task.

**Derive the prices — do not hardcode them.** Call `getSharePriceAtSize(tier, foundSize)` per available brand and bucket by the result. Two Phase 0 task briefs shipped wrong share prices by quoting numbers instead of deriving them; the `$200/$300/$400` above is orientation, not a specification.

Brands already on the board are rendered `disabled`, not hidden — a player learning the game should see the full field.

- [x] **Step 1: Write the failing test**

Cover: groups appear in ascending price order; every available brand appears exactly once; taken brands render disabled and do not fire `onSelect`; the group headers show prices derived from `getSharePriceAtSize`, asserted by calling that function in the test rather than by literal.

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): the founding screen, grouped by starting price"
```

---

### Task 10: Final scoring

**Files:**
- Create: `src/game/FinalScoring.tsx`, `src/game/FinalScoring.test.tsx`

**Interfaces:**
- Consumes: `Cash`, `Price` (Task 2), `Brand` (Task 3), `tickerFor` (Task 1)
- Produces: `<FinalScoring reason={string} players={...} chains={...} holdings={...} bonuses={...} />`, prop shapes matching the `finalScore(state)` report from `engine/endGame.ts`

**Context you need:** The terminal game-over overlay: a scrim over the game, one column per player, sorted by final total so the winner reads leftmost. Each chain contributes a **stock** row and a **bonus** row. Bonus marks are `M` majority · `m` minority · `Mm` sole holder — they differ only in case, so weight and size carry the distinction visually while the `title` carries the word.

Reference: `prototype/components.js:242-308`.

**Two deliberate changes from the prototype:**
1. The prototype takes `bonuses` as authored props. Here the shape must match what `finalScore(state)` actually returns, since the catalog feeds it real engine output.
2. The prototype's overlay is terminal — no dismiss, no "New game". Correct for a catalog entry, and it stays terminal here. The roadmap notes a real app needs a route back to the lobby; **Phase 2 adds that, not this task.**

Sorting and totals are derived here (`stock + bonus + cash`), matching `scoreColumns` at `prototype/components.js:257-269`. Bonus *resolution* is a rules concern and arrives already computed.

- [x] **Step 1: Write the failing test**

Cover: columns sort by total descending; a player holding nothing in a chain shows the em-dash placeholder, not `×0`; a `both` bonus renders the `Mm` mark with a title naming the sole-holder case; the banner names the winner and their total; totals equal `stock + bonus + cash`.

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): the terminal final-scoring overlay"
```

---

### Task 11: The pass-and-play reveal overlay

**Files:**
- Create: `src/game/RevealOverlay.tsx`, `src/game/RevealOverlay.test.tsx`

**Interfaces:**
- Produces: `<RevealOverlay playerName={string} emoji?: string onReveal={() => void} />`

**Context you need:** Built in the prototype at `prototype/index.html:606-613` and styled at `prototype/components.css:336-344`, but absent from `src/pages/PassAndPlayPage.tsx`. It covers the board between turns on a shared device so the next player does not see the previous player's hand, and clears on a single "I'm ⟨name⟩ — Reveal" button.

This is the one place the prototype's "show the same thing to all players" principle is deliberately broken, and the roadmap records that the principle does not transfer past pass-and-play.

- [x] **Step 1: Write the failing test**

Cover: the player's name appears in the button; `onReveal` fires on click; the overlay renders a scrim that covers its container.

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): the pass-and-play reveal overlay"
```

---

### Task 12: Catalog fixtures from the golden games

**Files:**
- Create: `src/game/catalog/fixtures.ts`, `src/game/catalog/fixtures.test.ts`

**Interfaces:**
- Consumes: `replayGoldenGame`, `ALL_GOLDEN_GAMES` from `engine/golden` (Plan 1a Task 4)
- Produces:
  - `goldenState(gameId: string, stepIndex: number): GameState`
  - `type CatalogFixture = { source: 'golden'; gameId: string; stepIndex: number; state: GameState } | { source: 'authored'; note: string }`

**Context you need:** Fixtures come from the engine wherever a golden game covers the state. This is not a formality: `prototype/states.html:116` prices Gobble at `$1000` for a 41-tile chain, and the correct figure from `getSharePriceAtSize` is `$1200`. That same error reached two separate Phase 0 task briefs. Deriving from the engine makes the whole class of error impossible.

**The known limit, to be handled rather than discovered:** the golden games were authored as *rules* tests, not visual ones. Some catalog states have no golden game behind them and never will — empty staging, the atom vocabulary, a zero-count stack. Those are `source: 'authored'`, and the discriminated union exists so the catalog can label them visibly. Nobody should be able to mistake an authored fixture for engine-verified truth.

If you find a state that *should* have engine backing but does not, report it — that is a coverage finding for the golden catalogue, not a licence to hand-author.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { goldenState } from './fixtures';
import { getSharePriceAtSize } from '../../../engine/startups';

describe('catalog fixtures', () => {
  it('resolves a state by game id and step index', () => {
    const s = goldenState('G9', 1);
    expect(s.stage).toBe('buy');
  });

  it('throws on an unknown game rather than returning undefined', () => {
    expect(() => goldenState('G99', 0)).toThrow(/G99/);
  });

  it('throws on an out-of-range step index', () => {
    expect(() => goldenState('G9', 99)).toThrow(/step/);
  });

  // The error states.html shipped: Gobble at 41 tiles is $1200, not $1000.
  it('carries engine-derived prices, not authored ones', () => {
    const s = goldenState('G9', 1);
    const gobble = s.startups.Gobble!;
    expect(getSharePriceAtSize(gobble.tier, 41)).toBe(1200);
  });
});
```

- [x] **Step 2: Run, implement, verify. Commit.**

```bash
git add src/game
git commit -m "feat(game): catalog fixtures derived from the golden games"
```

---

### Task 13: The catalog route

**Files:**
- Create: `src/game/catalog/CatalogPage.tsx`, `src/game/catalog/sections.tsx`
- Create: `src/game/catalog/CatalogPage.test.tsx`
- Modify: `src/App.tsx` (add the route)

**Interfaces:**
- Consumes: every component from Tasks 2–12
- Produces: the `/catalog` route

**Context you need:** This is the acceptance surface for the whole plan — the React equivalent of `prototype/states.html`, and what makes "does it look right" verifiable independently of "does it play right".

Keep `states.html`'s organisation: **sections in turn-step sequence, each showing all of that step's states**, each state captioned with a stable label. That organisation is good and should survive the rebuild. Sections, matching `prototype/states.html:200-271`:

1. Place a tile · 2. Found a startup · 3. Merger — pick a victor · 4. Merger payout · 5. Liquidate · 6. Buy shares · then Staging (spans steps), Tiles (vocabulary), Card stacks (vocabulary), and Final scoring.

Every state's caption names its source: the golden game and step for `source: 'golden'`, and a visible "authored" marker otherwise.

**Route it lazily.** `React.lazy` + a dynamic `import()` so the golden games and fixtures stay out of the main bundle:

```tsx
const CatalogPage = React.lazy(() => import('./game/catalog/CatalogPage'));
// …
<Route path="/catalog" element={<React.Suspense fallback={null}><CatalogPage /></React.Suspense>} />
```

**The catalog is not an assertion surface.** No snapshot tests — snapshots churn constantly during a from-scratch rebuild, and churning snapshots get blind-approved.

- [x] **Step 1: Write the failing test**

Cover: the page renders every section heading; each golden-sourced state's caption names its game id; no section renders zero states; `render` completes without throwing for every state in the catalog (a smoke pass over the whole inventory).

- [x] **Step 2: Run, implement, verify**

Run: `npx vitest run src/game/` → all pass
Run: `npm run typecheck` → exit 0
Run: `npm run check:bundle` → exit 0 — this is the check that the lazy route kept vitest and the golden data out of the main chunk

- [x] **Step 3: Commit**

```bash
git add src/game src/App.tsx
git commit -m "feat(game): the component catalog route"
```

---

### Task 14: Responsive and motion pass

**Files:**
- Modify: `src/game/Board.tsx`, `src/game/panel/Panel.tsx`, and any component whose layout breaks below 1024px
- Create: `src/game/layout.test.tsx`
- Modify: `src/styles/index.css` (the reduced-motion rule and any keyframes)

**Interfaces:**
- Consumes: everything built so far
- Produces: no new API — this task changes classes, not signatures

**Context you need:** Target **≥768px**: desktop and tablet. Phone is explicitly out of scope. Tablet is the natural pass-and-play device — a shared screen passed around a table — so it is a first-class target, not a degraded desktop.

The hard law across the whole range: **the full 9×12 grid always fits and nothing scrolls** (`prototype/README.md:93`).

The side panel is `320px` fixed at desktop. Below roughly 1024px it needs to narrow rather than squeeze the board out of its aspect ratio; the board sizes from its `aspect-ratio` and the `cqi` text scaling from Task 5 should carry the rest without per-breakpoint font sizes. If you find yourself adding breakpoint-specific `text-` classes to board cells, the container-query setup in Task 5 is wrong — fix that instead.

`prefers-reduced-motion` skips enter animations, matching the existing lab (`prototype/states.html:34`).

- [x] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Board } from './Board';
import { createEmptyBoard } from '../../engine/gameInit';

describe('layout', () => {
  it('keeps the board on a fixed aspect ratio so it never needs to scroll', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    const grid = container.querySelector('[data-board="grid"]')!;
    expect(grid.className).toMatch(/aspect-\[13\/10\]/);
    expect(grid.className).toMatch(/\[container-type:inline-size\]/);
  });

  it('never puts an overflow-x on the game surface', () => {
    const { container } = render(<Board board={createEmptyBoard()} />);
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/);
  });
});
```

- [x] **Step 2: Add the reduced-motion rule**

In `src/styles/index.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .step-enter,
  .active-step-enter {
    animation: none;
  }
}
```

- [x] **Step 3: Check it by hand at both widths**

Run: `npm run dev`, open `/catalog`, and check at 768px and 1440px. Confirm the board never scrolls and the panel zones do not jump when you switch a section's states. **Report what you saw at each width** — this is the one check in this plan that no test performs.

- [x] **Step 4: Verify and commit**

Run: `npx vitest run` → all pass
Run: `npm run typecheck` → exit 0
Run: `npx vite build` → succeeds

```bash
git add src
git commit -m "feat(game): responsive pass for tablet and desktop, reduced-motion respected"
```

---

## Done when

- Every component in the inventory renders in the catalog at `/catalog`.
- The catalog's fixtures come from the golden games wherever one covers the state, with authored fixtures visibly marked as such.
- All five board-parity defects are closed, each pinned by a test.
- Panel-height stability is enforced by test, not by eye.
- The catalog holds at 768px and 1440px with no scrolling and no layout jumps.
- `vitest`, `typecheck`, `vite build` and `check:bundle` all pass.

## What this plan does NOT do

- **No game wiring.** No component reads or dispatches game state. Phase 2.
- **No phone viewports.**
- **No deleting the old components.** `BuyModal`, `MergerLiquidation`, `SurvivorSelectionModal`, `FoundStartupModal`, `DrawModal`, `TilePlacementConfirmModal` and `Game.tsx` stay until Phase 2 deletes them.
- **No fixing `src/Game.tsx:158` or `src/components/MergerLiquidation.tsx:17`.** Both are on that list. `npm run dev` still lands on a broken game screen throughout this plan; `/catalog` is where the new work is visible.
- **No lobby or waiting-room work.** `WaitingRoom.tsx` is deferred to its own spec, before Phase 5.
- **No declare-end affordance.** Deferred to its own spec, needed before Phase 2.
