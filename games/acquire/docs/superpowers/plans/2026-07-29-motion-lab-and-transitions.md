# Motion Lab & Step Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two panel transitions to the prototype (T1: tile resolves into the log; T2: next step toasts up from behind staging) plus a `motion.html` lab that tunes them in isolation using the real shared components and transition code.

**Architecture:** `render()` replaces `#panel.innerHTML` wholesale, so we animate *around* the swap — play the out-transition on the live DOM, commit state + render, then play the in-transition on the fresh DOM — using the Web Animations API with measured pixel deltas. All motion lives in a new shared `transitions.js` (imported by both the live app and the lab) driven by a tunable `MOTION` token object. The T1 "rise into the log" beat FLIPs a freshly-built tile clone (which survives the innerHTML swap) from the pre-render position to the post-render log row.

**Tech Stack:** Vanilla ES (plain `<script>` globals, no bundler/modules), Web Animations API, CSS custom properties. Served locally with `python3 -m http.server`; verified with headless Chrome screenshots.

## Global Constraints

- **No build step / no modules.** Plain `<script src>` globals, loaded in order: `components.js` → `transitions.js` → page inline script. No `import`/`export`.
- **No test framework.** Verification is `node --check <file>` for JS syntax + headless-Chrome screenshots. Do NOT add jest/vitest/jsdom.
- **No component fork.** The lab links the same `components.css` + `components.js` as the app; motion lives only in `transitions.js`, shared by app + lab.
- **Respect reduced motion.** Every transition function returns immediately (resolved Promise, no animation) when `prefers-reduced-motion: reduce`.
- **`MOTION` default tokens (verbatim starting values):**
  `t1: { slide: 140, tuckScale: 0.9, stagger: 30, dur: 320, ease: 'cubic-bezier(.2,.7,.3,1)' }`
  `t2: { rise: 40, dur: 280, ease: 'cubic-bezier(.2,.7,.3,1)' }`
  `speed: 1` (lab-only slow-mo multiplier).
- **Serve/screenshot recipe** (used in verification steps), run from repo root:
  ```bash
  (cd prototype && python3 -m http.server 8177 >/tmp/srv.log 2>&1 &) ; sleep 1
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ("$CHROME" --headless=new --hide-scrollbars --disable-gpu --no-sandbox \
    --virtual-time-budget=4000 --user-data-dir=/tmp/mc --window-size=1280,900 \
    --screenshot=/tmp/shot.png "http://localhost:8177/<PAGE>" >/tmp/c.log 2>&1 &) ; sleep 7
  pkill -f /tmp/mc ; pkill -f "http.server 8177"
  ```

---

### Task 1: `transitions.js` — shared motion module

**Files:**
- Create: `prototype/transitions.js`

**Interfaces:**
- Consumes: `tile(coord, opts)` from `components.js` (used by `flyTileToLog` to build the flying clone).
- Produces (all become globals):
  - `MOTION` — token object (see Global Constraints).
  - `reducedMotion()` → `boolean`.
  - `applyMotionVars(root?)` → void — mirror scalar tokens onto CSS vars `--t1-dur/--t1-ease/--t2-dur/--t2-ease` on `root` (default `document.documentElement`).
  - `runAnim(el, keyframes, opts)` → `Promise` — WAAPI wrapper; resolves on finish, immediately if reduced.
  - `t2Toaster(activeStepEl)` → `Promise` — translateY(`MOTION.t2.rise`→0) + fade.
  - `t1TileTuck(rowEl, selectedEl)` → `Promise<DOMRect>` — tucks unused siblings behind the selected, slides selected right; resolves with the selected's final on-screen rect.
  - `flyTileToLog(fromRect, toRect, coord)` → `Promise` — FLIP a freshly-built filled tile from `fromRect` to `toRect`.

- [ ] **Step 1: Write the module**

Create `prototype/transitions.js`:

