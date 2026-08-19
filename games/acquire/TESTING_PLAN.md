# Testing Plan for Acquire Startups M1

## Current State
- ❌ No test suite exists
- ❌ No linter configured
- ❌ No CI/CD pipeline for automated testing

## Goals
1. **Fast feedback**: Run tests locally in <5 seconds for TDD workflow
2. **Confidence**: Catch regressions before they reach production
3. **Documentation**: Tests serve as executable specifications of game rules
4. **Easier QA**: Automated tests replace manual testing for core mechanics

## Testing Strategy

### 1. Unit Tests (Priority: HIGH)
Test pure functions in isolation, especially game logic.

**Target Coverage:**
- `src/state/gameLogic.ts` - All game rule functions
- `src/utils/gameHelpers.ts` - Board utilities, coordinate math
- Share price calculations, bonus calculations, merger logic

**Benefits:**
- Fast (<1s for entire suite)
- Precise failure messages
- Easy to write and maintain
- Run on every file save (watch mode)

### 2. Integration Tests (Priority: MEDIUM)
Test how components interact with game state.

**Target Coverage:**
- Modal flows (BuyModal, FoundStartupModal, MergerLiquidationModal)
- State transitions between game stages
- Multiplayer synchronization

**Benefits:**
- Catch bugs in component/state interactions
- Validate user workflows
- More realistic than unit tests

### 3. E2E Tests (Priority: LOW - Future)
Test complete user flows in a real browser.

**Target Coverage:**
- Full game from setup to end
- Multiplayer room creation and joining
- Reconnection flows

**Benefits:**
- Highest confidence
- Tests real user experience

**Drawbacks:**
- Slow (30s-2min per test)
- Flaky (network, timing issues)
- Hard to maintain

## Test Framework Stack

### Recommended Setup
```json
{
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.1.4",
    "@testing-library/user-event": "^14.5.1",
    "@types/jest": "^29.5.5",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "ts-jest": "^29.1.1",
    "vitest": "^1.0.0" // Alternative to Jest, integrates with Vite
  }
}
```

