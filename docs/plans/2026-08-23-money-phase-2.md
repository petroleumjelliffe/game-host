# Money Phase 2 Implementation Plan — the economy, and the endgame the rulebook actually has

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** written 2026-08-23, not implemented.

**Goal:** Rail Baron gains ownership, user fees, and the published endgame —
declare, the rover, the alternate destination — plus the liquidation stub;
phase 1's silent-homeward simplification is retired.

**Architecture:** three new events (`bought`, `declared`, `sold`) and two big
derivations (fees, the rover) on the existing event-sourced fold. Every
change is an event or a derivation; `legal.ts` stays the whole authority;
the log replays into the same game on any machine. Fees and the rover are
**never appended** — they are recomputed at replay from `moved` paths and
the ownership map the fold already holds.

**Tech Stack:** nothing new. TypeScript, vitest, the existing fold. No new
dependencies, no new socket messages, no protocol or save version bump
(reasoning in Task 2).

**Spec:** [`specs/2026-08-23-money-phase-2.md`](../../specs/2026-08-23-money-phase-2.md)
— read it first, and the three transcriptions it argues from in
[`games/railbaron/docs/rules/`](../../games/railbaron/docs/rules/). Every
decision below cites one of them.

## Global Constraints

- **The log is the authority; fees and the rover are derivations.** No
  `feesPaid` event, ever — a second copy of derivable truth could disagree
  with the first (spec Decision 2).
- **Money is dollars.** Railroad prices are the transcription's thousands
  ×1000 (`railroadPrice('SLSF')` is `19000`), matching `payoutBetween`.
- **Fees settle when the turn closes**, and `banked` may go **negative** —
  a legal, blocking state, not corruption (spec Decision 2/4).
- **The fold is tolerant, `legal.ts` is the gate.** `replay` banks whatever
  the log says (no affordability checks); every refusal lives in
  `appendLegality` and is mirrored in both hooks *in the same words*.
- **`homeward` is retired.** The field disappears from `Seat`; eligibility
  is a derivation (`mayDeclare`), the run home is `Seat.run`.
- **Old saves replay unchanged in structure, changed in money**: a log with
  no `bought` has no owners and bills only $1,000-per-turn bank fees; a log
  with no `declared` can produce **no winner** — a finished phase-1 game
  replays as unfinished. Both accepted by the spec's Compatibility section;
  Task 12 writes the deploy note.
- **Golden fixtures invalidated by the new rules are deleted, not patched**,
  the retiring rule named in the deletion commit (policy in
  `engine/golden/games.ts`; the spec names the three:
  the homeward run, the win, the overtaken leader in `goldenMoney.test.ts`).
- **Four assumptions ship as marked comments**, each citing the spec's
  *Still owed* table: cheapest-legal shared-trackage attribution; own-track
  turns bill nothing; other-owner usage displaces the $1,000 bank fee; the
  bank pays half the purchase price. **Elimination and `trainBought` are
  not implemented at all** — spec Decisions 4 and 5 gate them on text still
  owed.
- **Verification after every task:** `npx vitest run --root games/railbaron`
  green; at the end the full gate `npm run lint && npm run typecheck &&
  npm test && npm run build` (expect 1705 tests + this plan's additions,
  minus the three retirements).

---

### Task 1: `engine/railroads.ts` — the price list pinned

**Files:**
- Create: `games/railbaron/engine/railroads.ts`
- Modify: `games/railbaron/engine/index.ts` (export the new module)
- Test: `games/railbaron/engine/railroads.test.ts`

**Interfaces:**
- Produces: `RAILROAD_PRICES: ReadonlyMap<RailroadId, number>` (thousands),
  `railroadPrice(id: RailroadId): number` (dollars),
  `bankSalePrice(id: RailroadId): number` (dollars, half — the Decision 4
  placeholder). Tasks 3, 8, 9, 10, 11 consume the two functions.

- [ ] **Step 1: Write the failing test**

```ts
// games/railbaron/engine/railroads.test.ts
import { describe, expect, it } from 'vitest';
import { RAILROADS } from './network';
import { RAILROAD_PRICES, bankSalePrice, railroadPrice } from './railroads';

// Locked-in digest of the price list, transcribed 2026-08-23 from the
// printed rulebook (docs/rules/railroad-prices.md). FNV-1a over
// "ID:thousands," in id order — the same policy that pins PAYOUT_TABLE
// and CODES, because range checks pass on mis-copied cells and this
// table already produced one (SLSF pasted as 119; it is 19).
const RAILROAD_PRICES_DIGEST = 'fac6bc07';

const digestOf = (prices: ReadonlyMap<string, number>): string => {
  let hash = 0x811c9dc5;
  for (const id of [...prices.keys()].sort()) {
    const text = `${id}:${prices.get(id)},`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

describe('the railroad price list', () => {
  it('matches the transcription digest, cell for cell', () => {
    expect(digestOf(RAILROAD_PRICES)).toBe(RAILROAD_PRICES_DIGEST);
  });

  it('prices exactly the 28 railroads the map carries', () => {
    expect([...RAILROAD_PRICES.keys()].sort())
      .toEqual([...RAILROADS.keys()].sort());
  });

  it('agrees with the cost the built network already carries', () => {
    // network.json is generated data; this table is the pinned record.
    // If a graph rebuild ever drifts a cost, this is what says which of
    // the two is the transcription.
    for (const [id, line] of RAILROADS) {
      expect(railroadPrice(id), id).toBe(line.cost);
    }
  });

  it('answers in dollars, and halves for the bank', () => {
    expect(railroadPrice('SLSF')).toBe(19000);
    expect(bankSalePrice('SLSF')).toBe(9500);
    expect(bankSalePrice('CRI&P')).toBe(14500);
  });

  it('throws on a railroad that never existed', () => {
    expect(() => railroadPrice('AMTRAK')).toThrow(/AMTRAK/);
  });
});
```

- [ ] **Step 2: Run: `npx vitest run --root games/railbaron railroads.test` — FAIL** (`Cannot find module './railroads'`).

- [ ] **Step 3: Implement**

```ts
// games/railbaron/engine/railroads.ts
// The rulebook's railroad purchase prices, in thousands — the transcription
// (docs/rules/railroad-prices.md) is the record, this table is the runtime,
// and the digest test is the lock, exactly as PAYOUT_TABLE and CODES are
// pinned. SLSF is 19: the paste read 119, out of family against a 4–42
// range, and the cell was held out until the owner checked the printed
// page (2026-08-23, a doubled keystroke). That story is why the digest
// exists — range checks pass on mis-copied cells.
import type { RailroadId } from './network.js';

export const RAILROAD_PRICES: ReadonlyMap<RailroadId, number> = new Map([
  ['ACL', 12], ['AT&SF', 40], ['B&M', 4], ['B&O', 24], ['C&NW', 14],
  ['C&O', 20], ['CB&Q', 20], ['CMStP&P', 18], ['CRI&P', 29], ['D&RGW', 6],
  ['GM&O', 12], ['GN', 17], ['IC', 14], ['L&N', 18], ['MP', 21],
  ['N&W', 12], ['NP', 14], ['NYC', 28], ['NYNH&H', 4], ['PA', 30],
  ['RF&P', 4], ['SAL', 14], ['SLSF', 19], ['SOU', 20], ['SP', 42],
  ['T&P', 10], ['UP', 40], ['WP', 8],
]);

/** Dollars — thousands ×1000, payoutBetween's convention. */
export function railroadPrice(id: RailroadId): number {
  const thousands = RAILROAD_PRICES.get(id);
  if (thousands === undefined) throw new Error(`no railroad priced: ${id}`);
  return thousands * 1000;
}

/**
 * What the bank pays in a forced sale: half the purchase price. A
 * PLACEHOLDER by decision (spec Decision 4, docs/rules/user-fees.md) —
 * the customary figure, held against the still-owed forced-sale text.
 * `sold` events carry their price, so correcting this later changes new
 * sales only; history replays as written.
 */
export const bankSalePrice = (id: RailroadId): number => railroadPrice(id) / 2;
```

Add to `engine/index.ts`:
`export { RAILROAD_PRICES, bankSalePrice, railroadPrice } from './railroads.js';`

- [ ] **Step 4: Run: `npx vitest run --root games/railbaron railroads.test` — PASS** (the network cross-check should pass as-is: `network.json` already carries these costs; if a cell disagrees, the transcription wins — investigate before touching either).

- [ ] **Step 5: Commit**

```bash
git add games/railbaron/engine/railroads.ts games/railbaron/engine/railroads.test.ts \
  games/railbaron/engine/index.ts
git commit -m "feat: the railroad price list as engine data, pinned by digest"
```

---

### Task 2: events — `bought`, `declared`, `sold` on the wire

**Files:**
- Modify: `games/railbaron/src/state/events.ts`,
  `games/railbaron/src/state/legal.ts` (temporary refusals — the union
  widening breaks its exhaustive switch otherwise)
- Test: `games/railbaron/src/state/events.test.ts` — **check first** whether
  event-validator tests live there (`grep -rln "isGameEvent" games/railbaron/src/state/*.test.ts`);
  add cases to the file that already tests `isGameEvent`, or create
  `events.money.test.ts` if none does.

**Interfaces:**
- Produces (Tasks 3–11 all read these):

```ts
  | { type: 'bought'; seat: SeatId; railroad: RailroadId; price: number }
  | { type: 'declared'; seat: SeatId;
      alternate: { city: CityId; region: RegionId; payout: number } }
  | { type: 'sold'; seat: SeatId; railroad: RailroadId; price: number }
```

- **No version bump.** `RB_SAVE_VERSION` and `RB_PROTOCOL_VERSION` stay 1:
  old saves are valid new saves (the events are simply absent), and both
  deployments ship client and server from one build. The precedent is
  phase 1's `started.rules`, which bumped nothing for the same reason.

- [ ] **Step 1: Write the failing tests**