```js
/* ============================================================
   transitions.js — shared motion layer (live app + motion lab).
   Pure DOM animation over the presentational atoms; no game engine.
   Tune MOTION in motion.html, then commit the settled values here.
   Loaded after components.js; all exports are globals.
   ============================================================ */

const MOTION = {
  t1: { slide: 140, tuckScale: 0.9, stagger: 30, dur: 320, ease: 'cubic-bezier(.2,.7,.3,1)' },
  t2: { rise: 40, dur: 280, ease: 'cubic-bezier(.2,.7,.3,1)' },
  speed: 1,   // lab-only slow-mo multiplier (1 / .5 / .25); the app leaves it at 1
};

function reducedMotion(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* mirror the scalar tokens onto CSS custom properties (so CSS-driven bits can read them) */
function applyMotionVars(root){
  const el = root || document.documentElement;
  el.style.setProperty('--t1-dur', (MOTION.t1.dur / MOTION.speed) + 'ms');
  el.style.setProperty('--t1-ease', MOTION.t1.ease);
  el.style.setProperty('--t2-dur', (MOTION.t2.dur / MOTION.speed) + 'ms');
  el.style.setProperty('--t2-ease', MOTION.t2.ease);
}

/* WAAPI wrapper: resolve when the animation finishes; no-op under reduced motion. */
function runAnim(el, keyframes, opts){
  if(reducedMotion()) return Promise.resolve();
  const anim = el.animate(keyframes, opts);
  return anim.finished.catch(()=>{});   // swallow cancellation
}

/* T2 — reveal. The active step toasts up from behind the staging band. */
function t2Toaster(activeStepEl){
  if(!activeStepEl || reducedMotion()) return Promise.resolve();
  const { rise, dur, ease } = MOTION.t2;
  return runAnim(activeStepEl, [
    { transform: 'translateY(' + rise + 'px)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: dur / MOTION.speed, easing: ease });
}

/* T1 (part 1) — the unused hand tiles slide toward the selected and tuck behind it
   (descending z-index, scale down, fade), staggered; the selected slides right.
   Resolves with the selected tile's final on-screen rect (for the FLIP-to-log). */
function t1TileTuck(rowEl, selectedEl){
  if(reducedMotion()) return Promise.resolve(selectedEl.getBoundingClientRect());
  const { slide, tuckScale, stagger, dur, ease } = MOTION.t1;
  const d = dur / MOTION.speed;
  const selRect = selectedEl.getBoundingClientRect();
  const others = Array.prototype.slice.call(rowEl.children).filter(function(el){ return el !== selectedEl; });
  const tucks = others.map(function(el, i){
    const r = el.getBoundingClientRect();
    el.style.zIndex = String(others.length - i);
    return runAnim(el, [
      { transform: 'translateX(0) scale(1)', opacity: 1 },
      { transform: 'translateX(' + (selRect.left - r.left) + 'px) scale(' + tuckScale + ')', opacity: 0.35 },
    ], { duration: d, easing: ease, delay: i * (stagger / MOTION.speed), fill: 'forwards' });
  });
  selectedEl.style.position = 'relative';
  selectedEl.style.zIndex = String(others.length + 1);
  const slid = runAnim(selectedEl, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(' + slide + 'px)' },
  ], { duration: d, easing: ease, fill: 'forwards' });
  return Promise.all(tucks.concat([slid])).then(function(){
    return selectedEl.getBoundingClientRect();
  });
}

/* T1 (part 2) — FLIP a freshly-built filled tile from fromRect up to the log row.
   Built from `coord` (not the live node) so it survives the innerHTML re-render. */
function flyTileToLog(fromRect, toRect, coord){
  if(reducedMotion() || !fromRect || !toRect) return Promise.resolve();
  const { dur, ease } = MOTION.t1;
  const holder = document.createElement('div');
  holder.innerHTML = tile(coord, { state: 'filled' });
  const clone = holder.firstElementChild;
  clone.style.cssText += 'position:fixed; margin:0; left:' + fromRect.left + 'px; top:' + fromRect.top +
    'px; width:' + fromRect.width + 'px; height:' + fromRect.height + 'px; z-index:9999; pointer-events:none;';
  document.body.appendChild(clone);
  const dx = toRect.left - fromRect.left, dy = toRect.top - fromRect.top;
  const sx = toRect.width / fromRect.width, sy = toRect.height / fromRect.height;
  return runAnim(clone, [
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')', opacity: 0.6 },
  ], { duration: dur / MOTION.speed, easing: ease }).then(function(){ clone.remove(); });
}
```

- [ ] **Step 2: Verify JS syntax**

