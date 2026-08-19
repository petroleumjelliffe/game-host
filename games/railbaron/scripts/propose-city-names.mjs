#!/usr/bin/env node
// Proposes a name and region for every city node in the traced graph.
//
// The city nodes are bare coordinates in scan pixel space; the 67 Rail Baron
// cities are known by latitude and longitude. Neither set is labelled, so this
// registers one onto the other: project the known cities through US Albers,
// fit an affine map onto the pixel cloud, and iterate nearest-neighbour
// assignment until it settles. Whatever name goes unclaimed is the city the
// scan is missing.
//
//   node scripts/propose-city-names.mjs [graph] [--write]
//
// Residuals are reported so doubtful matches surface themselves. Check the
// ones at the top of the list, and check the four clusters called out at the
// end regardless — neighbours that close can swap for almost no cost.

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--')) ?? 'data/rail-baron-graph.json';
const write = args.includes('--write');

const REGION = { NE: 'Northeast', SE: 'Southeast', NC: 'North Central',
                 SC: 'South Central', PL: 'Plains', NW: 'Northwest', SW: 'Southwest' };

// name, lat, lon, region
const CITIES = [
  ['Albany', 42.65, -73.75, 'NE'], ['Baltimore', 39.29, -76.61, 'NE'],
  ['Boston', 42.36, -71.06, 'NE'], ['Buffalo', 42.89, -78.88, 'NE'],
  ['New York', 40.71, -74.01, 'NE'], ['Philadelphia', 39.95, -75.17, 'NE'],
  ['Pittsburgh', 40.44, -79.99, 'NE'], ['Portland, ME', 43.66, -70.26, 'NE'],
  ['Washington DC', 38.90, -77.04, 'NE'],
  ['Atlanta', 33.75, -84.39, 'SE'], ['Charleston', 32.78, -79.93, 'SE'],
  ['Charlotte', 35.23, -80.84, 'SE'], ['Chattanooga', 35.05, -85.31, 'SE'],
  ['Jacksonville', 30.33, -81.66, 'SE'], ['Knoxville', 35.96, -83.92, 'SE'],
  ['Miami', 25.76, -80.19, 'SE'], ['Mobile', 30.69, -88.04, 'SE'],
  ['Norfolk', 36.85, -76.29, 'SE'], ['Richmond', 37.54, -77.44, 'SE'],
  ['Tampa', 27.95, -82.46, 'SE'],
  ['Chicago', 41.88, -87.63, 'NC'], ['Cincinnati', 39.10, -84.51, 'NC'],
  ['Cleveland', 41.50, -81.69, 'NC'], ['Columbus', 39.96, -83.00, 'NC'],
  ['Detroit', 42.33, -83.05, 'NC'], ['Indianapolis', 39.77, -86.16, 'NC'],
  ['Milwaukee', 43.04, -87.91, 'NC'], ['St. Louis', 38.63, -90.20, 'NC'],
  ['Birmingham', 33.52, -86.80, 'SC'], ['Dallas', 32.78, -96.80, 'SC'],
  ['Fort Worth', 32.76, -97.33, 'SC'], ['Houston', 29.76, -95.37, 'SC'],
  ['Little Rock', 34.75, -92.29, 'SC'], ['Louisville', 38.25, -85.76, 'SC'],
  ['Memphis', 35.15, -90.05, 'SC'], ['Nashville', 36.16, -86.78, 'SC'],
  ['New Orleans', 29.95, -90.07, 'SC'], ['San Antonio', 29.42, -98.49, 'SC'],
  ['Shreveport', 32.53, -93.75, 'SC'],
  ['Denver', 39.74, -104.99, 'PL'], ['Des Moines', 41.59, -93.62, 'PL'],
  ['Fargo', 46.88, -96.79, 'PL'], ['Kansas City', 39.10, -94.58, 'PL'],
  ['Minneapolis', 44.98, -93.27, 'PL'], ['Oklahoma City', 35.47, -97.52, 'PL'],
  ['Omaha', 41.26, -95.93, 'PL'], ['Pueblo', 38.25, -104.61, 'PL'],
  ['St. Paul', 44.95, -93.09, 'PL'],
  ['Billings', 45.78, -108.50, 'NW'], ['Butte', 46.00, -112.53, 'NW'],
  ['Casper', 42.85, -106.32, 'NW'], ['Pocatello', 42.87, -112.45, 'NW'],
  ['Portland, OR', 45.52, -122.68, 'NW'], ['Rapid City', 44.08, -103.23, 'NW'],
  ['Salt Lake City', 40.76, -111.89, 'NW'], ['Seattle', 47.61, -122.33, 'NW'],
  ['Spokane', 47.66, -117.43, 'NW'],
  ['El Paso', 31.76, -106.49, 'SW'], ['Las Vegas', 36.17, -115.14, 'SW'],
  ['Los Angeles', 34.05, -118.24, 'SW'], ['Oakland', 37.80, -122.27, 'SW'],
  ['Phoenix', 33.45, -112.07, 'SW'], ['Reno', 39.53, -119.81, 'SW'],
  ['Sacramento', 38.58, -121.49, 'SW'], ['San Diego', 32.72, -117.16, 'SW'],
  ['San Francisco', 37.77, -122.42, 'SW'], ['Tucumcari', 35.17, -103.72, 'SW']
];