```ts
// added to the file that tests isGameEvent
describe('phase 2 money events', () => {
  it('accepts a well-formed bought and sold, and refuses junk', () => {
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'SLSF', price: 19000 })).toBe(true);
    expect(isGameEvent({ type: 'sold', seat: 'red', railroad: 'SLSF', price: 9500 })).toBe(true);
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'AMTRAK', price: 19000 })).toBe(false);
    expect(isGameEvent({ type: 'bought', seat: 'mauve', railroad: 'SLSF', price: 19000 })).toBe(false);
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'SLSF', price: '19000' })).toBe(false);
    expect(isGameEvent({ type: 'sold', seat: 'red', railroad: 'SLSF', price: -1 })).toBe(false);
  });

  it('accepts declared only when the alternate is a real place', () => {
    // Build alternate from the engine, never literals: city 0's own region.
    const city = CITIES[0]!;
    const good = { type: 'declared', seat: 'red',
      alternate: { city: city.id, region: city.region, payout: 5000 } };
    expect(isGameEvent(good)).toBe(true);
    expect(isGameEvent({ ...good, alternate: { ...good.alternate, region: 'not-a-region' } })).toBe(false);
    expect(isGameEvent({ ...good, alternate: { ...good.alternate, payout: null } })).toBe(false);
    expect(isGameEvent({ ...good, alternate: null })).toBe(false);
    expect(isGameEvent({ type: 'declared', seat: 'red' })).toBe(false);
  });

  it('region must match the alternate city, engine-checked', () => {
    // Find a region that is NOT city 0's, from REGIONS.
    const city = CITIES[0]!;
    const other = REGIONS.find((r) => r.id !== city.region)!;
    expect(isGameEvent({ type: 'declared', seat: 'red',
      alternate: { city: city.id, region: other.id, payout: 5000 } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL** (unknown `type` falls to `default: return false`).

- [ ] **Step 3: Implement in `events.ts`.** Add the three union members
  (with `import type { RailroadId }` and `RAILROADS` from the engine), a
  derived set beside the others —

```ts
const VALID_RAILROADS: ReadonlySet<string> = new Set(RAILROADS.keys());
```

— and the validator cases:

```ts
    case 'bought':
    case 'sold':
      // Price travels in the event so the log is self-contained, like
      // arrived.payout; legal.ts audits it against the table, this only
      // checks shape.
      return (
        VALID_SEATS.has(event.seat as string) &&
        VALID_RAILROADS.has(event.railroad as string) &&
        typeof event.price === 'number' && Number.isFinite(event.price) &&
        event.price > 0
      );
    case 'declared': {
      if (!VALID_SEATS.has(event.seat as string)) return false;
      const alt = event.alternate as Record<string, unknown> | null;
      // Same short-circuit discipline as `arrived`: VALID_CITIES gates
      // cityById, which throws on ids it does not know.
      return (
        typeof alt === 'object' && alt !== null &&
        VALID_CITIES.has(alt.city as CityId) &&
        VALID_REGIONS.has(alt.region as RegionId) &&
        cityById(alt.city as CityId).region === alt.region &&
        typeof alt.payout === 'number' && Number.isFinite(alt.payout)
      );
    }
```

- [ ] **Step 4: Keep `legal.ts` compiling.** Its switch is exhaustive over
  the event union; add three temporary cases at the bottom, replaced by
  Task 8:

```ts
    case 'bought':
    case 'declared':
    case 'sold':
      // Placeholders until the phase-2 legality task lands; refusing is
      // the safe default for an event no rule yet admits.
      return not('notNow', 'not yet in play');
```

- [ ] **Step 5: Run: `npx vitest run --root games/railbaron` — everything green.**

- [ ] **Step 6: Commit**

```bash
git add games/railbaron/src/state/events.ts games/railbaron/src/state/legal.ts \
  games/railbaron/src/state/*.test.ts
git commit -m "feat: bought, declared, sold — three events, shape-checked, priced in the log"
```

---

### Task 3: the fold learns ownership

**Files:**
- Modify: `games/railbaron/src/state/game.ts`
- Test: `games/railbaron/src/state/ownership.test.ts` (create)

**Interfaces:**
- Consumes: the Task 2 events.
- Produces (Tasks 5–11 read these):
  - `Seat` gains `holdings: readonly RailroadId[]`.
  - `GameState` gains `owners: ReadonlyMap<RailroadId, SeatId>`.
  - Inside `replay`: an `adjust: Map<SeatId, number>` ledger (all money that
    is not a stop's payout — purchases, sales, later fees and the rover)
    and a `cashOf(sid)` closure; `banked` becomes
    `earned − inFlight + adjust`.

- [ ] **Step 1: Write the failing tests** (reuse `endRule.test.ts`'s
  helpers verbatim — `id`, `home`, `assign`, `walk`, `opening`; copy them,
  the files are independent):

```ts
// games/railbaron/src/state/ownership.test.ts
import { describe, expect, it } from 'vitest';
import { payoutBetween, railroadPrice } from '../../engine/index.js';
import { replay } from './game.js';
// ...helpers as in endRule.test.ts...

const buy = (seat: SeatId, railroad: string): GameEvent =>
  ({ type: 'bought', seat, railroad, price: railroadPrice(railroad) });

describe('ownership', () => {
  it('a purchase debits the buyer and lands on the map', () => {
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      buy('red', 'NYC'),
    ];
    const state = replay(log);
    expect(state.owners.get('NYC')).toBe('red');
    expect(state.seats.red.holdings).toEqual(['NYC']);
    expect(state.seats.red.banked)
      .toBe(payoutBetween(CHICAGO, NEW_YORK) - railroadPrice('NYC'));
  });

  it('a sale returns the railroad to the map and credits the seller', () => {
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      buy('red', 'NYC'),
      { type: 'sold', seat: 'red', railroad: 'NYC', price: 14000 },
    ];
    const state = replay(log);
    expect(state.owners.has('NYC')).toBe(false);
    expect(state.seats.red.holdings).toEqual([]);
    expect(state.seats.red.banked)
      .toBe(payoutBetween(CHICAGO, NEW_YORK) - railroadPrice('NYC') + 14000);
  });

  it('replays a pre-ownership log with an empty map', () => {
    const state = replay([...opening(CHICAGO, MIAMI)]);
    expect(state.owners.size).toBe(0);
    expect(state.seats.red.holdings).toEqual([]);
  });

  it('is tolerant: the fold banks whatever the log says, even into debt', () => {
    // No affordability check at replay — that is legal.ts's job. A log
    // that bought beyond its means folds to a negative balance, which
    // Decision 2 makes a legal state anyway.
    const state = replay([...opening(CHICAGO, MIAMI), buy('red', 'SP')]);
    expect(state.seats.red.banked).toBe(-railroadPrice('SP'));
  });
});
```

- [ ] **Step 2: Run — FAIL** (`owners`/`holdings` do not exist).

- [ ] **Step 3: Implement in `game.ts`.**
  - `Seat` gains `/** Railroads this baron owns, in purchase order. */ holdings: readonly RailroadId[];`
    (`emptyState` seats gain `holdings: []`).
  - `GameState` gains `/** Who owns what. Empty for every pre-phase-2 log. */ owners: ReadonlyMap<RailroadId, SeatId>;`
    (`emptyState` gains `owners: new Map()`).
  - In `replay`, beside `inFlight`:

```ts
  /** Who owns what, folded as purchases and sales land. */
  const owners = new Map<RailroadId, SeatId>();
  /**
   * Every dollar that is not a stop's payout: purchases and sales now,
   * fees and the rover when their derivations land. banked =
   * earned − inFlight + adjust, always — one ledger, so no money flow
   * needs its own bookkeeping field on Seat.
   */
  const adjust = new Map<SeatId, number>();
  const credit = (sid: SeatId, amount: number): void => {
    adjust.set(sid, (adjust.get(sid) ?? 0) + amount);
  };
  const cashOf = (sid: SeatId): number =>
    state.seats[sid].earned - (inFlight.get(sid) ?? 0) + (adjust.get(sid) ?? 0);
```

  - New switch cases:

```ts
      case 'bought':
        owners.set(event.railroad, event.seat);
        credit(event.seat, -event.price);
        state.seats[event.seat] = { ...seat, holdings: [...seat.holdings, event.railroad] };
        break;
      case 'sold':
        // The Decision 4 stub: a forced sale to the bank. The event is
        // ordinary log history, so a future auction replaces the mechanism
        // without touching how this replays.
        owners.delete(event.railroad);
        credit(event.seat, event.price);
        state.seats[event.seat] = {
          ...seat, holdings: seat.holdings.filter((line) => line !== event.railroad),
        };
        break;
```

  - Every `banked` computation switches to `cashOf`: the in-loop settlement
    block inside `moved` (`const banked = cashOf(event.seat);`) and the
    post-loop pass (`const banked = cashOf(sid);`). Before `return state;`,
    add `state.owners = owners;`.
  - Import `RailroadId` (type) from the engine.

- [ ] **Step 4: Run: `npx vitest run --root games/railbaron` — ownership passes, everything else stays green** (logs without the new events must fold byte-identically; the existing suites are that assertion).

- [ ] **Step 5: Commit**

```bash
git add games/railbaron/src/state/game.ts games/railbaron/src/state/ownership.test.ts
git commit -m "feat: the fold learns ownership — an owners map, holdings, and one money ledger"
```

---

### Task 4: `src/state/money.ts` — the fee derivation, pure

**Files:**
- Create: `games/railbaron/src/state/money.ts`
- Test: `games/railbaron/src/state/money.test.ts`

**Interfaces:**
- Consumes: `neighbours` from the engine (edge railroads), `SeatId`.
- Produces (Task 5 and 7 read these):
  - `BANK_FEE = 1000`, `OWNER_FEE = 5000`, `ALL_OWNED_FEE = 10000`,
    `ROVER_PRIZE = 50000`
  - `sectionRailroads(a: NodeId, b: NodeId): readonly RailroadId[]`
  - `attributeSection(candidates, mover, owners): RailroadId | null`
  - `turnBill(paths, mover, owners, allOwned): TurnBill` where
    `interface TurnBill { toBank: number; toOwners: ReadonlyMap<SeatId, number> }`

- [ ] **Step 1: Write the failing tests.** Real nodes, real edges — the
  neighbourhood notes at the top of `engine/golden/games.ts` are the map:
  `c13` Minneapolis –`d131` carries `[C&NW]` alone, `c13`–`d222` carries
  `[CMStP&P]` alone, `c13`–`d417` is shared `[GN, NP]`. **Verify each edge
  before trusting it** (`neighbours('c13')` in a scratch assertion or by
  reading `engine/network.json`) — the golden header was written for
  movement, not fees.

```ts
// games/railbaron/src/state/money.test.ts
import { describe, expect, it } from 'vitest';
import { attributeSection, sectionRailroads, turnBill,
         ALL_OWNED_FEE, BANK_FEE, OWNER_FEE } from './money.js';

