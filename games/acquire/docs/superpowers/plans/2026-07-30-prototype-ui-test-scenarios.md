# Prototype UI-test Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two standalone, deterministic click-through UI scenarios to `prototype/` (a permanently-dead tile traded for a replacement, and a chain hitting 41 to win) driven by a shared rules-free step player.

**Architecture:** All game truth is authored data — a `base` state plus a `STEPS` array of shallow patches merged cumulatively. A shared driver (`scenario.js`) renders each resolved step as board + panel using the existing presentational layer and advances on a single per-step hotspot click. First, the panel-zone renderers currently inlined in `index.html` are hoisted into `components.js` so the app and the scenarios render from one source of truth.

**Tech Stack:** Buildless vanilla HTML/CSS/JS in `prototype/`, sharing `components.css` + `components.js`. No framework, no bundler, no test runner. Verification is `node --check` on JS plus manual browser checks.

## Global Constraints

- No game-rules engine, no tile bag, no random draws, no adjacency/merge computation in scenarios — every value is authored. The dead-tile replacement is one fixed tile (`I12`); the win target is one fixed tile.
- No changes to `index.html`'s game engine. The only edits to `index.html` are (a) the presentational rewire in Task 1 and (b) the "Scenarios" nav link in Task 5. Engine functions (`initGame`, `placementBlocked`, `switchPlacement`, stage logic) are untouched.
- Scripts are linear: exactly one hotspot `{sel, to}` per step, or none on the terminal step.
- Reuse existing atoms/composites from `components.js` (`boardHtml`, `tile`, `activeStep`, `stepEntry`, `stagingZone`, `stacksFor`, `cash`, `stockStack`) and existing CSS classes. Do not add new CSS to `components.css`; scenario-only styles are injected by `scenario.js`.
- Board coordinates are `A1`–`I12` (rows `A`–`I`, cols `1`–`12`), consistent with `ROWS`/`COLS` in `components.js`.
- Panel render order is fixed: `stepstack → active → staging → hand → players`. Panel zones must not resize between steps (the panel-height-stability invariant).
- Respect `prefers-reduced-motion` (skip the enter animation), matching `states.html`.

---

### Task 1: Hoist panel renderers into `components.js`, rewire `index.html`

Move the four panel-composition renderers out of `index.html` into `components.js` as pure, props-in functions, then make `index.html` call them. Output must be byte-for-byte identical so the live app is visually unchanged.

**Files:**
- Modify: `prototype/components.js` (append four functions after `boardHtml`, ~line 206)
- Modify: `prototype/index.html` (`handHtml` ~432, `playersHtml` ~442, `stepStackHtml` ~460, `renderPanel` ~597)

**Interfaces:**
- Produces (consumed by Task 2 and index.html):
  - `handZone({name, portfolio, cash}) → string` — the `.hand-zone` HTML.
  - `playersStrip(players) → string` — `players: [{emoji, name, cash, active}]` → the `.players-strip` HTML.
  - `stepStack(steps, renderEntry=stepEntry) → string` — wraps rendered entries in `.stepstack`; `steps` is an array passed one-by-one to `renderEntry`.
  - `panelHtml({stepstack, active, staging, hand, players}) → string` — concatenates the five pre-rendered zone strings in fixed order.
- Consumes: existing `stacksFor`, `cash`, `stepEntry` from `components.js`.

- [ ] **Step 1: Append the four pure renderers to `components.js`**

Add at the end of `prototype/components.js` (after `boardHtml`):

