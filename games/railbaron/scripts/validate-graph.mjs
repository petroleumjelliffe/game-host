#!/usr/bin/env node
// Structural checks on the hand-traced map graph.
//
// The graph is traced by eye against a scan, so it drifts as it is corrected.
// These checks are the ones a person cannot do by reading: every dead end,
// every orphan, every place a railroad is secretly in two pieces.
//
//   node scripts/validate-graph.mjs [path]
//
// Exits non-zero if anything fails, so it can gate a build.

import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'data/rail-baron-graph.json';
const graph = JSON.parse(readFileSync(path, 'utf8'));

const nodes = graph.nodes ?? [];
const edges = graph.edges ?? [];
const railroads = (graph.railroads ?? []).map(r => r.id);

const byId = new Map(nodes.map(n => [n.id, n]));
const kind = id => byId.get(id)?.kind;
const at = id => {
  const n = byId.get(id);
  return n ? `(${n.x}, ${n.y})` : '(missing)';
};

const problems = [];
const notes = [];
const fail = (label, items, render = String) => {
  if (!items.length) return;
  problems.push({ label, items: items.map(render) });
};

/* ---- referential integrity ------------------------------------------- */

const dangling = edges.filter(e => !byId.has(e.a) || !byId.has(e.b));
fail('Edges referencing a node that does not exist', dangling,
  e => `${e.a} → ${e.b}  [${e.railroads.join(', ')}]`);

const selfLoops = edges.filter(e => e.a === e.b);
fail('Self-loops', selfLoops, e => `${e.a} → itself`);

/* ---- duplicate edges -------------------------------------------------- */

const key = e => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
const seen = new Map();
const dupes = [];
for (const e of edges) {
  const k = key(e);
  if (seen.has(k)) dupes.push(e); else seen.set(k, e);
}
fail('Duplicate edges (same pair listed twice)', dupes,
  e => `${e.a} → ${e.b}  [${e.railroads.join(', ')}]`);

/* ---- degrees ---------------------------------------------------------- */

const adj = new Map(nodes.map(n => [n.id, []]));
for (const e of edges) {
  if (!byId.has(e.a) || !byId.has(e.b)) continue;
  adj.get(e.a).push({ to: e.b, rrs: e.railroads });
  adj.get(e.b).push({ to: e.a, rrs: e.railroads });
}
const degree = id => adj.get(id).length;

const unrouted = nodes.filter(n => degree(n.id) === 0);
fail('Nodes no route touches', unrouted, n => `${n.id} ${n.kind} ${at(n.id)}`);

// A dot with one edge is track that stops in open country — nearly always an
// untraced continuation. Cities legitimately terminate; junctions cannot.
const deadEnds = nodes.filter(n => n.kind === 'dot' && degree(n.id) === 1);
fail('Dead-end dots (one edge — track stopping mid-map)', deadEnds,
  n => `${n.id} ${at(n.id)} → ${adj.get(n.id)[0].to}  [${adj.get(n.id)[0].rrs.join(', ')}]`);

// A junction with one edge dangles, same defect as a dead-end dot.
const danglingJunctions = nodes.filter(n => n.kind === 'junction' && degree(n.id) === 1);
fail('Junctions with a single edge (dangling)', danglingJunctions,
  n => `${n.id} ${at(n.id)} → ${adj.get(n.id)[0].to}`);

// Two edges is a bend point — junctions shape the drawn route as well as
// carrying forks, and a coastal line needs them to follow the shore instead of
// cutting across water. Costs no move, so it is reported for information only.
const bendJunctions = nodes.filter(n => n.kind === 'junction' && degree(n.id) === 2);
if (bendJunctions.length) {
  notes.push({
    label: 'Bend junctions (two edges — shaping the route, not forking it)',
    items: bendJunctions.map(n =>
      `${n.id} ${at(n.id)} — ${adj.get(n.id).map(l => l.to).join(', ')}`)
  });
}