const owners = (entries: [string, string][]) => new Map(entries) as ReadonlyMap<string, SeatId>;

describe('sectionRailroads', () => {
  it('reads the edge, and answers [] for a pair no edge joins', () => {
    expect([...sectionRailroads('c13', 'd131')]).toEqual(['C&NW']);
    expect([...sectionRailroads('c13', 'd417')].sort()).toEqual(['GN', 'NP']);
    // A hostile log's teleporting path must not throw the fold.
    expect(sectionRailroads('c13', 'c65')).toEqual([]);
  });
});

describe('attributeSection — cheapest legal bill for the mover', () => {
  it('prefers own line over any other, unowned over other-owned', () => {
    expect(attributeSection(['GN', 'NP'], 'red', owners([['NP', 'red']]))).toBe('NP');
    expect(attributeSection(['GN', 'NP'], 'red', owners([['GN', 'blue']]))).toBe('NP');
  });
  it('breaks ties by railroad id, deterministically', () => {
    expect(attributeSection(['NP', 'GN'], 'red', owners([]))).toBe('GN');
    expect(attributeSection(['NP', 'GN'], 'red',
      owners([['GN', 'blue'], ['NP', 'green']]))).toBe('GN');
  });
});

describe('turnBill', () => {
  it('bills $1,000 to the bank for an all-unowned turn', () => {
    const bill = turnBill([['c13', 'd131']], 'red', owners([]), false);
    expect(bill.toBank).toBe(BANK_FEE);
    expect(bill.toOwners.size).toBe(0);
  });

  it('bills one fee per owner, not per line or section', () => {
    const map = owners([['C&NW', 'blue'], ['CMStP&P', 'blue']]);
    const bill = turnBill([['d131', 'c13', 'd222']], 'red', map, false);
    expect(bill.toOwners.get('blue')).toBe(OWNER_FEE);   // both sections, one fee
    expect(bill.toBank).toBe(0);                          // displaced, not added
  });

  it('bills $10,000 per owner once all railroads are owned', () => {
    const map = owners([['C&NW', 'blue']]);
    const bill = turnBill([['c13', 'd131']], 'red', map, true);
    expect(bill.toOwners.get('blue')).toBe(ALL_OWNED_FEE);
  });

  it('bills nothing for a turn entirely on the mover\'s own lines', () => {
    const bill = turnBill([['c13', 'd131']], 'red', owners([['C&NW', 'red']]), false);
    expect(bill.toBank).toBe(0);
    expect(bill.toOwners.size).toBe(0);
  });

  it('rides the unowned line across shared trackage rather than paying', () => {
    // c13–d417 carries GN and NP; blue owns GN, NP is free.
    const bill = turnBill([['c13', 'd417']], 'red', owners([['GN', 'blue']]), false);
    expect(bill.toOwners.size).toBe(0);
    expect(bill.toBank).toBe(BANK_FEE);
  });

  it('sums both legs of a two-leg turn into one bill', () => {
    const map = owners([['C&NW', 'blue'], ['CMStP&P', 'green']]);
    const bill = turnBill([['c13', 'd131'], ['d131', 'c13', 'd222']], 'red', map, false);
    expect(bill.toOwners.get('blue')).toBe(OWNER_FEE);
    expect(bill.toOwners.get('green')).toBe(OWNER_FEE);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`Cannot find module './money.js'`).

- [ ] **Step 3: Implement**

```ts
// games/railbaron/src/state/money.ts
// The user-fee schedule as a pure derivation over what the log already
// holds (docs/rules/user-fees.md; spec Decision 2). Movement recorded its
// paths and charged nothing — route.ts's promise — and this is the file
// that prices them. Nothing here appends: a turn's bill is recomputable at
// replay from the paths and the ownership map, so a `feesPaid` event would
// be a second copy of derivable truth.
import { neighbours, type NodeId, type RailroadId } from '../../engine/index.js';
import type { SeatId } from './events.js';

export const BANK_FEE = 1000;
export const OWNER_FEE = 5000;
export const ALL_OWNED_FEE = 10000;
export const ROVER_PRIZE = 50000;

/**
 * The railroads on the section between two adjacent nodes. [] when no edge
 * joins them: a hand-edited log can name a teleporting path, and the fold
 * must fold it without throwing — no track used, nothing billed.
 */
export function sectionRailroads(a: NodeId, b: NodeId): readonly RailroadId[] {
  const edge = neighbours(a).find((one) => one.a === b || one.b === b);
  return edge?.railroads ?? [];
}

/**
 * Which company a shared section counts as: the one producing "the
 * cheapest legal bill for the mover (own line over any other; unowned over
 * other-owned; deterministic tie-break by railroad id)" — the spec's
 * words. ASSUMPTION, held pending the rulebook's own text on shared
 * trackage (spec, Still owed): the log keeps the full sets, so this is
 * revisitable without rewriting history.
 */
export function attributeSection(
  candidates: readonly RailroadId[],
  mover: SeatId,
  owners: ReadonlyMap<RailroadId, SeatId>,
): RailroadId | null {
  const rank = (id: RailroadId): number => {
    const owner = owners.get(id);
    return owner === mover ? 0 : owner === undefined ? 1 : 2;
  };
  let best: RailroadId | null = null;
  for (const id of candidates) {
    if (best === null || rank(id) < rank(best)
        || (rank(id) === rank(best) && id < best)) best = id;
  }
  return best;
}

export interface TurnBill {
  toBank: number;
  /** One fee per owner, not per line — confirmed 2026-08-23. */
  toOwners: ReadonlyMap<SeatId, number>;
}

export function turnBill(
  paths: readonly (readonly NodeId[])[],
  mover: SeatId,
  owners: ReadonlyMap<RailroadId, SeatId>,
  allOwned: boolean,
): TurnBill {
  let unowned = false;
  const others = new Set<SeatId>();
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const ridden = attributeSection(sectionRailroads(path[i - 1]!, path[i]!), mover, owners);
      if (ridden === null) continue;
      const owner = owners.get(ridden);
      if (owner === undefined) unowned = true;
      else if (owner !== mover) others.add(owner);
    }
  }
  const each = allOwned ? ALL_OWNED_FEE : OWNER_FEE;
  const toOwners = new Map<SeatId, number>();
  for (const owner of others) toOwners.set(owner, each);
  // Two ASSUMPTIONS, both marked in the transcription's "edges still open":
  // a turn wholly on the mover's own lines bills nothing, and other-owner
  // usage displaces the $1,000 bank fee rather than adding to it.
  return { toBank: others.size === 0 && unowned ? BANK_FEE : 0, toOwners };
}
```

- [ ] **Step 4: Run: `npx vitest run --root games/railbaron money.test` — PASS.**

- [ ] **Step 5: Commit**

```bash
git add games/railbaron/src/state/money.ts games/railbaron/src/state/money.test.ts
git commit -m "feat: the fee schedule as a pure derivation — three tiers, one fee per owner, cheapest-legal attribution"
```

---

### Task 5: the fold settles fees when the turn closes

**Files:**
- Modify: `games/railbaron/src/state/game.ts`
- Test: `games/railbaron/src/state/fees.test.ts` (create)

**Interfaces:**
- Consumes: `turnBill` (Task 4), the `adjust`/`cashOf` ledger (Task 3).
- Produces: fee-inclusive `banked`, which **may be negative**. Task 8's
  liquidation gate reads exactly that sign.

- [ ] **Step 1: Write the failing tests.** Real edges again (`c13`–`d131`,
  `[C&NW]`); the endRule helpers' two-fake-node `walk()` paths ride no
  edge, so they bill nothing — deliberately, and this task's tests say so.

```ts
// games/railbaron/src/state/fees.test.ts
// ...endRule helpers; MPLS = id('Minneapolis'); note nodeForCity(MPLS) === 'c13'...

describe('fees settle when the turn closes', () => {
  it('bills $1,000 to the bank for an unowned turn — and may go negative', () => {
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(log);
    // The trip is in flight, so nothing is banked yet; the fee still lands.
    expect(state.seats.red.banked).toBe(-1000);
  });

  it('pays the owner, who is credited in the same derivation', () => {
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'bought', seat: 'blue', railroad: 'C&NW', price: railroadPrice('C&NW') },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(log);
    expect(state.seats.red.banked).toBe(-5000);
    expect(state.seats.blue.banked).toBe(-railroadPrice('C&NW') + 5000);
  });

  it('does not bill an open turn — settlement is after the turn', () => {
    // [6, 6] earns a freight its Bonus Roll, so one leg leaves the turn open.
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    expect(replay(log).seats.red.banked).toBe(0);
  });

  it('bills a fee-free turn nothing: fake paths ride no edges', () => {
    // The endRule fixtures' two-node walks are off the rail network, so
    // they attract no fee — which is why every phase-1 money assertion
    // survives this task unchanged. This test pins that reading.
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
    ];
    expect(replay(log).seats.red.banked).toBe(payoutBetween(CHICAGO, NEW_YORK));
  });
});
```

- [ ] **Step 2: Run — FAIL** (no fees are billed).

- [ ] **Step 3: Implement in `game.ts`.**
  - `OpenTurn` gains `/** This turn's walked legs, for the fee bill. */ paths: NodeId[][];`
    (`turnRolled` opens with `paths: []`).
  - A closure above the event loop, after `cashOf`:

```ts
  const settleFees = (turn: OpenTurn): void => {
    // "He must pay all the fines and penalties each turn" — settled here,
    // as the turn closes, from the paths it walked (spec Decision 2). The
    // balance may cross zero: negative is the moment between the bill
    // landing and the liquidation covering it, and legal.ts is what blocks
    // play until it does.
    const bill = turnBill(turn.paths, turn.seat, owners, owners.size === RAILROADS.size);
    let total = bill.toBank;
    for (const [owner, fee] of bill.toOwners) {
      total += fee;
      credit(owner, fee);
    }
    if (total > 0) credit(turn.seat, -total);
  };
```

    (`import { RAILROADS } from '../../engine/index.js';` — the value, for
    its `.size`; `turnBill` from `./money.js`.)
  - In the `moved` case's open-turn block, record the leg and settle on
    close:

```ts
        if (open !== null) {
          open.paths.push(event.path);
          open.legs += 1;
          const owed = open.legacy
            ? bonusLegOwed(open.roll, pathCost(event.path), event.arrived)
            : earnsBonus(state.rules.startingTrain, open.roll.white);
          if (open.legs >= 2 || !owed) {
            settleFees(open);
            taken += 1; open = null;
          }
        }
```

- [ ] **Step 4: Run the whole package: `npx vitest run --root games/railbaron`.**
  `fees.test` passes. **Expect collateral:** any existing test whose log
  walks *real edges* and asserts `banked` now sees fee-adjusted numbers —
  `replay.golden.test.ts` builds real logs from the golden movement games,
  so check whether it asserts money (it should not; it pins movement). If a
  test fails on a $1,000 delta, the *test's expectation* moves to the
  fee-inclusive number with a comment naming the bank fee — the behaviour
  is the feature.

- [ ] **Step 5: Commit**

```bash
git add games/railbaron/src/state/game.ts games/railbaron/src/state/fees.test.ts
git commit -m "feat: fees settle as the turn closes — derived from the paths, never appended"
```

---

### Task 6: declare — the run home, and the retirement of `homeward`

The pivot of the phase: `Seat.homeward` disappears, `Seat.run` arrives, and
the win rule becomes *declared + home + target after fees*. This task
touches every `homeward` consumer at once because removing a field cannot
be done by halves — but the new-event *legality* still waits for Task 8;
here `legal.ts` only swaps its guards mechanically.

**Files:**
- Modify: `games/railbaron/src/state/game.ts`,
  `games/railbaron/src/state/turns.ts`, `games/railbaron/src/state/legal.ts`,
  `games/railbaron/src/state/useGame.ts`,
  `games/railbaron/src/net/useOnlineGame.ts`,
  `games/railbaron/src/board/MoneyStrip.tsx` (+ its test),
  `games/railbaron/src/state/endRule.test.ts` (rewrite the homeward-era
  tests), `games/railbaron/src/state/goldenMoney.test.ts` (deletions),
  `games/railbaron/src/state/legalMoney.test.ts` (guard-message updates)

**Interfaces:**
- Produces (Tasks 7–11 read these):

```ts
export interface DeclaredRun {
  /** Rolled at declaration; paid only if reached after cancellation. */
  alternate: { city: CityId; region: RegionId; payout: number };
  /** true: bound for home. false: caught or impoverished, bound for the alternate. */
  toHome: boolean;
}
// Seat: homeward removed; run: DeclaredRun | null added.
```

  - `turns.ts` gains `mayDeclare(state, id): boolean` and
    `shortSeat(state): SeatId | null`; `destinationOf` re-keys on `run`.

- [ ] **Step 1: Delete the retired goldens, and commit that alone.** In
  `goldenMoney.test.ts`, delete the three describes the new rules
  invalidate: **the homeward run**, **the win** (silent-homeward winning),
  **the overtaken leader**. Keep **the standard cycle** and **the $0
  neighbours** — nothing in them touches the win rule. Then:

```bash
git add games/railbaron/src/state/goldenMoney.test.ts
git commit -m "test: retire the silent-homeward goldens — declaring replaces the win rule they pinned

The homeward run, the win, and the overtaken leader encoded phase 1's
simplification: cross the target and destination rolls silently stop.
The rulebook transcription (docs/rules/declaring-and-the-rover.md) shows
winning is an announced declare with the rover as counterplay, so these
three record a rule the game no longer has. Deleted, not patched — the
policy in engine/golden/games.ts. Declared-era replacements land with the
phase-2 golden shelf."
```

- [ ] **Step 2: Write the failing fold tests** — rewrite `endRule.test.ts`'s
  `describe('the win')` and the homeward assertions in `describe('banked vs
  earned')` to the declared era, and add the new mechanisms. The helpers
  stay; add one:

```ts
const declare = (seat: SeatId, from: CityId, alt: CityId): GameEvent =>
  ({ type: 'declared', seat,
     alternate: { city: alt, region: cityById(alt).region,
                  payout: payoutBetween(from, alt) } });
```

Replacement and new tests (fold-level, `replay` only — the fold is
tolerant of turn order):

```ts
describe('the declared run', () => {
  const brink = (): GameEvent[] => [
    ...opening(CHICAGO, MIAMI),
    assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
  ];   // red banked past winTarget 1000, standing at New York

  it('crossing the target no longer changes anything by itself', () => {
    const state = replay(brink());
    expect(state.seats.red.run).toBeNull();
    expect(state.winner).toBeNull();
    // The seat is *eligible* — Task 6 makes that a derivation:
    expect(mayDeclare(state, 'red')).toBe(true);
    expect(mayDeclare(state, 'blue')).toBe(false);
  });

  it('declaring sets the run and aims the baron home', () => {
    const state = replay([...brink(), declare('red', NEW_YORK, LOS_ANGELES)]);
    expect(state.seats.red.run).toEqual({
      alternate: { city: LOS_ANGELES, region: cityById(LOS_ANGELES).region,
                   payout: payoutBetween(NEW_YORK, LOS_ANGELES) },
      toHome: true,
    });
    expect(destinationOf(state.seats.red)).toBe(CHICAGO);
    expect(state.winner).toBeNull();
  });

  it('a declared moved ending at home wins — undeclared, the same move does not', () => {
    const winning: GameEvent[] = [
      { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
    ];
    const declaredWin = replay([...brink(), declare('red', NEW_YORK, LOS_ANGELES), ...winning]);
    expect(declaredWin.winner).toBe('red');
    expect(declaredWin.phase).toBe('over');

    // "A player cannot win just by moving into his home city during a
    // normal trip" — the same log without the declare has no winner.
    const silent = replay([...brink(), ...winning]);
    expect(silent.winner).toBeNull();
    expect(silent.phase).toBe('playing');
  });

  it('declaring while standing at home wins immediately', () => {
    // Red's latest destination IS Chicago, their home — a legal trip.
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      assign('red', NEW_YORK, CHICAGO), ...walk('red', NEW_YORK, CHICAGO),
      declare('red', CHICAGO, MIAMI),
    ];
    const state = replay(log);
    expect(state.winner).toBe('red');
    expect(state.phase).toBe('over');
  });

  it('a cancelled run continues to the alternate and pays on arrival', () => {
    const cancelled: GameEvent[] = [
      ...brink(),
      declare('red', NEW_YORK, LOS_ANGELES),
    ];
    // Force the cancellation Task 7 derives (the rover); until then, fold
    // it directly by building the state we need: use a declared run whose
    // toHome the rover has cleared. This test lands in Task 7 if the
    // fixture cannot be built without it — see Task 7 Step 1, which owns
    // the rover fixtures. Keep here only the arrival mechanics, driven by
    // a poverty cancellation: winTarget high enough that declaring is
    // impossible... it is not, so: SKIP this test until Task 7 and note it
    // in the Task 6 commit. (Task 7 Step 1 includes it verbatim.)
  });
});
```

  (The last stub is deliberate: cancellation has no cause until the rover
  or poverty exists, and both are Task 7. Task 6 ships declare + the win;
  Task 7 ships every path that *clears* a declaration and the alternate
  arrival that follows.)

- [ ] **Step 3: Run — FAIL** (`declared` folds to nothing; `homeward` still exists).

- [ ] **Step 4: Implement.**

  **`game.ts`:** delete `homeward` from `Seat` (and both places it is
  computed); add `run: DeclaredRun | null` (export the interface;
  `emptyState` seats gain `run: null`). New switch case:

```ts
      case 'declared': {
        // The alternate is rolled at declaration and carried here; it
        // banks nothing unless the run is cancelled and the baron reaches
        // it (Task 7). Eligibility was legal.ts's question; the fold folds
        // what the log says.
        const runner: Seat = { ...seat, run: { alternate: event.alternate, toHome: true } };
        state.seats[event.seat] = runner;
        // "If a player is in his home city when he declares he wins
        // immediately" — the rulebook's own clause.
        const home = runner.stops[0]?.city ?? null;
        if (state.winner === null && home !== null
            && runner.at === nodeForCity(home)) {
          state.winner = event.seat;
        }
        break;
      }
```

  In the `moved` case, replace the phase-1 settlement block (the one that
  computed `banked`/`homeward`/`home` and set `winner`) with:

```ts
        {
          const mover = state.seats[event.seat];
          state.seats[event.seat] = {
            ...mover, banked: cashOf(event.seat), home: mover.stops[0]?.city ?? null,
          };
        }
        {
          // The win: a declared run's moved ending at the home node, with
          // the target still in hand after this turn's fees — settleFees
          // has already run if the turn closed, and Task 7's poverty sweep
          // clears toHome when it broke the target, so `toHome` here means
          // "still able to win".
          const mover = state.seats[event.seat];
          if (state.winner === null && mover.run?.toHome === true
              && mover.home !== null && mover.at === nodeForCity(mover.home)) {
            state.winner = event.seat;
          }
        }
```

  and in the open-turn block, add the forfeit clause — a declared pawn
  "stops immediately when it reaches its home city", so any Bonus Roll
  still owed has no trip to spend itself on:

```ts
          const mover = state.seats[event.seat];
          const homeRun = mover.run?.toHome === true
            && mover.home !== null && mover.at === nodeForCity(mover.home);
          if (homeRun || open.legs >= 2 || !owed) {
            settleFees(open);
            taken += 1; open = null;
          }
```

  (**Order within the case matters and is the win rule:** position/`used`
  update → `inFlight` clear on arrival → `lastMove` → *(Task 7 inserts the
  rover and the alternate arrival here)* → open-turn bookkeeping with
  `settleFees` on close → *(Task 7 inserts the poverty sweep inside
  `settleFees`)* → money/home refresh → win check. Write the case in that
  order now so Task 7 only inserts.)

  The post-loop pass loses `homeward`:

```ts
  for (const sid of SEATS) {
    const seat = state.seats[sid];
    state.seats[sid] = { ...seat, home: seat.stops[0]?.city ?? null, banked: cashOf(sid) };
  }
```

  **`turns.ts`:** `destinationOf` re-keys on the run —

```ts
export const destinationOf = (seat: Seat): CityId | null =>
  // A declared baron's destination IS home; a caught or impoverished one's
  // is the alternate the declare carried. One seam serving both surfaces,
  // exactly as it served phase-1 homeward: the map's draft walks toward
  // it, and needsDestination() goes structurally false mid-run.
  seat.run !== null
    ? (seat.run.toHome ? seat.home : seat.run.alternate.city)
    : seat.stops.length >= 2 ? seat.stops[seat.stops.length - 1]!.city : null;
```

  and two new derivations (import `nodeForCity` — `turns.ts` already
  imports engine values):

```ts
/**
 * The rulebook's three conditions, verbatim: "1) have $200,000 or more in
 * cash, 2) be in his latest destination city, and 3) be about to roll for
 * a new destination". Cash is banked — fees already netted. Lights the
 * choice for the UI and gates the event for legal.ts; changes nothing by
 * itself (spec Decision 3).
 */
export function mayDeclare(state: GameState, id: SeatId): boolean {
  const seat = state.seats[id];
  if (state.phase !== 'playing' || seat.run !== null) return false;
  if (seat.stops.length < 2) return false;   // home is a stop, never a destination
  const latest = seat.stops[seat.stops.length - 1]!.city;
  return seat.at === nodeForCity(latest) && seat.banked >= state.rules.winTarget;
}

/** The seat a fee bill has put under zero, if any — the liquidation gate. */
export const shortSeat = (state: GameState): SeatId | null =>
  SEATS.find((id) => state.seats[id].banked < 0) ?? null;
```

  **`legal.ts`, mechanically:** `seat.homeward` guards in `arrived` and
  `regionRequested` become `seat.run !== null` with the message
  `'a declared baron rolls no destinations — the trip is already set'`;
  `turnRolled`'s conjunct becomes `seat.run === null &&
  needsDestination(...)`; `bonusRolled`'s becomes `(seat.run !== null ||
  !needsDestination(...))`.

  **`useGame.ts` / `useOnlineGame.ts`, mechanically and in the same
  words:** `current.homeward` → `current.run !== null` in `roll`;
  `!rollingSeat.homeward &&` → `rollingSeat.run === null &&` in
  `rollDice`; `!bonusSeat.homeward &&` → `bonusSeat.run === null &&` in
  `rollBonus`.

  **`MoneyStrip.tsx`:** the homeward line becomes the run —

```tsx
{seat.run !== null && state.winner === null && (
  <em>{seat.run.toHome
    ? ` declared — racing home to ${seat.home === null ? '?' : cityById(seat.home).name}`
    : ` caught — bound for ${cityById(seat.run.alternate.city).name}`}</em>
)}
```

  (its test's `homeward` fixture becomes a log with a `declare(...)` event,
  asserting `/declared — racing home to Chicago/i`).

  **`legalMoney.test.ts`:** its homeward describes assert the same refusals
  through the new guards — build the logs with a `declared` event (the
  helpers above) and match the new message (`/declared baron/`).

- [ ] **Step 5: Run the whole package — green**, including the app project
  (MoneyStrip renders). `grep -rn "homeward" games/railbaron/src` must
  come back **empty**.

- [ ] **Step 6: Commit**

```bash
git add -A games/railbaron/src
git commit -m "feat: declaring replaces silent homeward — the run home is an announced event, the win needs it"
```

---

### Task 7: the rover, poverty, and the road to the alternate

**Files:**
- Modify: `games/railbaron/src/state/game.ts`
- Test: `games/railbaron/src/state/rover.test.ts` (create)

**Interfaces:**
- Consumes: `ROVER_PRIZE` (Task 4), `DeclaredRun` (Task 6).
- Produces: cancellation as a derivation — Tasks 8, 10, 11 rely on
  `run.toHome` flipping false on a catch or a dip, and on the alternate
  arrival appending a real stop.

- [ ] **Step 1: Write the failing tests.** The catch needs two pawns on
  real adjacent nodes: red's latest destination **St. Paul** (`c95`), blue
  travelling `['c13', 'c95']` — a real edge (the golden header's spur;
  verify as in Task 4). Use `MPLS`/`STP` so the assign payouts are $0 and
  the arithmetic stays legible; set `winTarget: 1` in a bespoke `opening`
  so a single real payout … **no** — $0 payouts never reach a target, so
  this file's opening uses `winTarget: 1000` and red banks
  Chicago→New York first, then is assigned St. Paul. Concretely:

```ts
// games/railbaron/src/state/rover.test.ts
// ...helpers as before...
const runnerAtStPaul = (): GameEvent[] => [
  ...opening(CHICAGO, MIAMI),                        // red home Chicago, blue Miami
  assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
  assign('red', NEW_YORK, STP), ...walk('red', NEW_YORK, STP),
  declare('red', STP, MPLS),                          // alternate: Minneapolis, $0
];

describe('the rover play', () => {
  it('transfers $50,000 to the first catcher and clears the declaration', () => {
    const before = replay(runnerAtStPaul());
    const caught = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },
    ]);
    expect(caught.seats.red.banked).toBe(before.seats.red.banked - 50000);
    expect(caught.seats.blue.banked).toBe(before.seats.blue.banked + 50000 - 1000);
    //                              blue's own turn still owes its bank fee ↑
    expect(caught.seats.red.run).toEqual({
      alternate: { city: MPLS, region: cityById(MPLS).region, payout: 0 },
      toHome: false,
    });
    expect(destinationOf(caught.seats.red)).toBe(MPLS);
    expect(caught.winner).toBeNull();
  });

  it('moving *through* the runner\'s dot catches too — and only the first pawn collects', () => {
    const through = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95', 'c13'], arrived: false },
      // A second pass finds no declared pawn: the run is already cleared.
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: true },
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },
    ]);
    // Red's whole ledger, folded from the events, never from memory:
    // both trips' payouts, the alternate's $0, one rover payment, and the
    // $1,000 their own real-edge turn to the alternate billed. Blue's
    // second pass finds no declared pawn — the run cleared on the first.
    expect(through.seats.red.banked).toBe(
      payoutBetween(CHICAGO, NEW_YORK) + payoutBetween(NEW_YORK, STP)
      - 50000 - 1000);
  });

  it('starting beside the runner is not a catch — the path\'s first node is where the pawn already was', () => {
    const state = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c95', 'c13'], arrived: false },
    ]);
    expect(state.seats.red.run?.toHome).toBe(true);
  });
});