```js
/* ---- panel zones (hoisted from index.html; pure / props-in) ---- */

/* the "<name>'s hand" zone: portfolio stacks + balance. */
function handZone({name, portfolio, cash:bal}){
  return `<div class="hand-zone">
    <div class="zone-label">${name}'s hand</div>
    <div class="hand-body">${stacksFor(portfolio)}<div class="balance"><span class="bl">Balance</span><span class="bn">${cash(bal)}</span></div></div>
  </div>`;
}

/* the players strip. players: [{emoji, name, cash, active}] (cash already resolved by caller). */
function playersStrip(players){
  return `<div class="players-strip">
    ${players.map(p=>`<div class="pl ${p.active?'active':''}"><span class="player-emoji">${p.emoji||'•'}</span><span class="pnm">${p.name}</span><span class="pcash">${cash(p.cash)}</span></div>`).join('')}
  </div>`;
}

/* the stepstack wrapper (also the flex spacer pinning zones below to the bottom).
   renderEntry maps one step → HTML; defaults to the shared stepEntry (no undo). */
function stepStack(steps, renderEntry=stepEntry){
  return `<div class="stepstack">${steps.map(s=>renderEntry(s)).join('')}</div>`;
}

/* compose the panel: the five zones in fixed order. Callers pass pre-rendered HTML. */
function panelHtml({stepstack='', active='', staging='', hand='', players=''}){
  return `${stepstack}${active}${staging}${hand}${players}`;
}
```

- [ ] **Step 2: Rewire `index.html` `handHtml` to call `handZone`**

Replace the body of `handHtml` (`prototype/index.html:432-441`) with:

```js
function handHtml(){
  const g = game, dp = displayPlayer(), liq = g.stage==="mergerLiquidation", folded = g.stage==="turnComplete";
  // liquidation → the liquidator's live holdings; buy/found → the turn-player's turn-start base; complete → folded
  const portfolio = (liq || folded) ? dp.portfolio : g.turnStartHand.portfolio;
  const bal       = (liq || folded) ? dp.cash      : g.turnStartHand.cash;
  return handZone({name:dp.name, portfolio, cash:bal});
}
```

- [ ] **Step 3: Rewire `index.html` `playersHtml` to call `playersStrip`**

Replace the body of `playersHtml` (`prototype/index.html:442-451`) with:

```js
function playersHtml(){
  const g = game, dp = displayPlayer(), liq = g.stage==="mergerLiquidation", folded = g.stage==="turnComplete";
  const players = g.players.map(p=>{
    const isDp = p.id===dp.id;
    const c = (isDp && !liq && !folded) ? g.turnStartHand.cash : p.cash;   // turn-player tracks the hand base until fold
    return {emoji:p.emoji, name:p.name, cash:c, active:isDp};
  });
  return playersStrip(players);
}
```

- [ ] **Step 4: Rewire `index.html` `stepStackHtml` to call `stepStack`**

Replace the body of `stepStackHtml` (`prototype/index.html:460-463`) with:

```js
function stepStackHtml(){
  return stepStack(game.steps, stepEntryHtml);   // stepEntryHtml adds the ↺ undo button per step
}
```

(Leave `stepEntryHtml` and `stepsListHtml` as-is; `stepsListHtml` may now be unused — that is fine, do not delete it in this task.)

- [ ] **Step 5: Rewire `index.html` `renderPanel` to call `panelHtml`**

Replace the body of `renderPanel` (`prototype/index.html:597-601`) with:

```js
function renderPanel(){
  // bottom-anchored: log rises at top, then active phase, staging, your hand, players pinned
  document.getElementById("panel").innerHTML = panelHtml({
    stepstack: stepStackHtml(),
    active:    activeStepHtml(),
    staging:   stagingHtml(),
    hand:      handHtml(),
    players:   playersHtml(),
  });
}
```

- [ ] **Step 6: Syntax-check the JS**

Run: `node --check prototype/components.js`
Expected: no output, exit 0.

- [ ] **Step 7: Manual regression check of the live app**

Serve and open the app:

```bash
cd prototype && python3 -m http.server 8777
```

Open `http://127.0.0.1:8777/index.html`. Verify:
- Console is clean (no errors).
- The starting panel (players strip, hand zone, "Place a tile") looks unchanged.
- Place `E6` → merger flows (payout, liquidate); place `G6` → found; then buy. Each panel — play / found / merger / payout / liquidate / buy / turn-complete — renders identically to before, and panel zones do not shift height.

Expected: PASS (visually identical to pre-change app).

