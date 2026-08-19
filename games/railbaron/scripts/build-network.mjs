#!/usr/bin/env node
// Turns the hand-traced graph into the map the app ships.
//
//   node scripts/build-network.mjs [--write]
//
// The graph is in scan pixel space: coordinates read off a photograph of the
// printed board. The app wants real geography, so this fits a warp from the
// scan to the map's projection using the 67 cities as control points — they
// are the only nodes whose true position is known — and pushes every dot and
// junction through it.
//
// The warp is a thin-plate spline, not the affine fit scripts/propose-city-
// names.mjs uses for registration. Affine is right there: it is rigid enough
// that one bad assignment cannot bend the fit to accommodate itself. It is
// wrong here, because it cannot absorb the printed map's local distortions,
// and a 50px residual around San Francisco Bay would put dots in the water. A
// TPS passes through every control point exactly and spreads the discrepancy
// between them.
//
// It fits scan → Albers rather than scan → lat/lon directly. The printed map
// is roughly conic, so in Albers the relationship is nearly affine and the
// spline is left correcting only the drawing's own distortions — a smaller,
// better-behaved job than also asking it to learn the projection. lat/lon
// comes back out by inverting Albers, and the round-trip is checked against
// all 67 known positions before anything is written.
//
// Fails loudly rather than emitting suspect data: a graph this size is
// hand-traced and will drift as it is corrected, and a build that refuses is
// what stops a mistake reaching the board.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const write = process.argv.includes('--write');
const GRAPH = 'data/rail-baron-graph.json';
const NAMES = 'data/city-names.json';
const ENGINE = 'engine/cities.ts';
const OUT = 'engine/network.json';
const DESIGN = 'data/design-network.json';

const problems = [];
const fail = msg => problems.push(msg);

/* ---- the 67 cities, by latitude and longitude -------------------------- */
// Same table as scripts/propose-city-names.mjs. Duplicated deliberately: that
// script proposes names and this one consumes confirmed ones, and a shared
// module between two one-shot scripts buys less than it costs. If one changes,
// change both — the cross-check against engine/cities.ts below catches a name
// drifting, and the round-trip check catches a coordinate drifting.
const LATLON = {
  'Albany': [42.65, -73.75], 'Baltimore': [39.29, -76.61],
  'Boston': [42.36, -71.06], 'Buffalo': [42.89, -78.88],
  'New York': [40.71, -74.01], 'Philadelphia': [39.95, -75.17],
  'Pittsburgh': [40.44, -79.99], 'Portland, ME': [43.66, -70.26],
  'Washington DC': [38.90, -77.04],
  'Atlanta': [33.75, -84.39], 'Charleston': [32.78, -79.93],
  'Charlotte': [35.23, -80.84], 'Chattanooga': [35.05, -85.31],
  'Jacksonville': [30.33, -81.66], 'Knoxville': [35.96, -83.92],
  'Miami': [25.76, -80.19], 'Mobile': [30.69, -88.04],
  'Norfolk': [36.85, -76.29], 'Richmond': [37.54, -77.44],
  'Tampa': [27.95, -82.46],
  'Chicago': [41.88, -87.63], 'Cincinnati': [39.10, -84.51],
  'Cleveland': [41.50, -81.69], 'Columbus': [39.96, -83.00],
  'Detroit': [42.33, -83.05], 'Indianapolis': [39.77, -86.16],
  'Milwaukee': [43.04, -87.91], 'St. Louis': [38.63, -90.20],
  'Birmingham': [33.52, -86.80], 'Dallas': [32.78, -96.80],
  'Fort Worth': [32.76, -97.33], 'Houston': [29.76, -95.37],
  'Little Rock': [34.75, -92.29], 'Louisville': [38.25, -85.76],
  'Memphis': [35.15, -90.05], 'Nashville': [36.16, -86.78],
  'New Orleans': [29.95, -90.07], 'San Antonio': [29.42, -98.49],
  'Shreveport': [32.53, -93.75],
  'Denver': [39.74, -104.99], 'Des Moines': [41.59, -93.62],
  'Fargo': [46.88, -96.79], 'Kansas City': [39.10, -94.58],
  'Minneapolis': [44.98, -93.27], 'Oklahoma City': [35.47, -97.52],
  'Omaha': [41.26, -95.93], 'Pueblo': [38.25, -104.61],
  'St. Paul': [44.95, -93.09],
  'Billings': [45.78, -108.50], 'Butte': [46.00, -112.53],
  'Casper': [42.85, -106.32], 'Pocatello': [42.87, -112.45],
  'Portland, OR': [45.52, -122.68], 'Rapid City': [44.08, -103.23],
  'Salt Lake City': [40.76, -111.89], 'Seattle': [47.61, -122.33],
  'Spokane': [47.66, -117.43],
  'El Paso': [31.76, -106.49], 'Las Vegas': [36.17, -115.14],
  'Los Angeles': [34.05, -118.24], 'Oakland': [37.80, -122.27],
  'Phoenix': [33.45, -112.07], 'Reno': [39.53, -119.81],
  'Sacramento': [38.58, -121.49], 'San Diego': [32.72, -117.16],
  'San Francisco': [37.77, -122.42], 'Tucumcari': [35.17, -103.72]
};

