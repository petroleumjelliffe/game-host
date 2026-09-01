# Word Game Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planned, not started (2026-08-31)

**Goal:** Rebuild the word game client's five surfaces — entry/lobby, room,
game board, blank/invalid states, and the notification sheet — to match the
Claude Design states board, including the new home-screen game list it
requires server support for.

**Architecture:** A visual-language pass (Tailwind tokens + two self-hosted
fonts) under a set of behavioral additions: server-stamped move timestamps
and positions, a client-side score preview from the existing engine modules,
a notification-status hook, a `listRooms` addition to the shared identity
store, and one new token-verified HTTP endpoint that summarizes the rooms a
device holds seats in. The design is the spec; the engine and wire protocol
are otherwise untouched.

**Tech Stack:** React 19, Tailwind 3, vitest + testing-library, express 5,
socket.io. Fonts via `@fontsource` packages (self-hosted, bundled by Vite).

**Spec:** the `.dc.html` files in this directory. `Word Game States.dc.html`
is the journey board that assigns states to screens;
`Word Game Entry.dc.html`, `Word Game Room.dc.html`,
`Word Game Hi-Fi.dc.html` (+ `HiFiBoard.dc.html`), and
`Word Game Notify.dc.html` are the buildable screens, each with a
`data-props` block listing its states and a `renderVals()` that is the
authoritative mapping from state to copy/colors. Open them in a browser to
see them rendered (`support.js` in the design project is the runtime; not
vendored here — read the markup and script blocks directly).

## Global Constraints

- Branch off `main` first (`wordgame-redesign` or similar); finish as a
  pushed branch + PR, never a local merge to main.
- Run everything from the repo root; per-package suites via
  `npx vitest run --root games/wordgame` (never a root `vitest run` with
  projects — see CLAUDE.md "Testing").
- Gates before the PR: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build` all clean at root.
- No new runtime import in server code that is not a production dependency
  of the importing package (the host bundle's external surface is express +
  socket.io + builtins).
- The client stays origin-relative: no URL names a host, port, or external
  origin — which is why fonts are self-hosted, not Google-Fonts-linked.
- No CORS anywhere; no global middleware in the server — anything added is
  scoped under `BASE_PATH` (a POST route, not `app.use(express.json())`).
- Engine stays deterministic: no `Date.now()` inside `engine/` — timestamps
  are stamped in `server/room.ts` after `applyIntent` returns.
- `check:bundle` must stay green: nothing new in `src/` may import the
  dictionary (importing `engine/placement`, `engine/words`,
  `engine/score` is safe; they don't touch it).
- Wire/save compatibility: every new `MoveRecord` field is optional; old
  saves load unchanged (the `isGameState` guard doesn't inspect log entries).
- Match the repo's comment voice: narrative *why* comments, dated where a
  problem was found; update any load-bearing comment the change touches.
- Copy comes from the design verbatim (e.g. "Turns can be days apart — get a
  nudge when it's yours", "Worth 0 points — shown lowercase on the board").
  Typographic apostrophes (’) as the design uses them.

## Decisions already made (don't re-litigate mid-task)

1. **Fonts self-hosted.** `@fontsource/outfit` (400/500/600/700) and
   `@fontsource/bitter` (600/700) as `dependencies` of
   `@game-host/wordgame` (Vite bundles them; the LAN deployment must not
   reach out to Google Fonts).
2. **Room links keep auto-join.** `/room/:id` continues to seat a first-time
   visitor immediately (deliberate 2026-08 lobby-pass behavior). Lane 2.1's
   "code prefilled" join screen is honored on the join *page*: `/online/join`
   reads `?code=XXXX` and prefills. The design's own copy ("Already sat here
   before? The code takes you straight back in.") is consistent with this.
3. **Capacity stays 6** (`MAX_PLAYERS`). The design's "N of 4" copy is
   illustrative; all seat copy derives from the real capacity.
4. **ScorePanel is replaced by the chip row** from the design; `MoveLog`
   stays, below the action row. A disconnected player renders as a dimmed
   chip (opacity-60) — the design has no presence affordance and losing it
   entirely would regress a tested feature.
5. **"ON THIS DEVICE / Pass & play" is out of scope.** No such mode exists;
   the Entry page simply has no such section. Record in the PR body.
6. **Labels:** Exchange → **SWAP**, Shuffle → **MIX**, Recall → **RECALL**,
   Pass → **PASS** (icon + small caption buttons per the design). The
   exchange flow itself (select tiles → confirm) is kept, restyled.
7. **Timestamps and positions** (`at`, `positions` on `MoveRecord`) are
   stamped in `server/room.ts` after commit — optional fields, old saves
   compatible, engine untouched.
8. **Entry game list** = rooms enumerated from localStorage identities
   (`listRooms()` added to the shared identity store) + one new
   `POST ${BASE_PATH}/api/summaries` endpoint verifying `{roomId, playerId,
   token}` per room (same check as `verifySeat`). A room the server reports
   unknown gets its identity cleared client-side.
9. **Notify status mapping** (for badge/banner): `on` = push subscribed on
   this device OR email confirmed; `pending` = email pending and push off;
   `off` = neither; `unavailable` = no /notify service → no badge, no banner.
10. **HomePage becomes the Entry screen** at `/`. `OnlineLobbyPage` is
    deleted (its create-room logic moves into the Entry page); `/online`
    becomes a redirect to `/`; `/online/join` stays.

## Design tokens (referenced by name below)

Defined once in Task 1's `tailwind.config.js`:

| token | value | design role |
| --- | --- | --- |
| `page` | `#e9e5da` | page background |
| `paper` | `#f7f4ec` | card / screen background |
| `ink` | `#2b2820` | primary text |
| `ink-soft` | `#5f5744` | secondary buttons text |
| `ink-mute` | `#7a7361` | secondary text |
| `ink-faint` | `#8a8271` | tertiary text, section labels |
| `ink-ghost` | `#a39a85` | placeholders, empty seats |
| `line` | `#e0d9c8` | card borders |
| `line-strong` | `#d8d0bd` | input/button borders |
| `hairline` | `#e3ddcf` | dividers |
| `chipbg` | `#ded7c5` | avatar chip background |
| `accent` | `#2563eb` | primary actions (unchanged) |
| `accent-strong` | `#1d4ed8` | hover |
| `tile` | `#f7ebc8` | tile face |
| `tile-edge` | `#d9bf8a` | tile bottom bevel |
| `tile-ink` | `#5f4a1d` | tile letter |
| `tile-blank` | `#a08a4a` | blank letter on board |
| `board` | `#1e4d3b` | board frame |
| `board-cell` | `#ecf2e9` | empty cell |
| `board-cell-ink` | `#9db2a4` | empty cell glyphs |
| `prem-3w` | `#d05a41` | TW bg (white text) |
| `prem-2w` | `#f2c9bd` | DW bg (`#a04b33` text → `prem-2w-ink`) |
| `prem-3l` | `#3f88ba` | TL bg (white text) |
| `prem-2l` | `#b9d8ea` | DL bg (`#33698f` text → `prem-2l-ink`) |
| `gold` | `#e0a924` | last-move ring |
| `warnbg` | `#fdf3e0` | amber banners |
| `warnbd` | `#e3c88a` | amber banner border |
| `warn-ink` | `#8a5f10` | amber banner text |
| `warn-accent` | `#c98a1e` | amber banner accents |
| `danger` | `#d05a41` / text `#b34430` | invalid-word card |

Fonts: `font-sans` → Outfit (+ system fallbacks), `font-tile` → Bitter, serif.

---

### Task 1: Theme foundation — fonts and tokens

**Files:**
- Modify: `games/wordgame/package.json` (add `@fontsource/outfit`, `@fontsource/bitter` to `dependencies`)
- Modify: `games/wordgame/tailwind.config.js`
- Modify: `games/wordgame/src/styles/index.css`
- Modify: `games/wordgame/src/main.tsx` (font imports)

**Interfaces:**
- Produces: Tailwind color tokens named exactly as the table above
  (`bg-paper`, `text-ink-mute`, `border-line-strong`, `font-tile`, …) used by
  every later task.

- [ ] **Step 1: Install fonts**

```bash
npm install --workspace games/wordgame @fontsource/outfit @fontsource/bitter
```

- [ ] **Step 2: Extend the Tailwind theme**