const lonelyCities = nodes.filter(n => n.kind === 'city' && degree(n.id) === 1);
if (lonelyCities.length) {
  notes.push({
    label: 'Cities with a single connection (fine for a terminus — worth an eye)',
    items: lonelyCities.map(n => `${n.id} ${at(n.id)} → ${adj.get(n.id)[0].to}`)
  });
}

/* ---- connectivity ----------------------------------------------------- */

function components(nodeIds, edgeFilter) {
  const pool = new Set(nodeIds);
  const out = [];
  while (pool.size) {
    const start = pool.values().next().value;
    const group = [];
    const stack = [start];
    pool.delete(start);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const link of adj.get(id) ?? []) {
        if (!pool.has(link.to)) continue;
        if (edgeFilter && !edgeFilter(link)) continue;
        pool.delete(link.to);
        stack.push(link.to);
      }
    }
    out.push(group);
  }
  return out;
}

const whole = components(nodes.filter(n => degree(n.id) > 0).map(n => n.id));
if (whole.length > 1) {
  const sorted = [...whole].sort((a, b) => b.length - a.length);
  problems.push({
    label: `Network is in ${whole.length} disconnected pieces`,
    items: sorted.slice(1).map(g =>
      `${g.length} node(s), e.g. ${g[0]} ${at(g[0])}`)
  });
}

// Each railroad should be one continuous system.
const splitRoads = [];
const missingRoads = [];
for (const rr of railroads) {
  const touched = new Set();
  for (const e of edges) {
    if (!e.railroads.includes(rr)) continue;
    if (!byId.has(e.a) || !byId.has(e.b)) continue;
    touched.add(e.a); touched.add(e.b);
  }
  if (!touched.size) { missingRoads.push(rr); continue; }
  const parts = components([...touched], link => link.rrs.includes(rr));
  if (parts.length > 1) {
    const sorted = [...parts].sort((a, b) => b.length - a.length);
    // The closest pair of nodes across two pieces is almost always where the
    // missing edge belongs, so say it rather than leaving it to be hunted.
    let gap = '';
    const [big, ...rest] = sorted;
    for (const other of rest) {
      let bestPair = null, bd = Infinity;
      for (const a of big) for (const b of other) {
        const d = Math.hypot(byId.get(a).x - byId.get(b).x,
                             byId.get(a).y - byId.get(b).y);
        if (d < bd) { bd = d; bestPair = [a, b]; }
      }
      gap += `\n        gap: ${bestPair[0]} ${at(bestPair[0])} ↔ ` +
             `${bestPair[1]} ${at(bestPair[1])}  (${bd.toFixed(0)}px apart)`;
    }
    splitRoads.push(`${rr}: ${parts.length} pieces — ` +
      sorted.map(g => `${g.length}@${g[0]}`).join(', ') + gap);
  }
}
fail('Railroads with no edges at all', missingRoads);
fail('Railroads traced in more than one piece', splitRoads);

/* ---- counts ----------------------------------------------------------- */

const counts = { city: 0, dot: 0, junction: 0 };
for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;

if (counts.city !== 67) {
  problems.push({
    label: `Expected 67 cities, found ${counts.city}`,
    items: [counts.city < 67
      ? `${67 - counts.city} missing`
      : `${counts.city - 67} too many`]
  });
}

/* ---- report ----------------------------------------------------------- */

const shared = edges.filter(e => e.railroads.length > 1).length;
console.log(`${path}`);
console.log(`  ${counts.dot} dots · ${counts.city} cities · ${counts.junction} junctions`);
console.log(`  ${edges.length} edges (${shared} shared by more than one railroad)`);
console.log(`  ${railroads.length} railroads\n`);

for (const { label, items } of notes) {
  console.log(`~ ${label} — ${items.length}`);
  for (const line of items) console.log(`    ${line}`);
  console.log();
}

if (!problems.length) {
  console.log('PASS — no structural problems.');
  process.exit(0);
}

for (const { label, items } of problems) {
  console.log(`FAIL  ${label} — ${items.length}`);
  for (const line of items.slice(0, 40)) console.log(`    ${line}`);
  if (items.length > 40) console.log(`    … and ${items.length - 40} more`);
  console.log();
}
console.log(`${problems.length} problem group(s).`);
process.exit(1);
