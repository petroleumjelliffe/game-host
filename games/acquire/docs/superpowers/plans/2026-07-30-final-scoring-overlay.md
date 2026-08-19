# Final-Scoring Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the game-over final-scoring overlay — a column-per-player table of stock value, shareholder bonus, cash and total — and catalogue it in `states.html`.

**Architecture:** One new pure renderer, `finalScoring(props)`, added to `prototype/components.js` alongside `payoutLines`/`stagingZone`, with its styles in `prototype/components.css`. `states.html` gains a full-width section that renders a real board + panel with the overlay scrim on top. Bonuses are authored fixture data; the renderer derives only stock values, column totals and sort order.

**Tech Stack:** Buildless HTML/CSS/JS. No framework, no bundler, no dev server — edit a file and refresh the browser. Node 26 is available for a throwaway verification harness only.

**Spec:** `docs/superpowers/specs/2026-07-30-final-scoring-overlay-design.md`

## Global Constraints

- **Prototype only.** Work happens in `prototype/`. Do not touch `src/` or `server/`.
- **`prototype/index.html` is not modified at all** by this plan.
- **No animations.** No enter transition on the overlay, card, or scrim.
- **No test framework may be added to the repo.** The prototype has no test suite; the Node harness in Task 1 lives in the scratchpad and is never committed.
- **`components.js` renderers are pure and props-in** — no reference to the live `game` global.
- **The overlay is terminal:** no dismiss control, no close button, no "New game" button. Emitting any `<button>` inside it is a defect.
- **Bonus marks are `M` (majority), `m` (minority), `Mm` (sole holder).** The words "majority" and "minority" appear only in `title` attributes, never as visible cell text.
- **Player column headers carry no rank medal or badge.**
- **Empty cells render an em-dash (`—`), never a blank.**
- Scratchpad directory for temporary files:
  `/private/tmp/claude-501/-Users-petroleumjelliffe-Developer-personal-acquire-startups-m1/1d37022f-ece0-49fe-ad9d-a224d38a72e9/scratchpad`

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `prototype/components.js` | Modify (append) | `scoreColumns()` rollup + `finalScoring()` markup + `bonusMark()` helper |
| `prototype/components.css` | Modify (append) | Scrim, card, banner, table, and `M`/`m` mark styles |
| `prototype/states.html` | Modify | Catalog stage CSS, fixture data, and the new full-width section |

Task order is renderer → catalog wiring → styles, so that every task ends in something a
reviewer can actually look at. (The spec lists CSS second; this ordering is a verifiability
choice only, not a design change.)

---

### Task 1: `finalScoring()` renderer

**Files:**
- Modify: `prototype/components.js` (append after `panelHtml`, currently ending at line 234)
- Test: `<scratchpad>/check-scoring.cjs` (throwaway, never committed)

**Interfaces:**
- Consumes: `ticker()`, `brand()`, `price()`, `cash()` — all already in `components.js`.
- Produces:
  - `scoreColumns({players, chains, holdings, bonuses})` → array of
    `{player, rows, stock, bonus, total}` sorted by `total` descending, where each `rows`
    entry is `{chainId, qty, stock, bonus}` in the order `chains` was given and `bonus` is
    either the matching bonus object or `null`.
  - `finalScoring({reason, players, chains, holdings, bonuses})` → HTML string.
  - `bonusMark(type)` → HTML string for one `M`/`m`/`Mm` mark.

Prop shapes:

```js
{
  reason,     // "Gobble reached 41 tiles" — subhead text
  players,    // [{ id, name, emoji, cash }] in seat order; the renderer sorts
  chains,     // [{ id, size, price }] — chains on the board at game end, in display order
  holdings,   // { [playerId]: { [chainId]: qty } }
  bonuses,    // [{ chainId, playerId, type: 'majority'|'minority'|'both', amount }]
}
```

- [ ] **Step 1: Write the failing check**

