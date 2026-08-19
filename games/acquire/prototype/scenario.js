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

/* ---- board builders (shared by scenario files; no engine) ---- */
function makeBoard(fill){
  const b = {}; ROWS.forEach(r=>COLS.forEach(c=> b[r+c] = {placed:false}));
  Object.entries(fill).forEach(([coord,id])=> b[coord] = {placed:true, startupId:id});
  return b;
}
function chain(row, from, to, id){
  const o = {}; for(let c=from;c<=to;c++) o[row+c] = id; return o;
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