Run: `node --check prototype/transitions.js`
Expected: exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add prototype/transitions.js
git commit -m "Add shared transitions.js (MOTION tokens, T1 tuck/flip, T2 toaster)"
```

---

### Task 2: `motion.html` — the tuning lab

**Files:**
- Create: `prototype/motion.html`
- Modify: `prototype/index.html` (add "Motion" nav link)
- Modify: `prototype/states.html` (add "Motion" nav link)

**Interfaces:**
- Consumes: `tile`, `activeStep`, `stepEntry`, `stagingZone` from `components.js`; `MOTION`, `applyMotionVars`, `t1TileTuck`, `flyTileToLog`, `t2Toaster` from `transitions.js`.
- Produces: none (leaf page).

- [ ] **Step 1: Add the "Motion" nav link to the other two pages**

In `prototype/index.html`, change the nav to include Motion:

```html
  <nav class="proto-nav">
    <a href="index.html" aria-current="page">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html">Motion</a>
  </nav>
```

In `prototype/states.html`, change the nav to include Motion:

```html
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html" aria-current="page">States</a>
    <a href="motion.html">Motion</a>
  </nav>
```

- [ ] **Step 2: Write the lab page**

Create `prototype/motion.html`:

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>Acquire — Motion Lab</title>
<link rel="stylesheet" href="components.css">
<style>
  html,body{height:auto;}
  body{margin:0; min-height:100%; overflow:visible; display:block;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:#111827; background:#eef0f3;}
  header.cat{position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid #e5e7eb; padding:12px 20px;}
  header.cat .proto-nav{position:absolute; top:12px; right:20px;}
  header.cat h1{font-size:15px; margin:0; font-weight:700;}
  header.cat p{margin:4px 0 0; font-size:12px; color:#6b7280;}
  .lab{padding:20px; display:flex; gap:24px; flex-wrap:wrap; align-items:flex-start;}
  .stage-frame{width:360px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; overflow:hidden;}
  .panel-mock{display:flex; flex-direction:column;}
  .panel-mock .stepstack{min-height:120px; display:flex; flex-direction:column; justify-content:flex-end; gap:12px; padding:14px 16px 8px;}
  .controls{width:320px; display:flex; flex-direction:column; gap:12px; font-size:13px;
    background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:16px;}
  .controls h2{font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#374151; margin:0;}
  .controls .row{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
  .controls button{border:1px solid #d1d5db; background:#fff; border-radius:6px; padding:5px 12px; cursor:pointer; font:inherit;}
  .controls button.on{background:#2563eb; color:#fff; border-color:#2563eb;}
  .controls label{display:flex; align-items:center; gap:8px; color:#6b7280; justify-content:space-between;}
  .controls output, .controls select{font-variant-numeric:tabular-nums; color:#111827;}
  .controls textarea{width:100%; height:96px; font:11px ui-monospace,Menlo,monospace;}
</style>

<header class="cat">
  <nav class="proto-nav">
    <a href="index.html">Prototype</a>
    <a href="states.html">States</a>
    <a href="motion.html" aria-current="page">Motion</a>
  </nav>
  <h1>Motion lab</h1>
  <p>Tune the two transitions in isolation. Params live in <b>MOTION</b> (transitions.js) — copy the settled values back when done.</p>
</header>

<main class="lab">
  <div class="stage-frame"><div class="panel-mock" id="viewport"></div></div>
  <div class="controls" id="controls"></div>
</main>

<script src="components.js"></script>
<script src="transitions.js"></script>
<script>
function onBoardCellClick(){}   /* inert here */

const FIX_HAND = ["E6","E2","E10","G6","A12","I1"];
let current = "t1";   // "t1" | "t2"
let looping = false;

const vp = document.getElementById("viewport");

/* ---- fixtures: render the real atoms into a mock panel ---- */
function renderT1Fixture(){
  vp.innerHTML =
    `<div class="stepstack" id="logStack"></div>` +
    activeStep({ label:"Place a tile",
      body:`<div class="option-row" id="row">${FIX_HAND.map(c=>tile(c,{state:"hand"})).join("")}</div>
        <div class="hint">Tap a highlighted tile.</div>` }) +
    stagingZone({ label:"Staging — commits on end turn" });
}
function renderT2Fixture(){
  vp.innerHTML =
    `<div class="stepstack">${stepEntry({phase:"Place a tile", detail: tile("E6",{state:"filled"})})}</div>` +
    `<div id="stepSlot"></div>` +
    stagingZone({ label:"Staging — commits on end turn" });
  // the active step is injected fresh on each play (so it can toast in)
}

/* ---- play the selected transition ---- */
async function play(){
  applyMotionVars();
  if(current==="t1"){
    renderT1Fixture();
    const row = document.getElementById("row");
    const sel = [...row.children].find(el=> el.getAttribute("title")==="E6") || row.children[0];
    const fromRect = await t1TileTuck(row, sel);
    // reveal the log entry, then FLIP the tile up into it
    const log = document.getElementById("logStack");
    log.innerHTML = stepEntry({phase:"Place a tile", detail: tile("E6",{state:"filled"})});
    const logTile = log.querySelector(".tile");
    await flyTileToLog(fromRect, logTile.getBoundingClientRect(), "E6");
  } else {
    renderT2Fixture();
    const slot = document.getElementById("stepSlot");
    slot.innerHTML = activeStep({ label:"Buy shares (0/3)",
      body:`<div class="buy-grid">${["PaperfulPost","Messla","ZuckFace"].map(id=>stockCard(id,{mode:"select",price:300})).join("")}</div>` });
    await t2Toaster(slot.querySelector(".active-step"));
  }
  if(looping){ setTimeout(play, 500); }
}

/* ---- scrub: start paused, drive currentTime across all animations in the viewport ---- */
let scrubAnims = [];
function startScrub(){
  applyMotionVars();
  if(current==="t1"){ renderT1Fixture(); const row=document.getElementById("row");
    const sel=[...row.children].find(el=>el.getAttribute("title")==="E6")||row.children[0]; t1TileTuck(row, sel); }
  else { renderT2Fixture(); const slot=document.getElementById("stepSlot");
    slot.innerHTML = activeStep({label:"Buy shares (0/3)", body:`<div class="buy-grid">${stockCard("Messla",{mode:"select",price:300})}</div>`});
    t2Toaster(slot.querySelector(".active-step")); }
  scrubAnims = vp.getAnimations ? vp.getAnimations({subtree:true}) : [];
  scrubAnims.forEach(a=> a.pause());
}
function scrubTo(frac){
  const maxEnd = Math.max(1, ...scrubAnims.map(a=>{
    const t=a.effect.getTiming(); return (t.delay||0)+(t.duration||0);
  }));
  scrubAnims.forEach(a=>{ a.currentTime = frac * maxEnd; });
}

/* ---- controls ---- */
function renderControls(){
  const c = document.getElementById("controls");
  const t1 = MOTION.t1, t2 = MOTION.t2;
  c.innerHTML = `
    <h2>Transition</h2>
    <div class="row" id="pick">
      <button data-t="t1" class="${current==="t1"?"on":""}">T1 · tile → log</button>
      <button data-t="t2" class="${current==="t2"?"on":""}">T2 · toaster</button>
    </div>
    <div class="row">
      <button id="playBtn">▶ Replay</button>
      <button id="loopBtn" class="${looping?"on":""}">Loop</button>
    </div>
    <label>Speed <select id="speed">
      <option value="1"${MOTION.speed===1?" selected":""}>1×</option>
      <option value="0.5"${MOTION.speed===0.5?" selected":""}>0.5×</option>
      <option value="0.25"${MOTION.speed===0.25?" selected":""}>0.25×</option>
    </select></label>
    <h2>${current==="t1"?"T1 params":"T2 params"}</h2>
    ${current==="t1" ? `
      <label>Duration <input type="range" id="t1dur" min="0" max="800" step="20" value="${t1.dur}"><output>${t1.dur}ms</output></label>
      <label>Slide px <input type="range" id="t1slide" min="0" max="300" step="10" value="${t1.slide}"><output>${t1.slide}</output></label>
      <label>Tuck scale <input type="range" id="t1tuck" min="0.5" max="1" step="0.05" value="${t1.tuckScale}"><output>${t1.tuckScale}</output></label>
      <label>Stagger ms <input type="range" id="t1stag" min="0" max="120" step="5" value="${t1.stagger}"><output>${t1.stagger}</output></label>
    ` : `
      <label>Duration <input type="range" id="t2dur" min="0" max="800" step="20" value="${t2.dur}"><output>${t2.dur}ms</output></label>
      <label>Rise px <input type="range" id="t2rise" min="0" max="120" step="4" value="${t2.rise}"><output>${t2.rise}</output></label>
    `}
    <h2>Scrub</h2>
    <div class="row"><button id="scrubStart">Load frame</button></div>
    <label>t <input type="range" id="scrub" min="0" max="1" step="0.02" value="0" style="flex:1"></label>
    <h2>Tokens</h2>
    <textarea id="tokens" readonly></textarea>
    <button id="copyBtn">Copy MOTION</button>
  `;
  // wire
  c.querySelectorAll("#pick button").forEach(b=> b.onclick=()=>{ current=b.dataset.t; renderControls(); play(); });
  c.querySelector("#playBtn").onclick = play;
  c.querySelector("#loopBtn").onclick = ()=>{ looping=!looping; renderControls(); if(looping) play(); };
  c.querySelector("#speed").onchange = e=>{ MOTION.speed=parseFloat(e.target.value); refreshTokens(); };
  const bind = (id, apply)=>{ const el=c.querySelector("#"+id); if(!el) return;
    el.oninput=()=>{ apply(parseFloat(el.value)); el.nextElementSibling.textContent = el.value + (id.endsWith("dur")?"ms":""); refreshTokens(); }; };
  bind("t1dur", v=>MOTION.t1.dur=v); bind("t1slide", v=>MOTION.t1.slide=v);
  bind("t1tuck", v=>MOTION.t1.tuckScale=v); bind("t1stag", v=>MOTION.t1.stagger=v);
  bind("t2dur", v=>MOTION.t2.dur=v); bind("t2rise", v=>MOTION.t2.rise=v);
  c.querySelector("#scrubStart").onclick = ()=>{ startScrub(); c.querySelector("#scrub").value=0; };
  c.querySelector("#scrub").oninput = e=> scrubTo(parseFloat(e.target.value));
  c.querySelector("#copyBtn").onclick = ()=> navigator.clipboard && navigator.clipboard.writeText(c.querySelector("#tokens").value);
  refreshTokens();
}
function refreshTokens(){
  const t = document.querySelector("#tokens"); if(!t) return;
  t.value = "t1: " + JSON.stringify(MOTION.t1) + ",\nt2: " + JSON.stringify(MOTION.t2) + ",";
}

renderControls();
play();
</script>
```