/* ---- US Albers, forward and inverse ------------------------------------ */

const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const P1 = rad(29.5), P2 = rad(45.5), P0 = rad(37.5), L0 = rad(-96);
const nA = (Math.sin(P1) + Math.sin(P2)) / 2;
const C = Math.cos(P1) ** 2 + 2 * nA * Math.sin(P1);
const rho = phi => Math.sqrt(C - 2 * nA * Math.sin(phi)) / nA;
const RHO0 = rho(P0);

// y grows downward, matching pixel space — same convention as the registration
// script, so the two agree about which way is north.
function albers(lat, lon) {
  const r = rho(rad(lat));
  const theta = nA * (rad(lon) - L0);
  return [r * Math.sin(theta), -(RHO0 - r * Math.cos(theta))];
}

function albersInverse(x, y) {
  const d = RHO0 + y;                    // y was negated on the way out
  const theta = Math.atan2(x, d);
  const r = Math.hypot(x, d);
  const sinPhi = (C - r * r * nA * nA) / (2 * nA);
  return [deg(Math.asin(sinPhi)), deg(L0 + theta / nA)];
}

/* ---- thin-plate spline ------------------------------------------------- */
// f(p) = a0 + a1·x + a2·y + Σ wi·U(|p − pi|),  U(r) = r² ln r
//
// with Σwi = Σwi·xi = Σwi·yi = 0 so the spline carries no affine component of
// its own — the polynomial term owns that, which is why the fit degrades to a
// plain affine map far from the control points instead of diverging.

const U = r => (r === 0 ? 0 : r * r * Math.log(r));

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;   // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

// Control coordinates are normalised before the spline sees them. U(r) is
// r² ln r, so raw pixel distances in the hundreds make the kernel block many
// orders of magnitude larger than the polynomial block, and the solve loses
// precision it does not need to lose.
function fitTps(points, values) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const scale = Math.max(
    ...points.map(p => Math.max(Math.abs(p[0] - mx), Math.abs(p[1] - my)))
  );
  const norm = ([x, y]) => [(x - mx) / scale, (y - my) / scale];
  const P = points.map(norm);

  const size = n + 3;
  const A = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U(Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
    A[i][n] = 1; A[i][n + 1] = P[i][0]; A[i][n + 2] = P[i][1];
    A[n][i] = 1; A[n + 1][i] = P[i][0]; A[n + 2][i] = P[i][1];
  }
  const rhs = [...values, 0, 0, 0];
  const sol = solve(A, rhs);
  if (sol === null) return null;

  const w = sol.slice(0, n);
  const [a0, a1, a2] = sol.slice(n);
  return point => {
    const [x, y] = norm(point);
    let v = a0 + a1 * x + a2 * y;
    for (let i = 0; i < n; i++) v += w[i] * U(Math.hypot(x - P[i][0], y - P[i][1]));
    return v;
  };
}

/* ---- inputs ------------------------------------------------------------ */

const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));
const names = JSON.parse(readFileSync(NAMES, 'utf8'));

// engine/cities.ts assigns ids by flattening GROUPS in file order. Parsed
// rather than imported: this is a plain .mjs script and engine/ is TypeScript.
// engine/network.test.ts re-checks the result against the real module, so a
// parse that drifts fails a test rather than shipping.
const src = readFileSync(ENGINE, 'utf8');
const groupsBlock = src.slice(src.indexOf('const GROUPS'), src.indexOf('export const CITIES'));
const engineCities = [];
for (const m of groupsBlock.matchAll(/\['([A-Z]{2})',\s*\[([^\]]*)\]\]/g)) {
  const region = m[1];
  for (const q of m[2].matchAll(/'([^']+)'/g)) {
    engineCities.push({ name: q[1], region, id: engineCities.length });
  }
}
if (engineCities.length !== 67) fail(`parsed ${engineCities.length} cities from ${ENGINE}, expected 67`);
const engineByName = new Map(engineCities.map(c => [c.name, c]));

