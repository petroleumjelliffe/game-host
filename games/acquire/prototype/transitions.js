/* ============================================================
   transitions.js — shared motion layer (live app + motion lab).
   Pure DOM animation over the presentational atoms; no game engine.
   Tune MOTION in motion.html, then commit the settled values here.
   Loaded after components.js; all exports are globals.
   ============================================================ */

const MOTION = {
  t1:    { blink: 300, tuckScale: 0.9, stagger: 30, dur: 320, ease: 'cubic-bezier(.2,.7,.3,1)' },   // place: blink→converge
  found:  { blink: 360, stagger: 24, dur: 300, ease: 'cubic-bezier(.2,.7,.3,1)' },       // found: blink→gather→upper-left
  merger: { blink: 360, dur: 300, ease: 'cubic-bezier(.2,.7,.3,1)' },                    // merger: pulse→slide+absorbs
  payout: { loader: 620, dur: 300, gap: 140, ease: 'cubic-bezier(.2,.7,.3,1)' },         // payout: loader→majority→minority
  staging:{ rise: 90, grow: 2.4, dur: 420, ease: 'cubic-bezier(.2,.7,.3,1)' },           // staging receive: card materializes big → shrinks into cart slot
  t2:     { rise: 40, dur: 300, ease: 'cubic-bezier(.2,.7,.3,1)' },                      // push-up / reveal
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

/* click confirmation — a quick opacity pulse on the chosen element before it resolves. */
function pulse(el, ms){
  if(!el || reducedMotion()) return Promise.resolve();
  return runAnim(el, [
    { opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }, { opacity: 1 },
  ], { duration: (ms || 300) / MOTION.speed, easing: 'ease-in-out' });
}

/* Step advance (T2) — every step resolves IN PLACE, then this pushes it up: the
   outgoing (now-completed) step rises up and out of the active slot (on its way into
   the log) while the incoming step rises from below (behind staging) to fill the slot.
   The new step shoves the old one up. Either element may be null (first reveal has no
   outgoing). The caller reparents the outgoing node into the log once this resolves. */
function stepAdvance(outgoingEl, incomingEl){
  if(reducedMotion()) return Promise.resolve();
  const { rise, dur, ease } = MOTION.t2;
  const d = dur / MOTION.speed;
  const anims = [];
  if(outgoingEl){
    const h = outgoingEl.getBoundingClientRect().height;
    anims.push(runAnim(outgoingEl, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(' + (-h) + 'px)' },
    ], { duration: d, easing: ease, fill: 'forwards' }));   // stays visible — it becomes the log entry
  }
  if(incomingEl){
    anims.push(runAnim(incomingEl, [
      { transform: 'translateY(' + rise + 'px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: d, easing: ease }));
  }
  return Promise.all(anims);
}

/* first reveal (no outgoing step to push up) — the toaster rise on its own. */
function t2Toaster(activeStepEl){
  if(!activeStepEl) return Promise.resolve();
  return stepAdvance(null, activeStepEl);
}

/* Merger payout — the active step opens on a "calculating bonuses…" loader while the
   bonuses resolve; then the majority bonus line(s) fade up, then the minority line(s).
   linesEl is a .payout-lines already holding the settled .bonus-line[data-role] nodes
   plus a .payout-loader; we hide the lines, hold the loader, drop it, then reveal the
   majority group and the minority group in turn. The title never changes — this only
   fills the body. Resolves when the last line has faded in. */
async function payoutReveal(linesEl){
  if(reducedMotion()) return;
  const { loader, dur, gap, ease } = MOTION.payout;
  const d = dur / MOTION.speed;
  const loaderEl = linesEl.querySelector('.payout-loader');
  const lines = Array.prototype.slice.call(linesEl.querySelectorAll('.bonus-line'));
  lines.forEach(function(el){ el.style.opacity = '0'; });
  await new Promise(function(r){ setTimeout(r, loader / MOTION.speed); });   // "calculating…"
  if(loaderEl) loaderEl.remove();
  const groups = [
    lines.filter(function(el){ return el.getAttribute('data-role') === 'majority'; }),
    lines.filter(function(el){ return el.getAttribute('data-role') === 'minority'; }),
  ];
  for(let g = 0; g < groups.length; g++){
    if(!groups[g].length) continue;
    await Promise.all(groups[g].map(function(el){
      return runAnim(el, [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: d, easing: ease, fill: 'forwards' });
    }));
    if(g < groups.length - 1) await new Promise(function(r){ setTimeout(r, gap / MOTION.speed); });
  }
}

/* Staging receive — a bought/received share lands in the cart: a large card
   materializes centered above the staging pile, then shrinks and descends into its
   slot. targetStackEl is the .stock-stack in the pile that just incremented (it
   already holds the final count). We overlay a fixed-position ghost of its top card,
   pop the ghost in big + raised, then fly it down to scale 1 over the real card and
   remove it — the real stack shows through underneath, so the landing is seamless.
   Resolves once the card has landed. */
async function stagingReceive(targetStackEl){
  if(reducedMotion() || !targetStackEl) return;
  const { rise, grow, dur, ease } = MOTION.staging;
  const d = dur / MOTION.speed;
  const cardEl = targetStackEl.querySelector('.stock');   // the single face card = landing target
  if(!cardEl) return;
  const to = cardEl.getBoundingClientRect();
  const ghost = cardEl.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'fixed', left: to.left + 'px', top: to.top + 'px',
    width: to.width + 'px', height: to.height + 'px',
    margin: '0', transformOrigin: 'center', zIndex: '9999', pointerEvents: 'none',
  });
  document.body.appendChild(ghost);
  cardEl.style.visibility = 'hidden';   // hide the real face card until the ghost lands over it
  await runAnim(ghost, [
    { opacity: 0, transform: 'translateY(' + (-rise) + 'px) scale(' + grow + ')' },
    { opacity: 1, transform: 'translateY(' + (-rise) + 'px) scale(' + grow + ')', offset: 0.28 },  // popped in, large, raised
    { opacity: 1, transform: 'translateY(0) scale(1)' },   // shrunk down into the slot
  ], { duration: d, easing: ease });
  cardEl.style.visibility = '';
  ghost.remove();
}

/* T1 — the tile step resolves IN PLACE: the selected tile slides LEFT to the row's
   start and the unused tiles converge BEHIND it (descending z-index, scaled + faded).
   One step updating — no separate section. The push-up (stepAdvance) happens after. */
function t1TileConverge(rowEl, selectedEl){
  if(reducedMotion()) return Promise.resolve();
  const { tuckScale, stagger, dur, ease } = MOTION.t1;
  const d = dur / MOTION.speed;
  const rowRect = rowEl.getBoundingClientRect();
  const selRect = selectedEl.getBoundingClientRect();
  const others = Array.prototype.slice.call(rowEl.children).filter(function(el){ return el !== selectedEl; });
  selectedEl.style.position = 'relative';
  selectedEl.style.zIndex = String(others.length + 1);   // selected on top
  const sel = runAnim(selectedEl, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(' + (rowRect.left - selRect.left) + 'px)' },
  ], { duration: d, easing: ease, fill: 'forwards' });
  const tucks = others.map(function(el, i){
    const r = el.getBoundingClientRect();
    el.style.position = 'relative';
    el.style.zIndex = String(others.length - i);   // behind the selected, descending
    return runAnim(el, [
      { transform: 'translateX(0) scale(1)', opacity: 1 },
      { transform: 'translateX(' + (rowRect.left - r.left) + 'px) scale(' + tuckScale + ')', opacity: 0 },
    ], { duration: d, easing: ease, delay: i * (stagger / MOTION.speed), fill: 'forwards' });   // slide behind + fade out
  });
  return Promise.all([sel].concat(tucks));
}
