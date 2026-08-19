# Rail Baron engine and roller — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2013 jQuery Rail Baron app with a React one that rolls each baron's next destination onto a split-flap departures board.

**Architecture:** A pure `engine/` holds the rules — roll tables, cities, payouts — with no React and no DOM. Game state is derived by replaying an event log rather than mutated, so undo is truncation and a server-authoritative rewrite later needs no redesign. Components under `src/game/` are props-in and read only from replayed state.

**Tech Stack:** Vite, React 19, TypeScript, Vitest. No other runtime dependencies.

## Global Constraints

- **Node 26.4**, already installed. ES modules throughout; no CommonJS.
- **`engine/` imports nothing from `src/`, and nothing from React or the DOM.** It runs in the Vitest `engine` project, which has no jsdom — a stray `window.` there fails immediately.
- **A payout of `0` is a real value, not "missing".** Minneapolis↔St. Paul and San Francisco↔Oakland both pay exactly $0 and are the only such pairs in the matrix. Never write `if (payout)` or `payout || …`. "No payout yet" is `null`, which is a different thing and is what a home city carries.
- **`localStorage` keys are prefixed `railbaron:`.** This game and Acquire share the GitHub Pages origin.
- **Game data is copied verbatim** from `js/railbaronv2.js`, never retyped from the board. Each data task ends with a test that proves the copy landed intact.
- **Regions in `cities` are relabelled during the copy:** the source labels groups 4, 5 and 6 all as `"South Central"`; they are Plains, Northwest and Southwest.
- Target is **tablet landscape**. One layout, no responsive breakpoints.

---

## File structure

| Path | Responsibility |
|---|---|
| `engine/types.ts` | Shared types: `CityId`, `RegionId`, `Rng`, `Stop`, `RollOutcome`. |
| `engine/regions.ts` | The seven regions and their roll-table column. |
| `engine/cities.ts` | The 67 cities, their region, and lookups. |
| `engine/payouts.ts` | The triangular matrix and `payoutBetween`. |
| `engine/rollTable.ts` | The 22×8 `CODES` table and the dice. |
| `engine/roll.ts` | Destination selection — the only place the rules live. |
| `engine/index.ts` | Public surface for `src/`. |
| `src/state/events.ts` | Event union and `SeatId`. |
| `src/state/game.ts` | `replay`, `undo`, and the state shape. |
| `src/state/storage.ts` | Namespaced, versioned load/save. |
| `src/state/useGame.ts` | React binding: log in state, persisted on change. |
| `src/game/tokens.ts` | Colours and metrics from the departures concept. |
| `src/game/SplitFlap.tsx` | One field of flap tiles. |
| `src/game/DeparturesRow.tsx` | One baron's row, in every state it can be in. |
| `src/game/RegionBallot.tsx` | The seven-row region takeover. |
| `src/game/DeparturesBoard.tsx` | The board: chrome, header, six rows or the ballot. |
| `src/App.tsx`, `src/main.tsx` | Shell and mount. |

**One deviation from the spec's component list:** it named a separate `SignupRow`. A row's join state shares all its chrome — chip, name column, column widths — with its playing state, so this plan gives `DeparturesRow` a `mode` instead of duplicating that chrome in a second component.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts`, `engine/smoke.test.ts`
- Modify: `.gitignore` (create if absent)

**Interfaces:**
- Consumes: nothing
- Produces: `npm test`, `npm run dev`, `npm run build`, `npm run typecheck`. Two Vitest projects named `engine` (node) and `app` (jsdom).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "railbaron",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["engine", "src", "vite.config.ts"]
}
```

`noUncheckedIndexedAccess` is deliberate: this codebase indexes tables by dice roll and by city id constantly, and it forces those lookups to be checked.

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'engine', environment: 'node', include: ['engine/**/*.test.ts'] }
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts']
        }
      }
    ]
  }
});
```

The split is load-bearing: `engine` runs without jsdom, so anything in `engine/` that touches `window` or `localStorage` fails there rather than silently working. Do not add a root-level `setupFiles` — it merges into both projects and disarms that.

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <title>Rail Baron</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@300;400;700&family=DM+Mono:wght@400;500&display=swap" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/App.tsx` and `src/main.tsx`**

```tsx
// src/App.tsx
export default function App() {
  return <div>Rail Baron</div>;
}
```

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules
dist
*.local
```

- [ ] **Step 8: Write a smoke test that proves the engine project has no DOM**

```ts
// engine/smoke.test.ts
import { describe, expect, it } from 'vitest';

describe('the engine test project', () => {
  it('runs without a DOM, so browser globals cannot leak into engine code', () => {
    expect(typeof globalThis.window).toBe('undefined');
    expect(typeof globalThis.localStorage).toBe('undefined');
  });
});
```

- [ ] **Step 9: Install and run**

Run: `npm install && npm test`
Expected: PASS, one test in the `engine` project. If `window` is defined, the project split is misconfigured — fix `vite.config.ts` before continuing.

- [ ] **Step 10: Verify the dev server and typecheck**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src .gitignore engine
git commit -m "Scaffold Vite + React + TypeScript with split test projects"
```

---

### Task 2: Regions and cities

**Files:**
- Create: `engine/types.ts`, `engine/regions.ts`, `engine/cities.ts`, `engine/cities.test.ts`
- Read for reference: `js/railbaronv2.js:187-304`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type CityId = number` (0–66), `type RegionId = 'NE'|'SE'|'NC'|'SC'|'PL'|'NW'|'SW'`
  - `REGIONS: readonly Region[]` where `Region = { id: RegionId; name: string; column: number }`, `column` is 1–7
  - `CITIES: readonly City[]` where `City = { id: CityId; name: string; region: RegionId }`
  - `cityById(id: CityId): City`, `citiesIn(region: RegionId): readonly City[]`, `regionById(id: RegionId): Region`

- [ ] **Step 1: Write `engine/types.ts`**

```ts
export type CityId = number;
export type RegionId = 'NE' | 'SE' | 'NC' | 'SC' | 'PL' | 'NW' | 'SW';

export interface Region {
  id: RegionId;
  name: string;
  /** Column into the roll table that yields a city within this region. 1–7. */
  column: number;
}

export interface City {
  id: CityId;
  name: string;
  region: RegionId;
}

/** Returns a float in [0, 1). Injected so tests can script the dice. */
export type Rng = () => number;
```

- [ ] **Step 2: Write `engine/regions.ts`**

```ts
import type { Region, RegionId } from './types';

export const REGIONS: readonly Region[] = [
  { id: 'NE', name: 'Northeast', column: 1 },
  { id: 'SE', name: 'Southeast', column: 2 },
  { id: 'NC', name: 'North Central', column: 3 },
  { id: 'SC', name: 'South Central', column: 4 },
  { id: 'PL', name: 'Plains', column: 5 },
  { id: 'NW', name: 'Northwest', column: 6 },
  { id: 'SW', name: 'Southwest', column: 7 }
];

const BY_ID = new Map(REGIONS.map(r => [r.id, r]));

export function regionById(id: RegionId): Region {
  const region = BY_ID.get(id);
  if (!region) throw new Error(`unknown region: ${id}`);
  return region;
}
```

- [ ] **Step 3: Write the failing test for the city table**

```ts
// engine/cities.test.ts
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, citiesIn } from './cities';
import { REGIONS } from './regions';

