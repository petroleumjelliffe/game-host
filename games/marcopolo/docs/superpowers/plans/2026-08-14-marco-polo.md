# Marco Polo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A same-room, phones-on-LAN real-time Marco Polo chase game: one blind Marco hunting by sound ripples, sighted Polos hiding, server-authoritative at 20 Hz.

**Architecture:** One Node process (express + socket.io) owns rooms and a pure-function simulation; the lobby (rooms/seats/tokens/presence) comes from the `vendor/lobby` submodule, compiled by this repo. The React client renders role-filtered snapshots on canvas and sends inputs only. Marco's snapshot never contains Polo positions — filtering happens server-side.

**Tech Stack:** TypeScript, socket.io 4, express 5, React 19, Vite 6, Vitest 3, `qrcode`. No game framework.

**Spec:** `docs/superpowers/specs/2026-08-14-marco-polo-design.md`

## Global Constraints

- `PROTOCOL_VERSION = 1`, `APP_ID = 'marco-polo'`, seats `p1`–`p8`, `MIN_PLAYERS = 3`, `MAX_PLAYERS = 8`.
- Tuning (arena units; circle of radius 1 centered at origin) — exact values, used by both halves:
  `arenaRadius: 1`, `avatarRadius: 0.045`, `baseSpeed: 0.22` units/s, `turboMultiplier: 2`, `turboFullSeconds: 1.5`, `turboRechargeSeconds: 8`, `roundSeconds: 90`, `graceSeconds: 30`, `endRadiusFraction: 0.35`, `callCooldownSeconds: 5`, `replyDelaySeconds: 1`, `tickHz: 20`.
- **Filtering invariant:** a snapshot sent to Marco's seat must not contain any Polo coordinates. Enforced in `snapshotFor`, tested at unit level and over the real wire.
- `vendor/lobby` is compiled by this repo (submodule, shared as source). Server-side tsconfig includes `vendor/lobby/{protocol,server}`; client-side includes `vendor/lobby/{protocol,client}`. Never mix.
- Server-side imports use NodeNext style with `.js` extensions (matching `vendor/lobby/server`); client-side imports are extensionless (matching `vendor/lobby/client`).
- In `io.on('connection')`, `game.attach(socket)` runs **before** `wiring.attach(socket)`: the lobby's disconnect handler deletes the seat binding, and the game's disconnect handler must read it first.
- Client routing is hash-based (`#/room/CODE`) so the server needs no history fallback.
- Dev ports: server 3001, Vite 5173 (proxies `/socket.io` with `ws: true`). TDD; commit at the end of every task.

---

### Task 1: Scaffold and toolchain

The deliverable: `npm test` runs the vendor lobby's own tests green, and both tsconfigs typecheck.

**Files:**
- Create: `package.json`, `tsconfig.json`, `client/tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Consumes: `vendor/lobby` submodule (already committed).
- Produces: `npm test` (vitest, two projects: node + jsdom), `npm run typecheck`, `npm run dev`, `npm run build`, `npm start` for all later tasks.

- [ ] **Step 1: Init package and install dependencies**

```bash
npm init -y
npm pkg set type=module private=true name=marco-polo
npm pkg set scripts.dev='concurrently -k "tsx watch server/main.ts" "vite"'
npm pkg set scripts.build='vite build'
npm pkg set scripts.start='tsx server/main.ts'
npm pkg set scripts.test='vitest run'
npm pkg set scripts.typecheck='tsc --noEmit && tsc --noEmit -p client'
npm install express@^5 qrcode react@^19 react-dom@^19 socket.io@^4 socket.io-client@^4
npm install -D @types/express @types/node @types/qrcode @types/react @types/react-dom @vitejs/plugin-react concurrently jsdom tsx typescript@^5 vite@^6 vitest@^3
```

- [ ] **Step 2: Write configs**

`.gitignore`:

```
node_modules/
client/dist/
```

`tsconfig.json` (server half):

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "lib": ["es2022"],
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["protocol", "server", "vendor/lobby/protocol", "vendor/lobby/server"]
}
```

`client/tsconfig.json` (client half — note it must NOT include `vendor/lobby/server`):

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "skipLibCheck": true
  },
  "include": ["src", "../protocol", "../vendor/lobby/protocol", "../vendor/lobby/client"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: true,
    fs: { allow: ['..'] },
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
  build: { outDir: 'dist' },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'protocol/**/*.test.ts',
            'server/**/*.test.ts',
            'vendor/lobby/protocol/**/*.test.ts',
            'vendor/lobby/server/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['client/**/*.test.{ts,tsx}', 'vendor/lobby/client/**/*.test.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Run the vendor tests to verify the harness**

Run: `npm test`
Expected: PASS — the submodule's suites (`rooms.test.ts`, `genericConsumer.test.ts`, `importBoundary.test.ts`, `identity.test.ts`, `view.test.ts`) all run and pass. No tests of our own yet.

- [ ] **Step 4: Typecheck fails only for missing dirs, then stub them**

Run: `npm run typecheck`. If tsc complains that `protocol`/`server`/`src` don't exist, create empty placeholder dirs with a `.gitkeep`-free approach: they get real files in Task 2; for now narrow `include` is fine to leave failing only until Task 2 — acceptable if Step 3 passed. If tsc errors on vendor files themselves, fix the config (that is this task's bug), not the vendor code.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold toolchain — vitest runs vendor lobby suites green"
```

---

### Task 2: Game protocol module

**Files:**
- Create: `protocol/game.ts`
- Test: `protocol/game.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained, like `vendor/lobby/protocol`).
- Produces (used by every later task):
  - Constants: `PROTOCOL_VERSION: 1`, `APP_ID: 'marco-polo'`, `MIN_PLAYERS: 3`, `MAX_PLAYERS: 8`, `SEAT_IDS: readonly string[]` (`p1`…`p8`), `TUNING` (shape below).
  - Types: `Role`, `GamePhase`, `InputMessage`, `SnapshotPlayer`, `YouState`, `StateMessage`, `GameEvent`.
  - Event names: `GAME_CLIENT_EVENTS = { input, call, nextRound }`, `GAME_SERVER_EVENTS = { state: 'gameState', event: 'gameEvent' }`.

- [ ] **Step 1: Write the failing test**

`protocol/game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS, PROTOCOL_VERSION, SEAT_IDS, TUNING } from './game.js';

describe('game protocol constants', () => {
  it('has one seat id per possible player', () => {
    expect(SEAT_IDS).toHaveLength(MAX_PLAYERS);
    expect(new Set(SEAT_IDS).size).toBe(MAX_PLAYERS);
    expect(MIN_PLAYERS).toBeLessThanOrEqual(MAX_PLAYERS);
  });

  it('has coherent tuning', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TUNING.graceSeconds).toBeLessThan(TUNING.roundSeconds);
    expect(TUNING.endRadiusFraction).toBeGreaterThan(0);
    expect(TUNING.endRadiusFraction).toBeLessThan(1);
    expect(TUNING.avatarRadius * 2).toBeLessThan(TUNING.arenaRadius * TUNING.endRadiusFraction);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run protocol`
Expected: FAIL — cannot resolve `./game.js`.

- [ ] **Step 3: Write the module**

`protocol/game.ts`:

```ts
// The game half of the wire. Self-contained: imports nothing, like the
// lobby's protocol file. Both halves of the app read the same TUNING, so the
// client and server cannot drift on a number neither had to be told.

export const PROTOCOL_VERSION = 1;
export const APP_ID = 'marco-polo';
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const SEAT_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;

/** Arena units: a circle of radius `arenaRadius` centered at the origin. */
export const TUNING = {
  arenaRadius: 1,
  avatarRadius: 0.045,
  baseSpeed: 0.22,
  turboMultiplier: 2,
  turboFullSeconds: 1.5,
  turboRechargeSeconds: 8,
  roundSeconds: 90,
  graceSeconds: 30,
  endRadiusFraction: 0.35,
  callCooldownSeconds: 5,
  replyDelaySeconds: 1,
  tickHz: 20,
} as const;

export type Role = 'marco' | 'polo';
export type GamePhase = 'grace' | 'shrinking' | 'betweenRounds';

/** Client → server. Both coords are numbers, or both null ("stop"). */
export interface InputMessage {
  tx: number | null;
  ty: number | null;
  turbo: boolean;
}

/**
 * One player in a snapshot. `x`/`y` are ABSENT (not null) when the viewer may
 * not know them: a Marco viewer receives Polo entries without coordinates.
 */
export interface SnapshotPlayer {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  x?: number;
  y?: number;
}

export interface YouState {
  /** 0..1 */
  turbo: number;
  /** Seconds until MARCO is ready; null when the viewer is not Marco. */
  callCooldown: number | null;
}

export interface StateMessage {
  round: number;
  phase: GamePhase;
  /** Whole seconds remaining in the round (ceil). */
  timer: number;
  ringRadius: number;
  marcoId: string;
  you: YouState;
  players: SnapshotPlayer[];
  scores: Record<string, number>;
}

/**
 * One-shot occurrences. Positions are stamped at emission time — a ripple
 * marks where the sound happened, and does not track the player afterward.
 */
export type GameEvent =
  | { type: 'call'; x: number; y: number }
  | { type: 'reply'; playerId: string; x: number; y: number }
  | { type: 'roundStart'; round: number; marcoId: string }
  | {
      type: 'roundEnd';
      reason: 'catch' | 'timeout';
      caughtId: string | null;
      nextMarcoId: string;
      scores: Record<string, number>;
    };

export const GAME_CLIENT_EVENTS = {
  input: 'input',
  call: 'call',
  nextRound: 'nextRound',
} as const;

export const GAME_SERVER_EVENTS = {
  state: 'gameState',
  event: 'gameEvent',
} as const;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run protocol` — expected PASS. Then `npm run typecheck` — expected clean (create `server/` and `client/src/` with the files of later tasks still absent; if tsc objects to empty includes, defer the root typecheck to Task 3 and note it in the commit).

- [ ] **Step 5: Commit**

```bash
git add protocol
git commit -m "feat: game protocol — constants, tuning, wire types"
```

---

### Task 3: Simulation — round creation, movement, clamping

**Files:**
- Create: `server/sim/sim.ts`
- Test: `server/sim/sim.test.ts`

**Interfaces:**
- Consumes: `TUNING`, `Role`, `GameEvent` from `../../protocol/game.js`.
- Produces:
  - `interface SimPlayer { id: string; role: Role; x: number; y: number; tx: number | null; ty: number | null; turboHeld: boolean; turbo: number }`
  - `interface SimState { players: SimPlayer[]; marcoId: string; elapsed: number; callCooldown: number; replyDue: number | null; over: { reason: 'catch'; caughtId: string } | { reason: 'timeout'; caughtId: null } | null }`
  - `type SimEvent = Extract<GameEvent, { type: 'call' | 'reply' }>`
  - `ringRadius(elapsed: number): number`
  - `createRound(playerIds: readonly string[], marcoId: string, rng?: () => number): SimState`
  - `applyInput(state: SimState, playerId: string, msg: unknown): void`
  - `tryCall(state: SimState): SimEvent | null` (Task 6 fills it in)
  - `tick(state: SimState, dt: number): SimEvent[]` (mutates state, returns events)