- [ ] **Step 3: Verify the lab renders and the transition runs**

Serve and screenshot `motion.html` (use the recipe with `<PAGE>` = `motion.html`).
Run the recipe, then: `# open /tmp/shot.png`
Expected: the lab shows a mock panel (step-stack + active step + staging) on the left and the controls (Transition T1/T2, Replay/Loop, Speed, params, Scrub, Tokens) on the right. The Tokens textarea shows the MOTION values.

- [ ] **Step 4: Verify a mid-transition frame via scrub**

Re-run the recipe but append an init script that loads a frame at t=0.5. Replace the screenshot line's URL with:
`"http://localhost:8177/motion.html"` and add flag `--virtual-time-budget=1000`, then after load the page auto-plays; to freeze a frame, capture is best-effort. Simplest check: confirm no console errors in `/tmp/c.log` (`grep -i error /tmp/c.log` → no WAAPI/JS errors).
Expected: `/tmp/c.log` has no JS errors; screenshot shows the T1 fixture (six hand tiles or their tucked end-state).

- [ ] **Step 5: Commit**

```bash
git add prototype/motion.html prototype/index.html prototype/states.html
git commit -m "Add motion lab (motion.html) + Motion nav tab"
```

---

### Task 3: App `advance()` orchestrator + T2 on every stage reveal + staging mask