describe('the city table', () => {
  it('holds 67 cities with contiguous ids from 0', () => {
    expect(CITIES).toHaveLength(67);
    expect(CITIES.map(c => c.id)).toEqual([...Array(67).keys()]);
  });

  it('groups them into the regions the board uses', () => {
    const counts = Object.fromEntries(
      REGIONS.map(r => [r.id, citiesIn(r.id).length])
    );
    expect(counts).toEqual({ NE: 9, SE: 11, NC: 8, SC: 11, PL: 9, NW: 9, SW: 10 });
  });

  it('keeps ids in region order, which the roll table depends on', () => {
    // Column c of the roll table indexes into citiesIn(region c) by position,
    // so a region's cities must be a contiguous, ascending run of ids.
    for (const region of REGIONS) {
      const ids = citiesIn(region.id).map(c => c.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(ids[ids.length - 1]! - ids[0]!).toBe(ids.length - 1);
    }
  });

  it('places the cities the old app mislabelled into their real regions', () => {
    // js/railbaronv2.js labels groups 4, 5 and 6 all "South Central".
    expect(cityById(43).name).toBe('Minneapolis');
    expect(cityById(43).region).toBe('PL');
    expect(cityById(55).name).toBe('Seattle');
    expect(cityById(55).region).toBe('NW');
    expect(cityById(59).name).toBe('Los Angeles');
    expect(cityById(59).region).toBe('SW');
  });

  it('has no duplicate names', () => {
    expect(new Set(CITIES.map(c => c.name)).size).toBe(67);
  });
});
```

- [ ] **Step 4: Run the test to watch it fail**

Run: `npx vitest run engine/cities.test.ts`
Expected: FAIL — cannot resolve `./cities`.

- [ ] **Step 5: Write `engine/cities.ts`**

Copy the names and ids verbatim from `js/railbaronv2.js:199-304`, in the same order, assigning the region each group truly belongs to.

```ts
import type { City, CityId, RegionId } from './types';

const GROUPS: ReadonlyArray<readonly [RegionId, readonly string[]]> = [
  ['NE', ['Albany', 'Baltimore', 'Boston', 'Buffalo', 'New York',
          'Philadelphia', 'Pittsburgh', 'Portland, ME', 'Washington DC']],
  ['SE', ['Atlanta', 'Charleston', 'Charlotte', 'Chattanooga', 'Jacksonville',
          'Knoxville', 'Miami', 'Mobile', 'Norfolk', 'Richmond', 'Tampa']],
  ['NC', ['Chicago', 'Cincinnati', 'Cleveland', 'Columbus', 'Detroit',
          'Indianapolis', 'Milwaukee', 'St. Louis']],
  ['SC', ['Birmingham', 'Dallas', 'Fort Worth', 'Houston', 'Little Rock',
          'Louisville', 'Memphis', 'Nashville', 'New Orleans', 'San Antonio',
          'Shreveport']],
  ['PL', ['Denver', 'Des Moines', 'Fargo', 'Kansas City', 'Minneapolis',
          'Oklahoma City', 'Omaha', 'Pueblo', 'St. Paul']],
  ['NW', ['Billings', 'Butte', 'Casper', 'Pocatello', 'Portland, OR',
          'Rapid City', 'Salt Lake City', 'Seattle', 'Spokane']],
  ['SW', ['El Paso', 'Las Vegas', 'Los Angeles', 'Oakland', 'Phoenix', 'Reno',
          'Sacramento', 'San Diego', 'San Francisco', 'Tucumcari']]
];

export const CITIES: readonly City[] = GROUPS.flatMap(([region, names]) =>
  names.map(name => ({ name, region }))
).map((city, id) => ({ ...city, id }));

const BY_ID = new Map(CITIES.map(c => [c.id, c]));
const BY_REGION = new Map<RegionId, City[]>();
for (const city of CITIES) {
  const list = BY_REGION.get(city.region) ?? [];
  list.push(city);
  BY_REGION.set(city.region, list);
}

export function cityById(id: CityId): City {
  const city = BY_ID.get(id);
  if (!city) throw new Error(`unknown city id: ${id}`);
  return city;
}

export function citiesIn(region: RegionId): readonly City[] {
  return BY_REGION.get(region) ?? [];
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run engine/cities.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add engine/types.ts engine/regions.ts engine/cities.ts engine/cities.test.ts
git commit -m "Port the region and city tables, fixing three mislabelled regions"
```

---

### Task 3: The payout matrix

**Files:**
- Create: `engine/payouts.ts`, `engine/payouts.test.ts`
- Read for reference: `js/railbaronv2.js:308-376`

**Interfaces:**
- Consumes: `CityId` from `engine/types`, `CITIES` from `engine/cities`
- Produces: `payoutBetween(a: CityId, b: CityId): number` — dollars, symmetric, `0` is a legitimate answer

- [ ] **Step 1: Write the failing test**

```ts
// engine/payouts.test.ts
import { describe, expect, it } from 'vitest';
import { PAYOUT_TABLE, payoutBetween } from './payouts';
import { CITIES } from './cities';

const idOf = (name: string) => {
  const city = CITIES.find(c => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

describe('the payout table', () => {
  it('is triangular — row n holds n entries, so every pair is covered', () => {
    expect(PAYOUT_TABLE).toHaveLength(67);
    PAYOUT_TABLE.forEach((row, n) => expect(row).toHaveLength(n));
  });

  it('answers the same whichever way round the journey is asked', () => {
    for (const a of [0, 17, 33, 52, 66]) {
      for (const b of [4, 21, 40, 59, 66]) {
        if (a === b) continue;
        expect(payoutBetween(a, b)).toBe(payoutBetween(b, a));
      }
    }
  });

  it('pays nothing between the two twin pairs, and only those', () => {
    // These are the board's only zero-paying journeys. They are legal
    // destinations you can be sent to; the trip is simply worth nothing.
    const zeros: string[] = [];
    for (let hi = 1; hi < PAYOUT_TABLE.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        if (payoutBetween(hi, lo) === 0) {
          zeros.push([CITIES[lo]!.name, CITIES[hi]!.name].sort().join(' / '));
        }
      }
    }
    expect(zeros.sort()).toEqual([
      'Minneapolis / St. Paul',
      'Oakland / San Francisco'
    ]);
  });

  it('still charges for the pairs that only look like twins', () => {
    expect(payoutBetween(idOf('Dallas'), idOf('Fort Worth'))).toBe(500);
    expect(payoutBetween(idOf('New York'), idOf('Philadelphia'))).toBe(1000);
  });

  it('reports dollars, not thousands', () => {
    expect(payoutBetween(idOf('Albany'), idOf('Baltimore'))).toBe(3500);
  });

  it('refuses a journey from a city to itself', () => {
    expect(() => payoutBetween(12, 12)).toThrow(/same city/);
  });

  it('never returns a negative or fractional dollar amount', () => {
    for (let hi = 1; hi < PAYOUT_TABLE.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        const paid = payoutBetween(hi, lo);
        expect(paid).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(paid)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run engine/payouts.test.ts`
Expected: FAIL — cannot resolve `./payouts`.

- [ ] **Step 3: Write `engine/payouts.ts`**

Copy the array verbatim from `js/railbaronv2.js:308-376`, including the empty first row. Do not retype the numbers by hand — copy the text and reformat. The test above is what proves the copy landed.

```ts
import type { CityId } from './types';

/**
 * Triangular, indexed [higher city id][lower city id], in thousands of
 * dollars. Row n holds n entries; row 0 is empty because city 0 has no lower
 * neighbour. Copied verbatim from js/railbaronv2.js.
 */
export const PAYOUT_TABLE: readonly (readonly number[])[] = [
  [],
  [3.5],
  [2, 4]
  // … remaining rows copied from the source file
];

export function payoutBetween(a: CityId, b: CityId): number {
  if (a === b) throw new Error(`no journey between a city and the same city: ${a}`);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const row = PAYOUT_TABLE[hi];
  if (!row) throw new Error(`no payout row for city ${hi}`);
  const thousands = row[lo];
  if (thousands === undefined) throw new Error(`no payout for ${lo} → ${hi}`);
  return thousands * 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run engine/payouts.test.ts`
Expected: PASS, 7 tests. A failure in the triangular test means rows were dropped or merged during the copy; a failure in the zero-pairs test means a value was mistyped.

- [ ] **Step 5: Prove the zero-pairs test can fail**

Temporarily change the Minneapolis↔St. Paul entry from `0` to `1`, run the test, and confirm it reports one zero pair instead of two. Restore the `0`.

Run: `npx vitest run engine/payouts.test.ts`
Expected after the edit: FAIL. This test is the only thing standing between a mistyped digit and a wrong payment; a version of it that cannot fail is worse than none.

- [ ] **Step 6: Commit**

```bash
git add engine/payouts.ts engine/payouts.test.ts
git commit -m "Port the payout matrix with tests that prove the transcription"
```

---

### Task 4: The roll table and the dice

**Files:**
- Create: `engine/rollTable.ts`, `engine/rollTable.test.ts`
- Read for reference: `js/railbaronv2.js:160-185` (the `codes` table) and `:379-386` (`roll`)

**Interfaces:**
- Consumes: `Rng`, `RegionId` from `engine/types`; `REGIONS`, `regionById`; `CITIES`, `citiesIn`
- Produces:
  - `CODES: readonly (readonly number[])[]` — 22 rows of 8
  - `rollRow(rng: Rng): number` — 0–21
  - `rollRegion(rng: Rng): RegionId`
  - `rollCityIn(region: RegionId, rng: Rng): CityId`

- [ ] **Step 1: Write the failing test**

```ts
// engine/rollTable.test.ts
import { describe, expect, it } from 'vitest';
import { CODES, rollCityIn, rollRegion, rollRow } from './rollTable';
import { REGIONS } from './regions';
import { citiesIn } from './cities';
import type { Rng } from './types';

/** Feeds scripted values to the dice, then throws rather than looping. */
const scripted = (...values: number[]): Rng => {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('rng called more times than scripted');
    return values[i++]!;
  };
};

describe('the roll table', () => {
  it('is 22 rows of 8', () => {
    expect(CODES).toHaveLength(22);
    CODES.forEach(row => expect(row).toHaveLength(8));
  });

  it('only ever names a region that exists', () => {
    for (const row of CODES) expect(row[0]).toBeLessThan(REGIONS.length);
  });

  it('only ever names a city that exists in the region of its column', () => {
    // This is what catches a mis-copied row: column c must index into the
    // c-th region's city list, and those lists are different lengths.
    REGIONS.forEach((region, position) => {
      const size = citiesIn(region.id).length;
      for (const row of CODES) {
        expect(row[position + 1]).toBeLessThan(size);
      }
    });
  });
});

describe('rolling', () => {
  it('reads one d6, one d6, and a d2 that shifts by eleven', () => {
    expect(rollRow(scripted(0, 0, 0))).toBe(0);
    expect(rollRow(scripted(0.99, 0.99, 0))).toBe(10);
    expect(rollRow(scripted(0, 0, 0.99))).toBe(11);
    expect(rollRow(scripted(0.99, 0.99, 0.99))).toBe(21);
  });

  it('never lands outside the table', () => {
    const rng: Rng = () => Math.random();
    for (let i = 0; i < 5000; i++) {
      const row = rollRow(rng);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(CODES.length);
    }
  });

  it('turns a row into the region that row names', () => {
    const expected = REGIONS[CODES[0]![0]!]!.id;
    expect(rollRegion(scripted(0, 0, 0))).toBe(expected);
  });

  it('picks a city from within the region it was asked for', () => {
    for (const region of REGIONS) {
      const ids = citiesIn(region.id).map(c => c.id);
      expect(ids).toContain(rollCityIn(region.id, scripted(0, 0, 0)));
    }
  });

  it('can reach every city in a region across the whole table', () => {
    // A column that never yields some city would make that city unreachable.
    for (const region of REGIONS) {
      const reachable = new Set(CODES.map(row => row[region.column]));
      expect(reachable.size).toBe(citiesIn(region.id).length);
    }
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run engine/rollTable.test.ts`
Expected: FAIL — cannot resolve `./rollTable`.

- [ ] **Step 3: Write `engine/rollTable.ts`**

Copy `CODES` verbatim from `js/railbaronv2.js:160-185`.

```ts
import { citiesIn } from './cities';
import { REGIONS, regionById } from './regions';
import type { CityId, RegionId, Rng } from './types';

/**
 * Indexed [row][column]. Column 0 names a region by its position in REGIONS;
 * columns 1–7 name a city by its position within that region's list. Rows
 * 0–10 are the odd half of the die, 11–21 the even. Copied verbatim from
 * js/railbaronv2.js.
 */
export const CODES: readonly (readonly number[])[] = [
  [6, 4, 8, 1, 10, 5, 8, 2]
  // … remaining 21 rows copied from the source file
];

/** One d6 plus one d6 plus a d2 that shifts the whole result by eleven. */
export function rollRow(rng: Rng): number {
  return Math.floor(rng() * 6) + Math.floor(rng() * 6) + Math.floor(rng() * 2) * 11;
}

export function rollRegion(rng: Rng): RegionId {
  const row = CODES[rollRow(rng)];
  if (!row) throw new Error('roll landed outside the table');
  const region = REGIONS[row[0]!];
  if (!region) throw new Error(`row names a region that does not exist: ${row[0]}`);
  return region.id;
}

export function rollCityIn(region: RegionId, rng: Rng): CityId {
  const row = CODES[rollRow(rng)];
  if (!row) throw new Error('roll landed outside the table');
  const position = row[regionById(region).column]!;
  const city = citiesIn(region)[position];
  if (!city) throw new Error(`no city at position ${position} of ${region}`);
  return city.id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run engine/rollTable.test.ts`
Expected: PASS, 7 tests. If "can reach every city" fails, a row was mis-copied — the failure names the region, which narrows it to one column.

- [ ] **Step 5: Commit**

```bash
git add engine/rollTable.ts engine/rollTable.test.ts
git commit -m "Port the roll table with a test that proves every city is reachable"
```

---

### Task 5: Destination selection

**Files:**
- Create: `engine/roll.ts`, `engine/roll.test.ts`, `engine/index.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `type RollOutcome = { kind: 'home'; city; region } | { kind: 'arrived'; city; region; payout: number } | { kind: 'chooseRegion'; rolled: RegionId }`
  - `rollDestination(from: CityId | null, rng: Rng): RollOutcome`
  - `destinationInRegion(from: CityId, region: RegionId, rng: Rng): { city: CityId; region: RegionId; payout: number }`
  - `engine/index.ts` re-exports the public surface

- [ ] **Step 1: Write the failing test**

```ts
// engine/roll.test.ts
import { describe, expect, it } from 'vitest';
import { destinationInRegion, rollDestination } from './roll';
import { CITIES, cityById } from './cities';
import type { Rng } from './types';

const scripted = (...values: number[]): Rng => {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('rng called more times than scripted');
    return values[i++]!;
  };
};
const idOf = (name: string) => CITIES.find(c => c.name === name)!.id;

describe('rolling a destination', () => {
  it('gives a baron with no history a home city and no payout', () => {
    const outcome = rollDestination(null, scripted(0, 0, 0, 0, 0, 0));
    expect(outcome.kind).toBe('home');
    if (outcome.kind !== 'home') throw new Error('unreachable');
    expect(cityById(outcome.city).region).toBe(outcome.region);
  });

  it('asks the player to choose when the roll repeats their own region', () => {
    // Sitting in a Northeast city and rolling Northeast must not pick a city.
    const seattle = idOf('Seattle');
    const rolled = rollDestination(seattle, scripted(0, 0, 0));
    if (rolled.kind === 'chooseRegion') {
      expect(rolled.rolled).toBe(cityById(seattle).region);
    } else {
      expect(rolled.region).not.toBe(cityById(seattle).region);
    }
  });

  it('pays for a journey to a different region', () => {
    let found = false;
    for (let seed = 0; seed < 200 && !found; seed++) {
      const outcome = rollDestination(0, () => (seed * 7919 % 1000) / 1000);
      if (outcome.kind !== 'arrived') continue;
      found = true;
      expect(outcome.payout).toBeGreaterThan(0);
      expect(Number.isInteger(outcome.payout)).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('reports a zero payout as zero rather than as nothing', () => {
    // Minneapolis to St. Paul is legal and pays $0. `payout` must be the
    // number 0, never null or undefined, or the board will show a blank.
    const result = destinationInRegion(idOf('Minneapolis'), 'PL', scripted(0, 0, 0));
    expect(result.payout).not.toBeNull();
    expect(typeof result.payout).toBe('number');
  });

  it('never sends a baron to the city they are already in', () => {
    const from = idOf('Chicago');
    for (let i = 0; i < 500; i++) {
      const outcome = rollDestination(from, () => Math.random());
      if (outcome.kind === 'arrived') expect(outcome.city).not.toBe(from);
    }
  });
});

describe('choosing a region after a repeat roll', () => {
  it('picks a city in the chosen region and prices the journey', () => {
    const from = idOf('Boston');
    const result = destinationInRegion(from, 'SW', scripted(0, 0, 0));
    expect(cityById(result.city).region).toBe('SW');
    expect(result.region).toBe('SW');
    expect(result.payout).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run engine/roll.test.ts`
Expected: FAIL — cannot resolve `./roll`.

- [ ] **Step 3: Write `engine/roll.ts`**

```ts
import { cityById } from './cities';
import { payoutBetween } from './payouts';
import { rollCityIn, rollRegion } from './rollTable';
import type { CityId, RegionId, Rng } from './types';

export type RollOutcome =
  | { kind: 'home'; city: CityId; region: RegionId }
  | { kind: 'arrived'; city: CityId; region: RegionId; payout: number }
  | { kind: 'chooseRegion'; rolled: RegionId };

export interface Arrival {
  city: CityId;
  region: RegionId;
  payout: number;
}

/**
 * A baron's first roll is their home town and pays nothing. After that, a
 * roll that names the region they are already in hands the choice to the
 * player instead of picking a city.
 */
export function rollDestination(from: CityId | null, rng: Rng): RollOutcome {
  const region = rollRegion(rng);

  if (from === null) {
    return { kind: 'home', city: rollCityIn(region, rng), region };
  }

  if (region === cityById(from).region) {
    return { kind: 'chooseRegion', rolled: region };
  }

  const { city, payout } = destinationInRegion(from, region, rng);
  return { kind: 'arrived', city, region, payout };
}

/** Used both for a normal roll and after the player picks a region. */
export function destinationInRegion(from: CityId, region: RegionId, rng: Rng): Arrival {
  let city = rollCityIn(region, rng);
  // Only reachable when the player chose their own region: the table can name
  // the city they are standing in, and a journey to yourself has no price.
  let guard = 0;
  while (city === from) {
    if (++guard > 100) throw new Error(`could not leave ${from} within ${region}`);
    city = rollCityIn(region, rng);
  }
  return { city, region, payout: payoutBetween(from, city) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run engine/roll.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `engine/index.ts`**

```ts
export { CITIES, cityById, citiesIn } from './cities';
export { REGIONS, regionById } from './regions';
export { payoutBetween } from './payouts';
export { destinationInRegion, rollDestination } from './roll';
export type { Arrival, RollOutcome } from './roll';
export type { City, CityId, Region, RegionId, Rng } from './types';
```

- [ ] **Step 6: Run the whole engine suite and typecheck**

Run: `npx vitest run --project engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/roll.ts engine/roll.test.ts engine/index.ts
git commit -m "Add destination selection with the same-region choice branch"
```

---

### Task 6: The event log

**Files:**
- Create: `src/state/events.ts`, `src/state/game.ts`, `src/state/game.test.ts`

**Interfaces:**
- Consumes: `CityId`, `RegionId` from `engine`
- Produces:
  - `type SeatId = 'red'|'green'|'blue'|'yellow'|'black'|'white'`, `SEATS: readonly SeatId[]`
  - `type GameEvent` — `{ type: 'joined'; seat; name }`, `{ type: 'regionRequested'; seat; rolled }`, `{ type: 'arrived'; seat; city; region; payout: number | null }`
  - `interface Stop { city: CityId; region: RegionId; payout: number | null }`
  - `interface Seat { id: SeatId; name: string | null; stops: readonly Stop[]; awaiting: RegionId | null }`
  - `interface GameState { seats: Record<SeatId, Seat> }`
  - `replay(events: readonly GameEvent[]): GameState`, `undo(events: readonly GameEvent[]): GameEvent[]`

- [ ] **Step 1: Write `src/state/events.ts`**

```ts
import type { CityId, RegionId } from '../../engine';

export type SeatId = 'red' | 'green' | 'blue' | 'yellow' | 'black' | 'white';

export const SEATS: readonly SeatId[] = ['red', 'green', 'blue', 'yellow', 'black', 'white'];

/**
 * Events record what happened, not what was rolled. Replaying the log gives
 * the same game back without re-rolling any dice, which is what lets undo be
 * truncation and what a server-authoritative version would need.
 *
 * `payout: null` means "no payout applies" — a home town. A journey worth
 * nothing is the number 0, and the two are not interchangeable.
 */
export type GameEvent =
  | { type: 'joined'; seat: SeatId; name: string }
  | { type: 'regionRequested'; seat: SeatId; rolled: RegionId }
  | { type: 'arrived'; seat: SeatId; city: CityId; region: RegionId; payout: number | null };
```

- [ ] **Step 2: Write the failing test**

```ts
// src/state/game.test.ts
import { describe, expect, it } from 'vitest';
import { replay, undo } from './game';
import type { GameEvent } from './events';

const join = (seat: 'red' | 'blue', name: string): GameEvent =>
  ({ type: 'joined', seat, name });

describe('replaying the log', () => {
  it('starts with six empty seats', () => {
    const state = replay([]);
    expect(Object.keys(state.seats)).toHaveLength(6);
    expect(state.seats.red.name).toBeNull();
    expect(state.seats.red.stops).toEqual([]);
    expect(state.seats.red.awaiting).toBeNull();
  });

  it('seats a player by name', () => {
    expect(replay([join('red', 'Pete')]).seats.red.name).toBe('Pete');
  });

  it('records a home town with no payout', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    expect(state.seats.red.stops).toEqual([{ city: 20, region: 'NC', payout: null }]);
  });

  it('keeps a zero payout as zero rather than losing it', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
    ]);
    expect(state.seats.red.stops[1]!.payout).toBe(0);
  });

  it('holds a seat waiting once a region has been requested', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' }
    ]);
    expect(state.seats.red.awaiting).toBe('NC');
  });

  it('clears the wait when the baron arrives somewhere', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' },
      { type: 'arrived', seat: 'red', city: 59, region: 'SW', payout: 22000 }
    ]);
    expect(state.seats.red.awaiting).toBeNull();
    expect(state.seats.red.stops).toHaveLength(2);
  });

  it('keeps seats independent', () => {
    const state = replay([join('red', 'Pete'), join('blue', 'Sam')]);
    expect(state.seats.red.name).toBe('Pete');
    expect(state.seats.blue.name).toBe('Sam');
    expect(state.seats.green.name).toBeNull();
  });

  it('is a pure fold — replaying twice gives the same answer', () => {
    const log: GameEvent[] = [
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ];
    expect(replay(log)).toEqual(replay(log));
  });
});

describe('undo', () => {
  it('drops the last event', () => {
    const log: GameEvent[] = [
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ];
    expect(undo(log)).toHaveLength(1);
    expect(replay(undo(log)).seats.red.stops).toEqual([]);
  });

  it('does nothing to an empty log', () => {
    expect(undo([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to watch it fail**

Run: `npx vitest run src/state/game.test.ts`
Expected: FAIL — cannot resolve `./game`.

- [ ] **Step 4: Write `src/state/game.ts`**

```ts
import type { CityId, RegionId } from '../../engine';
import { SEATS, type GameEvent, type SeatId } from './events';

export interface Stop {
  city: CityId;
  region: RegionId;
  /** null for a home town. 0 is a real, zero-paying journey. */
  payout: number | null;
}

export interface Seat {
  id: SeatId;
  name: string | null;
  stops: readonly Stop[];
  awaiting: RegionId | null;
}

export interface GameState {
  seats: Record<SeatId, Seat>;
}

function emptyState(): GameState {
  const seats = {} as Record<SeatId, Seat>;
  for (const id of SEATS) seats[id] = { id, name: null, stops: [], awaiting: null };
  return { seats };
}

export function replay(events: readonly GameEvent[]): GameState {
  const state = emptyState();
  for (const event of events) {
    const seat = state.seats[event.seat];
    switch (event.type) {
      case 'joined':
        state.seats[event.seat] = { ...seat, name: event.name };
        break;
      case 'regionRequested':
        state.seats[event.seat] = { ...seat, awaiting: event.rolled };
        break;
      case 'arrived':
        state.seats[event.seat] = {
          ...seat,
          awaiting: null,
          stops: [...seat.stops,
                  { city: event.city, region: event.region, payout: event.payout }]
        };
        break;
    }
  }
  return state;
}

export function undo(events: readonly GameEvent[]): GameEvent[] {
  return events.slice(0, -1);
}

export const currentCity = (seat: Seat): CityId | null =>
  seat.stops.length ? seat.stops[seat.stops.length - 1]!.city : null;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/state/game.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/state/events.ts src/state/game.ts src/state/game.test.ts
git commit -m "Add the event log and its replay"
```

---

### Task 7: Persistence

**Files:**
- Create: `src/state/storage.ts`, `src/state/storage.test.ts`

**Interfaces:**
- Consumes: `GameEvent` from `./events`
- Produces: `loadLog(): GameEvent[]`, `saveLog(events: readonly GameEvent[]): void`, `clearLog(): void`, `STORAGE_KEY: string`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/storage.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, clearLog, loadLog, saveLog } from './storage';
import type { GameEvent } from './events';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'Pete' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
];

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('namespaces its key, because this origin is shared with another game', () => {
    expect(STORAGE_KEY.startsWith('railbaron:')).toBe(true);
  });

  it('round-trips a log, zero payouts included', () => {
    saveLog(log);
    const back = loadLog();
    expect(back).toEqual(log);
    expect(back[2]!.type === 'arrived' && back[2]!.payout).toBe(0);
  });

  it('returns an empty log when nothing has been saved', () => {
    expect(loadLog()).toEqual([]);
  });

  it('returns an empty log rather than throwing on damaged data', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadLog()).toEqual([]);
  });

  it('ignores a log written by a future version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, events: log }));
    expect(loadLog()).toEqual([]);
  });

  it('leaves other games\' keys alone when clearing', () => {
    localStorage.setItem('acquire:something', 'keep me');
    saveLog(log);
    clearLog();
    expect(loadLog()).toEqual([]);
    expect(localStorage.getItem('acquire:something')).toBe('keep me');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/state/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Write `src/state/storage.ts`**

```ts
import type { GameEvent } from './events';

/** Prefixed: this game shares the GitHub Pages origin with Acquire. */
export const STORAGE_KEY = 'railbaron:log:v1';

const VERSION = 1;

export function saveLog(events: readonly GameEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, events }));
  } catch {
    // A full or disabled store loses the save, not the game in progress.
  }
}

export function loadLog(): GameEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { version, events } = parsed as { version?: number; events?: unknown };
    if (version !== VERSION || !Array.isArray(events)) return [];
    return events as GameEvent[];
  } catch {
    return [];
  }
}

export function clearLog(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/state/storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/state/storage.ts src/state/storage.test.ts
git commit -m "Persist the event log under a namespaced key"
```

---

### Task 8: Design tokens and the split-flap field

**Files:**
- Create: `src/game/tokens.ts`, `src/game/SplitFlap.tsx`, `src/game/SplitFlap.test.tsx`, `src/index.css`
- Modify: `src/main.tsx` (import the stylesheet)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `TOKENS` — colours and metrics
  - `SEAT_COLORS: Record<SeatId, string>`
  - `formatMoney(payout: number | null): string`
  - `<SplitFlap value={string} width={number} align?='left'|'right' tone?='pale'|'amber' />`

- [ ] **Step 1: Write the failing test**

```tsx
// src/game/SplitFlap.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SplitFlap, formatMoney } from './SplitFlap';

const tiles = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-flap]')].map(el => el.getAttribute('data-flap'));

describe('a split-flap field', () => {
  it('shows one tile per character position, always the same number', () => {
    const { container } = render(<SplitFlap value="DENVER" width={14} />);
    expect(tiles(container)).toHaveLength(14);
  });

  it('reads out as plain text for anything not looking at pixels', () => {
    render(<SplitFlap value="Denver" width={14} />);
    expect(screen.getByText('DENVER')).toBeInTheDocument();
  });

  it('uppercases, because the flaps have no lower case', () => {
    const { container } = render(<SplitFlap value="Salt Lake City" width={14} />);
    expect(tiles(container).join('').trimEnd()).toBe('SALT LAKE CITY');
  });

  it('pads short values and truncates long ones rather than reflowing', () => {
    const { container } = render(<SplitFlap value="RENO" width={6} />);
    expect(tiles(container)).toEqual(['R', 'E', 'N', 'O', ' ', ' ']);

    const long = render(<SplitFlap value="ABCDEFGH" width={4} />);
    expect(tiles(long.container)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('right-aligns when asked, for money', () => {
    const { container } = render(<SplitFlap value="500" width={6} align="right" />);
    expect(tiles(container)).toEqual([' ', ' ', ' ', '5', '0', '0']);
  });
});

describe('formatting money', () => {
  it('shows a zero payout as $0, not as blank', () => {
    // Minneapolis to St. Paul really does pay nothing.
    expect(formatMoney(0)).toBe('$0');
  });

  it('groups thousands', () => {
    expect(formatMoney(21500)).toBe('$21,500');
  });

  it('says HOME when there is no payout at all', () => {
    expect(formatMoney(null)).toBe('HOME');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/game/SplitFlap.test.tsx`
Expected: FAIL — cannot resolve `./SplitFlap`.

- [ ] **Step 3: Write `src/game/tokens.ts`**

Values taken from concept 1a in the Rail Baron Game Board Design project.

```ts
import type { SeatId } from '../state/events';

export const TOKENS = {
  board: '#0a0a0a',
  bezel: '#1b1b1b',
  header: '#151515',
  rule: '#1c1c1c',
  amber: '#f5c451',
  pale: '#cfc9ba',
  dim: '#6f6a5e',
  label: '#7d7669',
  flapTop: '#1e1e1e',
  flapBottom: '#151515',
  tileWidth: 30,
  tileHeight: 40,
  rowHeight: 64
} as const;

export const SEAT_COLORS: Record<SeatId, string> = {
  red: '#e02b1d',
  green: '#5fbb2e',
  blue: '#2f7fe8',
  yellow: '#f0b429',
  black: '#1d1d1d',
  white: '#f2efe6'
};
```

- [ ] **Step 4: Write `src/game/SplitFlap.tsx`**

```tsx
import { TOKENS } from './tokens';

export interface SplitFlapProps {
  value: string;
  width: number;
  align?: 'left' | 'right';
  tone?: 'pale' | 'amber';
}

/**
 * A payout of 0 is a real amount — the board's two twin-city pairs pay it.
 * Only null means "no payout applies".
 */
export function formatMoney(payout: number | null): string {
  if (payout === null) return 'HOME';
  return `$${payout.toLocaleString('en-US')}`;
}

function pad(value: string, width: number, align: 'left' | 'right'): string[] {
  const text = value.toUpperCase().slice(0, width);
  const gap = ' '.repeat(width - text.length);
  return (align === 'right' ? gap + text : text + gap).split('');
}

export function SplitFlap({ value, width, align = 'left', tone = 'pale' }: SplitFlapProps) {
  const characters = pad(value, width, align);
  const color = tone === 'amber' ? TOKENS.amber : TOKENS.pale;

  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)'
        }}
      >
        {value.toUpperCase()}
      </span>
      {characters.map((character, index) => (
        <span
          key={index}
          data-flap={character}
          aria-hidden="true"
          style={{
            width: TOKENS.tileWidth,
            height: TOKENS.tileHeight,
            lineHeight: `${TOKENS.tileHeight}px`,
            textAlign: 'center',
            fontSize: 31,
            color,
            background: `linear-gradient(180deg, ${TOKENS.flapTop} 0 50%, ${TOKENS.flapBottom} 50% 100%)`,
            borderRadius: 3,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)'
          }}
        >
          {character === ' ' ? ' ' : character}
        </span>
      ))}
    </span>
  );
}
```

The visible tiles are `aria-hidden` with one off-screen copy of the whole word, so a screen reader says "Denver" rather than spelling it out, and the tests read that copy.

- [ ] **Step 5: Write `src/index.css` and import it**

```css
/* src/index.css */
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: #0a0a0a;
  color: #cfc9ba;
  font-family: 'Roboto Condensed', system-ui, sans-serif;
  font-weight: 300;
  -webkit-text-size-adjust: 100%;
}
```

Add `import './index.css';` to `src/main.tsx`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/game/SplitFlap.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the `$0` test can fail**

Temporarily change `formatMoney` to `if (!payout) return 'HOME';` and run the test. Expected: the `$0` case fails, because a zero payout has become a home town. Restore `payout === null`.

This is the exact bug the constraint exists to prevent — confirm the test catches it rather than assuming.

- [ ] **Step 8: Commit**

```bash
git add src/game/tokens.ts src/game/SplitFlap.tsx src/game/SplitFlap.test.tsx src/index.css src/main.tsx
git commit -m "Add design tokens and the split-flap field"
```

---

### Task 9: The departures row and board

**Files:**
- Create: `src/game/DeparturesRow.tsx`, `src/game/DeparturesBoard.tsx`, `src/game/DeparturesBoard.test.tsx`

**Interfaces:**
- Consumes: `Seat`, `GameState` from `../state/game`; `SplitFlap`, `formatMoney`, `TOKENS`, `SEAT_COLORS`
- Produces:
  - `<DeparturesRow seat={Seat} onActivate={(seat: SeatId) => void} />`
  - `<DeparturesBoard state={GameState} onActivate={(seat: SeatId) => void} onChooseRegion={(seat: SeatId, region: RegionId) => void} />`

- [ ] **Step 1: Write the failing test**

```tsx
// src/game/DeparturesBoard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeparturesBoard } from './DeparturesBoard';
import { replay } from '../state/game';
import type { GameEvent } from '../state/events';

const board = (events: GameEvent[], onActivate = vi.fn(), onChooseRegion = vi.fn()) => {
  render(
    <DeparturesBoard
      state={replay(events)}
      onActivate={onActivate}
      onChooseRegion={onChooseRegion}
    />
  );
  return { onActivate, onChooseRegion };
};

describe('the departures board', () => {
  it('offers all six seats before anyone has joined', () => {
    board([]);
    expect(screen.getAllByRole('button', { name: /tap to join/i })).toHaveLength(6);
  });

  it('shows a seated baron by name', () => {
    board([{ type: 'joined', seat: 'red', name: 'Pete' }]);
    expect(screen.getByText('PETE')).toBeInTheDocument();
  });

  it('shows a home town with no payout', () => {
    board([
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    expect(screen.getByText('CHICAGO')).toBeInTheDocument();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('shows a zero payout as $0', () => {
    board([
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
    ]);
    expect(screen.getByText('ST. PAUL')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('rolls for a seat when its row is tapped', async () => {
    const { onActivate } = board([
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    await userEvent.click(screen.getByRole('button', { name: /pete/i }));
    expect(onActivate).toHaveBeenCalledWith('red');
  });

  it('replaces the destinations with a ballot when a region is owed', () => {
    board([
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' }
    ]);
    expect(screen.getByRole('button', { name: /northwest/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /southwest/i })).toBeInTheDocument();
  });

  it('reports which region was picked, for the seat that owes one', async () => {
    const { onChooseRegion } = board([
      { type: 'joined', seat: 'red', name: 'Pete' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' }
    ]);
    await userEvent.click(screen.getByRole('button', { name: /southwest/i }));
    expect(onChooseRegion).toHaveBeenCalledWith('red', 'SW');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/game/DeparturesBoard.test.tsx`
Expected: FAIL — cannot resolve `./DeparturesBoard`.

- [ ] **Step 3: Write `src/game/DeparturesRow.tsx`**

```tsx
import { cityById, regionById } from '../../engine';
import type { Seat } from '../state/game';
import type { SeatId } from '../state/events';
import { SplitFlap, formatMoney } from './SplitFlap';
import { SEAT_COLORS, TOKENS } from './tokens';

export interface DeparturesRowProps {
  seat: Seat;
  onActivate: (seat: SeatId) => void;
}

export function DeparturesRow({ seat, onActivate }: DeparturesRowProps) {
  const latest = seat.stops[seat.stops.length - 1];
  const joined = seat.name !== null;
  const label = joined ? seat.name! : 'Tap to join';

  return (
    <button
      type="button"
      onClick={() => onActivate(seat.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        flex: 1,
        width: '100%',
        padding: '0 14px',
        border: 0,
        borderBottom: `1px solid ${TOKENS.rule}`,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: joined ? SEAT_COLORS[seat.id] : '#141414',
          boxShadow: joined ? '0 0 0 2px rgba(255,255,255,0.12)' : 'inset 0 0 0 1px #2c2c2c'
        }}
      />
      <span
        style={{
          width: 110,
          fontSize: 19,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: joined ? TOKENS.pale : TOKENS.dim
        }}
      >
        {label.toUpperCase()}
      </span>
      <span style={{ width: 212 }}>
        <SplitFlap value={latest ? regionById(latest.region).name : ''} width={13} />
      </span>
      <span style={{ width: 436 }}>
        <SplitFlap value={latest ? cityById(latest.city).name : ''} width={14} />
      </span>
      <span style={{ width: 219 }}>
        <SplitFlap
          value={latest ? formatMoney(latest.payout) : ''}
          width={7}
          align="right"
          tone="amber"
        />
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Write `src/game/DeparturesBoard.tsx`**

```tsx
import type { RegionId } from '../../engine';
import type { SeatId } from '../state/events';
import { SEATS } from '../state/events';
import type { GameState } from '../state/game';
import { DeparturesRow } from './DeparturesRow';
import { RegionBallot } from './RegionBallot';
import { TOKENS } from './tokens';

export interface DeparturesBoardProps {
  state: GameState;
  onActivate: (seat: SeatId) => void;
  onChooseRegion: (seat: SeatId, region: RegionId) => void;
}

export function DeparturesBoard({ state, onActivate, onChooseRegion }: DeparturesBoardProps) {
  // Only one seat can be owed a region at a time — it is the app's one modal
  // state, and it takes over the board rather than opening a dialog.
  const awaiting = SEATS.map(id => state.seats[id]).find(seat => seat.awaiting !== null);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: TOKENS.board,
        border: `14px solid ${TOKENS.bezel}`,
        boxShadow: 'inset 0 0 0 1px #262626'
      }}
    >
      <header
        style={{
          flex: '0 0 78px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 34px',
          background: TOKENS.header,
          borderBottom: '1px solid #2a2a2a'
        }}
      >
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '0.22em',
            color: TOKENS.amber,
            textTransform: 'uppercase'
          }}
        >
          Rail Baron
        </span>
        <span
          style={{
            fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: 13,
            letterSpacing: '0.22em',
            color: TOKENS.dim,
            textTransform: 'uppercase'
          }}
        >
          {awaiting ? `${awaiting.name ?? awaiting.id} rolled its own region` : 'Departures'}
        </span>
      </header>

      {awaiting ? (
        <RegionBallot
          seat={awaiting}
          onChoose={region => onChooseRegion(awaiting.id, region)}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 34px 20px' }}>
          {SEATS.map(id => (
            <DeparturesRow key={id} seat={state.seats[id]} onActivate={onActivate} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it fails on the ballot only**

Run: `npx vitest run src/game/DeparturesBoard.test.tsx`
Expected: FAIL — cannot resolve `./RegionBallot`. The first five tests should otherwise be satisfied by the code above; Task 10 supplies the ballot.

- [ ] **Step 6: Commit what compiles so far**

Hold this commit until Task 10 lands, since the board does not build without the ballot. Move straight to Task 10.

---

### Task 10: The region ballot

**Files:**
- Create: `src/game/RegionBallot.tsx`

**Interfaces:**
- Consumes: `REGIONS` from `engine`; `Seat` from `../state/game`
- Produces: `<RegionBallot seat={Seat} onChoose={(region: RegionId) => void} />`

- [ ] **Step 1: Write `src/game/RegionBallot.tsx`**

```tsx
import { REGIONS, type RegionId } from '../../engine';
import type { Seat } from '../state/game';
import { SEAT_COLORS, TOKENS } from './tokens';

export interface RegionBallotProps {
  seat: Seat;
  onChoose: (region: RegionId) => void;
}

/**
 * Shown when a roll named the region the baron is already in. The seven
 * regions take over the destination column, one per row, so the board keeps
 * its shape instead of opening a dialog over it.
 */
export function RegionBallot({ seat, onChoose }: RegionBallotProps) {
  return (
    <div
      role="group"
      aria-label={`Choose a region for ${seat.name ?? seat.id}`}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 34px 20px' }}
    >
      {REGIONS.map(region => {
        const repeat = region.id === seat.awaiting;
        return (
          <button
            key={region.id}
            type="button"
            onClick={() => onChoose(region.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              flex: 1,
              border: 0,
              borderBottom: `1px solid ${TOKENS.rule}`,
              background: 'transparent',
              color: repeat ? TOKENS.dim : TOKENS.amber,
              font: 'inherit',
              fontSize: 29,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: SEAT_COLORS[seat.id]
              }}
            />
            <span style={{ paddingLeft: 14 }}>{region.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

The region just rolled is dimmed rather than removed — the rules allow picking it, and a row vanishing would shift the other six under the player's finger.

- [ ] **Step 2: Run the board tests to verify they all pass**

Run: `npx vitest run src/game/DeparturesBoard.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/DeparturesRow.tsx src/game/DeparturesBoard.tsx src/game/RegionBallot.tsx src/game/DeparturesBoard.test.tsx
git commit -m "Add the departures board and the region ballot"
```

---

### Task 11: Wiring the game together

**Files:**
- Create: `src/state/useGame.ts`, `src/App.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything above
- Produces: `useGame(rng?: Rng)` returning `{ state, activate(seat), chooseRegion(seat, region), undoLast(), reset() }`

- [ ] **Step 1: Write `src/state/useGame.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { destinationInRegion, rollDestination, type RegionId, type Rng } from '../../engine';
import type { GameEvent, SeatId } from './events';
import { currentCity, replay, undo } from './game';
import { clearLog, loadLog, saveLog } from './storage';

export function useGame(rng: Rng = Math.random) {
  const [events, setEvents] = useState<GameEvent[]>(() => loadLog());

  useEffect(() => saveLog(events), [events]);

  const state = replay(events);

  const activate = useCallback((seat: SeatId) => {
    setEvents(log => {
      const current = replay(log).seats[seat];
      if (current.awaiting !== null) return log;

      if (current.name === null) {
        const name = window.prompt('Name this baron')?.trim();
        if (!name) return log;
        return [...log, { type: 'joined', seat, name }];
      }

      const outcome = rollDestination(currentCity(current), rng);
      switch (outcome.kind) {
        case 'home':
          return [...log,
            { type: 'arrived', seat, city: outcome.city, region: outcome.region, payout: null }];
        case 'arrived':
          return [...log,
            { type: 'arrived', seat, city: outcome.city, region: outcome.region, payout: outcome.payout }];
        case 'chooseRegion':
          return [...log, { type: 'regionRequested', seat, rolled: outcome.rolled }];
      }
    });
  }, [rng]);

  const chooseRegion = useCallback((seat: SeatId, region: RegionId) => {
    setEvents(log => {
      const current = replay(log).seats[seat];
      const from = currentCity(current);
      if (from === null || current.awaiting === null) return log;
      const arrival = destinationInRegion(from, region, rng);
      return [...log,
        { type: 'arrived', seat, city: arrival.city, region: arrival.region, payout: arrival.payout }];
    });
  }, [rng]);

  const undoLast = useCallback(() => setEvents(log => undo(log)), []);
  const reset = useCallback(() => { clearLog(); setEvents([]); }, []);

  return { state, activate, chooseRegion, undoLast, reset };
}
```

`window.prompt` is a deliberate placeholder for the name entry, replaced by the in-row typing field from concept 2a in Phase 2. It is called from the hook, not the component, so swapping it touches one place.

- [ ] **Step 2: Rewrite `src/App.tsx`**

```tsx
import { DeparturesBoard } from './game/DeparturesBoard';
import { useGame } from './state/useGame';

export default function App() {
  const { state, activate, chooseRegion } = useGame();
  return (
    <main style={{ height: '100%' }}>
      <DeparturesBoard state={state} onActivate={activate} onChooseRegion={chooseRegion} />
    </main>
  );
}
```

- [ ] **Step 3: Write the end-to-end test**

```tsx
// src/App.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('the app', () => {
  beforeEach(() => localStorage.clear());

  it('seats a baron, rolls a home town, and keeps it across a remount', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Pete');
    const first = render(<App />);

    await userEvent.click(screen.getAllByRole('button', { name: /tap to join/i })[0]!);
    expect(screen.getByText('PETE')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /pete/i }));
    expect(screen.getByText('HOME')).toBeInTheDocument();

    first.unmount();
    render(<App />);
    expect(screen.getByText('PETE')).toBeInTheDocument();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, every project.

- [ ] **Step 5: Look at it in a real browser**

Run: `npm run dev`, open the page at a tablet-landscape size, join two barons and roll each several times.
Confirm: rows are tappable at finger size; the region ballot appears when a baron rolls its own region and returns to the board once a region is picked; a refresh keeps the game. jsdom reports zero for all layout, so anything about size or fit has to be checked here.

- [ ] **Step 6: Commit**

```bash
git add src/state/useGame.ts src/App.tsx src/App.test.tsx
git commit -m "Wire the roller: rolling, region choice, and persistence"
```

---

### Task 12: Retire the jQuery app

**Files:**
- Delete: `index2.html`, `testlayout.html`, `Untitled.html`, `savegame.js`, `styles.css`, `railbaronv2.min.js`, `jquery-1.8.3.min.js`, `modernizr.custom.47689.js`, `js/`, `css/`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: a passing suite from Task 11
- Produces: a repo with one Rail Baron in it

- [ ] **Step 1: Confirm nothing in the port still reads the old files**

Run: `grep -rn "railbaronv2\|jquery\|flapper" src engine index.html`
Expected: no matches. If the payout or roll tables were imported rather than copied, stop and copy them first.

- [ ] **Step 2: Delete the old app**

```bash
git rm -r index2.html testlayout.html Untitled.html savegame.js styles.css \
  railbaronv2.min.js jquery-1.8.3.min.js modernizr.custom.47689.js js css
```

Git history keeps all of it. Two Rail Barons in one repo is how the wrong one gets edited.

- [ ] **Step 3: Update `README.md`**

Replace the preview link, which pointed at `index2.html`, with how to run the port:

```markdown
railbaron
=========

A destination-roller companion for the Avalon Hill board game *Rail Baron*. You play on
the physical board; the app rolls each baron's next destination and works out the payout.

```bash
npm install
npm run dev      # http://localhost:5173
npm test
```

Built for a tablet in landscape. See [ROADMAP.md](ROADMAP.md) for what comes next.
```

- [ ] **Step 4: Update `CLAUDE.md`**

The "Commands" section currently says there is no build system, and "Working notes" describes the dead 2013 files. Replace the first with the commands from `package.json`, and delete the notes about `index2.html`, `styles.css` and `railbaronv2.min.js`, which no longer exist. Keep the game-data section — it now documents where the ported tables came from — but change "Everything the roller needs is in `js/railbaronv2.js`" to point at `engine/`, noting the source file lives in git history.

- [ ] **Step 5: Run everything one last time**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Retire the 2013 jQuery app"
```

---

## Self-review

**Spec coverage.** Scope (roller only) — Tasks 2–5, 11. Data model and the three node kinds — not in this plan; it is map-side, and Plan 2 covers it. Data pipeline — Plan 2. Game data and its three defects — Task 2 fixes the regions, Task 5 drops `chooseRegion` by not porting it, Task 3 verifies the matrix structurally. The `$0` hazard — Tasks 3, 6, 8, with a break-it check in Task 8. `engine/` with no React — Task 1's project split, enforced by a test. Components under `src/game/` — Tasks 8–10. Event-log state — Task 6. Namespaced storage — Task 7. Departures board, ballot, signup — Tasks 9–11. Delete the jQuery app — Task 12. Testing approach — every task; two break-it checks.

**Gap found and closed.** The spec's interaction section describes the flaps settling in sequence — region, then city, then payout. No task implemented the animation, and `SplitFlap` renders its value immediately. That is deliberate for this plan: the animation is presentation over a correct board, it needs a real browser to judge, and putting it in the same task as the data would let a pretty failure hide a wrong number. It belongs in the polish plan alongside the blink choreography, and is noted here so it is not mistaken for an oversight.

**Placeholder scan.** Two data tables say "… remaining rows copied from the source file" rather than inlining 2,278 numbers. That is the instruction — retyping them by hand is exactly the failure mode — and each is paired with a test that proves the copy landed. `window.prompt` in Task 11 is called out as a deliberate stand-in with its replacement named.

**Type consistency.** `RollOutcome.kind` is `'home' | 'arrived' | 'chooseRegion'` in Tasks 5, 6 and 11. `GameEvent.type` is `'joined' | 'regionRequested' | 'arrived'` in Tasks 6, 7, 9 and 11. `payout: number | null` is consistent across engine, events, state and `formatMoney`. `citiesIn`, `cityById`, `regionById` keep their names from Task 2 through Task 10.