- [ ] **Step 1: Write the failing tests**

`server/sim/sim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../protocol/game.js';
import { applyInput, createRound, tick } from './sim.js';

const ids = ['p1', 'p2', 'p3'];

describe('createRound', () => {
  it('spawns marco at the center and polos inside the arena', () => {
    const state = createRound(ids, 'p2', () => 0.5);
    const marco = state.players.find((p) => p.id === 'p2')!;
    expect(marco.role).toBe('marco');
    expect([marco.x, marco.y]).toEqual([0, 0]);
    for (const p of state.players.filter((q) => q.role === 'polo')) {
      expect(Math.hypot(p.x, p.y)).toBeLessThan(TUNING.arenaRadius);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0.1);
    }
    expect(state.players.every((p) => p.turbo === 1)).toBe(true);
  });
});

describe('movement', () => {
  it('moves toward the target at base speed', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: false });
    tick(state, 1);
    const marco = state.players[0]!;
    expect(marco.x).toBeCloseTo(TUNING.baseSpeed, 5);
    expect(marco.y).toBeCloseTo(0, 5);
  });

  it('arrives exactly at a near target instead of overshooting', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.1, ty: 0, turbo: false });
    tick(state, 1);
    expect(state.players[0]!.x).toBeCloseTo(0.1, 5);
  });

  it('stands still with a null target', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    tick(state, 1);
    expect(state.players[0]!.x).toBe(0);
  });

  it('clamps inside the arena edge', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 1.4, ty: 0, turbo: false });
    for (let i = 0; i < 200; i++) tick(state, 0.05);
    const marco = state.players[0]!;
    expect(Math.hypot(marco.x, marco.y)).toBeLessThanOrEqual(
      TUNING.arenaRadius - TUNING.avatarRadius + 1e-9,
    );
  });
});

describe('applyInput validation', () => {
  it('ignores malformed messages wholesale', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: Number.NaN, ty: 0, turbo: false });
    applyInput(state, 'p1', { tx: 99, ty: 0, turbo: false });
    applyInput(state, 'p1', { tx: 0.5, ty: 0.5, turbo: 'yes' });
    applyInput(state, 'p1', 'garbage');
    applyInput(state, 'nobody', { tx: 0.5, ty: 0.5, turbo: false });
    expect(state.players[0]!.tx).toBeNull();
    expect(state.players[0]!.turboHeld).toBe(false);
  });

  it('accepts a stop (both null)', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.5, ty: 0.5, turbo: false });
    applyInput(state, 'p1', { tx: null, ty: null, turbo: false });
    expect(state.players[0]!.tx).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/sim`
Expected: FAIL — cannot resolve `./sim.js`.

- [ ] **Step 3: Implement**

`server/sim/sim.ts`:

```ts
// The whole game world as a pure-ish module: `tick` mutates the state it is
// given and returns the sounds that happened. Nothing here knows sockets,
// rooms, or seats — that is what makes every rule below unit-testable.

import { TUNING, type GameEvent, type Role } from '../../protocol/game.js';

export type SimEvent = Extract<GameEvent, { type: 'call' | 'reply' }>;

export interface SimPlayer {
  id: string;
  role: Role;
  x: number;
  y: number;
  tx: number | null;
  ty: number | null;
  turboHeld: boolean;
  /** 0..1 */
  turbo: number;
}

export interface SimState {
  players: SimPlayer[];
  marcoId: string;
  /** Seconds since the round started. */
  elapsed: number;
  /** Seconds until MARCO may be called again; 0 = ready. */
  callCooldown: number;
  /** `elapsed` at which the forced polo replies fire, or null. */
  replyDue: number | null;
  over:
    | { reason: 'catch'; caughtId: string }
    | { reason: 'timeout'; caughtId: null }
    | null;
}

export function ringRadius(elapsed: number): number {
  const { arenaRadius, graceSeconds, roundSeconds, endRadiusFraction } = TUNING;
  if (elapsed <= graceSeconds) return arenaRadius;
  const t = Math.min(1, (elapsed - graceSeconds) / (roundSeconds - graceSeconds));
  return arenaRadius - t * arenaRadius * (1 - endRadiusFraction);
}

export function createRound(
  playerIds: readonly string[],
  marcoId: string,
  rng: () => number = Math.random,
): SimState {
  const players = playerIds.map((id): SimPlayer => {
    const base = { id, tx: null, ty: null, turboHeld: false, turbo: 1 };
    if (id === marcoId) return { ...base, role: 'marco', x: 0, y: 0 };
    const angle = rng() * 2 * Math.PI;
    const r = 0.4 + 0.5 * rng();
    return { ...base, role: 'polo', x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
  return { players, marcoId, elapsed: 0, callCooldown: 0, replyDue: null, over: null };
}

/**
 * Whatever the socket delivered, typed by wishful thinking. A partially valid
 * message is ignored wholesale rather than half-applied, so a malformed
 * client can never wedge a player into a state no honest client produces.
 */
export function applyInput(state: SimState, playerId: string, msg: unknown): void {
  if (state.over) return;
  const p = state.players.find((q) => q.id === playerId);
  if (!p || typeof msg !== 'object' || msg === null) return;
  const { tx, ty, turbo } = msg as Record<string, unknown>;
  const coord = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1.5;
  const stop = tx === null && ty === null;
  if (!(stop || (coord(tx) && coord(ty))) || typeof turbo !== 'boolean') return;
  p.tx = stop ? null : (tx as number);
  p.ty = stop ? null : (ty as number);
  p.turboHeld = turbo;
}

export function tryCall(state: SimState): SimEvent | null {
  if (state.over || state.callCooldown > 0) return null;
  const marco = state.players.find((p) => p.id === state.marcoId)!;
  state.callCooldown = TUNING.callCooldownSeconds;
  state.replyDue = state.elapsed + TUNING.replyDelaySeconds;
  return { type: 'call', x: marco.x, y: marco.y };
}

export function tick(state: SimState, dt: number): SimEvent[] {
  if (state.over) return [];
  const events: SimEvent[] = [];
  state.elapsed += dt;
  state.callCooldown = Math.max(0, state.callCooldown - dt);

  const maxLen = ringRadius(state.elapsed) - TUNING.avatarRadius;
  for (const p of state.players) {
    const boosting = p.turboHeld && p.turbo > 0;
    if (boosting) p.turbo = Math.max(0, p.turbo - dt / TUNING.turboFullSeconds);
    else if (!p.turboHeld) p.turbo = Math.min(1, p.turbo + dt / TUNING.turboRechargeSeconds);

    if (p.tx !== null && p.ty !== null) {
      const speed = TUNING.baseSpeed * (boosting ? TUNING.turboMultiplier : 1);
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = speed * dt;
      if (dist <= step) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }

    const len = Math.hypot(p.x, p.y);
    if (len > maxLen) {
      p.x *= maxLen / len;
      p.y *= maxLen / len;
    }
  }

  if (state.replyDue !== null && state.elapsed >= state.replyDue) {
    state.replyDue = null;
    for (const p of state.players) {
      if (p.role === 'polo') events.push({ type: 'reply', playerId: p.id, x: p.x, y: p.y });
    }
  }

  const marco = state.players.find((p) => p.id === state.marcoId)!;
  for (const p of state.players) {
    if (p.role !== 'polo') continue;
    if (Math.hypot(p.x - marco.x, p.y - marco.y) <= 2 * TUNING.avatarRadius) {
      state.over = { reason: 'catch', caughtId: p.id };
      return events;
    }
  }
  if (state.elapsed >= TUNING.roundSeconds) state.over = { reason: 'timeout', caughtId: null };
  return events;
}
```

Note: spawn at `r = 0.4 + 0.5 * rng()` keeps polos at least 0.4 from a center-spawned Marco, so a round can never open with an instant catch.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/sim` — expected PASS (catch/turbo/reply behaviors get their tests in Tasks 4–7; this task's tests must pass now).

- [ ] **Step 5: Commit**

```bash
git add server/sim
git commit -m "feat: simulation core — spawn, movement, input validation, clamping"
```

---

### Task 4: Simulation — turbo

**Files:**
- Modify: `server/sim/sim.ts` (only if a test exposes a bug — the Task 3 code already implements the rule)
- Test: `server/sim/sim.test.ts` (append)

**Interfaces:**
- Consumes/Produces: unchanged from Task 3. The rule under test: turbo drains at `dt / turboFullSeconds` while held and non-empty (speed ×2), recharges at `dt / turboRechargeSeconds` only while **not** held, and does nothing while held at zero.

- [ ] **Step 1: Write the failing/locking tests** (append to `server/sim/sim.test.ts`)

```ts
describe('turbo', () => {
  it('doubles speed and drains while held', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: true });
    tick(state, 0.5);
    const marco = state.players[0]!;
    expect(marco.x).toBeCloseTo(TUNING.baseSpeed * TUNING.turboMultiplier * 0.5, 5);
    expect(marco.turbo).toBeCloseTo(1 - 0.5 / TUNING.turboFullSeconds, 5);
  });

  it('falls back to base speed once empty, and does not recharge while held', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    applyInput(state, 'p1', { tx: 0.9, ty: 0, turbo: true });
    for (let i = 0; i < 40; i++) tick(state, 0.05); // 2s > turboFullSeconds
    const marco = state.players[0]!;
    expect(marco.turbo).toBe(0);
    const before = marco.x;
    tick(state, 0.1);
    expect(marco.x - before).toBeCloseTo(TUNING.baseSpeed * 0.1, 5);
    expect(marco.turbo).toBe(0);
  });

  it('recharges to full over turboRechargeSeconds when released', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const marco = state.players[0]!;
    marco.turbo = 0;
    applyInput(state, 'p1', { tx: null, ty: null, turbo: false });
    tick(state, TUNING.turboRechargeSeconds / 2);
    expect(marco.turbo).toBeCloseTo(0.5, 5);
    tick(state, TUNING.turboRechargeSeconds);
    expect(marco.turbo).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/sim`
Expected: PASS if Task 3's implementation is correct; if any fail, fix `tick`'s turbo branch until green.

- [ ] **Step 3: Commit**

```bash
git add server/sim
git commit -m "test: lock turbo drain/boost/recharge rules"
```

---

### Task 5: Simulation — ring shrink and timeout

**Files:**
- Test: `server/sim/sim.test.ts` (append); modify `server/sim/sim.ts` only on failure.

**Interfaces:** unchanged. Rules under test: `ringRadius` is flat during grace, linear to `endRadiusFraction` at `roundSeconds`; the shrinking ring pushes players in; the round times out.

- [ ] **Step 1: Write the tests** (append)

```ts
import { ringRadius } from './sim.js'; // add to the existing import line

describe('ring shrink', () => {
  it('holds full size through the grace period', () => {
    expect(ringRadius(0)).toBe(TUNING.arenaRadius);
    expect(ringRadius(TUNING.graceSeconds)).toBe(TUNING.arenaRadius);
  });

  it('shrinks linearly to the end fraction', () => {
    const mid = (TUNING.graceSeconds + TUNING.roundSeconds) / 2;
    const expectedMid =
      TUNING.arenaRadius - 0.5 * TUNING.arenaRadius * (1 - TUNING.endRadiusFraction);
    expect(ringRadius(mid)).toBeCloseTo(expectedMid, 5);
    expect(ringRadius(TUNING.roundSeconds)).toBeCloseTo(
      TUNING.arenaRadius * TUNING.endRadiusFraction,
      5,
    );
    expect(ringRadius(TUNING.roundSeconds + 60)).toBeCloseTo(
      TUNING.arenaRadius * TUNING.endRadiusFraction,
      5,
    );
  });

  it('pushes a parked player inward as it passes them', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const polo = state.players.find((p) => p.role === 'polo')!;
    polo.x = 0.9;
    polo.y = 0;
    state.elapsed = TUNING.roundSeconds - 10; // deep in the shrink
    tick(state, 0.05);
    expect(Math.hypot(polo.x, polo.y)).toBeLessThanOrEqual(
      ringRadius(state.elapsed) - TUNING.avatarRadius + 1e-9,
    );
  });
});

