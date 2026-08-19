/* ============================================================
   components.js — shared presentational layer (config + atoms).
   Pure / props-in: safe to use without the live game engine.
   Used by index.html (the live app) AND states.html (the catalog).
   ============================================================ */

const ROWS = "ABCDEFGHI".split("");
const COLS = Array.from({length:12},(_,i)=>i+1);

const STARTUPS = {
  Gobble:{tier:2, ticker:"$G"}, Scrapple:{tier:2, ticker:"$S"}, PaperfulPost:{tier:0, ticker:"$PP"},
  CamCrooned:{tier:1, ticker:"$C"}, Messla:{tier:0, ticker:"$M"}, ZuckFace:{tier:1, ticker:"$Z"},
  WrecksonMobil:{tier:1, ticker:"$W"},
};

function ticker(id){ return id==='Cash' ? '$$' : (STARTUPS[id] && STARTUPS[id].ticker) || id; }

function cash(amount, opts={}){
  const abs = Math.abs(amount);
  let cls = 'cash', text;
  if(amount===0){ cls += ' zero'; text = '$0'; }
  else if(opts.sign==='delta'){ if(amount<0) cls += ' neg'; text = `${amount<0?'−':'+'}$${abs.toLocaleString()}`; }
  else { if(amount<0) cls += ' neg'; text = `$${abs.toLocaleString()}`; }
  return `<span class="${cls}">${text}</span>`;
}

function price(value, opts={}){
  if(opts.next!=null && opts.next!==value){
    const up = opts.next>value, dir = up ? 'up' : 'down';
    return `<span class="price">$${value.toLocaleString()}`
      + `<span class="price-arrow ${dir}">${up?'↑':'↓'}</span>`
      + `<span class="price-next ${dir}">$${opts.next.toLocaleString()}</span></span>`;
  }
  return `<span class="price">$${value.toLocaleString()}</span>`;
}

function brand(id, opts={}){
  const {mode='static', selected=false, disabled=false, size=null, onclick=null} = opts;
  const interactive = mode==='select';
  const tag = interactive ? 'button' : 'span';
  const cls = ['brand', `brand-${id}`];
  if(selected) cls.push('selected');
  if(disabled) cls.push('disabled');
  if(size) cls.push(size);
  const attrs = (interactive && onclick ? ` onclick="${onclick}"` : '') + (tag==='button' && disabled ? ' disabled' : '');
  return `<${tag} class="${cls.join(' ')}"${attrs}>${id}</${tag}>`;
}

function stockCard(id, opts={}){
  const {mode='static', selected=false, disabled=false, price:pr=null, size=null, depth=0, badge=null, onclick=null} = opts;
  const isCash = id==='Cash';   // money: a landscape "bill", $$ only — no per-share price
  const interactive = mode==='select' || mode==='add' || mode==='remove';
  const tag = interactive ? 'button' : 'span';
  const cls = ['stock', `brand-${id}`];
  if(isCash) cls.push('cash-card');
  if(selected) cls.push('selected');
  if(disabled) cls.push('disabled');
  if(size) cls.push(size);
  if(depth>0) cls.push(`depth-${Math.min(depth,2)}`);   // layered card edges behind, reinforcing a stack's count
  const attrs = (interactive && onclick ? ` onclick="${onclick}"` : '') + (tag==='button' && disabled ? ' disabled' : '');
  const value = pr!=null ? pr : (typeof game!=="undefined" && game.startups[id] && game.startups[id].price);   // a share card always shows a price
  return `<${tag} class="${cls.join(' ')}"${attrs} title="${id}">`
    + `<span class="stock-name">${ticker(id)}</span>`
    + (!isCash && value ? price(value) : '')
    + (mode==='remove' ? `<span class="x">×</span>` : '')
    + (badge ? `<span class="stock-badge">${badge}</span>` : '')
    + `</${tag}>`;
}