### Option A: Vitest (Recommended)
- ✅ Native Vite integration
- ✅ Fast (uses Vite's transform pipeline)
- ✅ Jest-compatible API
- ✅ Built-in code coverage

### Option B: Jest
- ✅ More mature ecosystem
- ✅ Better IDE support
- ❌ Slower than Vitest
- ❌ Requires extra config for TypeScript

**Recommendation**: Use **Vitest** for speed and Vite integration.

## Critical Test Cases

### 1. Merger Logic (CRITICAL - Just Fixed!)

#### Test: Pre-merger prices are captured correctly
```typescript
test('merger bonuses use pre-merger share prices', () => {
  const state = createGameWithMergerSetup();
  // Absorbed startup has 5 tiles = tier 0 price = $500
  // Trigger merger
  handleTilePlacement(state, 'A3');

  // Check that bonuses calculated with $500, not $0
  const bonuses = (state as any).pendingBonuses;
  expect(bonuses[0].amount).toBe(5000); // 10x $500
});
```

#### Test: Held shares persist after liquidation
```typescript
test('held shares remain in portfolio after merger', () => {
  const state = createGameWithMergerSetup();
  handleTilePlacement(state, 'A3'); // Trigger merger
  finalizeMergerPayout(state);

  // Player chooses to hold 6 shares
  handleLiquidationChoice(state, 'player1', 'Gobble', 'Scrapple', 'hold');
  advanceLiquidationTurn(state);

  const player = state.players.find(p => p.id === 'player1');
  expect(player.portfolio['Gobble']).toBe(6); // ✅ Shares preserved
});
```

#### Test: Liquidation sale price uses pre-merger price
```typescript
test('selling shares uses correct pre-merger price', () => {
  const state = createGameWithMergerSetup();
  const initialCash = state.players[0].cash;

  handleTilePlacement(state, 'A3'); // Trigger merger
  finalizeMergerPayout(state);

  // Player sells 4 shares at pre-merger price ($500)
  handleLiquidationChoice(state, 'player1', 'Gobble', 'Scrapple', 'sell');

  const player = state.players.find(p => p.id === 'player1');
  expect(player.cash).toBe(initialCash + 2000); // 4 * $500
});
```

### 2. Share Pricing

```typescript
test('share price increases with startup size', () => {
  const state = createTestGame();
  state.startups['Gobble'].isFounded = true;

  // Size 2: $200 (tier 0)
  setBoardSize(state, 'Gobble', 2);
  expect(getSharePrice(state, 'Gobble')).toBe(200);

  // Size 6: $600
  setBoardSize(state, 'Gobble', 6);
  expect(getSharePrice(state, 'Gobble')).toBe(600);

  // Size 11 (safe): $700
  setBoardSize(state, 'Gobble', 11);
  expect(getSharePrice(state, 'Gobble')).toBe(700);
});

test('share price varies by tier', () => {
  const state = createTestGame();

  // Tier 0 @ size 5: $500
  state.startups['Gobble'].tier = 0;
  setBoardSize(state, 'Gobble', 5);
  expect(getSharePrice(state, 'Gobble')).toBe(500);

  // Tier 2 @ size 5: $700
  state.startups['Scrapple'].tier = 2;
  setBoardSize(state, 'Scrapple', 5);
  expect(getSharePrice(state, 'Scrapple')).toBe(700);
});
```

### 3. Safe Chain Rules

```typescript
test('cannot merge two safe chains', () => {
  const state = createTestGame();

  // Create two safe chains (11+ tiles each)
  createSafeChain(state, 'Gobble', 11);
  createSafeChain(state, 'Scrapple', 11);

  // Try to place tile that would merge them
  const result = handleTilePlacement(state, 'A5');

  expect(state.stage).toBe('play'); // ❌ Placement blocked
  expect(state.board['A5'].placed).toBe(false);
});

test('can merge safe chain with non-safe chain', () => {
  const state = createTestGame();

  createSafeChain(state, 'Gobble', 11); // Safe
  createChain(state, 'Scrapple', 5);     // Not safe

  handleTilePlacement(state, 'A5');

  expect(state.stage).toBe('mergerPayout'); // ✅ Merger allowed
});
```

### 4. Founding Startups

```typescript
test('founding startup grants free share to founder', () => {
  const state = createTestGame();
  const player = state.players[0];

  foundStartup(state, 'Gobble', 'A1');

  expect(player.portfolio['Gobble']).toBe(1);
  expect(state.startups['Gobble'].availableShares).toBe(24); // 25 - 1
});

test('cannot found startup if none available', () => {
  const state = createTestGame();

  // Found all 7 startups
  AVAILABLE_STARTUPS.forEach(s => {
    state.startups[s.id].isFounded = true;
  });

  const available = getAvailableStartups(state);
  expect(available).toHaveLength(0);
});
```

### 5. Buy Phase

```typescript
test('cannot buy more than 3 shares per turn', () => {
  const state = createTestGame();
  state.stage = 'buy';
  state.currentBuyCount = 0;

  buyShares(state, 'player1', 'Gobble', 2);
  expect(state.currentBuyCount).toBe(2);

  buyShares(state, 'player1', 'Gobble', 2); // Try to buy 2 more
  expect(state.currentBuyCount).toBe(3); // ✅ Capped at 3
});

test('cannot buy shares with insufficient cash', () => {
  const state = createTestGame();
  const player = state.players[0];
  player.cash = 100;

  const result = buyShares(state, 'player1', 'Gobble', 1); // $500 share

  expect(result).toBe(false);
  expect(player.cash).toBe(100); // Unchanged
});
```

## Test Utilities

Create helper functions to reduce boilerplate:

```typescript
// src/test/helpers.ts

export function createTestGame(options?: {
  playerCount?: number;
  seed?: string;
}): GameState {
  const players = Array.from({ length: options?.playerCount || 2 }, (_, i) => ({
    id: `player${i + 1}`,
    name: `Player ${i + 1}`,
    cash: 6000,
    hand: [],
    portfolio: {},
  }));

  return createInitialGame(players, options?.seed || 'test-seed');
}

export function setBoardSize(state: GameState, startupId: string, size: number) {
  // Clear existing tiles
  Object.values(state.board).forEach(cell => {
    if (cell.startupId === startupId) cell.startupId = undefined;
  });

  // Place exactly 'size' tiles
  const coords = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
  coords.slice(0, size).forEach(coord => {
    state.board[coord].placed = true;
    state.board[coord].startupId = startupId;
  });
}

export function createGameWithMergerSetup(): GameState {
  const state = createTestGame();

  // Setup: Player has 4 shares of Gobble (tier 0)
  state.players[0].portfolio['Gobble'] = 4;
  state.startups['Gobble'].isFounded = true;
  state.startups['Gobble'].availableShares = 21;
  setBoardSize(state, 'Gobble', 5); // $500 price

  // Setup: Scrapple exists nearby (will be survivor)
  state.startups['Scrapple'].isFounded = true;
  setBoardSize(state, 'Scrapple', 6);

  // Place tiles to setup merger
  state.board['A1'].placed = true;
  state.board['A1'].startupId = 'Gobble';
  state.board['A3'].placed = true;
  state.board['A3'].startupId = 'Scrapple';
  // A2 is the merger trigger tile

  state.players[0].hand = ['A2'];

  return state;
}
```

## Test File Structure

```
src/
  state/
    gameLogic.ts
    gameLogic.test.ts          ← Unit tests for game logic
  utils/
    gameHelpers.ts
    gameHelpers.test.ts        ← Unit tests for helpers
  components/
    BuyModal.tsx
    BuyModal.test.tsx          ← Integration tests for modals
  test/
    helpers.ts                 ← Test utilities
    fixtures.ts                ← Sample game states
```

## Running Tests

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch"
  }
}
```

### Workflow
1. **TDD**: `npm run test:watch` - Run tests on file save
2. **CI**: `npm test` - Run once and exit
3. **Debug**: `npm run test:ui` - Visual test runner
4. **Coverage**: `npm run test:coverage` - Check coverage report

## Implementation Phases

### Phase 1: Setup (1-2 hours)
- [ ] Install Vitest and dependencies
- [ ] Configure `vitest.config.ts`
- [ ] Create test helpers (`src/test/helpers.ts`)
- [ ] Write first test to validate setup

### Phase 2: Critical Tests (2-3 hours)
- [ ] Merger logic tests (pre-merger prices, held shares)
- [ ] Share pricing tests
- [ ] Safe chain rules tests
- [ ] Buy phase constraint tests

### Phase 3: Full Coverage (4-6 hours)
- [ ] Founding startups
- [ ] Turn management
- [ ] Modal interactions
- [ ] Multiplayer state sync

### Phase 4: CI/CD (1 hour)
- [ ] Add GitHub Actions workflow
- [ ] Run tests on every PR
- [ ] Block merge if tests fail

## Success Metrics

- ✅ **80%+ code coverage** on `gameLogic.ts`
- ✅ **All merger bugs** have regression tests
- ✅ **Tests run in <5 seconds** for TDD workflow
- ✅ **CI passes** before every merge

## Next Steps

1. **Start small**: Write 5-10 tests for merger logic (the bugs we just fixed)
2. **Iterate**: Add tests as we find bugs
3. **Refactor confidently**: Tests catch regressions

---

**Note**: This is a living document. Update as testing strategy evolves.