describe('timeout', () => {
  it('ends the round at roundSeconds', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    state.elapsed = TUNING.roundSeconds - 0.01;
    tick(state, 0.05);
    expect(state.over).toEqual({ reason: 'timeout', caughtId: null });
    tick(state, 0.05); // ticking a finished round is a no-op
    expect(state.over).toEqual({ reason: 'timeout', caughtId: null });
  });
});
```

Note the shrink test parks a lone polo at 0.9 with Marco at the center — far apart, so no accidental catch.

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/sim` — expected PASS; fix `ringRadius`/`tick` on failure.

- [ ] **Step 3: Commit**

```bash
git add server/sim
git commit -m "test: lock ring shrink curve and round timeout"
```

---

### Task 6: Simulation — the MARCO call and forced replies

**Files:**
- Test: `server/sim/sim.test.ts` (append); modify `server/sim/sim.ts` only on failure.

**Interfaces:** unchanged. Rules: `tryCall` emits a `call` event at Marco's position and starts the cooldown; replies fire for every polo `replyDelaySeconds` later, at their positions at that moment, exactly once.

- [ ] **Step 1: Write the tests** (append; add `tryCall` to the sim import)

```ts
describe('the call', () => {
  it('emits a call at marco position and enters cooldown', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const ev = tryCall(state);
    expect(ev).toEqual({ type: 'call', x: 0, y: 0 });
    expect(state.callCooldown).toBe(TUNING.callCooldownSeconds);
    expect(tryCall(state)).toBeNull(); // still cooling down
  });

  it('becomes available again after the cooldown elapses', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    tryCall(state);
    for (let i = 0; i < 101; i++) tick(state, 0.05); // 5.05s
    expect(tryCall(state)).not.toBeNull();
  });

  it('forces every polo to reply after the delay, once, at their position then', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    tryCall(state);
    let events = tick(state, TUNING.replyDelaySeconds / 2);
    expect(events).toEqual([]);
    // a polo moves during the delay — the reply must use the later position
    const polo = state.players.find((p) => p.role === 'polo')!;
    applyInput(state, polo.id, { tx: 0, ty: 0, turbo: false });
    events = tick(state, TUNING.replyDelaySeconds); // now past replyDue
    const replies = events.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(2); // 3 players, 1 marco
    const his = replies.find((r) => r.type === 'reply' && r.playerId === polo.id)!;
    expect(his).toMatchObject({ x: polo.x, y: polo.y });
    expect(tick(state, 0.5)).toEqual([]); // never a second volley
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run server/sim` — expected PASS; fix `tryCall`/`tick` on failure.

- [ ] **Step 3: Commit**

```bash
git add server/sim
git commit -m "test: lock call cooldown and forced-reply volley"
```

---

### Task 7: Simulation — catching, scoring, Marco rotation

**Files:**
- Create: `server/sim/rounds.ts`
- Test: `server/sim/sim.test.ts` (append catch tests), `server/sim/rounds.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (`server/sim/rounds.ts`):
  - `pickNextMarco(playerIds: readonly string[], lastMarcoRound: Record<string, number>, rng?: () => number): string` — lowest `lastMarcoRound` wins (absent = 0 = never); ties broken by `rng`.
  - `survivors(poloIds: readonly string[], caughtId: string | null): string[]`

- [ ] **Step 1: Write the failing tests**

Append to `server/sim/sim.test.ts`:

```ts
describe('catching', () => {
  it('ends the round when marco overlaps a polo', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const polo = state.players.find((p) => p.role === 'polo')!;
    polo.x = 0.05;
    polo.y = 0;
    // marco at origin: distance 0.05 < 2 * avatarRadius (0.09)
    tick(state, 0.001);
    expect(state.over).toEqual({ reason: 'catch', caughtId: polo.id });
  });

  it('does not catch across a gap wider than two avatars', () => {
    const state = createRound(ids, 'p1', () => 0.5);
    const polo = state.players.find((p) => p.role === 'polo')!;
    polo.x = 0.2;
    polo.y = 0;
    const other = state.players.find((p) => p.role === 'polo' && p.id !== polo.id)!;
    other.x = 0.3;
    other.y = 0.3;
    tick(state, 0.001);
    expect(state.over).toBeNull();
  });
});
```

`server/sim/rounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickNextMarco, survivors } from './rounds.js';

describe('pickNextMarco', () => {
  it('picks the player who has waited longest (never-marco = 0)', () => {
    expect(pickNextMarco(['p1', 'p2', 'p3'], { p1: 2, p2: 1 }, () => 0)).toBe('p3');
  });

  it('breaks ties with rng', () => {
    const history = { p1: 1 };
    expect(pickNextMarco(['p1', 'p2', 'p3'], history, () => 0)).toBe('p2');
    expect(pickNextMarco(['p1', 'p2', 'p3'], history, () => 0.99)).toBe('p3');
  });
});