Create `<scratchpad>/check-scoring.cjs`. It must be `.cjs` — the repo's `package.json` sets
`"type": "module"`, so a `.js` file would be parsed as ESM and `require` would fail.
`components.js` is a bare script with no exports, so the harness appends an export line and
evaluates it with `new Function` (this keeps its top-level `const` bindings visible to the
appended line).

```js
const fs = require('fs');
const assert = require('assert');

const SRC = require('path').join(__dirname, '../../../prototype/components.js');
const src = fs.readFileSync(SRC, 'utf8') + '\n;module.exports = { finalScoring, scoreColumns };';
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const { finalScoring, scoreColumns } = mod.exports;

const FIX = {
  reason: 'Gobble reached 41 tiles',
  players: [
    { id:'p1', name:'Alex',   emoji:'🦊', cash:8600 },
    { id:'p2', name:'Sam',    emoji:'🐢', cash:12000 },
    { id:'p3', name:'Jordan', emoji:'🦁', cash:3100 },
  ],
  chains: [
    { id:'Gobble',   size:41, price:1000 },
    { id:'Messla',   size:8,  price:600 },
    { id:'ZuckFace', size:5,  price:400 },
  ],
  holdings: {
    p1: { Gobble:6, Messla:4 },
    p2: { Gobble:3, Messla:7 },
    p3: { Gobble:1, Messla:4, ZuckFace:3 },
  },
  bonuses: [
    { chainId:'Gobble',   playerId:'p1', type:'majority', amount:10000 },
    { chainId:'Gobble',   playerId:'p2', type:'minority', amount:5000  },
    { chainId:'Messla',   playerId:'p2', type:'majority', amount:6000  },
    { chainId:'Messla',   playerId:'p1', type:'minority', amount:1500  },
    { chainId:'Messla',   playerId:'p3', type:'minority', amount:1500  },
    { chainId:'ZuckFace', playerId:'p3', type:'both',     amount:6000  },
  ],
};

const cols = scoreColumns(FIX);

// sorted by final total, highest first — Sam outranks Alex on cash despite fewer bonuses
assert.deepStrictEqual(cols.map(c => c.player.name), ['Sam', 'Alex', 'Jordan']);
assert.deepStrictEqual(cols.map(c => c.total), [30200, 28500, 15200]);

// stock = qty × price summed over chains; bonus = authored amounts summed
assert.deepStrictEqual(cols.map(c => c.stock), [7200, 8400, 4600]);
assert.deepStrictEqual(cols.map(c => c.bonus), [11000, 11500, 7500]);

// one row per chain per column, in the order `chains` was given
const alex = cols[1];
assert.deepStrictEqual(alex.rows.map(r => r.chainId), ['Gobble', 'Messla', 'ZuckFace']);
assert.deepStrictEqual(alex.rows.map(r => r.qty), [6, 4, 0]);
assert.deepStrictEqual(alex.rows.map(r => r.stock), [6000, 2400, 0]);
assert.strictEqual(alex.rows[2].bonus, null);
assert.strictEqual(alex.rows[1].bonus.type, 'minority');

const html = finalScoring(FIX);
assert.ok(html.includes('Sam wins with'),                  'banner names the winner');
assert.ok(html.includes('>Mm<'),                           'sole holder renders Mm');
assert.ok(html.includes('>M<') && html.includes('>m<'),    'majority and minority marks render');
assert.ok(html.includes('fs-none'),                        'empty cells render an em-dash');
// strip attributes first — the words legitimately live in `title` and in class names
const visible = html.replace(/\s(?:title|class)="[^"]*"/g, '');
assert.ok(!/majority|minority/i.test(visible), 'the words are never visible cell text');
assert.ok(!/<button/i.test(html),                          'overlay is terminal — no buttons');

console.log('OK — final scoring: totals, sort, rows, marks');
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node "<scratchpad>/check-scoring.cjs"
```

Expected: `ReferenceError: finalScoring is not defined` — thrown by the appended export line,
because nothing defines it yet.

- [ ] **Step 3: Append the renderer to `prototype/components.js`**