describe('the road to the alternate', () => {
  it('a caught runner arrives at the alternate, collects its payout, and may re-declare', () => {
    const log: GameEvent[] = [
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },   // catch
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: true },      // alternate reached
    ];
    const state = replay(log);
    const red = state.seats.red;
    expect(red.run).toBeNull();
    expect(red.stops[red.stops.length - 1])
      .toEqual({ city: MPLS, region: cityById(MPLS).region, payout: 0 });
    expect(currentCity(red)).toBe(MPLS);
    // Standing at a fresh latest destination, re-declaring is the
    // ordinary eligibility rule again — which on THIS bankroll answers
    // false: the $50,000 rover payment sank red far below the target.
    // The affirmative case (caught, re-funded, re-declared) is Task 11's
    // golden, which scripts a bankroll that survives the hit.
    expect(mayDeclare(state, 'red')).toBe(false);
    expect(red.banked).toBeLessThan(state.rules.winTarget);
    expect(state.winner).toBeNull();
  });
});

describe('un-declaring by poverty', () => {
  it('a fee that breaks the target clears the declaration', () => {
    // Target 1000; red's cash after declaring sits at exactly the NY payout.
    // A rules override pins the target just under it so one $1,000 bank fee
    // breaks the line: winTarget: payoutBetween(CHICAGO, NEW_YORK).
    const tight: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'A' },
      { type: 'joined', seat: 'blue', name: 'B' },
      { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: payoutBetween(CHICAGO, NEW_YORK) } },
      home('red', CHICAGO), home('blue', MIAMI),
      { type: 'orderRolled', seat: 'red', first: 'red' },
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      declare('red', NEW_YORK, MIAMI),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      // Any real edge anywhere: fee fires at close. Fold tolerance lets a
      // test walk red on rails their pawn never stood beside.
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(tight);
    expect(state.seats.red.banked).toBeLessThan(state.rules.winTarget);
    expect(state.seats.red.run?.toHome).toBe(false);
  });
});
```

  (Adjust the `mayDeclare` re-eligibility assertion to a direct boolean
  once cash arithmetic for the fixture is settled at implementation — the
  point of the assertion is that eligibility is *the ordinary rule again*,
  nothing sticky. Also note red's `moved` legs above pay their own $1,000
  turns; fold every expected balance from the events, never from memory.)

- [ ] **Step 2: Run — FAIL** (no transfer, no cancellation, no alternate stop).

- [ ] **Step 3: Implement in `game.ts`, three insertions in the `moved`
  case** (the slots Task 6 left, in this order):

  After `state.lastMove = ...`:

```ts
        // The Rover Play, as a derivation (spec Decision 3): the paths are
        // in the log and so is every pawn's position, so no new message
        // can disagree with the movement that caused a catch. "The first
        // player to move onto or through a dot occupied by the declared
        // pawn collects $50,000" — path[0] is where the mover already
        // stood, so it does not count as moving onto anyone.
        for (const sid of SEATS) {
          if (sid === event.seat) continue;
          const runner = state.seats[sid];
          if (runner.run?.toHome !== true || runner.at === null) continue;
          if (event.path.slice(1).includes(runner.at)) {
            credit(sid, -ROVER_PRIZE);
            credit(event.seat, ROVER_PRIZE);
            // "He pays only the first pawn that catches him — after that
            // he is no longer declared": clearing toHome here is both the
            // payment cap and the cancellation.
            state.seats[sid] = { ...runner, run: { ...runner.run, toHome: false } };
          }
        }
        {
          // A cancelled run ends where the declare said it would: arrival
          // at the alternate appends the stop the trip was owed, pays the
          // carried payout, and hands back the ordinary rules — including
          // re-declaring next trip.
          const mover = state.seats[event.seat];
          if (mover.run !== null && !mover.run.toHome
              && mover.at === nodeForCity(mover.run.alternate.city)) {
            const { alternate } = mover.run;
            state.seats[event.seat] = {
              ...mover,
              run: null,
              earned: mover.earned + alternate.payout,
              stops: [...mover.stops,
                      { city: alternate.city, region: alternate.region,
                        payout: alternate.payout }],
            };
            // No inFlight entry: this payout banks now, on arrival — the
            // one stop that is never assigned ahead of being walked.
          }
        }