describe('survivors', () => {
  it('is every polo on a timeout', () => {
    expect(survivors(['p2', 'p3'], null)).toEqual(['p2', 'p3']);
  });

  it('excludes the caught polo', () => {
    expect(survivors(['p2', 'p3'], 'p3')).toEqual(['p2']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run server/sim`
Expected: `rounds.test.ts` FAILS (module missing); catch tests should pass against Task 3's tick (if not, fix tick).

- [ ] **Step 3: Implement**

`server/sim/rounds.ts`:

```ts
// Round bookkeeping that is not physics: who is Marco next, who scored.

export function pickNextMarco(
  playerIds: readonly string[],
  lastMarcoRound: Record<string, number>,
  rng: () => number = Math.random,
): string {
  let waited: string[] = [];
  let best = Infinity;
  for (const id of playerIds) {
    const round = lastMarcoRound[id] ?? 0;
    if (round < best) {
      best = round;
      waited = [id];
    } else if (round === best) {
      waited.push(id);
    }
  }
  return waited[Math.floor(rng() * waited.length)]!;
}

export function survivors(poloIds: readonly string[], caughtId: string | null): string[] {
  return poloIds.filter((id) => id !== caughtId);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/sim` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add server/sim
git commit -m "feat: catch detection locked; next-marco rotation and survivor scoring"
```

---

### Task 8: Room state and round flow

**Files:**
- Create: `server/game.ts`
- Test: `server/game.test.ts`

**Interfaces:**
- Consumes: `SeatHolder`, `Lifecycle` from `../vendor/lobby/server/rooms.js` and `../vendor/lobby/protocol/protocol.js`; `createRound`, `tick`, `SimState` from `./sim/sim.js`; `pickNextMarco`, `survivors` from `./sim/rounds.js`; `GameEvent` from `../protocol/game.js`.
- Produces:
  - `interface MarcoPoloRoom { id: string; players: SeatHolder[]; begun: boolean; round: number; between: boolean; sim: SimState | null; nextMarcoId: string | null; scores: Record<string, number>; lastMarcoRound: Record<string, number>; lifecycle(): Lifecycle }`
  - `makeRoom(id: string, players: SeatHolder[]): MarcoPoloRoom` — the factory `createLobbyRegistry` takes.
  - `startMatch(room: MarcoPoloRoom, rng?: () => number): GameEvent` — returns the `roundStart`.
  - `stepRound(room: MarcoPoloRoom, dt: number, rng?: () => number): GameEvent[]` — ticks; on sim end, scores survivors, picks `nextMarcoId`, sets `between`, appends the `roundEnd`.
  - `startNextRound(room: MarcoPoloRoom, rng?: () => number): GameEvent | null` — host-driven; null unless between rounds.

- [ ] **Step 1: Write the failing tests**

`server/game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SeatHolder } from '../vendor/lobby/server/rooms.js';
import { TUNING } from '../protocol/game.js';
import { makeRoom, startMatch, startNextRound, stepRound } from './game.js';

function seats(n: number): SeatHolder[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Swimmer ${i + 1}`,
    token: `t${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

describe('makeRoom', () => {
  it('is a lobby until begun, then playing', () => {
    const room = makeRoom('ABCDEF', seats(3));
    expect(room.lifecycle()).toBe('lobby');
    startMatch(room, () => 0);
    expect(room.lifecycle()).toBe('playing');
  });
});

describe('startMatch', () => {
  it('starts round 1 with an rng-chosen marco and zeroed scores', () => {
    const room = makeRoom('ABCDEF', seats(3));
    const ev = startMatch(room, () => 0); // rng 0 → first player
    expect(ev).toEqual({ type: 'roundStart', round: 1, marcoId: 'p1' });
    expect(room.round).toBe(1);
    expect(room.lastMarcoRound).toEqual({ p1: 1 });
    expect(room.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(room.sim?.marcoId).toBe('p1');
  });
});

describe('stepRound', () => {
  it('on a catch: caught player becomes next marco, survivors score', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0);
    const polo = room.sim!.players.find((p) => p.role === 'polo')!;
    polo.x = 0.01;
    polo.y = 0;
    const events = stepRound(room, 0.001, () => 0);
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toMatchObject({ reason: 'catch', caughtId: polo.id, nextMarcoId: polo.id });
    const survivor = room.players.find((p) => p.id !== 'p1' && p.id !== polo.id)!;
    expect(room.scores[survivor.id]).toBe(1);
    expect(room.scores[polo.id]).toBe(0);
    expect(room.between).toBe(true);
    expect(stepRound(room, 0.05, () => 0)).toEqual([]); // frozen between rounds
  });

  it('on a timeout: all polos score, marco rotates to the longest-waiting', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0); // marco p1
    room.sim!.elapsed = TUNING.roundSeconds;
    const events = stepRound(room, 0.05, () => 0);
    const end = events.find((e) => e.type === 'roundEnd');
    expect(end).toMatchObject({ reason: 'timeout', caughtId: null, nextMarcoId: 'p2' });
    expect(room.scores).toEqual({ p1: 0, p2: 1, p3: 1 });
  });
});

describe('startNextRound', () => {
  it('starts the following round with the recorded next marco', () => {
    const room = makeRoom('ABCDEF', seats(3));
    startMatch(room, () => 0);
    expect(startNextRound(room, () => 0)).toBeNull(); // mid-round: refused
    room.sim!.elapsed = TUNING.roundSeconds;
    stepRound(room, 0.05, () => 0);
    const ev = startNextRound(room, () => 0);
    expect(ev).toEqual({ type: 'roundStart', round: 2, marcoId: 'p2' });
    expect(room.between).toBe(false);
    expect(room.lastMarcoRound).toEqual({ p1: 1, p2: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run server/game.test.ts`
Expected: FAIL — cannot resolve `./game.js`.

- [ ] **Step 3: Implement**

`server/game.ts`:

```ts
// The match around the sim: rounds, scores, whose turn it is to be Marco.
// Still socket-free — `gameHandlers.ts` owns the wire.

import type { Lifecycle } from '../vendor/lobby/protocol/protocol.js';
import type { SeatHolder } from '../vendor/lobby/server/rooms.js';
import type { GameEvent } from '../protocol/game.js';
import { pickNextMarco, survivors } from './sim/rounds.js';
import { createRound, tick, type SimState } from './sim/sim.js';

export interface MarcoPoloRoom {
  id: string;
  players: SeatHolder[];
  begun: boolean;
  round: number;
  between: boolean;
  sim: SimState | null;
  nextMarcoId: string | null;
  scores: Record<string, number>;
  lastMarcoRound: Record<string, number>;
  lifecycle(): Lifecycle;
}

export function makeRoom(id: string, players: SeatHolder[]): MarcoPoloRoom {
  return {
    id,
    players,
    begun: false,
    round: 0,
    between: false,
    sim: null,
    nextMarcoId: null,
    scores: {},
    lastMarcoRound: {},
    lifecycle() {
      // No 'over': a match runs until the group walks away.
      return this.begun ? 'playing' : 'lobby';
    },
  };
}

function beginRound(room: MarcoPoloRoom, marcoId: string, rng: () => number): GameEvent {
  room.round += 1;
  room.between = false;
  room.nextMarcoId = null;
  room.lastMarcoRound[marcoId] = room.round;
  for (const p of room.players) room.scores[p.id] ??= 0;
  room.sim = createRound(room.players.map((p) => p.id), marcoId, rng);
  return { type: 'roundStart', round: room.round, marcoId };
}

export function startMatch(room: MarcoPoloRoom, rng: () => number = Math.random): GameEvent {
  const ids = room.players.map((p) => p.id);
  room.begun = true;
  return beginRound(room, ids[Math.floor(rng() * ids.length)]!, rng);
}

export function stepRound(
  room: MarcoPoloRoom,
  dt: number,
  rng: () => number = Math.random,
): GameEvent[] {
  if (!room.sim || room.between) return [];
  const events: GameEvent[] = [...tick(room.sim, dt)];
  const over = room.sim.over;
  if (over) {
    room.between = true;
    const poloIds = room.sim.players.filter((p) => p.role === 'polo').map((p) => p.id);
    for (const id of survivors(poloIds, over.caughtId)) {
      room.scores[id] = (room.scores[id] ?? 0) + 1;
    }
    room.nextMarcoId =
      over.caughtId ?? pickNextMarco(room.players.map((p) => p.id), room.lastMarcoRound, rng);
    events.push({
      type: 'roundEnd',
      reason: over.reason,
      caughtId: over.caughtId,
      nextMarcoId: room.nextMarcoId,
      scores: { ...room.scores },
    });
  }
  return events;
}

export function startNextRound(
  room: MarcoPoloRoom,
  rng: () => number = Math.random,
): GameEvent | null {
  if (!room.between || room.nextMarcoId === null) return null;
  return beginRound(room, room.nextMarcoId, rng);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server` — expected PASS (all sim + game suites).

- [ ] **Step 5: Commit**

```bash
git add server/game.ts server/game.test.ts
git commit -m "feat: match state — rounds, scoring, marco rotation, lobby lifecycle"
```

---

### Task 9: Snapshot filtering

**Files:**
- Create: `server/snapshot.ts`
- Test: `server/snapshot.test.ts`

**Interfaces:**
- Consumes: `MarcoPoloRoom` from `./game.js`; `ringRadius` from `./sim/sim.js`; `StateMessage`, `SnapshotPlayer`, `TUNING` from `../protocol/game.js`.
- Produces: `snapshotFor(room: MarcoPoloRoom, viewerId: string): StateMessage`. **This is the filtering invariant's home.**

- [ ] **Step 1: Write the failing tests**

`server/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SeatHolder } from '../vendor/lobby/server/rooms.js';
import { TUNING } from '../protocol/game.js';
import { makeRoom, startMatch, stepRound, type MarcoPoloRoom } from './game.js';
import { snapshotFor } from './snapshot.js';

function playingRoom(): MarcoPoloRoom {
  const players: SeatHolder[] = ['p1', 'p2', 'p3'].map((id, i) => ({
    id,
    name: `Swimmer ${i + 1}`,
    token: `t${id}`,
    isHost: i === 0,
    connected: true,
  }));
  const room = makeRoom('ABCDEF', players);
  startMatch(room, () => 0); // marco = p1
  return room;
}

describe('snapshotFor', () => {
  it('gives a polo viewer every position', () => {
    const snap = snapshotFor(playingRoom(), 'p2');
    expect(snap.players).toHaveLength(3);
    for (const p of snap.players) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
    }
    expect(snap.you.callCooldown).toBeNull();
  });

  it('NEVER leaks a polo coordinate to the marco viewer', () => {
    const snap = snapshotFor(playingRoom(), 'p1');
    for (const p of snap.players) {
      if (p.role === 'polo') {
        expect('x' in p).toBe(false);
        expect('y' in p).toBe(false);
      } else {
        expect(typeof p.x).toBe('number');
      }
    }
    expect(snap.you.callCooldown).toBe(0);
    // belt and braces: the serialized payload contains no polo coords at all
    const poloSimX = playingRoom().sim!.players.find((p) => p.role === 'polo')!.x;
    expect(JSON.stringify(snap)).not.toContain(String(poloSimX));
  });

  it('reports phase, timer, ring and scores', () => {
    const room = playingRoom();
    let snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('grace');
    expect(snap.timer).toBe(TUNING.roundSeconds);
    expect(snap.ringRadius).toBe(TUNING.arenaRadius);
    expect(snap.marcoId).toBe('p1');
    expect(snap.round).toBe(1);
    room.sim!.elapsed = TUNING.graceSeconds + 1;
    snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('shrinking');
    room.sim!.elapsed = TUNING.roundSeconds;
    stepRound(room, 0.05, () => 0);
    snap = snapshotFor(room, 'p2');
    expect(snap.phase).toBe('betweenRounds');
    expect(snap.scores.p2).toBe(1);
  });

  it('reports the viewer own turbo', () => {
    const room = playingRoom();
    room.sim!.players.find((p) => p.id === 'p3')!.turbo = 0.25;
    expect(snapshotFor(room, 'p3').you.turbo).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run server/snapshot.test.ts`
Expected: FAIL — cannot resolve `./snapshot.js`.

- [ ] **Step 3: Implement**

`server/snapshot.ts`:

```ts
// Role-filtered views of a room. Marco's blindness is enforced HERE, by
// omission: a coordinate that is never serialized cannot be rendered, so the
// client needs no trust at all. `x`/`y` are left absent (not null) so a
// leaked key is loud in tests: `'x' in p` is the assertion.

import { TUNING, type SnapshotPlayer, type StateMessage } from '../protocol/game.js';
import type { MarcoPoloRoom } from './game.js';
import { ringRadius } from './sim/sim.js';

export function snapshotFor(room: MarcoPoloRoom, viewerId: string): StateMessage {
  const sim = room.sim;
  if (!sim) throw new Error('snapshotFor before startMatch');
  const marcoViewer = viewerId === sim.marcoId;

  const players: SnapshotPlayer[] = room.players.map((seat) => {
    const sp = sim.players.find((p) => p.id === seat.id);
    const base: SnapshotPlayer = {
      id: seat.id,
      name: seat.name,
      role: sp?.role ?? 'polo',
      connected: seat.connected,
    };
    if (!sp || (marcoViewer && sp.role === 'polo')) return base;
    return { ...base, x: sp.x, y: sp.y };
  });

  const you = sim.players.find((p) => p.id === viewerId);
  return {
    round: room.round,
    phase: room.between
      ? 'betweenRounds'
      : sim.elapsed <= TUNING.graceSeconds
        ? 'grace'
        : 'shrinking',
    timer: Math.max(0, Math.ceil(TUNING.roundSeconds - sim.elapsed)),
    ringRadius: ringRadius(sim.elapsed),
    marcoId: sim.marcoId,
    you: { turbo: you?.turbo ?? 0, callCooldown: marcoViewer ? sim.callCooldown : null },
    players,
    scores: { ...room.scores },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add server/snapshot.ts server/snapshot.test.ts
git commit -m "feat: role-filtered snapshots — marco never receives polo coordinates"
```

---

### Task 10: Socket handlers, app server, and the wire test

**Files:**
- Create: `server/gameHandlers.ts`, `server/app.ts`, `server/main.ts`
- Test: `server/wire.test.ts`

**Interfaces:**
- Consumes: `createLobbyRegistry`, `SeatSpace` from `../vendor/lobby/server/rooms.js`; `createLobbyHandlers`, `LobbyHooks`, `LobbyWiring` from `../vendor/lobby/server/handlers.js`; `LOBBY_SERVER_EVENTS` from `../vendor/lobby/protocol/protocol.js`; everything from Tasks 2, 3, 8, 9.
- Produces:
  - `createGameHandlers(io: SocketServer, registry: Pick<LobbyRegistry<MarcoPoloRoom>, 'get'>, wiring: LobbyWiring<MarcoPoloRoom>, opts?: { tickMs?: number }): { begin(room: MarcoPoloRoom): void; seat(room: MarcoPoloRoom, playerId: string): void; attach(socket: Socket): void; stop(): void }`
  - `createAppServer(): { httpServer: HttpServer; io: SocketServer; stop(): Promise<void> }`
  - `server/main.ts` — boots on `PORT ?? 3001`, prints LAN URLs.

- [ ] **Step 1: Implement the handlers** (the wire test that proves them comes in Step 3 — the two files are only testable together, so both are written before the red/green run)

`server/gameHandlers.ts`:

```ts
// The game half of the socket wire: inputs in, snapshots and events out, and
// the 20Hz loop per room. All rules live in game.ts/sim.ts — this file only
// routes bytes and enforces WHO may say what (marco calls, host advances).

import type { Server as SocketServer, Socket } from 'socket.io';
import { LOBBY_SERVER_EVENTS } from '../vendor/lobby/protocol/protocol.js';
import type { LobbyRegistry } from '../vendor/lobby/server/rooms.js';
import type { LobbyWiring } from '../vendor/lobby/server/handlers.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  MIN_PLAYERS,
  TUNING,
  type GameEvent,
} from '../protocol/game.js';
import { snapshotFor } from './snapshot.js';
import { applyInput, tryCall } from './sim/sim.js';
import { startMatch, startNextRound, stepRound, type MarcoPoloRoom } from './game.js';

export interface GameWiring {
  begin(room: MarcoPoloRoom): void;
  seat(room: MarcoPoloRoom, playerId: string): void;
  attach(socket: Socket): void;
  stop(): void;
}

export function createGameHandlers(
  io: SocketServer,
  registry: Pick<LobbyRegistry<MarcoPoloRoom>, 'get'>,
  wiring: LobbyWiring<MarcoPoloRoom>,
  opts: { tickMs?: number } = {},
): GameWiring {
  const tickMs = opts.tickMs ?? 1000 / TUNING.tickHz;
  const loops = new Map<string, NodeJS.Timeout>();

  function broadcastSnapshots(room: MarcoPoloRoom): void {
    // Per-socket, not per-room: every player's snapshot differs (their own
    // meter at least, and Marco's is missing everyone).
    for (const socket of io.sockets.sockets.values()) {
      const b = wiring.seatOf(socket.id);
      if (b?.roomId === room.id) {
        socket.emit(GAME_SERVER_EVENTS.state, snapshotFor(room, b.playerId));
      }
    }
  }

  function emitEvents(room: MarcoPoloRoom, events: GameEvent[]): void {
    for (const ev of events) io.to(room.id).emit(GAME_SERVER_EVENTS.event, ev);
  }

  function begin(room: MarcoPoloRoom): void {
    if (room.begun) return;
    if (room.players.length < MIN_PLAYERS) {
      const host = room.players.find((p) => p.isHost);
      for (const s of host ? wiring.socketsFor(room.id, host.id) : []) {
        s.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'notEnoughPlayers',
          message: `Marco Polo needs at least ${MIN_PLAYERS} players`,
        });
      }
      return;
    }
    emitEvents(room, [startMatch(room)]);
    wiring.broadcastRoster(room);
    broadcastSnapshots(room);
    loops.set(
      room.id,
      setInterval(() => {
        emitEvents(room, stepRound(room, tickMs / 1000));
        broadcastSnapshots(room);
      }, tickMs),
    );
  }

  function seat(room: MarcoPoloRoom, playerId: string): void {
    if (!room.begun || !room.sim) return;
    for (const s of wiring.socketsFor(room.id, playerId)) {
      s.emit(GAME_SERVER_EVENTS.state, snapshotFor(room, playerId));
    }
  }

  function boundRoom(socket: Socket): { room: MarcoPoloRoom; playerId: string } | null {
    const b = wiring.seatOf(socket.id);
    const room = b && registry.get(b.roomId);
    return room ? { room, playerId: b.playerId } : null;
  }

  function attach(socket: Socket): void {
    socket.on(GAME_CLIENT_EVENTS.input, (msg: unknown) => {
      const found = boundRoom(socket);
      if (found?.room.sim && !found.room.between) {
        applyInput(found.room.sim, found.playerId, msg);
      }
    });

    socket.on(GAME_CLIENT_EVENTS.call, () => {
      const found = boundRoom(socket);
      if (!found?.room.sim || found.room.between) return;
      if (found.playerId !== found.room.sim.marcoId) return; // polos have no MARCO
      const ev = tryCall(found.room.sim);
      if (ev) emitEvents(found.room, [ev]);
    });

    socket.on(GAME_CLIENT_EVENTS.nextRound, () => {
      const found = boundRoom(socket);
      if (!found) return;
      const host = found.room.players.find((p) => p.isHost);
      if (host?.id !== found.playerId) return;
      const ev = startNextRound(found.room);
      if (ev) {
        emitEvents(found.room, [ev]);
        broadcastSnapshots(found.room);
      }
    });

    // Registered before the lobby's own disconnect handler (see app.ts):
    // that one deletes the binding this one reads. A vanished player stops
    // swimming and floats in place, still catchable.
    socket.on('disconnect', () => {
      const found = boundRoom(socket);
      if (found?.room.sim && !found.room.between) {
        applyInput(found.room.sim, found.playerId, { tx: null, ty: null, turbo: false });
      }
    });
  }

  return {
    begin,
    seat,
    attach,
    stop() {
      for (const loop of loops.values()) clearInterval(loop);
      loops.clear();
    },
  };
}
```

- [ ] **Step 2: Implement the app server and entrypoint**

`server/app.ts`:

```ts
// Assembly only: express static + socket.io + lobby wiring + game wiring.

import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { createLobbyRegistry, type SeatSpace } from '../vendor/lobby/server/rooms.js';
import { createLobbyHandlers, type LobbyHooks } from '../vendor/lobby/server/handlers.js';
import { PROTOCOL_VERSION, SEAT_IDS } from '../protocol/game.js';
import { makeRoom, type MarcoPoloRoom } from './game.js';
import { createGameHandlers } from './gameHandlers.js';

export function createAppServer(): {
  httpServer: HttpServer;
  io: SocketServer;
  stop(): Promise<void>;
} {
  const app = express();
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '../client/dist')));
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer);

  const space: SeatSpace = { ids: SEAT_IDS, defaultName: (i) => `Swimmer ${i + 1}` };
  const registry = createLobbyRegistry(makeRoom, space);
  const hooks: LobbyHooks<MarcoPoloRoom> = {
    protocolVersion: PROTOCOL_VERSION,
    // `game` is assigned below; these run only after a socket event arrives.
    onBegin(room) {
      game.begin(room);
    },
    onSeated(room, playerId) {
      game.seat(room, playerId);
    },
  };
  const wiring = createLobbyHandlers(io, registry, hooks);
  const game = createGameHandlers(io, registry, wiring);

  io.on('connection', (socket) => {
    // Game first: its disconnect handler must read the seat binding before
    // the lobby's disconnect handler deletes it. Do not reorder.
    game.attach(socket);
    wiring.attach(socket);
  });

  return {
    httpServer,
    io,
    async stop() {
      game.stop();
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
```

`server/main.ts`:

```ts
import { networkInterfaces } from 'node:os';
import { createAppServer } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const { httpServer } = createAppServer();
httpServer.listen(port, () => {
  console.log(`marco-polo listening on ${port}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  phones (prod build): http://${a.address}:${port}`);
        console.log(`  phones (npm run dev): http://${a.address}:5173`);
      }
    }
  }
});
```

- [ ] **Step 3: Write the wire test**

`server/wire.test.ts`:

```ts
// The one suite that runs the REAL wire: real socket.io server on an
// ephemeral port, real clients, real 50ms ticks. Everything asserted here is
// what a phone would actually receive — including that marco's phone never
// receives a polo coordinate.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  PROTOCOL_VERSION,
  type GameEvent,
  type StateMessage,
} from '../protocol/game.js';
import { createAppServer } from './app.js';

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function stateWhere(
  socket: Socket,
  pred: (s: StateMessage) => boolean,
  timeoutMs = 4000,
): Promise<StateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(GAME_SERVER_EVENTS.state, on);
      reject(new Error('no matching state before timeout'));
    }, timeoutMs);
    const on = (s: StateMessage) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      socket.off(GAME_SERVER_EVENTS.state, on);
      resolve(s);
    };
    socket.on(GAME_SERVER_EVENTS.state, on);
  });
}