**Files:**
- Modify: `prototype/index.html` (add `transitions.js` script tag; add `advance()`; route stage-advancing handlers through it; `applyMotionVars()` on init)
- Modify: `prototype/components.css` (z-index mask so T2 emerges from behind staging)

**Interfaces:**
- Consumes: `t2Toaster`, `applyMotionVars`, `reducedMotion` from `transitions.js`.
- Produces: `advance(mutator)` → `Promise` — runs `mutator()`, `render()`, and (only if `game.stage` changed) `t2Toaster` on the new active step; guarded by `ui.animating`.

- [ ] **Step 1: Load `transitions.js` in the app**

In `prototype/index.html`, immediately after the `components.js` script tag, add:

```html
<script src="components.js"></script>
<script src="transitions.js"></script>
```

- [ ] **Step 2: Add the z-index mask for T2**

In `prototype/components.css`, replace the `.staging-zone` rule (currently
`.staging-zone{flex:none; padding:12px 16px; border-top:1px dashed #e7dfbf; background:#fffdf5;}`)
and the `.active-step` rule to layer staging above the active step:

```css
  .staging-zone{flex:none; padding:12px 16px; border-top:1px dashed #e7dfbf; background:#fffdf5;
    position:relative; z-index:2;}   /* opaque + above → masks the T2 toaster emerging from behind it */
```