function stackDepth(count){ const n=Math.abs(count); if(n>=6) return 2; if(n>=2) return 1; return 0; }   // magnitude: leaving (−) stacks layer like their positive twin

function stockStack(id, count, opts={}){
  const {size=null, price:pr=null, onClick=null, onRemove=null, disabled=false, leaving=false} = opts;
  const cls = ['stock-stack']; if(size) cls.push(size); if(disabled) cls.push('disabled'); if(leaving) cls.push('leaving');
  const isCash = id==='Cash';
  const qcls = ['stack-qty']; if(count===0) qcls.push('zero'); if(isCash && count>0) qcls.push('cash-total');
  const depth = stackDepth(count);   // number of layers scales with size; the 3rd card is reserved for big stacks
  // cash is money: the label under the bills is the total dollars (bills × unit price), not ×N
  const qtyLabel = isCash ? `$${((pr||0)*count).toLocaleString()}` : `${leaving?'−':'×'}${count}`;
  const body = `${stockCard(id, {size, price:pr, depth})}<span class="${qcls.join(' ')}">${qtyLabel}</span>`;
  const bodyEl = (onClick && !disabled)
    ? `<button class="stock-stack-body" onclick="${onClick}">${body}</button>`
    : `<span class="stock-stack-body">${body}</span>`;
  const x = (onRemove && count>0 && !disabled)
    ? `<button class="stack-x" title="Remove one" onclick="${onRemove}">×</button>` : '';
  return `<span class="${cls.join(' ')}">${bodyEl}${x}</span>`;
}

function tile(coord, opts={}){
  const {state='empty', brand:brandId=null, onclick=null} = opts;
  const interactive = state==='hand' || !!onclick;
  const tag = interactive ? 'button' : 'span';
  const cls = ['tile', `t-${state}`];
  if((state==='chain' || state==='founded') && brandId) cls.push(`brand-${brandId}`);
  const attrs = interactive && onclick ? ` onclick="${onclick}"` : '';
  const label = (state==='founded' && brandId) ? ticker(brandId) : coord;
  return `<${tag} class="${cls.join(' ')}"${attrs} title="${coord}">${label}</${tag}>`;
}

function player(p, opts={}){
  const {active=false} = opts;
  return `<div class="player-row ${active?'active':''}">
    <span class="player-emoji">${p.emoji || '•'}</span>
    <span class="nm">${p.name}</span>
    ${active?'<span class="turn-tag">turn</span>':''}
    <span class="csh">${cash(p.cash)}</span>
    ${active?`<span class="chips">${stacksFor(p.portfolio)}</span>`:''}
  </div>`;
}

function stacksFor(portfolio){
  const entries = Object.entries(portfolio).filter(([,n])=>n>0);
  if(!entries.length) return `<span class="no-shares">no shares</span>`;
  return entries.map(([id,n])=>stockStack(id, n, {size:'sm'})).join('');
}

function boughtStacks(bought){
  const counts = {};
  bought.forEach(b=> counts[b.id] = (counts[b.id]||0) + 1);
  return Object.entries(counts).map(([id,n])=>stockStack(id, n, {size:'sm'})).join(' ');
}

/* ============================================================
   Composite views — the step-level components (props-in).
   These are the units the React port maps to 1:1. The live app
   (index.html) and the catalog (states.html) both render from these.
   ============================================================ */

/* a completed step in the stack. `undo` is optional trailing HTML (the ↺ button). */
function stepEntry({phase, detail, undo=''}){
  return `<div class="step-block">
    <div class="stage-label">${phase}${undo}</div>
    <div class="step-done">${detail}</div>
  </div>`;
}

/* the active-step panel: a titled region with a body and optional primary button. */
function activeStep({label, body, button=''}){
  return `<div class="active-step">
    <div class="stage-label">${label}</div>
    ${body}
    ${button}
  </div>`;
}

/* merger payout lines. bonuses: [{player, emoji, qty, type:'majority'|'minority', amount}]
   qty = shares of the absorbed chain the player held (why they earned majority/minority). */