Replace the one-liner `tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#e9e5da',
        paper: '#f7f4ec',
        ink: { DEFAULT: '#2b2820', soft: '#5f5744', mute: '#7a7361', faint: '#8a8271', ghost: '#a39a85' },
        line: { DEFAULT: '#e0d9c8', strong: '#d8d0bd' },
        hairline: '#e3ddcf',
        chipbg: '#ded7c5',
        accent: { DEFAULT: '#2563eb', strong: '#1d4ed8' },
        tile: { DEFAULT: '#f7ebc8', edge: '#d9bf8a', ink: '#5f4a1d', blank: '#a08a4a' },
        board: { DEFAULT: '#1e4d3b', cell: '#ecf2e9', 'cell-ink': '#9db2a4' },
        prem: {
          '3w': '#d05a41',
          '2w': '#f2c9bd', '2w-ink': '#a04b33',
          '3l': '#3f88ba',
          '2l': '#b9d8ea', '2l-ink': '#33698f',
        },
        gold: '#e0a924',
        warnbg: '#fdf3e0', warnbd: '#e3c88a',
        warn: { ink: '#8a5f10', accent: '#c98a1e' },
        danger: { DEFAULT: '#d05a41', ink: '#b34430' },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        tile: ['Bitter', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Import font faces and set the page ground**

In `src/main.tsx`, before the css import:

```ts
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/bitter/600.css';
import '@fontsource/bitter/700.css';
```

In `src/styles/index.css`:

```css
body {
  @apply bg-page font-sans text-ink;
}
```

- [ ] **Step 4: Verify nothing broke**

Run: `npx vitest run --root games/wordgame` and
`npm run build --workspace games/wordgame` (also proves the fonts bundle).
Expected: all pass; dist assets include woff2 files.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/package.json games/wordgame/tailwind.config.js games/wordgame/src/styles/index.css games/wordgame/src/main.tsx package-lock.json
git commit -m "feat(wordgame): design tokens + self-hosted Outfit/Bitter"
```

---

### Task 2: Server stamps `at` and `positions` on committed moves

**Files:**
- Modify: `games/wordgame/engine/gameTypes.ts` (MoveRecord fields)
- Modify: `games/wordgame/server/room.ts` (the stamp)
- Test: `games/wordgame/server/wire.test.ts` (or a new `room.stamp.test.ts` beside it)