Add at the end of the file, after `panelHtml`:

```js
/* ============================================================
   Final scoring — the game-over overlay.
   Bonuses arrive authored (majority/minority resolution is a rules
   concern); this derives only stock values, totals and the sort.
   ============================================================ */

const BONUS_MARK = {
  majority: {mark:'M',  title:'Majority shareholder'},
  minority: {mark:'m',  title:'Minority shareholder'},
  both:     {mark:'Mm', title:'Sole holder — majority and minority combined'},
};

/* M and m differ only in case, so the weight/size split in CSS carries the
   distinction; the title carries the word. */
function bonusMark(type){
  const b = BONUS_MARK[type];
  return `<abbr class="fs-mark fs-mark-${type}" title="${b.title}">${b.mark}</abbr>`;
}

/* one column per player: per-chain rows plus the three summed values.
   Sorted by total, highest first — the winner reads leftmost. */
function scoreColumns({players, chains, holdings, bonuses}){
  return players.map(p=>{
    const held = holdings[p.id] || {};
    const rows = chains.map(ch=>{
      const qty = held[ch.id] || 0;
      const bonus = bonuses.find(b=> b.chainId===ch.id && b.playerId===p.id) || null;
      return {chainId:ch.id, qty, stock:qty*ch.price, bonus};
    });
    const stock = rows.reduce((n,r)=> n + r.stock, 0);
    const bonus = rows.reduce((n,r)=> n + (r.bonus ? r.bonus.amount : 0), 0);
    return {player:p, rows, stock, bonus, total: stock + bonus + p.cash};
  }).sort((a,b)=> b.total - a.total);
}

/* the terminal game-over overlay: scrim + card. No dismiss — the game is over. */
function finalScoring({reason, players, chains, holdings, bonuses}){
  const cols = scoreColumns({players, chains, holdings, bonuses});
  const win  = cols[0];
  const dash = `<span class="fs-none">—</span>`;

  const head = `<tr><th class="fs-rowlabel"></th>${cols.map(c=>
    `<th class="fs-player"><span class="player-emoji">${c.player.emoji||'•'}</span><span class="pnm">${c.player.name}</span></th>`
  ).join('')}</tr>`;

  const chainRows = chains.map((ch,i)=>{
    const cells = cols.map(c=> c.rows[i]);
    return `<tr class="fs-chain-head"><th colspan="${cols.length+1}">`
        + `<span class="fs-ticker">${ticker(ch.id)}</span>${brand(ch.id)}`
        + `<span class="fs-chain-meta">${ch.size} tiles · ${price(ch.price)}</span></th></tr>`
      + `<tr class="fs-stock"><th class="fs-rowlabel">stock</th>${cells.map(r=>
          `<td>${r.qty ? `<span class="fs-qty">×${r.qty}</span>${cash(r.stock)}` : dash}</td>`
        ).join('')}</tr>`
      + `<tr class="fs-bonus"><th class="fs-rowlabel">bonus</th>${cells.map(r=>
          `<td>${r.bonus ? `${bonusMark(r.bonus.type)}${cash(r.bonus.amount,{sign:'delta'})}` : dash}</td>`
        ).join('')}</tr>`;
  }).join('');

  const cashRow  = `<tr class="fs-cash"><th class="fs-rowlabel">Cash</th>${
    cols.map(c=>`<td>${cash(c.player.cash)}</td>`).join('')}</tr>`;
  const totalRow = `<tr class="fs-total"><th class="fs-rowlabel">Total</th>${
    cols.map(c=>`<td>${cash(c.total)}</td>`).join('')}</tr>`;

  return `<div class="final-scoring-scrim">
    <div class="final-scoring">
      <div class="fs-banner">
        <div class="fs-winner"><span class="player-emoji">${win.player.emoji||'•'}</span>${win.player.name} wins with ${cash(win.total)}</div>
        <div class="fs-reason">${reason} — game over</div>
      </div>
      <table class="fs-table">${head}${chainRows}${cashRow}${totalRow}</table>
    </div>
  </div>`;
}
```