```

  And inside `settleFees`, at the end:

```ts
    // Un-declaring by poverty: "as soon as a declared player falls below
    // $200,000 … he is no longer declared." Below the target is below the
    // target, whichever bill did it — this sweep and the rover's own clear
    // are the only two ways a declaration ends short of winning.
    for (const sid of SEATS) {
      const runner = state.seats[sid];
      if (runner.run?.toHome === true && cashOf(sid) < state.rules.winTarget) {
        state.seats[sid] = { ...runner, run: { ...runner.run, toHome: false } };
      }
    }
```

  **Two facts to leave as they fall out, each with a comment:** nothing
  resets `used` at cancellation — "the interrupted trip to his home city
  and the following trip to his alternate destination count as parts of
  the same trip", and the sections carry over precisely because no code
  touches them (the arrival at the alternate releases them, as every
  arrival does). And the rulebook's reuse *mercy* ("if he has no other way
  … no more than is absolutely necessary") is **not implemented**: the
  draft UI keeps refusing reused sections, and a genuinely stranded
  cancelled runner is resolved at the table — the honor level the spec
  assigns it, worth one comment on the cancellation block so nobody reads
  the strictness as an oversight.

  Finally, restore the cancelled-run test stubbed in Task 6 Step 2 (it now
  has a cause) if it was skipped rather than moved here.

- [ ] **Step 4: Run: `npx vitest run --root games/railbaron` — green.**

- [ ] **Step 5: Commit**

```bash
git add games/railbaron/src/state/game.ts games/railbaron/src/state/rover.test.ts \
  games/railbaron/src/state/endRule.test.ts