**Interfaces:**
- Produces: `MoveRecord.at?: number` (epoch ms, stamped at commit) and
  `MoveRecord.positions?: number[]` (board positions of a play's tiles).
  Both ride `GameView.log` to the client via `viewFor`'s existing
  `{ ...entry }` copy. Consumed by Tasks 5, 7, 12, 13.

- [ ] **Step 1: Write the failing test**

```ts
// server/room.stamp.test.ts
import { describe, expect, it } from 'vitest';
// Use the same room-construction helpers wire.test.ts / testState.ts use to
// get a started 2-player room where p1 plays first — copy its setup verbatim.

describe('commit stamping', () => {
  it('stamps at and positions on a committed play', () => {
    const room = startedRoom(); // helper as in existing server tests
    const before = Date.now();
    const delivery = room.dispatch('p1', {
      type: 'play',
      placements: firstLegalPlay(), // e.g. two tiles through CENTER from p1's rack
    });
    expect(delivery.kind).toBe('commit');
    const last = room.state()!.log.at(-1)!;
    expect(last.at).toBeGreaterThanOrEqual(before);
    expect(last.positions).toEqual(firstLegalPlay().map((p) => p.pos).sort((a, b) => a - b));
  });

  it('stamps at (but no positions) on a pass', () => {
    const room = startedRoom();
    room.dispatch('p1', { type: 'pass' });
    const last = room.state()!.log.at(-1)!;
    expect(typeof last.at).toBe('number');
    expect(last.positions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run --root games/wordgame server/room.stamp.test.ts`
Expected: FAIL — `at` is undefined.

- [ ] **Step 3: Add the fields and the stamp**

`engine/gameTypes.ts`, in `MoveRecord`:

```ts
  /** Epoch ms, stamped by the server at commit — never by the engine, which
   * must stay deterministic under a seed. Absent on saves from before
   * 2026-08-31. */
  at?: number;
  /** For plays: the board positions placed, ascending — what the client
   * highlights as the last word. Stamped beside `at`. */
  positions?: number[];
```

`server/room.ts`, in `dispatch`, replace the try-body:

```ts
        state = applyIntent(state, intent, dictionary);
        // Stamp what only the server knows (the clock) and what the client
        // needs back (where the play landed) onto the record applyIntent
        // just appended. The engine stays deterministic; the record is fresh
        // this call, so mutating it races nothing.
        const record = state.log[state.log.length - 1];
        if (record !== undefined) {
          record.at = Date.now();
          if (move.type === 'play') {
            record.positions = move.placements.map((p) => p.pos).sort((a, b) => a - b);
          }
        }
        return { kind: 'commit' };
```

- [ ] **Step 4: Run the whole package suite**

Run: `npx vitest run --root games/wordgame`
Expected: PASS — engine golden tests unaffected (they never dispatch through
the room), store round-trips carry the optional fields.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/engine/gameTypes.ts games/wordgame/server/room.ts games/wordgame/server/room.stamp.test.ts
git commit -m "feat(wordgame): server stamps move time and positions at commit"
```

---

### Task 3: Client score preview

**Files:**
- Create: `games/wordgame/src/game/scorePreview.ts`
- Test: `games/wordgame/src/game/scorePreview.test.ts`

**Interfaces:**
- Consumes: `validatePlacement` (engine/placement), `findFormedWords`,
  `ResolvedPlacement` (engine/words), `scorePlay` (engine/score),
  `Placement`/`Square` (session/protocol).
- Produces: `previewPlay(board: Square[], staged: Placement[]): PlayPreview | null`
  where `PlayPreview = { total: number; bingo: boolean; anchorPos: number }`.
  Null when the staging is geometrically invalid or empty. `anchorPos` is the
  highest placed position (where Task 8 floats the badge). **No dictionary**:
  a preview can score a non-word; the server still rejects it.

- [ ] **Step 1: Write the failing test**

```ts
// src/game/scorePreview.test.ts
import { describe, expect, it } from 'vitest';
import { previewPlay } from './scorePreview';
import { BOARD_SQUARES, CENTER } from '../../engine/constants';
import type { Square } from '../../session/protocol';

const empty = (): Square[] => Array.from({ length: BOARD_SQUARES }, () => null);

describe('previewPlay', () => {
  it('scores a first play across the center (DW doubles it)', () => {
    // A(1) T(1) on H8+H9 horizontally: word 2, center DW → 4.
    const preview = previewPlay(empty(), [
      { pos: CENTER, tile: 'A' },
      { pos: CENTER + 1, tile: 'T' },
    ]);
    expect(preview).toEqual({ total: 4, bingo: false, anchorPos: CENTER + 1 });
  });

  it('is null for a disconnected/gapped staging', () => {
    expect(previewPlay(empty(), [
      { pos: CENTER, tile: 'A' },
      { pos: CENTER + 2, tile: 'T' }, // gap at CENTER+1
    ])).toBeNull();
  });

  it('is null for no tiles', () => {
    expect(previewPlay(empty(), [])).toBeNull();
  });

  it('flags a bingo and scores blanks as zero', () => {
    const board = empty();
    board[CENTER] = { letter: 'A', isBlank: false }; // something to connect to
    const staged = ['B', 'C', 'D', 'E', 'F', 'G'].map((tile, i) => ({
      pos: CENTER + 15 * (i + 1), tile: tile as never,
    }));
    staged.push({ pos: CENTER + 15 * 7, tile: '_' as never, as: 'S' } as never);
    const preview = previewPlay(board, staged);
    expect(preview?.bingo).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run --root games/wordgame src/game/scorePreview.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/game/scorePreview.ts
// The optimistic half of doPlay: geometry and arithmetic, no dictionary —
// the bundle must not carry ENABLE (check:bundle), and a wrong word previews
// a score the server will refuse, which is exactly the design's 4.5 state.

import { validatePlacement } from '../../engine/placement';
import { findFormedWords, type ResolvedPlacement } from '../../engine/words';
import { scorePlay } from '../../engine/score';
import type { Placement, Square } from '../../session/protocol';

export interface PlayPreview {
  total: number;
  bingo: boolean;
  /** Highest placed position — where the floating badge anchors. */
  anchorPos: number;
}

export function previewPlay(board: Square[], staged: Placement[]): PlayPreview | null {
  if (staged.length === 0) return null;
  const positions = staged.map((p) => p.pos);
  if (new Set(positions).size !== positions.length) return null;
  if (positions.some((pos) => (board[pos] ?? null) !== null)) return null;
  const isFirstMove = board.every((square) => square === null);
  try {
    const line = validatePlacement(board, positions, isFirstMove);
    const resolved: ResolvedPlacement[] = staged.map((p) =>
      p.tile === '_'
        ? { pos: p.pos, letter: p.as ?? 'A', isBlank: true }
        : { pos: p.pos, letter: p.tile, isBlank: false },
    );
    const formed = findFormedWords(board, resolved, line.axis);
    if (formed.length === 0) return null;
    const { total, bingo } = scorePlay(formed, staged.length);
    return { total, bingo, anchorPos: Math.max(...positions) };
  } catch {
    // validatePlacement rejects with IllegalIntentError; an invalid staging
    // simply has no preview.
    return null;
  }
}
```

- [ ] **Step 4: Run the test and check:bundle**

Run: `npx vitest run --root games/wordgame src/game/scorePreview.test.ts`
then `npm run check:bundle --workspace games/wordgame`
Expected: PASS both. (Adjust the first test's expected total only if the
hand-computed value was wrong — recompute from `TILE_VALUES` + CENTER being
DW, don't fudge.)

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/scorePreview.ts games/wordgame/src/game/scorePreview.test.ts
git commit -m "feat(wordgame): client-side play score preview, engine-backed, no dictionary"
```

---

### Task 4: Notification status hook

**Files:**
- Create: `games/wordgame/src/notify/useNotifyStatus.ts`
- Test: `games/wordgame/src/notify/useNotifyStatus.test.ts`

**Interfaces:**
- Consumes: `fetchSettings` (notify/api), `getPlayerKey` (notify/playerKey),
  `pushSupported` (notify/push).
- Produces:
  ```ts
  export type NotifyStatus = 'loading' | 'unavailable' | 'off' | 'pending' | 'on';
  export function useNotifyStatus(): { status: NotifyStatus; refresh(): void };
  ```
  Mapping (decision 9): email `confirmed` → `on`; push subscription active on
  this device → `on`; email `pending` → `pending`; settings reachable but
  neither → `off`; no service/playerKey → `unavailable`. Consumed by Tasks 7
  and 13 (badge + banner). `refresh()` refetches — the Entry banner calls it
  after the sheet closes.

- [ ] **Step 1: Write the failing test**

```ts
// src/notify/useNotifyStatus.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchSettings = vi.fn();
vi.mock('./api', async (importActual) => ({
  ...(await importActual<typeof import('./api')>()),
  fetchSettings: (...args: unknown[]) => fetchSettings(...args),
}));
vi.mock('./playerKey', () => ({ getPlayerKey: () => 'k'.repeat(24) }));
// jsdom has no PushManager: pushSupported() is false, so `on` must be
// reachable through email alone in these tests.

import { useNotifyStatus } from './useNotifyStatus';

const settings = (email: { address: string; status: string } | null) => ({
  pushEnabled: true, emailEnabled: true, vapidPublicKey: null,
  prefs: { push: true, email: true }, pushEndpoints: [], email,
});

beforeEach(() => { fetchSettings.mockReset(); });

describe('useNotifyStatus', () => {
  it('unavailable when the service is absent', async () => {
    fetchSettings.mockResolvedValue(null);
    const { result } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('unavailable'); });
  });

  it('off / pending / on from email status', async () => {
    fetchSettings.mockResolvedValue(settings(null));
    const { result, rerender } = renderHook(() => useNotifyStatus());
    await waitFor(() => { expect(result.current.status).toBe('off'); });

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'pending' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('pending'); });

    fetchSettings.mockResolvedValue(settings({ address: 'a@b.c', status: 'confirmed' }));
    result.current.refresh(); rerender();
    await waitFor(() => { expect(result.current.status).toBe('on'); });
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/notify/useNotifyStatus.ts
// One question, asked from two places (the entry header and the game
// header): is this device set up to be nudged? The answer drives the 🔔
// badge and the entry banner; 'unavailable' draws neither, which is the
// standalone dev server's honest state.

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings } from './api';
import { getPlayerKey } from './playerKey';
import { pushSupported } from './push';

export type NotifyStatus = 'loading' | 'unavailable' | 'off' | 'pending' | 'on';

export function useNotifyStatus(): { status: NotifyStatus; refresh(): void } {
  const [status, setStatus] = useState<NotifyStatus>('loading');
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const playerKey = getPlayerKey();
    if (playerKey === null) { setStatus('unavailable'); return; }
    void (async () => {
      const settings = await fetchSettings(playerKey);
      if (cancelled) return;
      if (settings === null) { setStatus('unavailable'); return; }
      if (settings.email?.status === 'confirmed') { setStatus('on'); return; }

      // Push counts as "on" only when THIS browser holds a subscription the
      // server knows — same check NotificationSettings makes.
      if (settings.pushEnabled && pushSupported()) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (!cancelled && sub !== null && settings.pushEndpoints.includes(sub.endpoint)) {
            setStatus('on');
            return;
          }
        } catch { /* no worker (dev): fall through */ }
      }
      if (cancelled) return;
      setStatus(settings.email?.status === 'pending' ? 'pending' : 'off');
    })();
    return () => { cancelled = true; };
  }, [epoch]);

  const refresh = useCallback(() => { setEpoch((e) => e + 1); }, []);
  return { status, refresh };
}
```

- [ ] **Step 4: Run it** — PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/notify/useNotifyStatus.ts games/wordgame/src/notify/useNotifyStatus.test.ts
git commit -m "feat(wordgame): useNotifyStatus — one hook behind the badge and the banner"
```

---

### Task 5: Board restyle + last-move highlight

**Files:**
- Modify: `games/wordgame/src/game/Board.tsx`
- Test: `games/wordgame/src/game/Board.test.tsx`

**Interfaces:**
- Consumes: token classes (Task 1); `MoveRecord.positions` arrives via
  GameScreen (Task 7) as a new prop.
- Produces: `BoardProps` gains `lastPositions?: number[]` — squares of the
  last committed play, drawn with the gold ring. GameScreen (Task 7) passes
  it.

- [ ] **Step 1: Extend the test**

Add to `Board.test.tsx` (keep existing tests; update any that assert old
premium labels):

```tsx
it('marks the last play with data-last', () => {
  const board = emptyBoard();
  board[112] = { letter: 'Q', isBlank: false };
  board[113] = { letter: 'I', isBlank: false };
  render(<Board board={board} staged={[]} lastPositions={[112, 113]} onCellTap={noop} />);
  expect(screen.getByTestId('cell-112')).toHaveAttribute('data-last');
  expect(screen.getByTestId('cell-113')).toHaveAttribute('data-last');
});

it('labels premiums 3W/2W/3L/2L', () => {
  render(<Board board={emptyBoard()} staged={[]} onCellTap={noop} />);
  expect(screen.getByTestId('cell-0')).toHaveTextContent('3W'); // A1
});
```

- [ ] **Step 2: Run, watch the new assertions fail.**

- [ ] **Step 3: Restyle**

Key edits to `Board.tsx` (structure unchanged — still a grid of buttons):

```tsx
const PREMIUM_CLASS: Record<Premium, string> = {
  DL: 'bg-prem-2l text-prem-2l-ink',
  TL: 'bg-prem-3l text-white',
  DW: 'bg-prem-2w text-prem-2w-ink',
  TW: 'bg-prem-3w text-white',
};

// The design names premiums by their multiplier, not initials.
const PREMIUM_LABEL: Record<Premium, string> = { DL: '2L', TL: '3L', DW: '2W', TW: '3W' };
```

`TileFace` gets the design's face: `font-tile`, cream tile, bevel via
box-shadow, blank lowercase in `text-tile-blank`, and a `last` variant:

```tsx
function TileFace({ letter, isBlank, staged = false, last = false }: TileFaceProps) {
  const value = isBlank ? 0 : TILE_VALUES[letter as keyof typeof TILE_VALUES] ?? 0;
  const ring = staged
    ? 'inset 0 -2px 0 #d9bf8a, 0 0 0 2px #2563eb, 0 2px 6px rgba(37,99,235,.4)'
    : last
      ? 'inset 0 -2px 0 #d9bf8a, 0 1px 1px rgba(0,0,0,.18), 0 0 0 2px #e0a924'
      : 'inset 0 -2px 0 #d9bf8a, 0 1px 1px rgba(0,0,0,.18)';
  return (
    <span
      className={`relative flex h-full w-full items-center justify-center rounded font-tile font-bold bg-tile ${
        isBlank ? 'text-tile-blank' : 'text-tile-ink'
      } ${staged ? 'z-10' : ''}`}
      style={{ boxShadow: ring }}
    >
      …unchanged letter/value spans…
    </span>
  );
}
```

Container: `bg-board p-1 rounded-lg gap-0.5`; empty cells
`bg-board-cell text-board-cell-ink rounded-sm`. Signature/prop:

```tsx
export interface BoardProps {
  board: Square[];
  staged: Placement[];
  /** The last committed play's squares — drawn with the gold ring. */
  lastPositions?: number[];
  onCellTap(pos: number): void;
}
```

In the cell loop: `const isLast = lastPositions?.includes(pos) ?? false;`
add `data-last={isLast ? '' : undefined}` and pass `last={isLast}` to the
occupied-square `TileFace`.

- [ ] **Step 4: Run the package suite** — PASS (fix any premium-label
  assertions in other tests).

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/Board.tsx games/wordgame/src/game/Board.test.tsx
git commit -m "feat(wordgame): board in the hi-fi palette, gold ring on the last play"
```

---

### Task 6: Rack restyle + bag tile

**Files:**
- Modify: `games/wordgame/src/game/Rack.tsx`
- Test: `games/wordgame/src/game/GameScreen.test.tsx` (rack is covered there)

**Interfaces:**
- Produces: `RackProps` gains `bagCount: number` — rendered as the green
  bag tile with a count badge at the row's end (design: dark-green tile,
  white outline square, black `43` pill). GameScreen passes `view.bagCount`.

- [ ] **Step 1: Restyle + add the bag tile**

Tiles become `h-[50px] w-11 rounded-md bg-tile font-tile text-tile-ink` with
the bevel `style={{ boxShadow: 'inset 0 -3px 0 #d9bf8a, 0 1px 3px rgba(0,0,0,.2)' }}`;
selection swaps the shadow for the blue-ring variant (as in Task 5). Blank
shows `·` in `text-tile-blank`. After the tile buttons:

```tsx
<div className="w-2 flex-none" />
<div
  data-testid="bag-tile"
  className="relative flex h-[50px] w-11 flex-none items-center justify-center rounded-md bg-board"
  style={{ boxShadow: 'inset 0 -3px 0 #143528, 0 1px 3px rgba(0,0,0,.25)' }}
  title={`${bagCount} tiles left in the bag`}
>
  <span className="h-[22px] w-[22px] rounded border-2 border-white/35" />
  <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-paper bg-ink px-1.5 text-[11px] font-bold text-white">
    {bagCount}
  </span>
</div>
```

- [ ] **Step 2: Update GameScreen call + tests**

GameScreen: `<Rack tiles={…} selected={…} onTileTap={…} bagCount={view.bagCount} />`.
In `GameScreen.test.tsx`, the "Bag: N" text assertion (if any) moves to
`getByTestId('bag-tile')` having text `N`. The bag count leaves the status
line in Task 7 — for now it appears in both places; that's fine.

- [ ] **Step 3: Run the suite** — PASS.

- [ ] **Step 4: Commit**

```bash
git add games/wordgame/src/game/Rack.tsx games/wordgame/src/game/GameScreen.tsx games/wordgame/src/game/GameScreen.test.tsx
git commit -m "feat(wordgame): beveled rack and the bag as a tile with its count"
```

---

### Task 7: GameScreen shell — header, chips, status, last-move banner, controls

**Files:**
- Modify: `games/wordgame/src/game/GameScreen.tsx`
- Create: `games/wordgame/src/game/PlayerChips.tsx` (replaces ScorePanel usage)
- Create: `games/wordgame/src/game/LastMove.tsx`
- Delete: `games/wordgame/src/game/ScorePanel.tsx` and its assertions (fold what survives into GameScreen.test)
- Modify: `games/wordgame/src/pages/RoomPage.tsx` (pass `roomId`)
- Test: `games/wordgame/src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `useNotifyStatus` (Task 4), `MoveRecord.at/positions` (Task 2),
  `seatEmoji`.
- Produces: `GameScreenProps` gains `roomId: string`. `PlayerChips` props:
  `{ view: GameView; viewerId: string; presence?: Record<string, boolean>; seatEmoji(i: number): string | null }`.
  `LastMove` props: `{ view: GameView; seatEmoji(i: number): string | null }`.
  Board receives `lastPositions` here.

- [ ] **Step 1: Write/adjust failing tests**

In `GameScreen.test.tsx` (reusing its existing fixture `view`):

```tsx
it('shows the room code and a back-to-lobby control', () => {
  renderScreen({ roomId: 'KTWQ' });
  expect(screen.getByText('KTWQ')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /lobby/i })).toBeInTheDocument();
});

it('renders one chip per player with score, current turn highlighted', () => {
  renderScreen();
  const chips = screen.getAllByTestId(/player-chip-/);
  expect(chips).toHaveLength(view.players.length);
  expect(screen.getByTestId(`player-chip-${view.currentPlayerId}`)).toHaveAttribute('data-current');
});

it('describes the last committed play', () => {
  // fixture log ends with { kind: 'play', words: [{ word: 'SQUID', score: 62 }], score: 62, playerId: <maya> }
  renderScreen();
  expect(screen.getByTestId('last-move')).toHaveTextContent(/played SQUID for 62/);
});
```

Also update: turn status asserts `Your turn` /
`{name}’s turn — you’ll get a nudge` (the latter only when notify status is
`on`; otherwise plain `{name}’s turn`); button names now `Play`, `RECALL`,
`SWAP`, `PASS`, `MIX`.

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement**

`PlayerChips.tsx`:

```tsx
import type { GameView } from '../../session/protocol';

export interface PlayerChipsProps {
  view: GameView;
  viewerId: string;
  presence?: Record<string, boolean>;
  seatEmoji(index: number): string | null;
}

/** The roster as pills — the current player's is solid accent. Replaces the
 * old ScorePanel list; rack counts live on the bag tile now, and a
 * disconnected player dims rather than growing a dot. */
export function PlayerChips({ view, viewerId, presence, seatEmoji }: PlayerChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
      {view.players.map((player, index) => {
        const current = view.stage === 'playing' && player.id === view.currentPlayerId;
        const connected = presence?.[player.id] ?? true;
        return (
          <div
            key={player.id}
            data-testid={`player-chip-${player.id}`}
            data-current={current ? '' : undefined}
            className={`flex items-center gap-1.5 rounded-full border-[1.5px] py-1 pl-2 pr-2.5 text-[13px] ${
              current
                ? 'border-accent bg-accent font-bold text-white'
                : 'border-line bg-white font-medium text-ink-soft'
            } ${connected ? '' : 'opacity-60'}`}
          >
            <span aria-hidden>{seatEmoji(index) ?? '·'}</span>
            <span>{player.id === viewerId ? 'You' : player.name}</span>
            <span className={`rounded-full px-1.5 text-xs font-bold ${current ? 'bg-white/20' : 'bg-page'}`}>
              {player.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

`LastMove.tsx`:

```tsx
import type { GameView, MoveRecord } from '../../session/protocol';

/** "3h ago" -style age; empty when the record predates timestamps. */
export function ago(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return '';
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export interface LastMoveProps {
  view: GameView;
  seatEmoji(index: number): string | null;
}

/** The last committed move as one line — the design's banner over the board. */
export function LastMove({ view, seatEmoji }: LastMoveProps) {
  const record: MoveRecord | undefined = view.log[view.log.length - 1];
  if (record === undefined) return null;
  const index = view.players.findIndex((p) => p.id === record.playerId);
  const name = view.players[index]?.name ?? '…';
  const when = ago(record.at);
  const suffix = when === '' ? '' : ` · ${when}`;
  const emoji = seatEmoji(index) ?? '';
  const body =
    record.kind === 'play' ? (
      <>
        <b className="text-ink">{name}</b> played{' '}
        <b className="text-warn-accent">{record.words?.[0]?.word ?? '—'}</b> for{' '}
        <b className="text-ink">{record.score}</b>
      </>
    ) : record.kind === 'exchange' ? (
      <><b className="text-ink">{name}</b> swapped {record.tilesPlayed ?? 0} tiles</>
    ) : (
      <><b className="text-ink">{name}</b> passed</>
    );
  return (
    <div data-testid="last-move" className="mx-3.5 mt-2.5 rounded-xl border border-hairline bg-white px-3 py-2 text-[13px] text-ink-soft">
      {emoji} {body}{suffix}
    </div>
  );
}
```

`GameScreen.tsx` rework (shell only; staging logic untouched):
- Props: add `roomId: string`.
- Screen container: `bg-paper` card feel is the page itself on mobile —
  keep `max-w-2xl mx-auto` but style per design (`bg-paper`, sections
  divided by `border-hairline`).
- Header: `‹ Lobby` button (calls `onExit`), center
  `vs {others' names} · <span className="tracking-widest text-ink-faint">{roomId}</span>`
  (2 players: `vs Maya`; 3+: `vs Sam, Lee, Ana`), right: profile chip —
  a 32px `bg-chipbg` circle with the viewer's initial
  (`view.players.find(p => p.id === viewerId)?.name[0] ?? '·'`), opening
  `NotificationSettings` on tap, with the 🔔 badge dot when
  `useNotifyStatus().status === 'on'`:

```tsx
const { status: notifyStatus, refresh: refreshNotify } = useNotifyStatus();
…
<button type="button" aria-label="Notifications" onClick={() => { setNotifyOpen(true); }}
  className="relative m-0 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-chipbg text-sm font-semibold text-ink-soft">
  {myInitial}
  {notifyStatus === 'on' && (
    <span data-testid="notify-badge" className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-paper bg-accent text-[8px]">🔔</span>
  )}
</button>
```
  (Close handler becomes `() => { setNotifyOpen(false); refreshNotify(); }`.)
- Status line: `Your turn` in `text-accent font-semibold`, or
  `` `${current?.name}’s turn${notifyStatus === 'on' ? ' — you’ll get a nudge' : ''}` `` in
  `text-ink-faint`; bingo state (`myTurn && localRack.length === 0 && staged.length === 7`)
  says `Your turn — all seven tiles played!`. Keep `scorelessTurns` line and
  `data-testid="turn-status"`.
- `<PlayerChips …/>`, `<LastMove …/>` between header and board.
- Board call gains `lastPositions={lastPlayPositions}` where:

```tsx
const lastPlay = [...view.log].reverse().find((r) => r.kind === 'play');
const lastPlayPositions = lastPlay?.positions;
```
- Controls row per design: Play as `flex-1` primary (label handled fully in
  Task 8 — for now keep `Play`), then four 46px square buttons with icon over
  caption:

```tsx
const Ctl = ({ icon, label, ...rest }: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...rest}
    className="m-0 flex w-[46px] flex-col items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-white text-ink-soft disabled:text-ink-ghost">
    <span className="text-base leading-none" aria-hidden>{icon}</span>
    <span className="text-[8.5px] font-semibold">{label}</span>
  </button>
);
```
  `↺ RECALL`, `⇄ SWAP` (toggleExchange), `» PASS` (pass; armed state turns the
  border/text red as today), `⤨ MIX` (shuffleRack). The exchange confirm strip
  keeps its logic, restyled with token classes and the word "Swap"
  (`Confirm swap (N)`).
- Remove `ScorePanel` import/usage; keep `<MoveLog …/>` section below the
  action row. Delete `ScorePanel.tsx`; move its "presence dims a player" test
  intent into the chips test (already written in Step 1).
- `RoomPage.tsx`: `<GameScreen roomId={roomId ?? ''} …/>`.

- [ ] **Step 4: Run the package suite; fix copy-level fallout**
  (`GameScreen.test.tsx` references to Exchange/Shuffle buttons, ScorePanel
  testids). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/ games/wordgame/src/pages/RoomPage.tsx
git commit -m "feat(wordgame): hi-fi game shell — header chips, last move, icon controls"
```

---

### Task 8: GameScreen staging — score badge, Play label, invalid overlay, blank picker

**Files:**
- Modify: `games/wordgame/src/game/GameScreen.tsx`
- Modify: `games/wordgame/src/game/BlankPicker.tsx`
- Modify: `games/wordgame/src/game/RejectionNote.tsx`
- Test: `games/wordgame/src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `previewPlay` (Task 3).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Failing tests**

```tsx
it('prices the play button from the staged preview', async () => {
  renderScreen(); // your turn, fixture rack
  await stageFirstTwoTiles(); // helper: tap rack tile, tap center, tap next…
  expect(screen.getByRole('button', { name: /^Play · \+\d+$/ })).toBeInTheDocument();
});

it('draws the invalid-word card over the board and keeps tiles staged', () => {
  renderScreen({ rejection: { code: 'invalidWord', message: 'not in the dictionary: DAX', words: ['DAX'] } });
  const card = screen.getByTestId('invalid-card');
  expect(card).toHaveTextContent(/DAX isn’t in the dictionary/);
  expect(card).toHaveTextContent(/rearrange or recall/i);
});
```

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement**

GameScreen:

```tsx
const preview = myTurn && !exchangeOn ? previewPlay(view.board, staged) : null;
```

- Play button: label `preview === null ? 'Play' : `Play · +${preview.total}``;
  enabled as today (`!canAct || staged.length === 0` disables). Style:
  enabled `bg-accent text-white shadow`, disabled `bg-hairline text-ink-faint`.
- Floating badge over the board: wrap `<Board …/>` in `relative`; when
  `preview !== null`, absolutely position

```tsx
<div data-testid="stage-badge"
  className="pointer-events-none absolute z-10 -translate-y-full rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-bold text-white shadow"
  style={{ left: `${(colOf(preview.anchorPos) + 1) / 15 * 100}%`, top: `${rowOf(preview.anchorPos) / 15 * 100}%` }}>
  {preview.bingo ? `+${preview.total} · BINGO` : `+${preview.total}`}
</div>
```
  (`colOf`/`rowOf` from `engine/board` — they're pure index math.)
- Invalid word: when `rejection?.code === 'invalidWord'`, render the design's
  card centered over the board instead of the top-of-screen note:

```tsx
{rejection !== null && rejection.code === 'invalidWord' && (
  <div data-testid="invalid-card"
    className="absolute inset-x-6 top-[38%] z-20 rounded-2xl border-2 border-danger bg-white px-3.5 py-3 text-center shadow-2xl">
    <p className="text-[15px] font-bold text-danger-ink">
      ✕ {rejection.words?.join(', ') ?? 'That'} isn’t in the dictionary
    </p>
    <p className="mt-0.5 text-[12.5px] text-ink-faint">Tiles stay on the board — rearrange or recall</p>
    <button type="button" onClick={onDismissRejection}
      className="m-0 mt-2 rounded-lg border border-line-strong px-3 py-1 text-sm font-semibold text-ink-soft">OK</button>
  </div>
)}
```
  Other rejection codes keep the `RejectionNote` strip (restyled with
  `bg-warnbg border-warnbd text-warn-ink`).
- BlankPicker → the design's sheet: 7-column grid of tile-styled buttons
  (`bg-tile font-tile text-tile-ink` + bevel shadow, `h-9 rounded`), title
  `Blank tile — choose its letter`, caption
  `Worth 0 points — shown lowercase on the board`, cancel
  `Cancel — back to rack`. Behavior unchanged.

- [ ] **Step 4: Run the package suite** — PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/
git commit -m "feat(wordgame): staged score badge, priced Play, invalid-word card, tile blank picker"
```

---

### Task 9: Notification sheet restyle + email edit pattern

**Files:**
- Modify: `games/wordgame/src/notify/NotificationSettings.tsx`
- Test: `games/wordgame/src/notify/NotificationSettings.test.tsx`

**Interfaces:** none new. All copy already matches the design (it was drawn
from this component); what changes is the frame and the email interaction.

- [ ] **Step 1: Failing tests**

```tsx
it('shows a saved address read-only with an Edit affordance', async () => {
  mockSettings({ email: { address: 'pete@example.com', status: 'confirmed' } });
  render(<NotificationSettings onClose={noop} />);
  expect(await screen.findByText('pete@example.com')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByRole('textbox')).toHaveValue('pete@example.com');
});

it('rejects a malformed address client-side', async () => {
  mockSettings({ email: null });
  render(<NotificationSettings onClose={noop} />);
  await user.type(await screen.findByRole('textbox'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(notifyPostMock).not.toHaveBeenCalledWith('/email', expect.anything());
});

it('confirms the badge when email is confirmed', async () => {
  mockSettings({ email: { address: 'pete@example.com', status: 'confirmed' } });
  render(<NotificationSettings onClose={noop} />);
  expect(await screen.findByText(/the 🔔 badge now shows on your profile/)).toBeInTheDocument();
});
```

(Use the file's existing mocking approach — it already mocks `./api`.)

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement**

- Frame: `bg-paper rounded-2xl` sheet, ✕ close, sections split by an
  `h-px bg-hairline` divider; push button per design (`bg-accent` when off →
  "Notify me when it’s my turn"; white/bordered when on → "Turn off push").
  Keep every existing degradation branch (loading / unavailable / push
  unsupported / not configured) verbatim.
- Email: new local state `editing: boolean` (initially `email status === null`).
  Read-only row = address + blue `Edit` button (sets editing, seeds the
  input). Editing row = input + `Save`. Client-side validation before the
  POST: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → on failure set the
  `Enter a valid email address.` note (`text-danger-ink`, input border
  `border-danger-ink`) and skip the request. Status line above the field
  keeps the existing pending/confirmed/off copy, drawn as the design's
  tinted pill (`bg-warnbg text-warn-ink` for pending, `bg-[#edf5ee] text-[#3f7a4d]`
  for confirmed).
- Confirmed banner at the sheet's foot when `email.status === 'confirmed'`:
  `✓ You’re set — the 🔔 badge now shows on your profile`
  (`bg-[#f0f5ff] border-accent text-accent-strong`).

- [ ] **Step 4: Run the package suite** — PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/notify/
git commit -m "feat(wordgame): notify sheet in the hi-fi frame, email edits in place"
```

---

### Task 10: Room screens restyle — seat note, waiting banner, join prefill

**Files:**
- Modify: `games/wordgame/src/game/lobby/LobbyCard.tsx`
- Modify: `games/wordgame/src/game/lobby/RoomLobby.tsx`
- Modify: `games/wordgame/src/game/lobby/JoinRoomCard.tsx`
- Modify: `games/wordgame/src/pages/JoinRoomPage.tsx`
- Test: `games/wordgame/src/pages/RoomPage.test.tsx`, new `games/wordgame/src/pages/JoinRoomPage.test.tsx`

**Interfaces:**
- Produces: `RoomLobbyProps` unchanged except behavior;
  `LobbyCardProps.title/subtitle` callers updated ("New room" / "Join room" /
  "Room {code}"). JoinRoomPage reads `?code=`.

- [ ] **Step 1: Failing tests**

In `RoomPage.test.tsx` (drives a fake connection already):

```tsx
it('counts seats under the list', async () => {
  await seatTwoOfSix(); // existing fixture machinery
  expect(screen.getByText('2 of 6 seats — waiting for 4 more')).toBeInTheDocument();
});

it('tells a guest they will be nudged when the game starts', async () => {
  await seatAsGuest();
  expect(screen.getByText('Waiting for Pete to start')).toBeInTheDocument();
  expect(screen.getByText(/You’ll get a nudge when the first turn is yours/)).toBeInTheDocument();
});
```

New `JoinRoomPage.test.tsx`:

```tsx
it('prefills the code from the query string', () => {
  render(
    <MemoryRouter initialEntries={['/online/join?code=ktwq']}>
      <Routes><Route path="/online/join" element={<JoinRoomPage connect={fakeConnect} />} /></Routes>
    </MemoryRouter>,
  );
  expect(screen.getByLabelText('Room code')).toHaveValue('KTWQ');
});
```

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement**

- `LobbyCard`: reframe with tokens — page `bg-page`, card
  `bg-paper rounded-[22px] shadow-xl p-4`, code block
  `bg-[#ece7da] rounded-2xl text-[30px] tracking-[0.32em]` (editable variant
  adds `border-2 border-dashed border-line-strong` per the design's join
  state); seat rows `bg-white border-line rounded-xl`; empty seats
  `border-[1.5px] border-dashed border-line-strong text-ink-ghost italic`;
  Leave `border-line-strong text-ink-soft`. Keep all data-testids, ARIA and
  the uncontrolled/controlled input split.
- `RoomLobby`:
  - Titles per design: host sees `New room` / guest `Room {code}`; subtitle
    host `Share this code with other players`, guest
    `You’re in — the game starts when the host says go`. (`view.you?.isHost`
    picks.)
  - Seat note under the list, derived from `view.seats`:
    ```tsx
    const filled = view.seats.filter((s) => s.id !== null).length;
    const empty = view.seats.length - filled;
    const seatNote = empty === 0
      ? (isHost ? `All ${view.seats.length} seats filled — you can start` : `All ${view.seats.length} seats filled`)
      : `${filled} of ${view.seats.length} seats — waiting for ${empty} more`;
    ```
  - Host primary: label stays `Start game` even while disabled (the seat
    note explains why; drop the old "Waiting for another player" swap).
  - Guest: replace the plain sentence with the amber banner:
    ```tsx
    <div className="rounded-xl border-[1.5px] border-warnbd bg-warnbg p-3 text-center">
      <p className="text-[15px] font-bold text-warn-ink">Waiting for {view.hostName ?? 'the host'} to start</p>
      <p className="text-[12.5px] text-[#a08a55]">You’ll get a nudge when the first turn is yours</p>
    </div>
    ```
    If `LobbyView` lacks a host name, derive it:
    `view.seats.find((s) => s.isHost)?.name ?? 'the host'`.
  - Reconnecting: a seat with `connected === false` and a name gains a
    trailing `reconnecting…` in `text-[11px] text-ink-ghost` (design row 3).
- `JoinRoomCard`: title `Join room`, subtitle `Enter or paste the room code`,
  helper line under the name row:
  `Already sat here before? The code takes you straight back in.`
  (`text-xs text-ink-ghost text-center`).
- `JoinRoomPage`: initialize the code from the URL —
  ```tsx
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());
  ```

- [ ] **Step 4: Run the package suite** — PASS (update any copy assertions:
  "New Room" → "New room", subtitle changes, start-button label).

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/game/lobby/ games/wordgame/src/pages/
git commit -m "feat(wordgame): room screens in the hi-fi frame — seat note, nudge banner, ?code prefill"
```

---

### Task 11: `listRooms` on the shared identity store

**Files:**
- Modify: `packages/lobby/client/identity.ts`
- Test: `packages/lobby/client/identity.test.ts` (extend; it exists — check its harness first)

**Interfaces:**
- Produces: `IdentityStore.listRooms(): { roomId: string; identity: RoomIdentity }[]`
  — every room this browser holds a seat for in this app's namespace.
  Consumed by Task 13. Same storage-throw hardening as every other accessor.

- [ ] **Step 1: Failing test**

```ts
it('lists every stored room identity for this app only', () => {
  const store = createIdentityStore('wordgame');
  const other = createIdentityStore('acquire');
  store.saveIdentity('AAAA', { playerId: 'p1', token: 't1', name: 'Pete' });
  store.saveIdentity('BBBB', { playerId: 'p2', token: 't2', name: 'Pete' });
  other.saveIdentity('CCCC', { playerId: 'p1', token: 't3', name: 'Pete' });
  const rooms = store.listRooms().map((r) => r.roomId).sort();
  expect(rooms).toEqual(['AAAA', 'BBBB']);
});
```

- [ ] **Step 2: Run (`npx vitest run --root packages/lobby`), watch it fail.**

- [ ] **Step 3: Implement**

```ts
  /**
   * Every room this browser holds a seat for, in this app's namespace.
   * Enumerated from storage keys — the store never kept an index, and one
   * would drift; corrupt entries are skipped the same way loadIdentity
   * skips them.
   */
  function listRooms(): { roomId: string; identity: RoomIdentity }[] {
    const prefix = `${appId}.room.`;
    const rooms: { roomId: string; identity: RoomIdentity }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(prefix)) continue;
        const roomId = key.slice(prefix.length);
        const identity = loadIdentity(roomId);
        if (identity !== null) rooms.push({ roomId, identity });
      }
    } catch {
      // Safari private mode: no storage, no rooms — same shrug as read().
    }
    return rooms;
  }
```

Add to the returned object and the `IdentityStore` interface. Re-export
nothing new in `games/wordgame/src/net/identity.ts` — the destructured
export gains `listRooms` automatically once added to the store object; add
it to the destructuring line.

- [ ] **Step 4: Run lobby + wordgame suites** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/lobby/client/identity.ts packages/lobby/client/identity.test.ts games/wordgame/src/net/identity.ts
git commit -m "feat(lobby): identity store enumerates this app's seats"
```

---

### Task 12: Room-summaries endpoint

**Files:**
- Modify: `games/wordgame/server/index.ts` (route registration in `build`)
- Create: `games/wordgame/server/summaries.ts`
- Test: `games/wordgame/server/summaries.test.ts`

**Interfaces:**
- Consumes: `RoomRegistry.get`, `GameRoom` (players with `token`/`isHost`,
  `lifecycle()`, `state()`), `viewFor` NOT needed — summaries are built
  directly and must leak nothing rack-shaped.
- Produces: `POST ${BASE_PATH}/api/summaries`, body
  `{ rooms: { roomId: string; playerId: string; token: string }[] }` (cap 20),
  response `{ summaries: RoomSummary[] }`:

```ts
export type RoomSummary =
  | { roomId: string; known: false }
  | {
      roomId: string;
      known: true;
      lifecycle: 'lobby' | 'playing' | 'over';
      capacity: number;
      players: { name: string; score: number | null; isHost: boolean; isYou: boolean }[];
      yourTurn: boolean;
      currentPlayerName: string | null;
      /** Last committed move, when playing/over and the log has one. */
      lastMove: { name: string; kind: 'play' | 'exchange' | 'pass'; word: string | null; score: number; at: number | null } | null;
      winnerNames: string[] | null;
    };
```

  A row whose token doesn't match the seat comes back `known: false` — the
  same shape as a missing room, so the endpoint probes nothing.

- [ ] **Step 1: Failing test**

```ts
// server/summaries.test.ts — boot createServer({ dictionary: tinyDict }) on
// port 0 like wire.test.ts does; create a room via a socket, start it, play
// a move, then:
it('summarizes a held seat and refuses a bad token identically to a missing room', async () => {
  const res = await fetch(`http://localhost:${port}${BASE_PATH}/api/summaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rooms: [
      { roomId, playerId, token },
      { roomId, playerId, token: 'wrong' },
      { roomId: 'ZZZZ', playerId: 'p1', token: 'x' },
    ] }),
  });
  const body = await res.json();
  expect(body.summaries).toHaveLength(3);
  expect(body.summaries[0]).toMatchObject({ known: true, lifecycle: 'playing', yourTurn: expect.any(Boolean) });
  expect(body.summaries[0].players.every((p: object) => !('rack' in p))).toBe(true);
  expect(body.summaries[1]).toEqual({ roomId, known: false });
  expect(body.summaries[2]).toEqual({ roomId: 'ZZZZ', known: false });
});
```

- [ ] **Step 2: Run, watch it fail (404).**

- [ ] **Step 3: Implement**

`server/summaries.ts`:

```ts
// What the entry screen's game list is drawn from. Token-verified per row —
// the same seat check the notify service makes — and returning `known:false`
// for bad token and missing room alike, so the endpoint cannot be used to
// probe which codes exist. Built by hand rather than through viewFor: a
// summary has no field a rack could ride in.

import type { Request, Response } from 'express';
import { getCurrentActor } from '../engine/actor.js';
import type { RoomRegistry } from './rooms.js';

const MAX_ROOMS = 20;

export function summariesHandler(rooms: Pick<RoomRegistry, 'get'>) {
  return (req: Request, res: Response): void => {
    const body: unknown = req.body;
    const list = (typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).rooms))
      ? ((body as Record<string, unknown>).rooms as unknown[]).slice(0, MAX_ROOMS)
      : null;
    if (list === null) { res.status(400).json({ error: 'rooms: [{roomId, playerId, token}] required' }); return; }

    const summaries = list.map((entry) => {
      const row = (typeof entry === 'object' && entry !== null) ? entry as Record<string, unknown> : {};
      const roomId = typeof row.roomId === 'string' ? row.roomId : '';
      const unknown = { roomId, known: false as const };
      if (typeof row.playerId !== 'string' || typeof row.token !== 'string') return unknown;
      const room = rooms.get(roomId);
      if (room === undefined) return unknown;
      const seat = room.players.find((p) => p.id === row.playerId);
      if (seat === undefined || seat.token !== row.token) return unknown;

      const state = room.state();
      const currentId = state === null ? null : getCurrentActor(state);
      const last = state?.log[state.log.length - 1];
      const lastName = last === undefined ? null
        : state?.players.find((p) => p.id === last.playerId)?.name ?? null;
      return {
        roomId,
        known: true as const,
        lifecycle: room.lifecycle(),
        capacity: 6, // MAX_PLAYERS — import it
        players: room.players.map((p) => ({
          name: p.name,
          score: state?.players.find((sp) => sp.id === p.id)?.score ?? null,
          isHost: p.isHost,
          isYou: p.id === row.playerId,
        })),
        yourTurn: currentId === row.playerId,
        currentPlayerName: state?.players.find((p) => p.id === currentId)?.name ?? null,
        lastMove: last === undefined || lastName === null ? null : {
          name: lastName,
          kind: last.kind,
          word: last.words?.[0]?.word ?? null,
          score: last.score,
          at: last.at ?? null,
        },
        winnerNames: state?.final === undefined ? null
          : state.final.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name ?? id),
      };
    });
    res.json({ summaries });
  };
}
```

In `build()` in `server/index.ts`, beside the health route (json parser
route-scoped, never global — composed-host rule):

```ts
app.post(`${BASE_PATH}/api/summaries`, express.json(), summariesHandler(rooms));
```

- [ ] **Step 4: Run the server suite** — PASS. Also run
  `npx vitest run --root apps/host routes.test.ts` to confirm nothing about
  the composed process objects to the new route.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/server/summaries.ts games/wordgame/server/index.ts games/wordgame/server/summaries.test.ts
git commit -m "feat(wordgame): token-verified room summaries for the entry screen"
```