- [ ] **Step 4: Run the check to confirm it passes**

```bash
node "<scratchpad>/check-scoring.cjs"
```

Expected: `OK — final scoring: totals, sort, rows, marks`

- [ ] **Step 5: Commit**

```bash
git add prototype/components.js
git commit -m "feat(prototype): add finalScoring renderer"
```

---

### Task 2: Catalog section and fixture

**Files:**
- Modify: `prototype/states.html` (fixtures near line 80; `SECTIONS` render call at line 259)

**Interfaces:**
- Consumes: `finalScoring()`, `scoreColumns()` from Task 1; existing `boardHtml()`,
  `panelHtml()`, `stepStack()`, `handZone()`, `playersStrip()`, `tile()`.
- Produces: `FS_BOARD`, `FS_HQ`, `FS_SCORE`, `finalScoringSection()` — used by no later task,
  but Task 3 styles the classes this renders.

The section is deliberately outside the `figure.state` grid: those frames are 340px / 520px /
auto and none of them fit a full game view.

- [ ] **Step 1: Add the fixture data to `states.html`**

Insert after the `FIX_HQ` line (currently line 81), before the active-step fixtures:

```js
/* ---- final-scoring fixture: three chains, three players, game over at 41 ---- */
const FS_HQ = ["A1","F1","H1"];
const FS_BOARD = (()=>{
  const b = {}; ROWS.forEach(r=>COLS.forEach(c=> b[r+c] = {placed:false}));
  const fill = (id, row, from, to)=>{ for(let c=from;c<=to;c++) b[row+c] = {placed:true, startupId:id}; };
  ["A","B","C"].forEach(r=> fill("Gobble", r, 1, 12));   // 36
  fill("Gobble", "D", 1, 5);                             // +5 → 41
  fill("Messla", "F", 1, 8);                             // 8
  fill("ZuckFace", "H", 1, 5);                           // 5
  return b;
})();
const FS_PANEL = panelHtml({
  stepstack: stepStack([{phase:"Place a tile", detail:`${tile("D5",{state:"filled"})} → Gobble reached 41 · game over`}]),
  hand:      handZone({name:"Alex", portfolio:{Gobble:6, Messla:4}, cash:8600}),
  players:   playersStrip([
    {emoji:"🦊", name:"Alex",   cash:8600,  active:true},
    {emoji:"🐢", name:"Sam",    cash:12000},
    {emoji:"🦁", name:"Jordan", cash:3100},
  ]),
});
const FS_SCORE = {
  reason: "Gobble reached 41 tiles",
  players: [
    {id:"p1", name:"Alex",   emoji:"🦊", cash:8600},
    {id:"p2", name:"Sam",    emoji:"🐢", cash:12000},
    {id:"p3", name:"Jordan", emoji:"🦁", cash:3100},
  ],
  chains: [
    {id:"Gobble",   size:41, price:1000},
    {id:"Messla",   size:8,  price:600},
    {id:"ZuckFace", size:5,  price:400},
  ],
  holdings: {
    p1: {Gobble:6, Messla:4},
    p2: {Gobble:3, Messla:7},
    p3: {Gobble:1, Messla:4, ZuckFace:3},
  },
  bonuses: [
    {chainId:"Gobble",   playerId:"p1", type:"majority", amount:10000},
    {chainId:"Gobble",   playerId:"p2", type:"minority", amount:5000},
    {chainId:"Messla",   playerId:"p2", type:"majority", amount:6000},
    {chainId:"Messla",   playerId:"p1", type:"minority", amount:1500},   // tie: $3,000 split
    {chainId:"Messla",   playerId:"p3", type:"minority", amount:1500},
    {chainId:"ZuckFace", playerId:"p3", type:"both",     amount:6000},   // sole holder
  ],
};
```

- [ ] **Step 2: Add the section renderer**

Insert immediately before the `/* ---- render ---- */` comment (currently line 258):