- [ ] **Step 8: Commit**

```bash
git add prototype/components.js prototype/index.html
git commit -m "refactor(prototype): hoist panel-zone renderers into components.js"
```

---

### Task 2: Build the shared driver `scenario.js`

A rules-free step player: resolves cumulative patches, renders board + panel via the hoisted renderers, advances on a single hotspot per step, animates the active step in, and provides Back / Replay / step-counter chrome. Injects its own scenario-only CSS so `components.css` stays untouched.

**Files:**
- Create: `prototype/scenario.js`

**Interfaces:**
- Consumes (from `components.js`): `boardHtml`, `panelHtml`, `stepStack`, `handZone`, `playersStrip`, `activeStep`, `stepEntry`, `tile`, `cash`.
- Produces: global `runScenario({base, steps})` called by each scenario HTML file. Also defines global no-op shims `onBoardCellClick`, `switchPlacement` so inline `onclick`s emitted by `boardHtml`/`tile` do not throw.
- Requires the host HTML to provide elements with ids: `board`, `panel`, `caption`, `stepCount`, `scBack`, `scReplay`.
- Step shape (resolved): `{ board, boardOpts?, log?, active?, staging?, hand:{name,portfolio,cash}, players:[{emoji,name,cash,active}], caption?, hotspot?:{sel,to} }`.

- [ ] **Step 1: Write `scenario.js`**

Create `prototype/scenario.js`:

```js
/* ============================================================
   scenario.js — rules-free driver for authored UI walkthroughs.
   Renders board + panel from authored step data (no game engine).
   Each scenario file calls runScenario({ base, steps }).
   ============================================================ */

/* inline onclicks emitted by boardHtml()/tile() must not throw; the real
   advance happens via delegated hotspot matching below. */
window.onBoardCellClick = function(){};
window.switchPlacement  = function(){};

/* scenario-only chrome + the enter animation, injected so components.css is untouched. */
const SC_STYLE = `
.sc-controls{margin-left:auto; display:flex; gap:8px; align-items:center;}
.sc-controls .reset-btn{margin-left:0;}
#stepCount{font-variant-numeric:tabular-nums; color:#374151; font-size:13px;}
.scenario-caption{flex-basis:100%; font-size:12px; color:#6b7280; padding-top:4px;}
.standings{display:flex; flex-direction:column; gap:4px; margin-top:6px;}
.active-step.enter{animation:tpUp var(--tp-dur,280ms) cubic-bezier(.2,.7,.3,1);}
@keyframes tpUp{from{transform:translateY(18px);opacity:0;} to{transform:none;opacity:1;}}
@media (prefers-reduced-motion:reduce){ .active-step.enter{animation:none;} }
`;
(function(){ const s=document.createElement('style'); s.textContent=SC_STYLE; document.head.appendChild(s); })();

/* state[i] = merge(state[i-1], STEPS[i]); state[-1] = base. Shallow spread. */
function resolveSteps(base, steps){
  const out = []; let acc = base;
  steps.forEach(patch=>{ acc = Object.assign({}, acc, patch); out.push(acc); });
  return out;
}

function scenarioPanel(step){
  return panelHtml({
    stepstack: stepStack(step.log || []),
    active:    step.active  || '',
    staging:   step.staging || '',
    hand:      handZone(step.hand),
    players:   playersStrip(step.players),
  });
}

function runScenario({base, steps}){
  const resolved = resolveSteps(base, steps);
  let cur = 0;
  const boardEl = document.getElementById('board');
  const panelEl = document.getElementById('panel');
  const capEl   = document.getElementById('caption');
  const countEl = document.getElementById('stepCount');
  const reduce  = window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  function render(animate){
    const step = resolved[cur];
    boardEl.innerHTML = boardHtml(step.board, step.boardOpts || {});
    panelEl.innerHTML = scenarioPanel(step);
    capEl.innerHTML   = step.caption || '';
    countEl.textContent = `${cur+1} / ${resolved.length}`;
    if(animate && !reduce){
      const a = panelEl.querySelector('.active-step');
      if(a){ a.classList.remove('enter'); void a.offsetWidth; a.classList.add('enter'); }
    }
  }
  function goto(i){ if(i<0 || i>=resolved.length) return; cur = i; render(true); }

  function tryHotspot(e){
    const hs = resolved[cur].hotspot;
    if(hs && e.target.closest(hs.sel)) goto(hs.to);
  }
  panelEl.addEventListener('click', tryHotspot);
  boardEl.addEventListener('click', tryHotspot);
  document.getElementById('scBack').addEventListener('click', ()=> goto(cur-1));
  document.getElementById('scReplay').addEventListener('click', ()=> goto(0));

  render(false);
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check prototype/scenario.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add prototype/scenario.js
git commit -m "feat(prototype): add rules-free scenario driver"
```

---

### Task 3: Build `scenario-dead-tile.html`

Two size-11 safe chains (`Messla B1–B11`, `ZuckFace D1–D11`) with a permanently-dead tile `C6` between them. The dead tile is shown blocked on the board and blocked-but-clickable in the panel; clicking it trades it for a single fixed replacement `I12`.

**Files:**
- Create: `prototype/scenario-dead-tile.html`

**Interfaces:**
- Consumes: `runScenario` (Task 2); `makeBoard`/`chain` helpers defined in-file; `activeStep`, `tile`, `switchPlacement` shim (Task 2).
- The dead-tile hotspot targets the panel tile (`.active-step [title="C6"]`) — `tile('C6',{state:'blocked', onclick})` renders a clickable blocked button (`tile()` treats any `onclick` as interactive). The board `C6` stays inert (blocked, non-clickable) via `boardOpts.blocked`.

- [ ] **Step 1: Write `scenario-dead-tile.html`**

Create `prototype/scenario-dead-tile.html`:

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>Acquire — Scenario: Dead tile</title>
<link rel="stylesheet" href="components.css">

<div class="topbar">
  <div class="brand">Prototype</div>
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html">Motion</a>
    <a href="scenario-dead-tile.html" aria-current="page">Scenarios</a>
  </nav>
  <nav class="proto-nav">
    <a href="scenario-dead-tile.html" aria-current="page">Dead tile</a>
    <a href="scenario-win-41.html">Win 41</a>
  </nav>
  <div class="sc-controls">
    <button class="reset-btn" id="scBack">◀ Back</button>
    <output id="stepCount">1 / 2</output>
    <button class="reset-btn" id="scReplay">↺ Replay</button>
  </div>
  <div class="scenario-caption" id="caption"></div>
</div>

<div class="main side" id="main">
  <div class="board-wrap"><div class="board" id="board"></div></div>
  <div class="panel" id="panel"></div>
</div>

<script src="components.js"></script>
<script src="scenario.js"></script>
<script>
/* ---- board helpers (per-file; no engine) ---- */
function makeBoard(fill){
  const b = {}; ROWS.forEach(r=>COLS.forEach(c=> b[r+c] = {placed:false}));
  Object.entries(fill).forEach(([coord,id])=> b[coord] = {placed:true, startupId:id});
  return b;
}
function chain(row, from, to, id){
  const o = {}; for(let c=from;c<=to;c++) o[row+c] = id; return o;
}

/* two size-11 safe chains with a dead gap at C6 (adjacent to B6 Messla + D6 ZuckFace) */
const board = makeBoard({ ...chain('B',1,11,'Messla'), ...chain('D',1,11,'ZuckFace') });

const players = [
  {emoji:'🦊', name:'Alex',   cash:4200, active:true},
  {emoji:'🐢', name:'Sam',    cash:5800, active:false},
  {emoji:'🦁', name:'Jordan', cash:3100, active:false},
];

const base = {
  board,
  boardOpts:{ hand:['C6','G6'], blocked:['C6'], hqTiles:['B1','D1'] },
  hand:{ name:'Alex', portfolio:{Messla:4, ZuckFace:2}, cash:4200 },
  players,
  log:[], active:'', staging:'',
};

const steps = [
  { // step 0 — play: the dead tile is offered for trade-in
    active: activeStep({
      label:'Place a tile',
      body:`<div class="option-row">`
        + tile('C6',{state:'blocked', onclick:"switchPlacement('C6')"})
        + tile('G6',{state:'hand',    onclick:"switchPlacement('G6')"})
        + `</div>`
        + `<div class="hint">◻ C6 can never be played — it would merge two safe chains. Tap it to trade it in.</div>`,
    }),
    caption:'Two size-11 safe chains with a single dead tile (C6) between them.',
    hotspot:{ sel:'.active-step [title="C6"]', to:1 },
  },
  { // step 1 — traded in: C6 gone, I12 drawn; turn continues
    boardOpts:{ hand:['G6','I12'], blocked:[], hqTiles:['B1','D1'] },
    log:[{ phase:'Traded a tile', detail:'◻ C6 → drew ◻ I12' }],
    active: activeStep({
      label:'Place a tile',
      body:`<div class="option-row">`
        + tile('G6', {state:'hand', onclick:"switchPlacement('G6')"})
        + tile('I12',{state:'hand', onclick:"switchPlacement('I12')"})
        + `</div>`
        + `<div class="hint">Traded in — the turn continues; you can still place a tile.</div>`,
    }),
    caption:'The dead tile is swapped for a fresh one (I12). The turn continues.',
  },
];

runScenario({ base, steps });
</script>
```

- [ ] **Step 2: Manual check**

With the server from Task 1 running, open `http://127.0.0.1:8777/scenario-dead-tile.html`. Verify:
- Console clean; counter shows `1 / 2`.
- Board: `B1–B11` and `D1–D11` render as chains (B1/D1 show tickers); `C6` shows the blocked look; `G6` shows the hand highlight.
- Panel: "Place a tile" with a blocked-but-highlighted `C6` and a normal `G6`, plus the hint.
- Clicking `C6` in the panel advances to step `2 / 2` with the slide+fade; the log gains "Traded a tile · ◻ C6 → drew ◻ I12"; the hand tiles become `G6` + `I12` (I12 highlighted bottom-right). Clicking `G6` or elsewhere does nothing.
- `↺ Replay` returns to `1 / 2`; `◀ Back` from step 2 returns to step 1.

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add prototype/scenario-dead-tile.html
git commit -m "feat(prototype): add dead-tile trade-in scenario"
```

---

### Task 4: Build `scenario-win-41.html`

One chain (`Gobble`) pre-grown to 40 tiles; placing the adjacent target `D5` makes 41 and ends the game with a final-standings panel.

**Files:**
- Create: `prototype/scenario-win-41.html`

**Interfaces:**
- Consumes: `runScenario` (Task 2); in-file `makeBoard`/`chain` helpers; `activeStep`, `tile`, `cash`, `onBoardCellClick` shim (Task 2).
- `Gobble` = `A1–A12` + `B1–B12` + `C1–C12` + `D1–D4` = exactly 40 tiles. Target `D5` (adjacent to `C5` and `D4`, both Gobble) is a normal placeable — hotspot targets the board cell `.board [title="D5"]`.

- [ ] **Step 1: Write `scenario-win-41.html`**

Create `prototype/scenario-win-41.html`:

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>Acquire — Scenario: Win at 41</title>
<link rel="stylesheet" href="components.css">

<div class="topbar">
  <div class="brand">Prototype</div>
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html">Motion</a>
    <a href="scenario-dead-tile.html">Scenarios</a>
  </nav>
  <nav class="proto-nav">
    <a href="scenario-dead-tile.html">Dead tile</a>
    <a href="scenario-win-41.html" aria-current="page">Win 41</a>
  </nav>
  <div class="sc-controls">
    <button class="reset-btn" id="scBack">◀ Back</button>
    <output id="stepCount">1 / 2</output>
    <button class="reset-btn" id="scReplay">↺ Replay</button>
  </div>
  <div class="scenario-caption" id="caption"></div>
</div>

<div class="main side" id="main">
  <div class="board-wrap"><div class="board" id="board"></div></div>
  <div class="panel" id="panel"></div>
</div>

<script src="components.js"></script>
<script src="scenario.js"></script>
<script>
/* ---- board helpers (per-file; no engine) ---- */
function makeBoard(fill){
  const b = {}; ROWS.forEach(r=>COLS.forEach(c=> b[r+c] = {placed:false}));
  Object.entries(fill).forEach(([coord,id])=> b[coord] = {placed:true, startupId:id});
  return b;
}
function chain(row, from, to, id){
  const o = {}; for(let c=from;c<=to;c++) o[row+c] = id; return o;
}

const G = 'Gobble';
/* 40 tiles: rows A,B,C full (12 each) + D1–D4 = 36 + 4 = 40 */
const fill40 = { ...chain('A',1,12,G), ...chain('B',1,12,G), ...chain('C',1,12,G), ...chain('D',1,4,G) };
const board40 = makeBoard(fill40);
const board41 = makeBoard({ ...fill40, D5:G });   // +D5 → 41

const players = [
  {emoji:'🦊', name:'Alex',   cash:8600, active:true},
  {emoji:'🐢', name:'Sam',    cash:5200, active:false},
  {emoji:'🦁', name:'Jordan', cash:3100, active:false},
];

function standings(ps){
  return `<div class="standings">${ps.slice().sort((a,b)=>b.cash-a.cash).map(p=>
    `<div class="pl"><span class="player-emoji">${p.emoji}</span><span class="pnm">${p.name}</span><span class="pcash">${cash(p.cash)}</span></div>`
  ).join('')}</div>`;
}

const base = {
  board: board40,
  boardOpts:{ hand:['D5'], hqTiles:['A1'] },
  hand:{ name:'Alex', portfolio:{Gobble:6}, cash:8600 },
  players,
  log:[], active:'', staging:'',
};

const steps = [
  { // step 0 — play: the winning tile is offered
    active: activeStep({
      label:'Place a tile',
      body:`<div class="option-row">`
        + tile('D5',{state:'hand', onclick:"switchPlacement('D5')"})
        + `</div>`
        + `<div class="hint">Gobble is at 40 tiles — placing D5 makes 41 and ends the game.</div>`,
    }),
    caption:'Gobble spans 40 tiles. One more ends the game.',
    hotspot:{ sel:'.board [title="D5"]', to:1 },
  },
  { // step 1 — game over: D5 placed, final standings
    board: board41,
    boardOpts:{ hand:[], placed:'D5', hqTiles:['A1'] },
    log:[{ phase:'Placed a tile', detail:'◻ D5 → Gobble reached 41 · game over' }],
    active:`<div class="active-step"><div class="stage-label">Gobble reached 41 — game over</div>${standings(players)}</div>`,
    caption:'Gobble hit 41 tiles. Final standings shown.',
  },
];

runScenario({ base, steps });
</script>
```

- [ ] **Step 2: Manual check**

With the server running, open `http://127.0.0.1:8777/scenario-win-41.html`. Verify:
- Console clean; counter `1 / 2`.
- Board: a 40-tile Gobble block (rows A–C full + D1–D4), `A1` shows the ticker, `D5` shows the hand highlight.
- Panel: "Place a tile" with `D5` highlighted and the 40→41 hint.
- Clicking `D5` on the board advances to `2 / 2` with the slide+fade; `D5` now reads as placed/part of the chain; the panel shows "Gobble reached 41 — game over" with final standings sorted by cash; the log gains the placement entry.
- `↺ Replay` returns to `1 / 2`.

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add prototype/scenario-win-41.html
git commit -m "feat(prototype): add win-at-41 scenario"
```

---

### Task 5: Wire navigation links

Add a "Scenarios" link to the shared nav of the three existing prototype pages so the scenarios are reachable.

**Files:**
- Modify: `prototype/index.html` (the `.proto-nav` block ~lines 9-13)
- Modify: `prototype/states.html` (the `.proto-nav` block ~lines 44-48)
- Modify: `prototype/motion.html` (its `.proto-nav` block)

**Interfaces:** none (static HTML links).

- [ ] **Step 1: Add the link in `index.html`**

In `prototype/index.html`, change the nav (currently `Prototype` / `States` / `Motion`) to include a Scenarios entry. Replace:

```html
  <nav class="proto-nav">
    <a href="index.html" aria-current="page">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html">Motion</a>
  </nav>
```

with:

```html
  <nav class="proto-nav">
    <a href="index.html" aria-current="page">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html">Motion</a>
    <a href="scenario-dead-tile.html">Scenarios</a>
  </nav>
```

- [ ] **Step 2: Add the link in `states.html`**

In `prototype/states.html`, replace:

```html
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html" aria-current="page">States</a>
    <a href="motion.html">Motion</a>
  </nav>
```

with:

```html
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html" aria-current="page">States</a>
    <a href="motion.html">Motion</a>
    <a href="scenario-dead-tile.html">Scenarios</a>
  </nav>
```

- [ ] **Step 3: Add the link in `motion.html`**

Find the nav in `prototype/motion.html`:

Run: `grep -n 'proto-nav' prototype/motion.html`

Add `<a href="scenario-dead-tile.html">Scenarios</a>` as the last link inside that `<nav class="proto-nav">…</nav>` block, matching the surrounding indentation and leaving the existing `aria-current="page"` link untouched.

- [ ] **Step 4: Manual check**

With the server running, open `http://127.0.0.1:8777/index.html`, `states.html`, and `motion.html`. Verify each shows a "Scenarios" nav link that opens `scenario-dead-tile.html`, and from there the "Dead tile" / "Win 41" sub-nav switches between the two scenarios and back to Prototype.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prototype/index.html prototype/states.html prototype/motion.html
git commit -m "feat(prototype): link Scenarios from the prototype nav"
```

---

## Self-review

**Spec coverage:**
- Two files (`scenario-dead-tile.html`, `scenario-win-41.html`) + shared `scenario.js` → Tasks 2–4. ✓
- Cumulative-patch step model (`resolveSteps`) → Task 2. ✓
- Panel-renderer hoist into `components.js` (`handZone`, `playersStrip`, `stepStack`, `panelHtml`) → Task 1. ✓
- Dead-tile board (Messla B1–B11, ZuckFace D1–D11, dead C6, replacement I12), 2 steps → Task 3. ✓
- Win board (Gobble 40 via helper, target adjacent tile, game-over standings), 2 steps → Task 4. ✓
- One hotspot per step; linear; reduced-motion respected; `.enter` reused → Task 2. ✓
- Nav "Scenarios" link on index/states/motion + scenario sub-nav → Tasks 3–5. ✓
- Non-goals honored: no bag/rules; index.html engine untouched (only presentational rewire + nav). ✓
- Verification (loads clean, one-step advance, replay, blocked-yet-clickable dead tile, 41-tile board + standings, regression on the app, no zone resize) → per-task manual checks. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step ships complete code. (Task 5 Step 3 uses a `grep` locate rather than a fixed line replace because `motion.html`'s exact nav markup wasn't read; the surrounding instruction is exact about what to add and what to preserve.)

**Type consistency:** `handZone({name,portfolio,cash})`, `playersStrip([{emoji,name,cash,active}])`, `stepStack(steps,renderEntry)`, `panelHtml({stepstack,active,staging,hand,players})` are defined in Task 1 and consumed with those exact shapes in Task 2 (`scenarioPanel`) and index.html. `runScenario({base,steps})` defined in Task 2, called with that shape in Tasks 3–4. Step fields (`board`, `boardOpts`, `log`, `active`, `staging`, `hand`, `players`, `caption`, `hotspot{sel,to}`) match between the driver and both scenario files. `boardHtml`'s `boardOpts` keys used (`hand`, `blocked`, `hqTiles`, `placed`) all exist in the current `boardHtml` signature.