/* ---- US Albers -------------------------------------------------------- */

const rad = d => (d * Math.PI) / 180;
const P1 = rad(29.5), P2 = rad(45.5), P0 = rad(37.5), L0 = rad(-96);
const nA = (Math.sin(P1) + Math.sin(P2)) / 2;
const C = Math.cos(P1) ** 2 + 2 * nA * Math.sin(P1);
const rho = phi => Math.sqrt(C - 2 * nA * Math.sin(phi)) / nA;
const RHO0 = rho(P0);

function albers(lat, lon) {
  const r = rho(rad(lat));
  const theta = nA * (rad(lon) - L0);
  // y negated so it grows downward, matching pixel space
  return { x: r * Math.sin(theta), y: -(RHO0 - r * Math.cos(theta)) };
}

/* ---- affine fit ------------------------------------------------------- */
// Least squares for [a b c; d e f] mapping source → target, via normal
// equations on the 3x3 Gram matrix. Six unknowns, solved as two 3-vectors.

function solve3(M, v) {
  const A = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 4; c++) A[r][c] -= f * A[col][c];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

function fitAffine(pairs) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vx = [0, 0, 0], vy = [0, 0, 0];
  for (const [s, t] of pairs) {
    const b = [s.x, s.y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += b[i] * b[j];
      vx[i] += b[i] * t.x;
      vy[i] += b[i] * t.y;
    }
  }
  const ax = solve3(M, vx), ay = solve3(M, vy);
  if (!ax || !ay) return null;
  return s => ({ x: ax[0] * s.x + ax[1] * s.y + ax[2],
                 y: ay[0] * s.x + ay[1] * s.y + ay[2] });
}

const stats = pts => {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sx = Math.sqrt(pts.reduce((a, p) => a + (p.x - mx) ** 2, 0) / n);
  const sy = Math.sqrt(pts.reduce((a, p) => a + (p.y - my) ** 2, 0) / n);
  return { mx, my, sx, sy };
};

/* ---- run -------------------------------------------------------------- */

const graph = JSON.parse(readFileSync(path, 'utf8'));
const targets = graph.nodes.filter(n => n.kind === 'city')
                           .map(n => ({ id: n.id, x: n.x, y: n.y }));
const sources = CITIES.map(([name, lat, lon, reg]) =>
  ({ name, region: REGION[reg], ...albers(lat, lon) }));

// Coarse start: match the two clouds by centre and spread.
const S = stats(sources), T = stats(targets);
let map = s => ({ x: (s.x - S.mx) / S.sx * T.sx + T.mx,
                  y: (s.y - S.my) / S.sy * T.sy + T.my });