function payoutLines(bonuses){
  return `<div class="payout-lines">
    ${bonuses.length ? bonuses.map(b=>
      `<div class="bonus-line" data-role="${b.type}"><span class="player-emoji">${b.emoji||''}</span><span class="pnm">${b.player}</span>${b.qty!=null?`<span class="pqty">×${b.qty}</span>`:''}<span class="role">· ${b.type==='majority'?'Majority':'Minority'}</span>${cash(b.amount,{sign:'delta'})}</div>`
    ).join('') : '<div class="bonus-line">No shareholders to pay.</div>'}
  </div>`;
}

/* the two liquidation exchange buttons: sell one → cash, trade 2 → 1 survivor. */
function liqActions({absorbedId, survivorId, unitPrice, canSell, canTrade, onSell='', onTrade=''}){
  return `<div class="liq-actions">
    <button class="liq-act" ${canSell?`onclick="${onSell}"`:'disabled'}>${stockCard(absorbedId,{size:'sm',price:unitPrice})}<span class="liq-arrow">→</span>${cash(unitPrice)}</button>
    <button class="liq-act" ${canTrade?`onclick="${onTrade}"`:'disabled'}>${stockStack(absorbedId,2,{size:'sm',price:unitPrice})}<span class="liq-arrow">→</span>${stockCard(survivorId,{size:'sm'})}</button>
  </div>`;
}

/* the staging zone: label + pile + always-present Net placeholder + optional action.
   sharesHtml is pre-rendered stacks; empty string → the "empty" placeholder. */
function stagingZone({label, sharesHtml='', cashDelta=0, action=''}){
  const sign = cashDelta>0?'+':cashDelta<0?'−':'';
  const net = `<div class="cart-total"><span class="ctl">Net</span><span class="ct ${cashDelta>0?'pos':cashDelta<0?'':'zero'}">${sign}$${Math.abs(cashDelta).toLocaleString()}</span></div>`;
  return `<div class="staging-zone">
    <div class="zone-label">${label}</div>
    <div class="staging-pile">${sharesHtml || '<span class="stage-empty">empty</span>'}</div>
    ${net}
    <div class="staging-action-slot">${action}</div>
  </div>`;   // slot always present → the zone is the same height with or without a button
}

/* the 9×12 board — pure over a board fixture (Record<coord,{placed,startupId}>).
   opts: hand[] (highlighted placeable), placed (the tile placed this turn),
   owners{coord:initial}, blocked[] (illegal-merge hand tiles), hqTiles[] (founding tiles). */
function boardHtml(board, opts={}){
  const {hand=[], placed=null, owners={}, blocked=[], hqTiles=[]} = opts;
  let html = `<div></div>` + COLS.map(c=>`<div class="colhead">${c}</div>`).join('');
  ROWS.forEach(r=>{
    html += `<div class="rowhead">${r}</div>`;
    COLS.forEach(c=>{
      const id = r+c, cell = board[id] || {placed:false};
      const founded = !!cell.startupId, isHQ = founded && hqTiles.includes(id);
      const inHand = hand.includes(id) && !cell.placed;
      const blockd = inHand && blocked.includes(id);
      const selected = placed === id;
      const classes = ["cell"];
      if(founded) classes.push(`brand-${cell.startupId}`, isHQ ? "hq" : "chain");
      else if(cell.placed) classes.push("placed");
      if(inHand) classes.push("hand");
      if(blockd) classes.push("blocked");
      if(selected) classes.push("selected");
      const clickable = (inHand && !blockd) || selected;
      const label = isHQ ? ticker(cell.startupId) : id;
      html += `<button class="${classes.join(' ')}" ${clickable ? `onclick="onBoardCellClick('${id}')"` : 'tabindex="-1"'} title="${id}">`
        + `<span class="coord">${label}</span>`
        + (owners[id] ? `<span class="tile-owner">${owners[id]}</span>` : '')
        + `</button>`;
    });
  });
  return html;
}

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