```js
/* ---- final scoring: a full-width stage so the scrim covers a real board + panel ---- */
function finalScoringSection(){
  return `<section class="group">
    <h2><span class="seq">★</span>Final scoring</h2>
    <p class="intent">A chain reached 41 tiles. One column per player, sorted by final total; each chain contributes a stock row and a bonus row (M majority · m minority · Mm sole holder). Terminal — there is no way out of this overlay.</p>
    <div class="fs-stage">
      <div class="main side">
        <div class="board-wrap"><div class="board">${boardHtml(FS_BOARD, {hqTiles:FS_HQ})}</div></div>
        <div class="panel">${FS_PANEL}</div>
        ${finalScoring(FS_SCORE)}
      </div>
    </div>
  </section>`;
}
```

- [ ] **Step 3: Mount it**

Change the render call (currently line 259-260) from:

```js
document.getElementById("catalog").innerHTML =
  SECTIONS.map(sectionEl).join("") + transitionSection();
```

to:

```js
document.getElementById("catalog").innerHTML =
  SECTIONS.map(sectionEl).join("") + transitionSection() + finalScoringSection();
```

- [ ] **Step 4: Add the stage CSS to the catalog chrome**

The overlay scrim uses `position:absolute; inset:0`, and `.main` is already
`position:relative` (`components.css:40`), so the scrim will cover the stage. But `.main` gets
its height from the app's full-viewport body, which the catalog deliberately undoes — so the
stage must supply one. Add to the `<style>` block in `states.html`, after the `.tp-controls`
rules:

```css
  /* ---- final-scoring stage: a fixed-height game view for the overlay to cover ---- */
  .fs-stage{height:560px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; background:#fff;}
  .fs-stage .main{height:100%;}
```

- [ ] **Step 5: Verify in the browser**

```bash
open prototype/states.html
```

At this point the card is **unstyled** — Task 3 supplies its appearance. Confirm only the
content and the stage:

- The console is clean.
- A "Final scoring" section appears at the bottom of the page.
- The stage shows a board with a 41-tile Gobble chain (rows A–C full, plus D1–D5), an 8-tile
  Messla (F1–F8) and a 5-tile ZuckFace (H1–H5), with the panel beside it.
- The scoring table is present with columns in the order **Sam, Alex, Jordan**.
- Totals read `$30,200`, `$28,500`, `$15,200`.
- The banner reads "🐢 Sam wins with $30,200".
- Every other catalog section still renders, and the transition player still works.

- [ ] **Step 6: Commit**

```bash
git add prototype/states.html
git commit -m "feat(prototype): catalog the final-scoring overlay"
```

---

### Task 3: Overlay styles

**Files:**
- Modify: `prototype/components.css` (append after the `.reveal-overlay` block, currently ending at line 344)

**Interfaces:**
- Consumes: the class names emitted by `finalScoring()` in Task 1 — `.final-scoring-scrim`,
  `.final-scoring`, `.fs-banner`, `.fs-winner`, `.fs-reason`, `.fs-table`, `.fs-player`,
  `.fs-rowlabel`, `.fs-chain-head`, `.fs-ticker`, `.fs-chain-meta`, `.fs-stock`, `.fs-bonus`,
  `.fs-qty`, `.fs-none`, `.fs-mark`, `.fs-mark-majority`, `.fs-mark-minority`,
  `.fs-mark-both`, `.fs-cash`, `.fs-total`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Append the styles**

Note the indentation — `components.css` indents its rules by two spaces. Nothing here defines
a transition, animation, or `@keyframes`: the overlay does not animate.