const REGION_NAME = { NE: 'Northeast', SE: 'Southeast', NC: 'North Central',
                      SC: 'South Central', PL: 'Plains', NW: 'Northwest', SW: 'Southwest' };

/* ---- structural checks ------------------------------------------------- */

const nodes = graph.nodes;
const byId = new Map(nodes.map(n => [n.id, n]));
if (byId.size !== nodes.length) fail('duplicate node ids in the graph');

for (const e of graph.edges) {
  if (!byId.has(e.a)) fail(`edge references unknown node ${e.a}`);
  if (!byId.has(e.b)) fail(`edge references unknown node ${e.b}`);
  if (e.a === e.b) fail(`self-loop at ${e.a}`);
  if (!e.railroads?.length) fail(`edge ${e.a}–${e.b} names no railroad`);
}

const cityNodes = nodes.filter(n => n.kind === 'city');
if (cityNodes.length !== 67) fail(`graph has ${cityNodes.length} city nodes, expected 67`);

const named = new Map(names.cities.map(c => [c.id, c]));
for (const n of cityNodes) if (!named.has(n.id)) fail(`city node ${n.id} has no name in ${NAMES}`);
for (const id of named.keys()) {
  if (!byId.has(id)) fail(`${NAMES} names ${id}, which is not in the graph`);
  else if (byId.get(id).kind !== 'city') fail(`${NAMES} names ${id}, which is a ${byId.get(id).kind}`);
}

const seen = new Set();
for (const c of named.values()) {
  if (seen.has(c.name)) fail(`${c.name} is used for more than one node`);
  seen.add(c.name);
  if (!LATLON[c.name]) fail(`no latitude/longitude known for ${c.name}`);
  const engine = engineByName.get(c.name);
  if (!engine) fail(`${c.name} is not a city in ${ENGINE}`);
  else if (REGION_NAME[engine.region] !== c.region) {
    fail(`${c.name}: ${NAMES} says ${c.region}, ${ENGINE} says ${REGION_NAME[engine.region]}`);
  }
}
for (const c of engineCities) if (!seen.has(c.name)) fail(`${c.name} is in ${ENGINE} but on no map node`);

if (problems.length) {
  console.error('FAILED before fitting:\n' + problems.map(p => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}

/* ---- fit --------------------------------------------------------------- */

const control = cityNodes.map(n => {
  const [lat, lon] = LATLON[named.get(n.id).name];
  return { node: n, name: named.get(n.id).name, target: albers(lat, lon), lat, lon };
});

const src2d = control.map(c => [c.node.x, c.node.y]);
const toX = fitTps(src2d, control.map(c => c.target[0]));
const toY = fitTps(src2d, control.map(c => c.target[1]));
if (!toX || !toY) {
  console.error('FAILED: the spline system is singular — are two city nodes at the same point?');
  process.exit(1);
}

const project = node => albersInverse(toX([node.x, node.y]), toY([node.x, node.y]));

/* ---- verify the round trip on every known position --------------------- */

// Test finiteness before magnitude. Every comparison against NaN is false, so
// a `worst.off > tolerance` gate on its own passes silently when the solve has
// produced nothing but NaN — which is exactly how a mis-indexed pivot in
// solve() got past this check once already.
let worst = { name: null, off: 0 };
for (const c of control) {
  const [lat, lon] = project(c.node);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error(`FAILED: ${c.name} projected to ${lat}, ${lon} — the spline solve did not converge.`);
    process.exit(1);
  }
  const off = Math.max(Math.abs(lat - c.lat), Math.abs(lon - c.lon));
  if (off > worst.off) worst = { name: c.name, off };
}
if (worst.off > 1e-6) {
  console.error(`FAILED: control points are not reproduced — worst is ${worst.name}, ` +
                `off by ${worst.off.toExponential(2)}°. The spline should interpolate them exactly.`);
  process.exit(1);
}

/* ---- project everything, and sanity-check where it landed -------------- */

const BOX = { lat: [22, 52], lon: [-128, -64] };
const out = nodes.map(n => {
  const [lat, lon] = project(n);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) fail(`${n.id} projected to a non-number`);
  else if (lat < BOX.lat[0] || lat > BOX.lat[1] || lon < BOX.lon[0] || lon > BOX.lon[1]) {
    fail(`${n.id} (${n.kind} at ${n.x},${n.y}) landed at ${lat.toFixed(2)}, ${lon.toFixed(2)} — outside the map`);
  }
  const city = named.get(n.id);
  return {
    id: n.id,
    kind: n.kind,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    ...(city ? { name: city.name, cityId: engineByName.get(city.name).id } : {})
  };
});