function eventWhere(
  socket: Socket,
  pred: (e: GameEvent) => boolean,
  timeoutMs = 4000,
): Promise<GameEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(GAME_SERVER_EVENTS.event, on);
      reject(new Error('no matching event before timeout'));
    }, timeoutMs);
    const on = (e: GameEvent) => {
      if (!pred(e)) return;
      clearTimeout(timer);
      socket.off(GAME_SERVER_EVENTS.event, on);
      resolve(e);
    };
    socket.on(GAME_SERVER_EVENTS.event, on);
  });
}

describe('over the wire', () => {
  let app: ReturnType<typeof createAppServer>;
  let url: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    app = createAppServer();
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await app.stop();
  });

  function client(): Socket {
    const c = connect(url, { transports: ['websocket'] });
    clients.push(c);
    return c;
  }

  it('creates, joins, begins, filters, moves, calls', async () => {
    // Lobby: one creator, two joiners.
    const c1 = client();
    c1.emit('createRoom', { name: 'Ann', protocolVersion: PROTOCOL_VERSION });
    const joined1 = await once<{ roomId: string; playerId: string }>(c1, 'joined');
    const roomId = joined1.roomId;

    const c2 = client();
    c2.emit('joinRoom', { roomId, name: 'Bo', protocolVersion: PROTOCOL_VERSION });
    const joined2 = await once<{ playerId: string }>(c2, 'joined');
    const c3 = client();
    c3.emit('joinRoom', { roomId, name: 'Cy', protocolVersion: PROTOCOL_VERSION });
    const joined3 = await once<{ playerId: string }>(c3, 'joined');

    const bySeat = new Map<string, Socket>([
      [joined1.playerId, c1],
      [joined2.playerId, c2],
      [joined3.playerId, c3],
    ]);

    // Begin → everyone learns who is marco.
    const start = eventWhere(c2, (e) => e.type === 'roundStart');
    c1.emit('beginGame');
    const roundStart = (await start) as Extract<GameEvent, { type: 'roundStart' }>;
    const marcoSocket = bySeat.get(roundStart.marcoId)!;
    const poloId = [...bySeat.keys()].find((id) => id !== roundStart.marcoId)!;
    const poloSocket = bySeat.get(poloId)!;

    // Filtering, over the real wire.
    const marcoSnap = await stateWhere(marcoSocket, () => true);
    for (const p of marcoSnap.players) {
      if (p.role === 'polo') expect('x' in p).toBe(false);
      else expect(typeof p.x).toBe('number');
    }
    expect(marcoSnap.you.callCooldown).toBe(0);
    const poloSnap = await stateWhere(poloSocket, () => true);
    for (const p of poloSnap.players) expect(typeof p.x).toBe('number');
    expect(poloSnap.you.callCooldown).toBeNull();

    // Movement: the polo swims and sees itself move in later snapshots.
    // Target is AWAY from the center, where marco spawns — swimming at the
    // origin could end the round with an accidental catch mid-test.
    const before = poloSnap.players.find((p) => p.id === poloId)!;
    poloSocket.emit(GAME_CLIENT_EVENTS.input, {
      tx: Math.sign(before.x! || 1) * 1.2,
      ty: before.y!,
      turbo: false,
    });
    await stateWhere(poloSocket, (s) => {
      const now = s.players.find((p) => p.id === poloId)!;
      return Math.hypot(now.x! - before.x!, now.y! - before.y!) > 0.02;
    });

    // The call: everyone hears marco; a beat later everyone hears the replies.
    const heardCall = eventWhere(poloSocket, (e) => e.type === 'call');
    const heardReply = eventWhere(marcoSocket, (e) => e.type === 'reply');
    marcoSocket.emit(GAME_CLIENT_EVENTS.call);
    await heardCall;
    const reply = (await heardReply) as Extract<GameEvent, { type: 'reply' }>;
    expect(typeof reply.x).toBe('number'); // ripples DO carry positions — that is the game

    // A polo pressing MARCO is ignored.
    poloSocket.emit(GAME_CLIENT_EVENTS.call);
    await new Promise((r) => setTimeout(r, 200));
  }, 15000);
});
```

- [ ] **Step 4: Run the suite red→green**

Run: `npx vitest run server/wire.test.ts` — if anything fails, the bug is in this task's two files (or an ordering assumption); fix and re-run. Then `npm test` — full suite green. Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add server package.json
git commit -m "feat: socket handlers, app assembly, LAN entrypoint — proven over the wire"
```