And add `position:relative; z-index:1;` to the existing `.active-step` rule (find
`.active-step{flex:none; display:flex; flex-direction:column; gap:12px; font-size:14px; padding:12px 16px; border-top:1px solid #eef0f2; background:#f8fafc;}`
and append the two properties inside the braces):

```css
  .active-step{flex:none; display:flex; flex-direction:column; gap:12px; font-size:14px; padding:12px 16px; border-top:1px solid #eef0f2; background:#f8fafc; position:relative; z-index:1;}
```

- [ ] **Step 3: Add the `advance()` orchestrator**

In `prototype/index.html`, add near the other lifecycle functions (e.g. just above `renderPanel`):

```js
/* orchestrate a stage-advancing action: commit, render, then toast the new step in.
   T2 fires only when the stage actually changes (so intra-step updates don't toast). */
async function advance(mutator){
  if(ui.animating) return;
  ui.animating = true;
  const before = game.stage;
  mutator();
  const changed = game.stage !== before;
  render();
  if(changed) await t2Toaster(document.querySelector('#panel .active-step'));
  ui.animating = false;
}
```

- [ ] **Step 4: Add `ui.animating` to the ui object**

In `prototype/index.html` `initGame()`, add `animating:false,` to the `ui = { ... }` initializer (so a reset clears it):

```js
  ui = {
    layout: (ui && ui.layout) || "side",
    passPlay: (ui && ui.passPlay) || false,
    revealed: !((ui && ui.passPlay)),
    selectedTile: null,
    animating: false,
    liqSell:0, liqTrade:0,
    survivorChoice:null, foundChoice:null,
    gallery: (ui && ui.gallery) || false,
  };
```

- [ ] **Step 5: Route the stage-advancing handlers through `advance()`**

Replace the inline `...; render();` handler strings for the stage-advancing actions. Make these exact edits in `prototype/index.html`:

- Found brand button `onclick` (in the `foundStartup` branch of `activeStepHtml`):
  from `onclick="beginAction(); chooseFoundBrand('${id}'); render();"`
  to `onclick="advance(()=>{ beginAction(); chooseFoundBrand('${id}'); })"`
- Merger tie pick (in the `merger` no-survivor branch):
  from `onClick:`beginAction(); finalizeSurvivor('${id}'); render();``
  to `onClick:`advance(()=>{ beginAction(); finalizeSurvivor('${id}'); })``
- Merger payout Continue button:
  from `onclick="beginAction(); finalizePayout(); render();"`
  to `onclick="advance(()=>{ beginAction(); finalizePayout(); })"`
- Liquidation confirm/next (in `stagingActionHtml`, the `mergerLiquidation` branch):
  from `onclick="confirmLiquidation(); render();"`
  to `onclick="advance(()=>{ confirmLiquidation(); })"`
- Buy / end turn (in `stagingActionHtml`, the `buy` branch):
  from `onclick="beginAction(); endTurn(); render();"`
  to `onclick="advance(()=>{ beginAction(); endTurn(); })"`
- Start new turn (in the `turnComplete` branch):
  from `onclick="startTurn()"`
  to `onclick="advance(()=>{ startTurn(); })"` — **and** change `startTurn()` so it does NOT call `render()` itself (advance renders). In `startTurn`, remove the trailing `render();`:
  ```js
  function startTurn(){
    history = []; curHist = -1;
    initGame();               // fresh identical turn (Alex) for repeatable demo
  }
  ```
  (The reset button still needs a render — see Step 6.)