git commit -m "feat: the rover and the alternate — a catch is a derivation, poverty un-declares, the trip continues"
```

---

### Task 8: `legal.ts` — the windows, the audit, the liquidation gate, the seeded declare

**Files:**
- Modify: `games/railbaron/src/state/legal.ts`,
  `games/railbaron/src/state/seeded.ts`
- Test: `games/railbaron/src/state/legalMoney.test.ts` (extend),
  `games/railbaron/src/state/seeded.test.ts` (extend)

**Interfaces:**
- Consumes: `mayDeclare`, `shortSeat` (Task 6), `railroadPrice`,
  `bankSalePrice` (Task 1), `state.owners` (Task 3).
- Produces: no new exports — `appendLegality` behaviour Tasks 9–11 rely
  on: *bought only in the arrival window and within the balance; declared
  only when eligible, payout audited; sold only while short, at half
  price; a short game refuses everything else.*

- [ ] **Step 1: Failing tests** in `legalMoney.test.ts` (helpers as
  before; **mind the turn-order trap the phase-1 tests documented** — every
  builder must leave the acting seat genuinely up, and every refusal is
  asserted by message, never only by non-null):

```ts
describe('the purchase window', () => {
  // red stands at New York, paid, owing a destination roll — the window.
  it('opens on arrival, closes with the destination roll, never blocks rolling', () => {
    const window = brink();   // red walked to NEW_YORK; red's turn is done…
    // …so the builder must hand the turn back: give blue a full walk()
    // turn first, exactly as the phase-1 note prescribes.
    expect(appendLegality(window,
      { type: 'bought', seat: 'red', railroad: 'NYC', price: railroadPrice('NYC') },
      'red')).toBeNull();
    // Several in one window: append one, ask about a second.
    // Rolling was never blocked: regionRequested stays legal in the window.
  });
  it('refuses the wrong price, the owned railroad, and the empty purse', () => {
    // wrong price → /price list/; already bought by blue → /already owned/;
    // price > banked → /balance/.
  });
  it('refuses a purchase from a declared baron — the window closed at declare', () => {
    // declared log → /window/ (or the exact message below).
  });
});

describe('declaring', () => {
  it('needs all three conditions and audits the alternate payout', () => {
    // eligible log → null; not at latest destination → refusal; short of
    // target → refusal; wrong payout → /payout table/.
  });
});

describe('the liquidation gate', () => {
  // A log where a fee has left red at −N (build with the Task 5 fixtures).
  it('refuses every event while a seat is short — except the sale that pays', () => {
    // blue's perfectly ordinary turnRolled → /sold|sell|bill/ refusal;
    // red's sold at bankSalePrice → null;
    // red's sold at any other price → /half/;
    // blue selling (not short) → /only for meeting a bill/;
    // once the sale would clear the debt, replay+append shows play resumes.
  });
});
```

  Flesh each comment into a real assertion at implementation; the builders
  are the work, the rules above are exact.

- [ ] **Step 2: Run — FAIL** (Task 2's placeholders refuse everything).

- [ ] **Step 3: Implement in `legal.ts`.**

  After the seed-conformance gate, the liquidation gate:

```ts
  // Negative at settlement blocks everything: the forced, ordered flow is
  // fee assessed → short → sell until covered → play continues
  // (docs/rules/user-fees.md). Only the sale that raises money passes.
  if (shortSeat(state) !== null && event.type !== 'sold') {
    return not('notNow', 'a fee bill is unmet — railroads must be sold to the bank first');
  }
```

  After the seat-match check and **before** the actor check (a short seat
  is usually not the actor — their turn closed when the bill landed):

```ts
  if (event.type === 'sold') {
    const seller = state.seats[sender];
    if (seller.banked >= 0) return not('notNow', 'selling is only for meeting a bill');
    if (state.owners.get(event.railroad) !== sender) {
      return not('notNow', 'that railroad is not yours to sell');
    }
    return event.price === bankSalePrice(event.railroad)
      ? null : not('notNow', 'the bank pays half the purchase price, exactly');
  }
```

  In the switch, replacing the Task 2 placeholders:

```ts
    case 'bought': {
      // The window (table's decision, 2026-08-23): on arrival, after being
      // paid, before rolling the next destination — the same
      // standing-at-your-stop state that gates the destination roll. It
      // never blocks rolling: skipping is simply rolling.
      if (state.phase !== 'playing') return not('notNow', 'the game has not begun');
      if (seat.run !== null) {
        return not('notNow', 'a declared baron\'s buying window closed at the declare');
      }
      if (!needsDestination(seat, nodeForCity)) {
        return not('notNow', 'railroads are bought on arrival, before the next destination');
      }
      if (state.owners.has(event.railroad)) return not('notNow', 'already owned');
      if (event.price !== railroadPrice(event.railroad)) {
        return not('notNow', 'that is not what the price list says');
      }
      // Nothing limits the count but the balance (spec Decision 1).
      return event.price <= seat.banked
        ? null : not('notNow', 'the balance does not cover it');
    }

    case 'declared': {
      if (!mayDeclare(state, sender)) {
        return not('notNow',
          'declaring needs the target in hand, at your latest destination, before the roll');
      }
      const from = currentCity(seat)!;
      const { city, payout } = event.alternate;
      if (city === from) return not('notNow', 'already there');
      // The payout is the table's, exactly as arrived's is — it banks
      // nothing today, but a cancelled run will pay it, so it is audited
      // on the way in, not on the way out.
      return payout === payoutBetween(from, city)
        ? null : not('notNow', 'that is not what the payout table says');
    }
```

  (`import { railroadPrice, bankSalePrice }` from the engine;
  `mayDeclare`, `shortSeat` from `./turns.js`.)

- [ ] **Step 4: The seeded declare.** In `seeded.ts`: `ROLL_TYPES` gains
  `'declared'` (the alternate is rolled at declaration — a roll-bearing
  event, so it advances the count), and the switch gains:

```ts
    case 'declared': {
      const seat = state.seats[event.seat];
      const from = currentCity(seat);
      if (from === null) return refused;
      const outcome = rollDestination(from, rng, homesTaken(state));
      const alt = event.alternate;
      if (outcome.kind === 'arrived') {
        return outcome.city === alt.city ? null : refused;
      }
      if (outcome.kind === 'chooseRegion') {
        // The region was the player's free choice; the city must be the
        // seed's roll within it, drawn from the same stream — one event,
        // one stream, choice and all.
        return destinationInRegion(from, alt.region, rng).city === alt.city
          ? null : refused;
      }
      return refused;   // 'home' needs from === null, unreachable here
    }
```

  `seeded.test.ts` gains two cases: a declared whose alternate is the
  seed's own prescription passes; any other city is refused. Generate the
  prescription in the test exactly as the hook will
  (`rollDestination(from, nextRng(log, seed), homesTaken(state))`, with the
  `chooseRegion` branch continued on the same stream) so the test *is* the
  generation/verification agreement, as the file's header promises.

- [ ] **Step 5: Run the package — green**, including the wire suites
  (`gameSocket.test.ts`, `goldenSocket.test.ts` — the guard against
  over-refusing).

- [ ] **Step 6: Commit**

```bash
git add games/railbaron/src/state/legal.ts games/railbaron/src/state/seeded.ts \
  games/railbaron/src/state/legalMoney.test.ts games/railbaron/src/state/seeded.test.ts