---

### Task 11: Client shell — routing, home, lobby screens

**Files:**
- Create: `client/index.html`, `client/src/main.tsx`, `client/src/styles.css`, `client/src/App.tsx`, `client/src/router.ts`, `client/src/net/singletons.ts`, `client/src/screens/HomeScreen.tsx`, `client/src/screens/RoomScreen.tsx`, `client/src/screens/LobbyPanel.tsx`
- Test: `client/src/router.test.ts`

**Interfaces:**
- Consumes: `createIdentityStore` (`vendor/lobby/client/identity`), `createLobbyConnection`, `LobbyConnection` (`vendor/lobby/client/connection`), `useLobbyRoom` (`vendor/lobby/client/useLobbyRoom`), `lobbyView` (`vendor/lobby/client/view`), `APP_ID`, `PROTOCOL_VERSION`, `MAX_PLAYERS`, `MIN_PLAYERS` (`protocol/game`).
- Produces:
  - `parseHash(hash: string): Route`, `useHashRoute(): Route`, `navigateToRoom(roomId: string): void` where `type Route = { screen: 'home' } | { screen: 'room'; roomId: string }`
  - `identity: IdentityStore` and `connection(): LobbyConnection` singletons (`client/src/net/singletons.ts`)
  - `<RoomScreen roomId={string} />` renders `LobbyPanel` until a game snapshot arrives (Task 13 swaps in `GameScreen`; this task leaves a `{/* GameScreen mounts here in Task 13 */}` seam rendering a "diving in…" line when `roster?.lifecycle === 'playing'`).

- [ ] **Step 1: Write the failing router test**

`client/src/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('routes #/room/CODE to the room, uppercased', () => {
    expect(parseHash('#/room/abq2x9')).toEqual({ screen: 'room', roomId: 'ABQ2X9' });
  });

  it('routes everything else home', () => {
    expect(parseHash('')).toEqual({ screen: 'home' });
    expect(parseHash('#/')).toEqual({ screen: 'home' });
    expect(parseHash('#/room/')).toEqual({ screen: 'home' });
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run client` — FAIL, module missing.

- [ ] **Step 3: Implement the shell**

`client/src/router.ts`:

```ts
import { useEffect, useState } from 'react';

export type Route = { screen: 'home' } | { screen: 'room'; roomId: string };

export function parseHash(hash: string): Route {
  const m = /^#\/room\/([A-Za-z2-9]+)$/.exec(hash);
  return m ? { screen: 'room', roomId: m[1]!.toUpperCase() } : { screen: 'home' };
}

export function navigateToRoom(roomId: string): void {
  window.location.hash = `#/room/${roomId}`;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
```

`client/src/net/singletons.ts`:

```ts
// One identity store and one socket for the whole tab. Module-level because
// remounting a screen must not reconnect the transport.

import { createIdentityStore } from '../../../vendor/lobby/client/identity';
import {
  createLobbyConnection,
  type LobbyConnection,
} from '../../../vendor/lobby/client/connection';
import { APP_ID, PROTOCOL_VERSION } from '../../../protocol/game';

export const identity = createIdentityStore(APP_ID);

let conn: LobbyConnection | null = null;
export function connection(): LobbyConnection {
  conn ??= createLobbyConnection({
    serverUrl: window.location.origin,
    protocolVersion: PROTOCOL_VERSION,
  });
  return conn;
}
```

`client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <title>Marco Polo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`client/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`client/src/App.tsx`:

```tsx
import { useHashRoute } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const route = useHashRoute();
  return route.screen === 'home' ? <HomeScreen /> : <RoomScreen key={route.roomId} roomId={route.roomId} />;
}
```

`client/src/screens/HomeScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { connection, identity } from '../net/singletons';
import { navigateToRoom } from '../router';

export function HomeScreen() {
  const [code, setCode] = useState('');

  // createRoom's `joined` arrives while still on this screen; store the seat
  // so RoomScreen's useLobbyRoom rejoins with the token instead of taking a
  // second seat.
  useEffect(() => {
    return connection().onJoined((msg) => {
      identity.saveIdentity(msg.roomId, {
        playerId: msg.playerId,
        token: msg.token,
        name: identity.rememberedName() ?? '',
      });
      navigateToRoom(msg.roomId);
    });
  }, []);

  return (
    <main className="home">
      <h1>Marco Polo</h1>
      <p>One phone each. One of you is blind. Everyone makes noise.</p>
      <button
        className="big"
        onClick={() => connection().createRoom(identity.rememberedName() ?? undefined)}
      >
        Start a pool
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) navigateToRoom(code.trim());
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Room code"
          maxLength={6}
          autoCapitalize="characters"
        />
        <button type="submit">Join</button>
      </form>
    </main>
  );
}
```

`client/src/screens/RoomScreen.tsx`:

```tsx
import { useLobbyRoom } from '../../../vendor/lobby/client/useLobbyRoom';
import { lobbyView } from '../../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { connection, identity } from '../net/singletons';
import { LobbyPanel } from './LobbyPanel';

export function RoomScreen({ roomId }: { roomId: string }) {
  const conn = connection();
  const lobby = useLobbyRoom(roomId, conn, identity);
  const view = lobbyView(lobby, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });

  if (view.terminal === 'gone')
    return <main className="notice">This pool has drained. <a href="#/">Start a new one</a></main>;
  if (view.terminal === 'stale')
    return <main className="notice">New version available — reload this page.</main>;

  if (lobby.roster?.lifecycle === 'playing') {
    {/* GameScreen mounts here in Task 13 */}
    return <main className="notice">diving in…</main>;
  }
  return <LobbyPanel view={view} lobby={lobby} />;
}
```

`client/src/screens/LobbyPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LobbyRoomState } from '../../../vendor/lobby/client/useLobbyRoom';
import type { LobbyView } from '../../../vendor/lobby/client/view';