---

### Task 13: The Entry screen

**Files:**
- Rewrite: `games/wordgame/src/pages/HomePage.tsx` (becomes the Entry screen)
- Create: `games/wordgame/src/pages/useMyGames.ts`
- Delete: `games/wordgame/src/pages/OnlineLobbyPage.tsx`
- Modify: `games/wordgame/src/App.tsx` (routes)
- Test: `games/wordgame/src/pages/HomePage.test.tsx` (new)

**Interfaces:**
- Consumes: `listRooms` (Task 11), the summaries endpoint (Task 12),
  `useNotifyStatus` (Task 4), `askWithTimeout` + `getConnection` (moved from
  OnlineLobbyPage), `clearIdentity`, `ago` (Task 7's LastMove module).
- Produces:
  ```ts
  export interface MyGame { roomId: string; summary: RoomSummary /* known: true */ }
  export function useMyGames(): { games: MyGame[] | null } // null while loading; [] when none/unavailable
  ```

- [ ] **Step 1: Failing tests**

```tsx
// HomePage.test.tsx — mock fetch for /api/summaries and the identity store.
it('groups games by whose move it is', async () => {
  mockRooms([
    lobbyRoom('LARK'),                       // → WAITING FOR PLAYERS
    playingRoom('KTWQ', { yourTurn: true }), // → YOUR MOVE
    playingRoom('MOSS', { yourTurn: false }),// → THEIR MOVE
  ]);
  renderHome();
  expect(await screen.findByText('WAITING FOR PLAYERS')).toBeInTheDocument();
  expect(screen.getByText(/YOUR MOVE \(1\)/)).toBeInTheDocument();
  expect(screen.getByText('THEIR MOVE')).toBeInTheDocument();
});

it('navigates into a room on tap', async () => {
  mockRooms([playingRoom('KTWQ', { yourTurn: true })]);
  renderHome();
  await user.click(await screen.findByTestId('game-KTWQ'));
  expect(currentPath()).toBe('/room/KTWQ');
});

it('nudges when notifications are off and hides the banner when on', async () => {
  setNotifyStatus('off');
  renderHome();
  expect(await screen.findByText(/get a nudge when it’s yours/)).toBeInTheDocument();
});

it('drops identities for rooms the server no longer knows', async () => {
  mockRooms([]); // summaries: [{ roomId: 'GONE', known: false }]
  renderHome();
  await waitFor(() => { expect(clearIdentityMock).toHaveBeenCalledWith('GONE'); });
});
```

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement**

`useMyGames.ts`:

```ts
// The entry list: every room this device holds a seat in, summarized by the
// server. One POST per mount — the list is a lobby, not a live view; the
// room page is where live state lives. A room the server disowns gets its
// identity cleared so it never haunts the list again.

import { useEffect, useState } from 'react';
import { listRooms, clearIdentity } from '../net/identity';

// The endpoint lives under the game's base path; the client stays
// origin-relative by addressing it through Vite's own base
// (`import.meta.env.BASE_URL` ends with '/'), never a hardcoded prefix.

export function useMyGames() {
  const [games, setGames] = useState<MyGame[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const rooms = listRooms();
    if (rooms.length === 0) { setGames([]); return; }
    void (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/summaries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rooms: rooms.map((r) => ({ roomId: r.roomId, playerId: r.identity.playerId, token: r.identity.token })) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { summaries: RoomSummary[] };
        if (cancelled) return;
        const known: MyGame[] = [];
        for (const s of body.summaries) {
          if (s.known) known.push({ roomId: s.roomId, summary: s });
          else clearIdentity(s.roomId);
        }
        setGames(known);
      } catch {
        // Standalone dev server (404) or a blip: an empty list, not an error
        // page — the New room door still works.
        if (!cancelled) setGames([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return { games };
}
```

(Define `RoomSummary`/`MyGame` types locally in this file, mirroring Task
12's response — the server file isn't importable into the client bundle
cleanly; a shared type in `session/protocol.ts` is also acceptable and
preferable if it stays type-only.)

`HomePage.tsx` — the design's Entry frame:
- Header: `Word Game` title left; profile chip right (initial from
  `rememberedName()?.[0] ?? '?'`, 🔔 badge when `status === 'on'` — same
  chip element as Task 7; tapping opens `NotificationSettings`, and its
  `onClose` calls `refresh()`).
- Banner under the header, from `useNotifyStatus()`:
  - `off`: blue-tinted (`bg-[#f0f5ff] border-accent`), text
    `🔔 Turns can be days apart — get a nudge when it’s yours`, button
    `Set up` → opens the notify sheet.
  - `pending`: amber (`bg-warnbg border-warn-accent`), text
    `✉️ Confirm your email — we sent a link to {maskedAddress}`, button
    `Resend` → also opens the sheet (the sheet owns resending).
  - `on`/`unavailable`/`loading`: no banner.
  (Mask: `p•••@gmail.com` style — first char + `•••` + domain. The address
  comes from a small extension: have `useNotifyStatus` also return
  `emailAddress: string | null`; add it in this task.)
- Sections from `useMyGames()`, each a labeled group
  (`text-[11.5px] font-semibold tracking-[.07em] text-ink-faint` headers):
  1. `WAITING FOR PLAYERS` — `lifecycle === 'lobby'`. Card: dashed
     `border-warn-accent` when you host; emoji row from seat count
     (`seatEmoji` over player indexes), `Room {roomId} · you host` or
     `Room {roomId}`, pill `{filled} OF {capacity}` (`bg-warnbg text-warn-ink`),
     subline `{other names} joined`.
  2. `YOUR MOVE ({n})` — playing && `yourTurn`. Card `bg-[#f0f5ff]
     border-accent`, pill `YOUR TURN` (`bg-accent text-white`), title
     `vs {other players' names}`, subline for 2-player:
     `You {yourScore} · {them} {theirScore} · {lastMove line} · {ago}`;
     3+: `{ordinal} of {n} · {lastMove line} · {ago}` (compute your rank
     from scores).
  3. `THEIR MOVE` — playing && not yours. White card, pill
     `{CURRENTNAME}’S TURN` (`bg-[#eee8db] text-ink-mute`), muted sublines.
  4. Finished games (`lifecycle === 'over'`): show under `THEIR MOVE`? No —
     design has no finished section; give them their own `FINISHED` group at
     the bottom, pill `{WINNER} WON` — minimal, same card anatomy. (The list
     only shows rooms this device sat in; a finished room ages out
     server-side in 30 days.)
  Card tap → `navigate(`/room/${roomId}`)`, `data-testid={`game-${roomId}`}`.
- Footer buttons (bottom-pinned, `mt-auto`): primary `New room` — runs the
  create-room episode lifted verbatim from `OnlineLobbyPage` (the
  `askWithTimeout` block, including the error strip and `Creating…` busy
  label); secondary `Join with a code` → `/online/join`.
- Empty list + `games === null`: just the doors (the design's minimal
  pre-game state is the same frame with no sections).

`App.tsx`:

```tsx
<Route path="/" element={<HomePage />} />
<Route path="/online" element={<Navigate to="/" replace />} />
<Route path="/online/join" element={<JoinRoomPage />} />
<Route path="/room/:roomId" element={<RoomPage />} />
<Route path="*" element={<Navigate to="/" replace />} />
```

Delete `OnlineLobbyPage.tsx` and its test; port any create-room test cases
into `HomePage.test.tsx` (the timeout/silence case especially).

- [ ] **Step 4: Run the package suite** — PASS.

- [ ] **Step 5: Commit**

```bash
git add games/wordgame/src/pages/ games/wordgame/src/App.tsx
git commit -m "feat(wordgame): the entry screen — your games, grouped by whose move"
```

---

### Task 14: Sweep, gates, PR

**Files:**
- Modify: `games/wordgame/src/game/GameOverPanel.tsx`,
  `games/wordgame/src/game/lobby/{RoomGone,RoomRefused,StaleClient,ConnectionStrip,ShareRoomButton}.tsx`
  (token-class alignment only: `bg-paper` cards, `border-line-strong`
  buttons, accent primaries — no structural change),
  `games/wordgame/src/game/MoveLog.tsx` (append `· {ago(record.at)}` via
  Task 7's `ago`).
- Modify: `games/wordgame/index.html` if it declares a theme-color meta
  (set `#e9e5da`).

**Steps:**

- [ ] **Step 1: Apply the token pass to the listed leaf components.** Any
  `bg-gray-50`/`bg-white`/`border-gray-300` in `games/wordgame/src` that
  survived Tasks 5–13 gets its token equivalent
  (`grep -rn 'gray-' games/wordgame/src` should end near zero; ConnectionStrip's
  status colors may keep semantic red/green).

- [ ] **Step 2: Full gates from the root**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
Expected: all clean — including the other games' suites (the
`packages/lobby` change is the only cross-package edit; its conformance
tests cover the games that share it).

- [ ] **Step 3: Boot the composed host and eyeball each design state**

```bash
DATA_DIR=$(mktemp -d) npm run start:host
```
Walk the five lanes of `Word Game States.dc.html` against
`http://localhost:4000/wordgame/`: create → share → entry list → start;
join via link; notify off/pending/on; stage/blank/invalid/bingo; rejoin.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add -A && git commit -m "chore(wordgame): token sweep over the remaining screens"
git push -u origin <branch>
gh pr create --title "Word game redesign: hi-fi screens + entry lobby" --body "…"
```

PR body: what the design specifies, the four behavioral additions
(timestamps/positions, score preview, notify status, summaries endpoint +
listRooms), and the explicit non-goals (pass-and-play section, capacity 4,
origin-external fonts). Do not merge; Pete reviews on GitHub.

---

## Self-review notes (done at planning time)

- **Spec coverage:** every `dc-import` state in the journeys board maps to a
  task — Entry `notif=off/pending/on`, `waitingRoom` (T13), Room
  `new/join/waiting × seats` (T10), Hi-Fi `tray full/semi/empty`,
  `blank chooser/set`, `invalidWord`, `yourTurn=false` (T5–T8), Notify
  `setup/sent/on` (T9, T4). The one design element with no task is the
  "ON THIS DEVICE / pass & play" card — decision 5, deliberate.
- **Type consistency:** `previewPlay` (T3) is consumed by that exact name in
  T8; `useNotifyStatus` (T4) in T7/T13 (T13 extends its return with
  `emailAddress` — implement that in T13, updating T4's test file);
  `listRooms` (T11) in T13; `RoomSummary` (T12) in T13; `lastPositions`
  (T5) fed in T7; `ago` (T7) reused in T13/T14.
- **Known soft spots an executor should verify rather than trust:** the
  hand-computed score in T3 step 1; the exact fixture helpers named in T2/T12
  test sketches (copy real setup from `wire.test.ts`/`testState.ts`);
  whether `LobbyView` seats expose `isHost`/`connected` under those names
  (read `packages/lobby/client/view.ts` before T10); `import.meta.env.BASE_URL`
  ending with `/` (it does under Vite `base`) so the summaries fetch path has
  no `//`.