if (problems.length) {
  console.error('FAILED after fitting:\n' + problems.map(p => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}

/* ---- report ------------------------------------------------------------ */
// How hard the spline is working, in kilometres. The affine part is the bulk
// of the map; the non-affine part is the drawing's own distortion. A large
// figure is not wrong — the printed board is not to scale — but a sudden
// change in it means the graph moved.

const KM_PER_DEG = 111.32;
const dists = control.map(c => {
  const [lat, lon] = albersInverse(...albers(c.lat, c.lon));
  return Math.hypot((lat - c.lat) * KM_PER_DEG,
                    (lon - c.lon) * KM_PER_DEG * Math.cos(rad(c.lat)));
});
const byKind = out.reduce((acc, n) => ({ ...acc, [n.kind]: (acc[n.kind] ?? 0) + 1 }), {});

console.log(`${nodes.length} nodes → ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log(`${graph.edges.length} edges, ${graph.railroads.length} railroads`);
console.log(`control points reproduced to ${worst.off.toExponential(1)}° (worst: ${worst.name})`);
console.log(`Albers round-trip error ${Math.max(...dists).toExponential(1)} km`);
console.log(`latitude ${Math.min(...out.map(n => n.lat)).toFixed(2)}–${Math.max(...out.map(n => n.lat)).toFixed(2)}, ` +
            `longitude ${Math.min(...out.map(n => n.lon)).toFixed(2)}–${Math.max(...out.map(n => n.lon)).toFixed(2)}`);
console.log('\nPASS — no structural problems.');

/* ---- the handoff copy -------------------------------------------------- */
// Everything the graph knows about a node, in one file, for the map work in
// the design project. It is not what the app ships: engine/network.json is
// deliberately lean, carries no scan coordinates, and leaves region to be
// looked up through cityId so the engine stays the only place a city's region
// is written down. Neither input file is self-describing on its own — the
// graph has no names and network.json has no scan space — so handing either
// one over alone means handing over half the picture.
//
// Written by the same command, from the same fit, so the two cannot drift.

const design = {
  note: `Generated by scripts/build-network.mjs from ${GRAPH} and ${NAMES}. `
      + 'A self-contained copy of the traced board for design work: every node '
      + 'in both spaces, cities named and placed in their region, and the full '
      + 'railroad records. Do not hand-edit — correct the graph and rebuild.',
  space: { scan: graph.space, geo: 'WGS84 degrees' },
  regions: Object.entries(REGION_NAME).map(([id, name]) => ({ id, name })),
  railroads: graph.railroads,
  nodes: nodes.map(n => {
    const projected = out.find(o => o.id === n.id);
    const city = named.get(n.id);
    return {
      id: n.id,
      kind: n.kind,
      x: n.x, y: n.y,
      lat: projected.lat, lon: projected.lon,
      ...(city
        ? { name: city.name, region: city.region, cityId: engineByName.get(city.name).id }
        : {})
    };
  }),
  edges: graph.edges.map(({ a, b, railroads }) => ({ a, b, railroads }))
};

if (write) {
  mkdirSync('engine', { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    note: `Generated by scripts/build-network.mjs from ${GRAPH} and ${NAMES}. `
        + 'Do not hand-edit — correct the graph and rebuild. Coordinates are '
        + 'WGS84 degrees; cityId indexes engine/cities.ts.',
    railroads: graph.railroads,
    nodes: out,
    edges: graph.edges.map(({ a, b, railroads }) => ({ a, b, railroads }))
  }, null, 1) + '\n');
  writeFileSync(DESIGN, JSON.stringify(design, null, 1) + '\n');
  console.log(`\nWrote ${OUT}`);
  console.log(`Wrote ${DESIGN} — the handoff copy for the design project`);
} else {
  console.log(`\nDry run — pass --write to emit ${OUT} and ${DESIGN}`);
}