git commit -m "feat: legal.ts prices the windows — buying on arrival, declaring audited, a short game sells or waits"
```

---

### Task 9: the hooks — buy, declare, sell, mirrored

**Files:**
- Modify: `games/railbaron/src/net/useOnlineGame.ts`,
  `games/railbaron/src/state/useGame.ts`,
  `games/railbaron/src/GameShell.ts` (the `GameSurface` interface only —
  the shell's *behaviour* is Task 10)
- Test: `games/railbaron/src/state/useGame.test.tsx` (extend — it has the
  render harness; the online hook's parity is enforced by the shared
  interface and Task 10's screens)

**Interfaces:**
- Produces — `GameSurface` (and therefore both hooks) gains:

```ts
  buy(seat: SeatId, railroad: RailroadId): void;
  rollDeclare(seat: SeatId): RollOutcome | null;
  commitDeclare(seat: SeatId, alternate: Arrival): void;
  declareChooseRegion(seat: SeatId, region: RegionId): void;
  sell(seat: SeatId, railroad: RailroadId): void;
```

- [ ] **Step 1: Failing tests** in `useGame.test.tsx`, following its
  existing render-and-drive idiom (read one test first for the harness):
  a seated pass-and-play game where the actor buys in the window (state
  shows the holding and the debit); a buy outside the window appends
  nothing; an eligible seat's `rollDeclare` returns an outcome and
  `commitDeclare` folds to a run; `sell` while short restores the balance.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement in `useOnlineGame.ts`** (each guard is `legal.ts`'s
  clause in the same words — that symmetry is the design):

```ts
  const buy = useCallback((seat: SeatId, railroad: RailroadId) => {
    if (seat !== mySeat) return;
    const buyer = state.seats[seat];
    if (state.phase !== 'playing' || actor !== seat) return;
    if (buyer.run !== null) return;                       // window closed at declare
    if (!needsDestination(buyer, nodeForCity)) return;    // bought on arrival only
    if (state.owners.has(railroad)) return;
    const price = railroadPrice(railroad);
    if (price > buyer.banked) return;
    transport.append({ type: 'bought', seat, railroad, price });
  }, [state, actor, transport, mySeat]);

  const rollDeclare = useCallback((seat: SeatId): RollOutcome | null => {
    if (seat !== mySeat) return null;
    if (!mayDeclare(state, seat) || actor !== seat) return null;
    // The alternate is an ordinary destination roll, made at declaration.
    return rollDestination(currentCity(state.seats[seat]), liveRng, homesTaken(state));
  }, [state, actor, liveRng, mySeat]);

  const commitDeclare = useCallback((seat: SeatId, alternate: Arrival) => {
    transport.append({ type: 'declared', seat,
      alternate: { city: alternate.city, region: alternate.region, payout: alternate.payout } });
  }, [transport]);

  const declareChooseRegion = useCallback((seat: SeatId, region: RegionId) => {
    if (seat !== mySeat) return;
    const from = currentCity(state.seats[seat]);
    if (from === null) return;
    // One roll event, one stream: in a seeded game liveRng is a fresh
    // stream for this event, so re-drawing the region roll (whose outcome
    // was chooseRegion) reproduces it exactly and the city continues the
    // same stream — precisely what seedConformance regenerates. Unseeded,
    // the re-draw is just two spent random numbers.
    rollDestination(from, liveRng, homesTaken(state));
    const arrival = destinationInRegion(from, region, liveRng);
    transport.append({ type: 'declared', seat,
      alternate: { city: arrival.city, region, payout: arrival.payout } });
  }, [state, liveRng, transport, mySeat]);

  const sell = useCallback((seat: SeatId, railroad: RailroadId) => {
    if (seat !== mySeat) return;
    const seller = state.seats[seat];
    if (seller.banked >= 0) return;                       // selling is only for meeting a bill
    if (state.owners.get(railroad) !== seat) return;
    transport.append({ type: 'sold', seat, railroad, price: bankSalePrice(railroad) });
  }, [state, transport, mySeat]);
```

  Return them all; add the imports (`railroadPrice`, `bankSalePrice`,
  `Arrival` type; `mayDeclare` from `../state/turns`).

- [ ] **Step 4: Mirror in `useGame.ts`** — same five callbacks, same guards
  in the same words, minus the `mySeat` gate (pass-and-play speaks for
  every baron) and with `append` being its `setEvents(events => [...events,
  event])` form (read its existing `commitRoll` for the exact shape).
  Widen `GameSurface` in `GameShell.ts` with the five signatures so both
  hooks are held to it by the compiler.

- [ ] **Step 5: Run the package — green. Commit**

```bash
git add games/railbaron/src/net/useOnlineGame.ts games/railbaron/src/state/useGame.ts \
  games/railbaron/src/GameShell.ts games/railbaron/src/state/useGame.test.tsx
git commit -m "feat: the hooks learn to buy, declare and sell — guards mirrored from legal.ts, word for word"
```

---

### Task 10: the board — the office, the declare row, the forced sale

The departures idiom, not a new surface: rows, takeover screens, the flap
vocabulary. The spec's hard requirements: buying never blocks rolling;
every purchase visible to the table; the MoneyStrip shows holdings.

**Files:**
- Modify: `games/railbaron/src/board/types.ts` (RowAction),
  `games/railbaron/src/board/screens/play.ts` (two rows),
  `games/railbaron/src/GameShell.ts` (wiring),
  `games/railbaron/src/board/MoneyStrip.tsx` (+ test)
- Create: `games/railbaron/src/board/screens/office.ts` (+ test),
  `games/railbaron/src/board/screens/liquidation.ts` (+ test)

- [ ] **Step 1: RowAction grows four kinds** in `types.ts`:

```ts
  /** Buy the named railroad, at the price list's price. */
  | { kind: 'buy'; railroad: RailroadId }
  /** Forced sale to the bank, half price — the liquidation screen's rows. */
  | { kind: 'sell'; railroad: RailroadId }
  /** Announce the run home; rolls the alternate. */
  | { kind: 'declare'; seat: SeatId }
  /** Toggle the railroad office; page turns the listing. */
  | { kind: 'office'; page?: number }
```

- [ ] **Step 2: Failing screen tests.**

  `office.test.ts`: lists unowned railroads with prices in the amount
  column; an unaffordable line renders `dim` with no action; an owned
  railroad is absent; more than five unowned yields a "More railroads" row
  carrying `{ kind: 'office', page: n + 1 }`; the last row is always
  "Back — roll the next destination" carrying `{ kind: 'office' }`.

  `liquidation.test.ts`: titled for the short baron, one row per holding
  at `bankSalePrice` with `{ kind: 'sell', railroad }`, and a sub line
  naming the shortfall (`dollars(-banked)` owed).

  `play.test.ts` additions: when the actor is in the purchase window and
  at least one railroad is unowned, a "Railroad Office" row appears (kind
  `office`); when `mayDeclare`, a "Declare" row appears (kind `declare`);
  with six barons seated neither row appears (the Undo precedent — no
  spare slot, and the board never grows).

- [ ] **Step 3: Implement the screens.**

```ts
// games/railbaron/src/board/screens/office.ts
// The railroad office: the purchase window as a takeover screen, paged
// five to a board because there are 28 railroads and seven rows, without
// exception. Skippable by design — the Back row is the destination roll's
// doorway, so buying can never block rolling.
import { RAILROADS, railroadPrice } from '../../../engine';
import type { GameState } from '../../state/game';
import { blankRow, padRows, BOARD_ROWS, type Row, type ScreenDef } from '../types';

const PER_PAGE = 5;