export function LobbyPanel({ view, lobby }: { view: LobbyView; lobby: LobbyRoomState }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 240 }).then(setQr);
  }, []);

  return (
    <main className="lobby">
      <h1>Pool {view.code}</h1>
      {qr && <img className="qr" src={qr} alt={`Join code ${view.code}`} />}
      <p className="share">Scan to jump in, or share the code.</p>
      <ul className="seats">
        {view.seats.map((seat) => (
          <li key={seat.index} className={seat.id ? 'taken' : 'empty'}>
            {seat.id === null ? (
              <span className="empty-seat">open water</span>
            ) : seat.canRename ? (
              <input
                defaultValue={seat.name ?? ''}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== seat.name) lobby.rename(name);
                }}
              />
            ) : (
              <span>
                {seat.name}
                {seat.isHost ? ' ⭐' : ''}
                {seat.connected ? '' : ' 💤'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {view.canBegin && <button className="big" onClick={() => lobby.begin()}>Everybody in — start</button>}
      {view.beginBlocked === 'notEnoughPlayers' && <p>Need at least 3 swimmers.</p>}
      {view.beginBlocked === 'notHost' && <p>Waiting for the host to start…</p>}
      {lobby.message && <p className="error">{lobby.message}</p>}
      {view.you && !view.you.isHost && <button onClick={() => lobby.leaveSeat()}>Leave</button>}
    </main>
  );
}
```

`client/src/styles.css`:

```css
* { box-sizing: border-box; margin: 0; }
html, body, #root { height: 100%; }
body {
  background: #06121f;
  color: #e8f1f8;
  font-family: system-ui, sans-serif;
  -webkit-user-select: none;
  user-select: none;
  overscroll-behavior: none;
}
main { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; }
h1 { font-size: 1.6rem; }
button {
  font: inherit; border: 0; border-radius: 10px; padding: 10px 18px;
  background: #1c6dd0; color: white; touch-action: manipulation;
}
button.big { font-size: 1.2rem; padding: 16px 28px; }
input {
  font: inherit; padding: 10px; border-radius: 8px; border: 1px solid #35506b;
  background: #0c2237; color: inherit; text-align: center;
}
.qr { border-radius: 12px; background: white; padding: 8px; }
.seats { list-style: none; padding: 0; width: min(320px, 90vw); display: flex; flex-direction: column; gap: 6px; }
.seats li { padding: 8px 12px; border-radius: 8px; background: #0c2237; }
.seats li.empty { opacity: 0.4; }
.error { color: #ff8a8a; }
.notice { justify-content: center; height: 100%; }
```

- [ ] **Step 4: Verify**

Run: `npx vitest run client` — router test PASS. Run `npm run typecheck` — clean. Run `npm run dev`, open `http://localhost:5173` in two browser windows: create a pool in one, join by code in the other, rename, see presence; begin stays blocked below 3 players; a third window enables begin, and pressing it shows "diving in…" in all three.

- [ ] **Step 5: Commit**

```bash
git add client vite.config.ts
git commit -m "feat: client shell — hash routing, home, lobby with QR and begin"
```

---

### Task 12: Client game logic — session state, interpolation, camera

**Files:**
- Create: `client/src/game/sessionState.ts`, `client/src/game/interpolate.ts`, `client/src/game/camera.ts`, `client/src/net/useGameSession.ts`
- Test: `client/src/game/sessionState.test.ts`, `client/src/game/interpolate.test.ts`, `client/src/game/camera.test.ts`

**Interfaces:**
- Consumes: `StateMessage`, `GameEvent`, `SnapshotPlayer`, `InputMessage`, `GAME_CLIENT_EVENTS`, `GAME_SERVER_EVENTS`, `TUNING` from `protocol/game`; `LobbyConnection` from `vendor/lobby/client/connection`.
- Produces:
  - `sessionState.ts`: `RIPPLE_MS = 2000`; `interface Ripple { word: 'marco' | 'polo'; x: number; y: number; at: number }`; `interface SessionState { latest: StateMessage | null; ripples: Ripple[]; roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null }`; `initialSession: SessionState`; `onState(s: SessionState, msg: StateMessage): SessionState`; `onEvent(s: SessionState, ev: GameEvent, now: number): SessionState`; `liveRipples(ripples: Ripple[], now: number): Ripple[]`
  - `interpolate.ts`: `class SnapshotBuffer { push(players: SnapshotPlayer[], at: number): void; at(now: number): Map<string, { x: number; y: number }> }` (renders 100 ms behind receipt, lerping between the last two snapshots)
  - `camera.ts`: `worldToScreen(wx: number, wy: number, size: number): { x: number; y: number }`; `screenToWorld(sx: number, sy: number, size: number): { x: number; y: number }`; `worldScale(w: number, size: number): number`
  - `useGameSession.ts`: `useGameSession(conn: LobbyConnection): { session: SessionState; buffer: SnapshotBuffer; sendInput(msg: InputMessage): void; call(): void; nextRound(): void }`

- [ ] **Step 1: Write the failing tests**

`client/src/game/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { screenToWorld, worldScale, worldToScreen } from './camera';

describe('camera', () => {
  it('maps world center to screen center and edges to edges', () => {
    expect(worldToScreen(0, 0, 400)).toEqual({ x: 200, y: 200 });
    expect(worldToScreen(1, 0, 400)).toEqual({ x: 400, y: 200 });
    expect(worldToScreen(0, -1, 400)).toEqual({ x: 200, y: 0 });
  });

  it('round-trips', () => {
    const w = screenToWorld(300, 100, 400);
    const back = worldToScreen(w.x, w.y, 400);
    expect(back.x).toBeCloseTo(300);
    expect(back.y).toBeCloseTo(100);
  });

  it('scales lengths by half the canvas', () => {
    expect(worldScale(0.5, 400)).toBe(100);
  });
});
```

`client/src/game/sessionState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GameEvent, StateMessage } from '../../../protocol/game';
import { initialSession, liveRipples, onEvent, onState, RIPPLE_MS } from './sessionState';

const snap = { round: 1, phase: 'grace' } as StateMessage;

describe('session reducer', () => {
  it('keeps the latest snapshot', () => {
    expect(onState(initialSession, snap).latest).toBe(snap);
  });

  it('turns calls and replies into ripples with the right word', () => {
    let s = onEvent(initialSession, { type: 'call', x: 0.1, y: 0.2 }, 1000);
    s = onEvent(s, { type: 'reply', playerId: 'p2', x: 0.3, y: 0.4 }, 2000);
    expect(s.ripples).toEqual([
      { word: 'marco', x: 0.1, y: 0.2, at: 1000 },
      { word: 'polo', x: 0.3, y: 0.4, at: 2000 },
    ]);
  });

  it('records roundEnd and clears it (and ripples) on roundStart', () => {
    const end: GameEvent = {
      type: 'roundEnd', reason: 'catch', caughtId: 'p2', nextMarcoId: 'p2', scores: { p1: 0 },
    };
    let s = onEvent(initialSession, { type: 'call', x: 0, y: 0 }, 0);
    s = onEvent(s, end, 1);
    expect(s.roundEnd).toMatchObject({ caughtId: 'p2' });
    s = onEvent(s, { type: 'roundStart', round: 2, marcoId: 'p2' }, 2);
    expect(s.roundEnd).toBeNull();
    expect(s.ripples).toEqual([]);
  });

  it('ages ripples out after RIPPLE_MS', () => {
    const ripples = [{ word: 'polo' as const, x: 0, y: 0, at: 1000 }];
    expect(liveRipples(ripples, 1000 + RIPPLE_MS - 1)).toHaveLength(1);
    expect(liveRipples(ripples, 1000 + RIPPLE_MS + 1)).toHaveLength(0);
  });
});
```

`client/src/game/interpolate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SnapshotPlayer } from '../../../protocol/game';
import { SnapshotBuffer } from './interpolate';

const player = (id: string, x: number): SnapshotPlayer => ({
  id, name: id, role: 'polo', connected: true, x, y: 0,
});

describe('SnapshotBuffer', () => {
  it('lerps between the last two snapshots, 100ms behind', () => {
    const buf = new SnapshotBuffer();
    buf.push([player('p2', 0)], 1000);
    buf.push([player('p2', 0.1)], 1050);
    // render at 1125 → sample time 1025 → halfway through the 1000→1050 span
    expect(buf.at(1125).get('p2')!.x).toBeCloseTo(0.05, 5);
    // beyond the span: clamp to the newest, never extrapolate
    expect(buf.at(1400).get('p2')!.x).toBeCloseTo(0.1, 5);
  });

  it('omits players without coordinates (marco view)', () => {
    const buf = new SnapshotBuffer();
    buf.push([{ id: 'p2', name: 'p2', role: 'polo', connected: true }], 1000);
    expect(buf.at(1200).has('p2')).toBe(false);
  });

  it('returns the single snapshot before a second arrives', () => {
    const buf = new SnapshotBuffer();
    buf.push([player('p2', 0.3)], 1000);
    expect(buf.at(1000).get('p2')!.x).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run client/src/game` — FAIL, modules missing.

- [ ] **Step 3: Implement**

`client/src/game/camera.ts`:

```ts
// World: circle of radius 1 at the origin, y up-negative like canvas.
// Screen: a square canvas of `size` px; the arena inscribes it exactly.

export function worldToScreen(wx: number, wy: number, size: number): { x: number; y: number } {
  return { x: ((wx + 1) / 2) * size, y: ((wy + 1) / 2) * size };
}

export function screenToWorld(sx: number, sy: number, size: number): { x: number; y: number } {
  return { x: (sx / size) * 2 - 1, y: (sy / size) * 2 - 1 };
}

export function worldScale(w: number, size: number): number {
  return (w * size) / 2;
}
```

`client/src/game/sessionState.ts`:

```ts
// Pure reducer over server messages — the hook is a thin shell around this,
// so everything the screens depend on is testable without a socket.

import type { GameEvent, StateMessage } from '../../../protocol/game';

export const RIPPLE_MS = 2000;

export interface Ripple {
  word: 'marco' | 'polo';
  x: number;
  y: number;
  at: number;
}

export interface SessionState {
  latest: StateMessage | null;
  ripples: Ripple[];
  roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null;
}

export const initialSession: SessionState = { latest: null, ripples: [], roundEnd: null };

export function onState(s: SessionState, msg: StateMessage): SessionState {
  return { ...s, latest: msg };
}

export function onEvent(s: SessionState, ev: GameEvent, now: number): SessionState {
  switch (ev.type) {
    case 'call':
      return { ...s, ripples: [...liveRipples(s.ripples, now), { word: 'marco', x: ev.x, y: ev.y, at: now }] };
    case 'reply':
      return { ...s, ripples: [...liveRipples(s.ripples, now), { word: 'polo', x: ev.x, y: ev.y, at: now }] };
    case 'roundEnd':
      return { ...s, roundEnd: ev };
    case 'roundStart':
      return { ...s, roundEnd: null, ripples: [] };
  }
}

export function liveRipples(ripples: Ripple[], now: number): Ripple[] {
  return ripples.filter((r) => now - r.at < RIPPLE_MS);
}
```

`client/src/game/interpolate.ts`:

```ts
// Snapshots arrive ~every 50ms; frames render every ~16ms. Draw 100ms in the
// past, lerped between the two snapshots that bracket that moment — smooth,
// and never extrapolating a player through a wall of their future.

import type { SnapshotPlayer } from '../../../protocol/game';

const DELAY_MS = 100;

type Frame = { at: number; pos: Map<string, { x: number; y: number }> };

function toFrame(players: SnapshotPlayer[], at: number): Frame {
  const pos = new Map<string, { x: number; y: number }>();
  for (const p of players) {
    if (typeof p.x === 'number' && typeof p.y === 'number') pos.set(p.id, { x: p.x, y: p.y });
  }
  return { at, pos };
}

export class SnapshotBuffer {
  private prev: Frame | null = null;
  private next: Frame | null = null;

  push(players: SnapshotPlayer[], at: number): void {
    this.prev = this.next;
    this.next = toFrame(players, at);
  }

  at(now: number): Map<string, { x: number; y: number }> {
    if (!this.next) return new Map();
    if (!this.prev) return this.next.pos;
    const t = now - DELAY_MS;
    const span = this.next.at - this.prev.at;
    const alpha = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - this.prev.at) / span));
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, b] of this.next.pos) {
      const a = this.prev.pos.get(id) ?? b;
      out.set(id, { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha });
    }
    return out;
  }
}
```

`client/src/net/useGameSession.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyConnection } from '../../../vendor/lobby/client/connection';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  type GameEvent,
  type InputMessage,
  type StateMessage,
} from '../../../protocol/game';
import { initialSession, onEvent, onState, type SessionState } from '../game/sessionState';
import { SnapshotBuffer } from '../game/interpolate';

export interface GameSession {
  session: SessionState;
  buffer: SnapshotBuffer;
  sendInput(msg: InputMessage): void;
  call(): void;
  nextRound(): void;
}

export function useGameSession(conn: LobbyConnection): GameSession {
  const [session, setSession] = useState<SessionState>(initialSession);
  const bufferRef = useRef(new SnapshotBuffer());

  useEffect(() => {
    const sock = conn.socket;
    const onSt = (msg: StateMessage) => {
      bufferRef.current.push(msg.players, Date.now());
      setSession((s) => onState(s, msg));
    };
    const onEv = (ev: GameEvent) => setSession((s) => onEvent(s, ev, Date.now()));
    sock.on(GAME_SERVER_EVENTS.state, onSt);
    sock.on(GAME_SERVER_EVENTS.event, onEv);
    return () => {
      sock.off(GAME_SERVER_EVENTS.state, onSt);
      sock.off(GAME_SERVER_EVENTS.event, onEv);
    };
  }, [conn]);

  const sendInput = useCallback(
    (msg: InputMessage) => conn.socket.emit(GAME_CLIENT_EVENTS.input, msg),
    [conn],
  );
  const call = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.call), [conn]);
  const nextRound = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.nextRound), [conn]);

  return { session, buffer: bufferRef.current, sendInput, call, nextRound };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run client` — PASS. `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/game client/src/net/useGameSession.ts
git commit -m "feat: client game logic — session reducer, snapshot lerp, camera math"
```

---

### Task 13: Game screens — canvas, touch, turbo, MARCO button, scoreboard

**Files:**
- Create: `client/src/render/draw.ts`, `client/src/screens/GameScreen.tsx`, `client/src/screens/ScoreboardOverlay.tsx`
- Modify: `client/src/screens/RoomScreen.tsx` (mount GameScreen), `client/src/styles.css` (append HUD styles)

**Interfaces:**
- Consumes: everything from Task 12; `TUNING`, `StateMessage` from `protocol/game`; `LobbyView` from `vendor/lobby/client/view`.
- Produces:
  - `drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): void` with `interface SceneOpts { size: number; youId: string; snapshot: StateMessage; positions: Map<string, { x: number; y: number }>; ripples: Ripple[]; now: number }`
  - `<GameScreen game={GameSession} view={LobbyView} youId={string} />`
  - `<ScoreboardOverlay .../>` rendered by GameScreen when `snapshot.phase === 'betweenRounds'`.

Rendering is verified by playing (per spec); the drawing function stays free of React so a later test can call it against an offscreen canvas if wanted.

- [ ] **Step 1: Implement the scene painter**

`client/src/render/draw.ts`:

```ts
// One painter for both roles. The marco view is not a client-side secret:
// polo positions are simply absent from `positions` (the server never sent
// them), so the branches here are styling, not information control.

import { TUNING, type StateMessage } from '../../../protocol/game';
import { RIPPLE_MS, type Ripple } from '../game/sessionState';
import { worldScale, worldToScreen } from '../game/camera';

export interface SceneOpts {
  size: number;
  youId: string;
  snapshot: StateMessage;
  positions: Map<string, { x: number; y: number }>;
  ripples: Ripple[];
  now: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): void {
  const { size, snapshot } = o;
  const marcoView = o.youId === snapshot.marcoId;
  const center = worldToScreen(0, 0, size);

  // water
  ctx.fillStyle = marcoView ? '#04070c' : '#0b3556';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = marcoView ? '#080f18' : '#11476f';
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2);
  ctx.fill();

  // shrink ring
  ctx.strokeStyle = marcoView ? '#3a5b7a' : '#7fd4ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(snapshot.ringRadius, size), 0, Math.PI * 2);
  ctx.stroke();

  // ripples
  for (const r of o.ripples) {
    const age = (o.now - r.at) / RIPPLE_MS; // 0..1
    if (age >= 1) continue;
    const at = worldToScreen(r.x, r.y, size);
    const alpha = 1 - age;
    ctx.strokeStyle =
      r.word === 'marco' ? `rgba(255,110,110,${alpha})` : `rgba(140,235,255,${alpha})`;
    ctx.lineWidth = 2 + 2 * (1 - age);
    for (const lag of [0, 0.18, 0.36]) {
      const a = age - lag;
      if (a <= 0) continue;
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.06 + a * 0.5, size), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `${Math.round(size / 22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(r.word, at.x, at.y - worldScale(0.09, size) - age * 14);
  }

  // players — whatever positions the server let this viewer have
  for (const p of snapshot.players) {
    const pos = o.positions.get(p.id);
    if (!pos) continue;
    const at = worldToScreen(pos.x, pos.y, size);
    const r = worldScale(TUNING.avatarRadius, size);
    const isMarco = p.id === snapshot.marcoId;
    ctx.fillStyle = isMarco ? '#ff6e6e' : p.id === o.youId ? '#ffe27a' : '#8cebff';
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.id === o.youId) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (!marcoView) {
      ctx.fillStyle = 'rgba(232,241,248,0.8)';
      ctx.font = `${Math.round(size / 30)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(p.name, at.x, at.y + r + 14);
    }
  }
}
```

- [ ] **Step 2: Implement GameScreen and the overlay**

`client/src/screens/GameScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { LobbyView } from '../../../vendor/lobby/client/view';
import type { GameSession } from '../net/useGameSession';
import { liveRipples } from '../game/sessionState';
import { screenToWorld } from '../game/camera';
import { drawScene } from '../render/draw';
import { ScoreboardOverlay } from './ScoreboardOverlay';

const SEND_EVERY_MS = 50;

export function GameScreen({ game, view, youId }: { game: GameSession; view: LobbyView; youId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const [turboHeld, setTurboHeld] = useState(false);
  const inputRef = useRef<{ tx: number | null; ty: number | null; turbo: boolean; lastSent: number }>(
    { tx: null, ty: null, turbo: false, lastSent: 0 },
  );

  const snapshot = game.session.latest!;
  const you = snapshot.you;
  const isMarco = youId === snapshot.marcoId;

  function send(force: boolean): void {
    const s = inputRef.current;
    const now = performance.now();
    if (!force && now - s.lastSent < SEND_EVERY_MS) return;
    s.lastSent = now;
    gameRef.current.sendInput({ tx: s.tx, ty: s.ty, turbo: s.turbo });
  }

  function setTarget(e: React.PointerEvent<HTMLCanvasElement>, clear: boolean): void {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const s = inputRef.current;
    if (clear) {
      s.tx = null;
      s.ty = null;
      send(true);
      return;
    }
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width);
    s.tx = Math.max(-1.5, Math.min(1.5, w.x));
    s.ty = Math.max(-1.5, Math.min(1.5, w.y));
    send(false);
  }

  function holdTurbo(held: boolean): void {
    setTurboHeld(held);
    inputRef.current.turbo = held;
    send(true);
  }

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const frame = () => {
      const g = gameRef.current;
      const snap = g.session.latest;
      if (snap) {
        const size = canvas.width;
        drawScene(ctx, {
          size,
          youId,
          snapshot: snap,
          positions: g.buffer.at(Date.now()),
          ripples: liveRipples(g.session.ripples, Date.now()),
          now: Date.now(),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [youId]);

  const side = Math.min(window.innerWidth, window.innerHeight - 120);

  return (
    <main className="game">
      <div className="hud-top">
        <span className={isMarco ? 'role marco' : 'role polo'}>
          {isMarco ? 'you are MARCO' : 'hide — you are a polo'}
        </span>
        <span className="timer">{snapshot.timer}s</span>
      </div>
      <canvas
        ref={canvasRef}
        width={side}
        height={side}
        style={{ width: side, height: side, touchAction: 'none' }}
        onPointerDown={(e) => setTarget(e, false)}
        onPointerMove={(e) => e.buttons > 0 && setTarget(e, false)}
        onPointerUp={(e) => setTarget(e, true)}
        onPointerCancel={(e) => setTarget(e, true)}
      />
      <div className="hud-bottom">
        {isMarco && (
          <button
            className="marco-btn"
            disabled={(you.callCooldown ?? 0) > 0}
            onClick={() => gameRef.current.call()}
          >
            {you.callCooldown && you.callCooldown > 0
              ? `MARCO… ${Math.ceil(you.callCooldown)}`
              : 'MARCO!'}
          </button>
        )}
        <button
          className={turboHeld ? 'turbo held' : 'turbo'}
          onPointerDown={() => holdTurbo(true)}
          onPointerUp={() => holdTurbo(false)}
          onPointerCancel={() => holdTurbo(false)}
          onPointerLeave={() => turboHeld && holdTurbo(false)}
        >
          <span className="meter" style={{ width: `${you.turbo * 100}%` }} />
          TURBO
        </button>
      </div>
      {snapshot.phase === 'betweenRounds' && (
        <ScoreboardOverlay
          snapshot={snapshot}
          roundEnd={game.session.roundEnd}
          isHost={view.you?.isHost === true}
          onNext={() => gameRef.current.nextRound()}
        />
      )}
    </main>
  );
}
```

`client/src/screens/ScoreboardOverlay.tsx`:

```tsx
import type { GameEvent, StateMessage } from '../../../protocol/game';

export function ScoreboardOverlay({
  snapshot,
  roundEnd,
  isHost,
  onNext,
}: {
  snapshot: StateMessage;
  roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null;
  isHost: boolean;
  onNext: () => void;
}) {
  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? id;
  const rows = [...snapshot.players].sort(
    (a, b) => (snapshot.scores[b.id] ?? 0) - (snapshot.scores[a.id] ?? 0),
  );

  return (
    <div className="overlay">
      <h2>
        {roundEnd?.reason === 'catch'
          ? `Caught! ${nameOf(roundEnd.caughtId!)} is Marco next.`
          : roundEnd
            ? `Time! The polos escaped — ${nameOf(roundEnd.nextMarcoId)} is Marco next.`
            : 'Round over'}
      </h2>
      <ol className="scores">
        {rows.map((p) => (
          <li key={p.id}>
            {p.name} — {snapshot.scores[p.id] ?? 0}
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="big" onClick={onNext}>Next round</button>
      ) : (
        <p>Waiting for the host…</p>
      )}
    </div>
  );
}
```

Modify `client/src/screens/RoomScreen.tsx` — replace the "diving in…" seam:

```tsx
// add imports:
import { useGameSession } from '../net/useGameSession';
import { GameScreen } from './GameScreen';

// inside the component, after `const lobby = ...`:
const game = useGameSession(conn);

// replace the `lifecycle === 'playing'` block with:
if (game.session.latest && lobby.playerId) {
  return <GameScreen game={game} view={view} youId={lobby.playerId} />;
}
if (lobby.roster?.lifecycle === 'playing') {
  return <main className="notice">diving in…</main>;
}
```

Append to `client/src/styles.css`:

```css
.game { padding: 0; gap: 8px; height: 100%; justify-content: center; }
.hud-top { display: flex; justify-content: space-between; width: 100%; padding: 12px 16px; }
.role.marco { color: #ff6e6e; font-weight: 700; }
.role.polo { color: #8cebff; }
.timer { font-variant-numeric: tabular-nums; font-weight: 700; }
.hud-bottom { display: flex; gap: 16px; width: 100%; padding: 0 16px 16px; justify-content: space-between; }
.marco-btn { flex: 1; font-size: 1.3rem; background: #b03030; padding: 18px; }
.marco-btn:disabled { opacity: 0.5; }
.turbo { flex: 1; position: relative; overflow: hidden; background: #133; padding: 18px; }
.turbo .meter { position: absolute; inset: 0 auto 0 0; background: #1c6dd0; z-index: -1; transition: width 120ms linear; }
.turbo.held { outline: 2px solid #7fd4ff; }
.overlay {
  position: fixed; inset: 0; background: rgba(4, 10, 18, 0.88);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
}
.scores { list-style: none; padding: 0; font-size: 1.2rem; text-align: center; }
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run typecheck && npm test` — expected clean and green.

- [ ] **Step 4: Hand-verify on real screens**

Run `npm run dev`. Three browser windows (or two + a phone on the LAN via `http://<your-ip>:5173`): create, join ×2, begin. Verify each item:

- Marco's screen is dark and shows no other players; polos see everyone.
- Holding a finger/mouse on the water swims toward it; release stops.
- TURBO visibly doubles speed, drains in ~1.5 s, refills in ~8 s when released.
- MARCO button ripples on every screen; ~1 s later polo ripples appear (with words), and the button is dead for 5 s.
- After 30 s the ring shrinks; players outside get pushed in.
- Marco touching a polo ends the round: overlay names the caught player, scores are right (survivors +1), host's Next round starts round 2 with the caught player as Marco, dark screen and all.
- Let a round time out: all polos +1, longest-waiting player becomes Marco.
- Reload a polo's tab mid-round: it rejoins the same seat and the game resumes.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat: game screens — sonar canvas, touch swim, turbo, MARCO call, scoreboard"
```

---

### Task 14: README and playthrough checklist

**Files:**
- Create: `README.md`

**Interfaces:** none — documentation of what Tasks 1–13 built.

- [ ] **Step 1: Write the README**

`README.md`:

```markdown
# Marco Polo

A same-room party game: everyone on their own phone, one player blind.
Marco shouts (a button), the polos are forced to shout back, and every
shout is a ripple that gives a position away. Catch someone and they're
Marco next. The pool shrinks, so nobody hides forever.

Design: `docs/superpowers/specs/2026-08-14-marco-polo-design.md`.

## Run it

    npm install
    npm run dev

The server prints a LAN URL (`http://<your-ip>:5173`); phones on the same
Wi-Fi open it, one creates a pool, the rest scan the QR. 3–8 players.

Production-ish: `npm run build && npm start` (serves the built client on 3001).

## Layout

    protocol/      game half of the wire — constants, tuning, message types
    server/sim/    pure simulation: movement, turbo, shrink, calls, catches
    server/        rooms, role-filtered snapshots, socket handlers, app
    client/        React + canvas: lobby, polo view, marco (sonar) view
    vendor/lobby   rooms/seats/tokens/presence — git submodule, compiled here

The one invariant to know: **Marco's phone is never sent polo positions.**
Filtering happens in `server/snapshot.ts` and is asserted both at unit level
and over a real socket in `server/wire.test.ts`.

## Tests

    npm test           # vitest: node project (sim/server) + jsdom project (client)
    npm run typecheck  # both tsconfigs (server half and client half)

The vendor submodule's own tests run inside this repo's vitest, per its README.

## Not built yet (deliberately)

Audio (first follow-up — the vibe needs it), obstacles, spectator screen,
client prediction for remote play, persistent scores.
```

- [ ] **Step 2: Final verification**

Run: `npm test && npm run typecheck && npm run build` — all clean. Submodule status clean (`git submodule status` shows the pinned commit).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — how to run, layout, the filtering invariant"
```