for (let iter = 0; iter < 60; iter++) {
  const pairs = [];
  for (const s of sources) {
    const p = map(s);
    let best = null, bd = Infinity;
    for (const t of targets) {
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    pairs.push([s, best]);
  }
  const next = fitAffine(pairs);
  if (!next) break;
  map = next;
}

// One-to-one assignment: repeatedly take the globally closest remaining pair.
const placed = sources.map(s => ({ ...s, p: map(s) }));
const openS = new Set(placed.map(s => s.name));
const openT = new Set(targets.map(t => t.id));
const matched = [];

while (openS.size && openT.size) {
  let pick = null, bd = Infinity;
  for (const s of placed) {
    if (!openS.has(s.name)) continue;
    for (const t of targets) {
      if (!openT.has(t.id)) continue;
      const d = Math.hypot(t.x - s.p.x, t.y - s.p.y);
      if (d < bd) { bd = d; pick = [s, t]; }
    }
  }
  if (!pick) break;
  openS.delete(pick[0].name);
  openT.delete(pick[1].id);
  matched.push({ id: pick[1].id, name: pick[0].name, region: pick[0].region,
                 residual: bd, x: pick[1].x, y: pick[1].y });
}

matched.sort((a, b) => b.residual - a.residual);

const res = matched.map(m => m.residual).sort((a, b) => a - b);
const median = res[Math.floor(res.length / 2)];

console.log(`${matched.length} cities matched · median residual ${median.toFixed(1)}px · ` +
            `worst ${res[res.length - 1].toFixed(1)}px\n`);

console.log('Least certain first — check these:');
for (const m of matched.slice(0, 12)) {
  console.log(`  ${m.residual.toFixed(1).padStart(6)}px  ${m.id.padEnd(4)} ` +
              `(${m.x}, ${m.y})  ${m.name} — ${m.region}`);
}

if (openS.size) {
  console.log(`\nUNCLAIMED — the city missing from the scan:`);
  for (const name of openS) {
    const s = placed.find(x => x.name === name);
    console.log(`  ${name} (${s.region}) — expected near (${s.p.x.toFixed(0)}, ${s.p.y.toFixed(0)})`);
  }
}

const byRegion = {};
for (const m of matched) byRegion[m.region] = (byRegion[m.region] ?? 0) + 1;
const EXPECT = { Northeast: 9, Southeast: 11, 'North Central': 8, 'South Central': 11,
                 Plains: 9, Northwest: 9, Southwest: 10 };
console.log('\nPer region (found / expected):');
for (const [r, n] of Object.entries(EXPECT)) {
  const got = byRegion[r] ?? 0;
  console.log(`  ${r.padEnd(15)} ${String(got).padStart(2)} / ${n}${got === n ? '' : '   <-- short'}`);
}

console.log('\nCheck these clusters by eye regardless — a swap here costs almost no residual:');
for (const group of [['New York', 'Philadelphia', 'Baltimore', 'Washington DC'],
                     ['San Francisco', 'Oakland'], ['Dallas', 'Fort Worth'],
                     ['Minneapolis', 'St. Paul']]) {
  const line = group.map(n => {
    const m = matched.find(x => x.name === n);
    return m ? `${n}=${m.id}` : `${n}=?`;
  }).join('  ');
  console.log(`  ${line}`);
}

if (write) {
  const out = [...matched].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }));
  // Deliberately not data/city-names.json — that file is hand-verified and is
  // what the build consumes. This one is a diagnostic re-run: compare it
  // against the verified names, don't substitute it for them.
  const file = 'data/city-names-proposed.json';
  writeFileSync(file, JSON.stringify(
    { note: 'Proposed by scripts/propose-city-names.mjs. Diagnostic only — '
          + 'data/city-names.json holds the hand-verified names.',
      unclaimed: [...openS],
      cities: out.map(({ id, name, region, x, y, residual }) =>
        ({ id, name, region, x, y, residual: Number(residual.toFixed(2)) })) },
    null, 1) + '\n');
  console.log(`\nWrote ${file}`);
}