export function office(state: GameState, page: number): ScreenDef {
  const unowned = [...RAILROADS.values()]
    .filter((line) => !state.owners.has(line.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const pages = Math.max(1, Math.ceil(unowned.length / PER_PAGE));
  const at = ((page % pages) + pages) % pages;
  const buyer = state.turn === null ? null : state.seats[state.turn];
  const cash = buyer?.banked ?? 0;

  const rows: Row[] = unowned.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE)
    .map((line) => {
      const price = railroadPrice(line.id);
      const affordable = price <= cash;
      return {
        ...blankRow(),
        label: line.id,
        text: line.name,
        amount: price.toLocaleString('en-US'),
        showDollar: true,
        tone: affordable ? 'normal' : 'dim',
        action: affordable ? { kind: 'buy', railroad: line.id } : null,
      };
    });

  const padded = padRows(rows).slice(0, BOARD_ROWS);
  if (pages > 1) {
    padded[BOARD_ROWS - 2] = { ...blankRow(), label: 'More',
      text: `Page ${at + 1} of ${pages}`, tone: 'dim',
      action: { kind: 'office', page: at + 1 } };
  }
  padded[BOARD_ROWS - 1] = { ...blankRow(), label: 'Back',
    text: 'Roll the next stop', tone: 'normal', action: { kind: 'office' } };

  return {
    title: 'Railroads',
    sub: 'FOR SALE',
    back: null,
    cols: ['Line', '', 'Railroad', 'Price', ''],
    rows: padded,
  };
}
```

```ts
// games/railbaron/src/board/screens/liquidation.ts
// The forced sale, as a takeover — the regionBallot precedent: the board
// keeps its shape instead of opening a dialog over it. It appears because
// legal.ts is refusing everything else anyway; the screen only offers the
// one legal act.
import { bankSalePrice, RAILROADS } from '../../../engine';
import { SEAT_COLORS } from '../../game/tokens';
import type { GameState, Seat } from '../../state/game';
import { blankRow, padRows, type Row, type ScreenDef } from '../types';

export function liquidation(state: GameState, short: Seat): ScreenDef {
  const rows: Row[] = short.holdings.map((id) => ({
    ...blankRow(),
    label: id,
    text: RAILROADS.get(id)?.name ?? id,
    amount: bankSalePrice(id).toLocaleString('en-US'),
    showDollar: true,
    chip: SEAT_COLORS[short.id],
    tone: 'normal',
    action: { kind: 'sell', railroad: id },
  }));
  return {
    title: 'Forced sale',
    sub: `${(short.name ?? short.id).toUpperCase()} OWES ${(-short.banked).toLocaleString('en-US')}`,
    back: null,
    cols: ['Line', '', 'Railroad', 'Bank pays', ''],
    rows: padRows(rows),
  };
}
```

  (A short baron with **no holdings** renders an all-blank board here —
  the spec's honest stall: elimination is not implemented until its text
  arrives, and the table resolves it by house rule. Put that sentence in a
  comment on `liquidation`, and give the empty case a single dim,
  actionless row saying `Nothing left to sell — house rule` so the table
  is told rather than puzzled.)

- [ ] **Step 4: The play screen's two rows** — in `play.ts`, after the Undo
  block and following its exact precedent (fixed index, only when a slot is
  free; with the office row at `BOARD_ROWS - 4` and declare at
  `BOARD_ROWS - 3`, checked against `rows.length` so barons always win the
  space):

```ts
  const actor = state.turn;
  if (actor !== null && state.phase === 'playing') {
    const seat = state.seats[actor];
    const windowOpen = seat.run === null && needsDestination(seat, nodeForCity)
      && state.owners.size < RAILROADS.size;
    if (windowOpen && rows.length < BOARD_ROWS - 3) {
      withMap[BOARD_ROWS - 4] = { ...blankRow(), label: 'Office',
        text: 'Buy railroads', tone: 'dim', action: { kind: 'office', page: 0 } };
    }
    if (mayDeclare(state, actor) && rows.length < BOARD_ROWS - 2) {
      withMap[BOARD_ROWS - 3] = { ...blankRow(), label: 'Declare',
        text: 'Race for home', tone: 'normal', action: { kind: 'declare', seat: actor } };
    }
  }
```

  (Exact indices and free-slot arithmetic to be settled against the file at
  implementation — the requirement is the Undo precedent: pinned rows,
  barons never displaced, six-baron boards drop the extras. Import
  `mayDeclare`, `RAILROADS`.)

- [ ] **Step 5: GameShell wiring.** New state:

```ts
  const [declaring, setDeclaring] =
    useState<{ seat: SeatId; outcome: RollOutcome } | null>(null);
  const [officePage, setOfficePage] = useState<number | null>(null);
```

  Screen selection (order matters — the forced sale outranks everything,
  as `legal.ts` does):

```ts
  const short = shortSeat(state);
  const gameScreen: ScreenDef = state.phase === 'homes'
    ? homes(...)
    : short !== null
      ? liquidation(state, state.seats[short])
      : awaiting
        ? regionBallot(awaiting)
        : declaring?.outcome.kind === 'chooseRegion'
          ? regionBallot({ ...state.seats[declaring.seat],
                           awaiting: declaring.outcome.rolled })
          : officePage !== null
            ? office(state, officePage)
            : play(state, turns,
                   (rolling ?? declaring) && { seat: (rolling ?? declaring)!.seat,
                     region: regionOf((rolling ?? declaring)!.outcome) },
                   rollingDice?.roll ?? null, rollingBonus?.face ?? null);
```

  `actOnRow` grows four branches (before the existing `act` handling; each
  respects `actAs` exactly as `act` does):

```ts
    if (row.action.kind === 'office') {
      // A paged action turns the page; a bare one toggles the office.
      const { page } = row.action;
      setOfficePage(page !== undefined ? page : officePage === null ? 0 : null);
      return true;
    }
    if (row.action.kind === 'buy') {
      if (state.turn !== null && (actAs === 'all' || state.turn === actAs)) {
        game.buy(state.turn, row.action.railroad);
      }
      return true;
    }
    if (row.action.kind === 'declare') {
      const seat = row.action.seat;
      if (actAs !== 'all' && seat !== actAs) return true;
      if (rolling !== null || declaring !== null) return true;
      const outcome = game.rollDeclare(seat);
      if (outcome === null) return true;
      setTurns((counted) => ({ ...counted, [seat]: (counted[seat] ?? 0) + 1 }));
      setDeclaring({ seat, outcome });
      return true;
    }
    if (row.action.kind === 'sell') {
      const seller = shortSeat(state);
      if (seller !== null && (actAs === 'all' || seller === actAs)) {
        game.sell(seller, row.action.railroad);
      }
      return true;
    }
```

  The ballot branch of `act` learns the declaring case (the choice row is
  the region, exactly as today):

```ts
      if (declaring?.outcome.kind === 'chooseRegion') {
        if (actAs !== 'all' && declaring.seat !== actAs) return true;
        game.declareChooseRegion(declaring.seat, REGIONS[index]!.id);
        setDeclaring(null);
        return true;
      }
```

  And `awaitRegion` announces a rolled alternate the way it announces a
  rolled destination:

```ts
    awaitRegion: rolling
      ? { row: ..., onLanded: () => { game.commitRoll(...); setRolling(null); } }
      : declaring !== null && declaring.outcome.kind === 'arrived'
        ? { row: seatedIndexOf(declaring.seat),
            onLanded: () => {
              game.commitDeclare(declaring.seat, declaring.outcome as Arrival);
              setDeclaring(null);
            } }
        : null,
```

  (`declaring.outcome.kind === 'home'` cannot happen — the seat has a
  current city; narrow with the same cast pattern the file already uses.
  Reset `officePage` to null whenever `state.turn` changes — one
  `useEffect` or a derivation guard — so the office never survives into
  the next baron's turn.)

- [ ] **Step 6: MoneyStrip holdings.** Each seated row gains, after the
  banked figure: `{seat.holdings.length > 0 && <span> · {seat.holdings.length} RR</span>}`,
  and `dollars` learns the sign:
  `const dollars = (amount: number): string =>
  `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('en-US')}`;`
  Tests: a holdings count renders; a negative balance renders with the sign.

- [ ] **Step 7: Run both projects: `npx vitest run --root games/railbaron` — green. Commit**

```bash
git add games/railbaron/src/board games/railbaron/src/GameShell.ts
git commit -m "feat: the office, the declare row, and the forced sale — the board learns phase 2, seven rows as ever"
```

---

### Task 11: the golden standards shelf, declared era

**Files:**
- Create: `games/railbaron/src/state/goldenPhase2.test.ts`
- Modify: `games/railbaron/src/state/goldenMoney.test.ts` (nothing to add —
  Task 6 already took the retirements; confirm what remains still passes)

Event-level scripts using the shared helpers, one `describe` per standard
from the spec's Testing section. **Fold-level standards drive `replay`
directly** (the fold is tolerant — no turn dance needed); **wire-facing
standards assert through `appendLegality` at every step**, with the
turn-order discipline the phase-1 notes prescribe.

- [ ] **Step 1: the purchase window, used and skipped** *(wire-facing)*:
  red arrives, `bought` legal, a second `bought` legal, `regionRequested`
  then legal (the window never blocked rolling); in a parallel script red
  skips straight to the roll and `bought` is refused after it.
- [ ] **Step 2: fee bills at all three tiers, the flip up and back**
  *(fold-level)*: a scripted log buys railroads until 27 are owned
  (`bought` events for every id but one — build the list from
  `RAILROAD_PRICES.keys()`, never literals), asserts a crossing turn bills
  `OWNER_FEE`; the 28th `bought` lands and the same crossing bills
  `ALL_OWNED_FEE`; a `sold` returns one to the bank and the tier drops
  back to `OWNER_FEE`. Real edges from the Task 4 fixtures.
- [ ] **Step 3: declare → rover catch → alternate arrival → re-declare**
  *(fold-level)*: the Task 7 St. Paul script extended one more trip: after
  re-arrival red declares again and `mayDeclare` was the ordinary rule.
- [ ] **Step 4: a declare cancelled by fees** *(fold-level)*: the Task 7
  poverty fixture, extended to the alternate arrival.
- [ ] **Step 5: the immediate win** *(wire-facing)*: red's latest
  destination is their home; `declared` accepted; every event type refused
  after (build one instance of each and loop — the phase-1 sweep pattern).
- [ ] **Step 6: liquidation forced and cleared** *(wire-facing)*: a fee
  leaves red short; every other seat's ordinary event refused; red's
  `sold` at half price accepted; balance restored; the next ordinary event
  accepted.
- [ ] **Step 7: Run everything: `npx vitest run --root games/railbaron` — green. Commit**

```bash
git add games/railbaron/src/state/goldenPhase2.test.ts games/railbaron/src/state/goldenMoney.test.ts
git commit -m "test: the phase-2 golden shelf — the window, three fee tiers and the flip, the rover cycle, the immediate win, the forced sale"
```

---

### Task 12: the maps catch up

**Files:**
- Modify: `docs/roadmap.md`, `docs/backlog.md`,
  `games/railbaron/ROADMAP.md`, `games/railbaron/CLAUDE.md`,
  `specs/2026-08-23-money-phase-2.md` (status + As built),
  `CLAUDE.md` (test count), `README.md` (test count + deploy note)

- [ ] **Step 1:** Roadmap and backlog: phase 2 struck through with date;
  what remains named — the four *Still owed* debts (forced-sale text,
  train timing, the two fee confirms, shared-trackage confirm), elimination
  unimplemented, `trainBought` designed-not-built.
- [ ] **Step 2:** Rail Baron's `CLAUDE.md` and `ROADMAP.md`: the money
  spec's second half is no longer "ahead"; ownership, fees, declare, the
  rover and the stub are in; the auction and elimination are the named
  holes.
- [ ] **Step 3:** The spec gains **Status: implemented** and an **As
  built** section recording every deviation the tasks forced (there will
  be some — the board-row indices, the office paging, whatever the
  turn-order builders taught). Deviations, not a rewrite.
- [ ] **Step 4: The deploy note the spec demands**, in README's deploying
  section (or beside it — match the file): deploying phase 2 changes what
  existing Rail Baron logs replay to. A phase-1 log's *finished* game
  replays as unfinished (the winner derivation now needs `declared`), an
  in-flight silently-homeward leader becomes merely eligible, and every
  past turn now bills its $1,000 bank fee. Game-night saves, not archives
  — accepted by the spec's Compatibility section, and this note is where
  an operator finds that out *before* the pull.
- [ ] **Step 5: The full gate, from the repo root:**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Update the test-count lines in `CLAUDE.md` and `README.md` to what
`npm test` truthfully prints.

- [ ] **Step 6: Commit**

```bash
git add docs/roadmap.md docs/backlog.md games/railbaron/ROADMAP.md \
  games/railbaron/CLAUDE.md specs/2026-08-23-money-phase-2.md CLAUDE.md README.md
git commit -m "docs: Rail Baron has its economy and its real endgame — and the maps say what replays differently"
```