```css
  /* ---------- Final scoring — the terminal game-over overlay ---------- */
  .final-scoring-scrim{
    position:absolute; inset:0; z-index:30; background:rgba(17,24,39,0.55);
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .final-scoring{
    background:#fff; border-radius:12px; box-shadow:0 20px 50px rgba(0,0,0,0.28);
    padding:20px 24px 22px; max-width:100%; max-height:100%; overflow:auto;
  }

  .fs-banner{margin-bottom:14px;}
  .fs-winner{display:flex; align-items:center; gap:8px; font-size:18px; font-weight:700; color:#1f2937;}
  .fs-reason{margin-top:3px; font-size:12px; color:#6b7280;}

  .fs-table{border-collapse:collapse; font-variant-numeric:tabular-nums; font-size:13px;}
  .fs-table th, .fs-table td{padding:5px 12px; text-align:right; white-space:nowrap;}
  .fs-player{font-weight:700; color:#374151; padding-bottom:8px;}
  .fs-player .pnm{margin-left:6px;}
  .fs-rowlabel{
    text-align:left; padding-left:16px; font-size:11px; font-weight:500;
    text-transform:uppercase; letter-spacing:.04em; color:#9ca3af;
  }

  .fs-chain-head > th{text-align:left; padding:14px 12px 4px; border-top:1px solid #e5e7eb;}
  .fs-ticker{font-weight:700; color:#6b7280; margin-right:6px;}
  .fs-chain-meta{margin-left:8px; font-size:11px; font-weight:500; color:#9ca3af;}

  .fs-qty{color:#9ca3af; margin-right:6px;}
  .fs-none{color:#d1d5db;}

  /* M vs m differ only in case — weight and size carry the distinction visually,
     the title carries the word. */
  .fs-mark{margin-right:6px; text-decoration:none; border:none; cursor:help; color:#6b7280;}
  .fs-mark-majority, .fs-mark-both{font-weight:800; color:#374151;}
  .fs-mark-minority{font-weight:500; font-size:12px;}

  .fs-cash > th, .fs-cash > td{border-top:1px solid #e5e7eb; padding-top:10px;}
  .fs-total > th, .fs-total > td{
    border-top:2px solid #111827; padding-top:10px; font-size:15px; font-weight:700;
  }
```

- [ ] **Step 2: Verify in the browser**

```bash
open prototype/states.html
```

Walk the spec's verification list against the "Final scoring" section:

- The scrim dims the board and panel behind it and covers them completely; nothing behind it
  is clickable.
- Columns are ordered Sam, Alex, Jordan; the banner names Sam with `$30,200`.
- Messla's bonus row shows `m +$1,500` in **two** cells (Alex and Jordan) — the tie, unlabelled.
- ZuckFace shows `Mm +$6,000` in Jordan's cell and em-dashes in Alex's and Sam's.
- Every zero cell is an em-dash, not blank.
- Each column's Total equals its stock + bonus + cash by hand:
  Sam `7,200 + 11,000 + 12,000 = 30,200`; Alex `8,400 + 11,500 + 8,600 = 28,500`;
  Jordan `4,600 + 7,500 + 3,100 = 15,200`.
- `M` and `m` are visually distinguishable at rendered size; hovering either shows its
  full-word tooltip.
- Player column headers carry no medal or rank badge.
- There is no button, close control, or other exit anywhere in the card.
- Nothing animates on load.

- [ ] **Step 3: Regression-check the rest of the lab**

`components.css` is shared, so confirm the new rules leaked nowhere. All `fs-`/`final-scoring`
selectors are new class names, so this should be clean:

```bash
open prototype/index.html
open prototype/scenario-win-41.html
```

- `index.html` plays a turn normally and its panel is visually unchanged.
- `scenario-win-41.html` still steps through both of its steps.
- Back in `states.html`, every pre-existing section and the transition player are unchanged.

- [ ] **Step 4: Commit**

```bash
git add prototype/components.css
git commit -m "feat(prototype): style the final-scoring overlay"
```

---

## Verification summary

The spec's full manual checklist is distributed across Task 2 Step 5 (content and stage),
Task 3 Step 2 (appearance and scoring rules) and Task 3 Step 3 (regression). Task 1's Node
harness covers the only computable surface — totals, sort order, per-chain rows, and the
mark/em-dash/no-button invariants in the emitted markup.

Delete the scratchpad harness when done; it is not part of the repo.