- [ ] **Step 6: Keep the Reset button working after startTurn lost its render**

In `prototype/index.html`, the reset button calls `startTurn()`. Update its listener to render explicitly:

```js
document.getElementById("resetBtn").addEventListener("click", ()=>{ startTurn(); render(); });
```

- [ ] **Step 7: Apply motion vars on init**

In `prototype/index.html`, at the bottom bootstrap (currently `initGame(); render();`), call `applyMotionVars()` once:

```js
applyMotionVars();
initGame();
render();
```

- [ ] **Step 8: Verify syntax + app still renders**

Run: `node --check` is not directly possible on inline HTML script; instead serve and screenshot `index.html` (recipe `<PAGE>`=`index.html`) and check `/tmp/c.log` for errors: `grep -iE "error|is not defined" /tmp/c.log` → empty.
Expected: the app renders the board + panel as before; no JS errors. (T2 fires on stage changes; a static screenshot of the initial play stage looks unchanged.)

- [ ] **Step 9: Commit**

```bash
git add prototype/index.html prototype/components.css
git commit -m "Route stage advances through advance() + T2 toaster; staging z-index mask"
```

---

### Task 4: App T1 — panel tile placement resolves into the log

**Files:**
- Modify: `prototype/index.html` (add `commitPlacement` + `advancePlaceTile`; point panel tiles and board cells at it)

**Interfaces:**
- Consumes: `t1TileTuck`, `flyTileToLog`, `t2Toaster`, `reducedMotion` from `transitions.js`.
- Produces: `advancePlaceTile(coord)` → `Promise` — the animated placement path (T1 tuck → commit+render → FLIP to log → T2). `commitPlacement(coord)` → void — the shared state mutation (revert prior placement, then place).

- [ ] **Step 1: Add `commitPlacement` and `advancePlaceTile`**

In `prototype/index.html`, replace the existing `switchPlacement` function with the shared `commitPlacement` plus the animated `advancePlaceTile`:

```js
/* commit a placement: if a tile was already placed this turn, revert it first (and
   everything after), then place `coord`. Pure state — no animation. */
function commitPlacement(coord){
  const placeStep = game.steps.find(s=>s.phase==="Place a tile");
  if(placeStep) undoTo(placeStep.histIdx);   // reverts the current placement (also renders)
  beginAction();
  placeTile(coord);
}

/* animated placement (T1): tuck the unused hand tiles behind the selected, commit +
   render, FLIP the placed tile up into its new log entry, then toast the next step (T2). */
async function advancePlaceTile(coord){
  if(ui.animating) return;
  if(game.stage==="turnComplete" || !game.turnHand || !game.turnHand.includes(coord)) return;
  ui.animating = true;
  const panel = document.getElementById('panel');
  const row = panel.querySelector('.active-step .option-row');   // present only in the play stage
  const selEl = row ? Array.prototype.slice.call(row.children).find(el=> el.getAttribute('title')===coord) : null;

  let fromRect = null;
  if(row && selEl && !reducedMotion()){
    fromRect = await t1TileTuck(row, selEl);
  }
  commitPlacement(coord);
  render();
  if(fromRect && !reducedMotion()){
    const logTile = panel.querySelector('.stepstack .step-block:last-child .tile');
    if(logTile) await flyTileToLog(fromRect, logTile.getBoundingClientRect(), coord);
  }
  await t2Toaster(panel.querySelector('.active-step'));
  ui.animating = false;
}
```

- [ ] **Step 2: Point the board cells at the animated path**

In `prototype/index.html`, update `onBoardCellClick` to use the animated path (it degrades gracefully — no `.option-row` on the board, so T1 is skipped but T2 still fires):

```js
function onBoardCellClick(coord){ advancePlaceTile(coord); }
```

- [ ] **Step 3: Point the panel place-tiles at the animated path**

In `prototype/index.html`, in the `play` branch of `activeStepHtml`, change the tile `onclick` from `switchPlacement` to `advancePlaceTile`:

```js
      return tile(coord, {state: blockd?'blocked':'hand', onclick: blockd?null:`advancePlaceTile('${coord}')`});
```

- [ ] **Step 4: Verify the placement flow end-to-end (no errors, log entry appears)**

Serve `index.html`. Drive a placement via an injected init script so the screenshot captures the *result* (post-T1). Run the recipe but add this flag before the URL:

```
--virtual-time-budget=6000
```

and replace the URL with a data-driven check: after load, the page is interactive; a static headless shot won't click. Instead verify programmatically — run:

```bash
(cd prototype && python3 -m http.server 8177 >/tmp/srv.log 2>&1 &) ; sleep 1
node -e '
  const {execSync}=require("child_process");
' 2>/dev/null
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --no-sandbox --dump-dom \
  --virtual-time-budget=3000 "http://localhost:8177/index.html" 2>/dev/null | grep -c "Place a tile" 
pkill -f "http.server 8177"
```

Expected: `--dump-dom` output contains the "Place a tile" active-step label (count ≥ 1), confirming the play stage renders with the new `advancePlaceTile` wiring and no fatal JS error (a JS error would blank the panel and drop the count to 0).

- [ ] **Step 5: Manual smoke (interactive) — note for the executor**

Open `http://localhost:8177/index.html`, tap a highlighted hand tile in the panel. Confirm: unused tiles tuck behind the selected, the placed tile flies up into a new log row, then the next step toasts up. Toggle OS "Reduce motion" and confirm placements commit instantly. (This step is human-verified; no automated assertion.)

- [ ] **Step 6: Commit**

```bash
git add prototype/index.html
git commit -m "Animate panel tile placement (T1 tuck + FLIP into log)"
```

---

### Task 5: Tune tokens in the lab, commit the settled defaults

**Files:**
- Modify: `prototype/transitions.js` (`MOTION` defaults)

**Interfaces:**
- Consumes: nothing new.
- Produces: updated `MOTION` constant values.

- [ ] **Step 1: Tune (human-driven)**

Open `http://localhost:8177/motion.html`. Use Replay/Loop/Speed/Scrub and the T1/T2 sliders to settle the feel. Click **Copy MOTION** to grab the tuned `t1`/`t2` token lines.

- [ ] **Step 2: Paste the settled values into `transitions.js`**

Replace the `MOTION.t1` and `MOTION.t2` literals with the copied values (keep `speed: 1`).

- [ ] **Step 3: Verify syntax**

Run: `node --check prototype/transitions.js`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add prototype/transitions.js
git commit -m "Tune MOTION tokens to settled values"
```

---

## Self-Review

**Spec coverage:**
- T1 tile resolve (slide/stash + rise into log) → Task 1 (`t1TileTuck`, `flyTileToLog`) + Task 4 (wiring). ✓
- T2 universal toaster + sequenced after T1 → Task 1 (`t2Toaster`) + Task 3 (all stages) + Task 4 (after FLIP). ✓
- Animate-around-innerHTML via WAAPI + clone FLIP → Task 1 + Task 4. ✓
- Shared `transitions.js` (app + lab) → Task 1, consumed by Task 2 + Tasks 3–4. ✓
- `MOTION` tokens + `applyMotionVars` → Task 1; applied in app Task 3 Step 7; tuned Task 5. ✓
- `motion.html` lab + Motion nav + scrub + copy-tokens → Task 2. ✓
- `advance()` orchestrator + `animating` guard → Task 3. ✓
- z-index staging mask → Task 3 Step 2. ✓
- reduced-motion → Task 1 (`reducedMotion` guards every fn); verified Task 4 Step 5. ✓
- Non-goals (bespoke out-transitions for found/merger/buy) correctly excluded — they flow through `advance` and get T2 only. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are concrete. The two human-verified steps (Task 4 Step 5, Task 5 Step 1) are explicitly labelled as manual because they judge *motion feel*, which no static assertion can capture — they still give exact click paths and expected outcomes.

**Type consistency:** Names match across tasks — `MOTION`, `reducedMotion`, `applyMotionVars`, `runAnim`, `t2Toaster`, `t1TileTuck` (returns `DOMRect`), `flyTileToLog(fromRect,toRect,coord)`, `advance(mutator)`, `commitPlacement(coord)`, `advancePlaceTile(coord)`, `ui.animating`. `t1TileTuck` returns a rect consumed by `flyTileToLog` in both the lab (Task 2) and the app (Task 4). `startTurn` loses its internal `render()` (Task 3 Step 5) and both callers (turnComplete button via `advance`, reset button Step 6) account for it.
