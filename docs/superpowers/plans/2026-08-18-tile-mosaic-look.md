# Tile Mosaic Look — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace every pixel of Marco Polo's client with the "Tile Concepts" design — a WebGL tile-mosaic pool floor, ring-and-emoji swimmers, and a tiled "pool deck" that carries the controls on every pre-game screen.

**Architecture:** The game is unchanged below the client: the arena stays a circle of radius 1, the 30s-grace → 35% shrink stays, `MIN_PLAYERS` stays 3, and no server or protocol file is touched. The client gains a rendering stack of three layers — a WebGL canvas painting the tile floor (one fragment shader, four skins via uniforms), a 2D canvas painting the arena circle, shrink ring, ripples and swimmers on top of it, and DOM for chrome. All pre-game screens share one backdrop component (tile floor with the MARCO POLO wordmark cut into it, plus idle swimmers) and one deck component (the bottom panel that holds the controls). Everything with a right answer — the mask bitmap, the seat→creature table, heading smoothing, pool letterboxing, turbo segments, timer format — lives in a pure module with tests; the painters and screens are verified in a browser, matching this repo's existing convention (`draw.ts` has no unit test; `camera.ts`, `interpolate.ts`, `sessionState.ts` do).

**Tech Stack:** TypeScript, React 19, WebGL1 (raw, no library), 2D canvas, Vite, Vitest (jsdom project — **no canvas/WebGL in jsdom, so tests must target pure functions only**), the existing `qrcode` package, Google-hosted Space Grotesk + JetBrains Mono with system fallbacks.

**Source of truth:** Claude Design project *Minimalist Marco Polo game*, file `Tile Concepts.dc.html` — <https://claude.ai/design/p/7d708fad-baab-4e1d-994b-ffb683ae1d53?file=Tile+Concepts.dc.html>. Artboards: `2a` home, `2b` create/host lobby, `2c` join, `1g` lobby, `1d` polo in-game, `1h` marco in-game, `1a`/`1b`/`1e`/`1f` wordmark variants, `1c` bare surface.

**Decisions already taken by the user (do not re-litigate):**

| Question | Answer |
|---|---|
| Rectangular pool? | No — keep the circle, drawn **over** the full-bleed tiles |
| Shrink ring | Keep |
| Turbo | Keep the buttons; the button itself charges up (segmented fill) |
| Creatures | Auto-assigned by seat now; player choice is a later feature |
| Room code | 6 characters (the vendored lobby's format is unchanged) |
| SPECTATE | Later — hide the button |
| "ONLINE" chip | Stays: it marks online vs. a future pass-and-play mode. Ignore `MARCOPOLO.GAME` |
| Min players | 3 |
| Scoreboard | Not in the design — extrapolate the style onto it |
| Scope | All four flows in one branch |
| Fonts | Google Fonts link is fine for now; fallback stack when offline |
| QR | Keep the repo's `qrcode` dependency |

**Branch:** `feat/tile-mosaic-look` (already created from `main`).

---

## Reference values (copy these exactly — they are the design's, not invented)

**Palette**

```
--deep:      #0e4670   deep water blue, headings on light
--blue:      #14588f   primary control blue
--pale-blue: #9fdcf7   highlight / marco's voice
--foam:      #f5f9f8   near-white
--deck:      #e8eeec   deck tile face
--grout:     #c9d3d1   deck grout
--slate:     #6d8496   secondary label
--ink:       #072240   text on pale-blue
```

**Creature ring colors, in seat order** — `#6f93b4`, `#5d9c62`, `#ec87a9`, `#b98fd6`, `#8fa6b8`, `#f0a04a`, `#e8d36a`, `#9fc4e0`.

**Creatures, in seat order** — 🐬 🐢 🦩 🐙 🦭 🐠 🦆 🐡. Marco is drawn as 🦈 whoever they are, but keeps their own ring color so the swap is legible.

**Type** — display: `'Space Grotesk', system-ui, sans-serif`; mono: `'JetBrains Mono', ui-monospace, monospace`. Buttons: 700 weight, `letter-spacing: 0.2em`, uppercase, **square corners everywhere** (no `border-radius` survives this redesign except the swimmer rings).

**Deck geometry** — `min-height: clamp(180px, 27dvh, 260px)`, growing with its content; face `#e8eeec` with a 24px grid of 2px `#c9d3d1` lines; a 12px `#f5f9f8` nosing across the top with `box-shadow: 0 1px 0 #c9d3d1`; the deck itself casts `0 -14px 22px rgba(6,40,70,0.22)` onto the water.

**The deck's height has exactly one source of truth: the deck element itself.** It is clamped in CSS *and* grows with its content, so no formula predicts it — the `Deck` component measures itself with a `ResizeObserver` and hands the number to whoever needs it. The swimmers' wall is that measurement. Never re-derive the deck height from viewport height.

---

## Task 1: Design tokens, fonts, and the CSS shell

**Files:**
- Modify: `client/index.html`
- Rewrite: `client/src/styles.css`

**Step 1: Add the fonts**

In `client/index.html`, inside `<head>` after the viewport meta:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&family=Space+Grotesk:wght@400;500;700&display=swap"
  rel="stylesheet"
/>
```

A phone on a LAN with no internet falls back to the stacks below — accepted for now.

**Step 2: Rewrite `client/src/styles.css` down to tokens and primitives**

Delete everything currently in the file. The old rules (`.home`, `.lobby`, `.seats`, `.hud-*`, `.turbo`, `.overlay`, rounded buttons) are all replaced by later tasks; leaving them would collide.

```css
:root {
  --deep: #0e4670;
  --blue: #14588f;
  --pale-blue: #9fdcf7;
  --foam: #f5f9f8;
  --deck: #e8eeec;
  --grout: #c9d3d1;
  --slate: #6d8496;
  --ink: #072240;
  --display: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  --deck-h: clamp(180px, 27vh, 260px);
}

* { box-sizing: border-box; margin: 0; }
html, body, #root { height: 100%; }
body {
  background: #0b3a5c;
  color: var(--foam);
  font-family: var(--display);
  -webkit-user-select: none;
  user-select: none;
  overscroll-behavior: none;
}

/* The pool: two stacked full-viewport layers, chrome above them. */
.pool { position: fixed; inset: 0; overflow: hidden; }
.pool canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* No WebGL: a flat stand-in in the same family, so the 2D layer still reads. */
.pool--fallback { background: linear-gradient(#dbe7e4, #a8c8dc); }
.pool--fallback.pool--blind { background: linear-gradient(#16171a, #0b1226); }

/* Chrome that floats over the water. */
.chip {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  padding: 3px 6px;
}
.chip--light { color: var(--deep); background: rgba(242, 248, 246, 0.92); }
.chip--dark { color: #f2f8f6; background: rgba(14, 70, 112, 0.9); }
.chips {
  position: absolute;
  left: 28px; right: 28px; top: 28px;
  display: flex; justify-content: space-between; align-items: baseline;
}

/* The deck. */
.deck {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: var(--deck-h);
  background-color: var(--deck);
  background-image:
    linear-gradient(90deg, var(--grout) 2px, transparent 2px),
    linear-gradient(var(--grout) 2px, transparent 2px);
  background-size: 24px 24px;
  box-shadow: 0 -14px 22px rgba(6, 40, 70, 0.22);
  padding: 30px 20px 22px;
}
.deck::before {
  content: '';
  position: absolute; left: 0; right: 0; top: 0; height: 12px;
  background: var(--foam);
  box-shadow: 0 1px 0 var(--grout);
}
.deck__label { font-family: var(--mono); font-size: 9px; letter-spacing: 0.22em; color: var(--slate); }
.deck__footer {
  position: absolute; left: 20px; right: 20px; bottom: 24px;
  display: flex; justify-content: space-between;
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.18em; color: var(--slate);
}

/* Buttons: square, spaced, two weights. */
.btn {
  font-family: var(--display);
  font-size: 14px; font-weight: 700; letter-spacing: 0.22em;
  padding: 18px 16px; border: 0; border-radius: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; touch-action: manipulation;
}
.btn--primary { background: var(--blue); color: var(--foam); }
.btn--primary .btn__pip { background: var(--pale-blue); }
.btn--ghost { background: #fff; color: var(--blue); border: 2px solid var(--blue); }
.btn--ghost .btn__pip { background: var(--blue); }
.btn__pip { width: 10px; height: 10px; flex: none; }
.btn:disabled { opacity: 0.45; }
.btn--center { justify-content: center; }
```

**Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS (CSS is not typechecked; this confirms nothing else broke).

The app will look broken until Task 7 — that is expected and fine.

**Step 4: Commit**

```bash
git add client/index.html client/src/styles.css
git commit -m "style: design tokens, deck primitives, and the design's two typefaces"
```

---

## Task 1b: Fixes from Task 1's review

Task 1 landed exactly as written, and the review found three faults **in this plan** rather than in the code. Fix them here, before any screen is built on top of them.

**Files:**
- Modify: `client/src/styles.css`
- Modify: `client/index.html`

**Step 1: Let the deck grow, and stop pinning its footer**

A deck fixed at `clamp(180px, …)` cannot hold the lobby's ~217px of controls: at the 180px floor (iPhone SE portrait, any short window) the content slides under the absolutely-positioned footer and spills onto the water. Make the deck a flex column that grows, and make the footer the last item in it.

Replace the `.deck` and `.deck__footer` rules with:

```css
.deck {
  position: absolute; left: 0; right: 0; bottom: 0;
  min-height: var(--deck-h);
  display: flex; flex-direction: column;
  box-shadow: 0 -14px 22px rgba(6, 40, 70, 0.22);
  padding: 30px 20px 22px;
}
.deck__footer {
  margin-top: auto; padding-top: 16px;
  display: flex; justify-content: space-between; gap: 8px;
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.18em; color: var(--slate);
}
```

`.deck::before` and `.deck__label` are unchanged.

**Step 2: Give the tile texture one home**

The same six lines were about to be copy-pasted into the scoreboard sheet. Add the utility (and its geometry tokens), and drop the texture out of `.deck` — the component will carry both classes.

Add to `:root`:

```css
  --tile: 24px;
  --tile-line: 2px;
```

Add after the `.pool` block:

```css
/* Deck tiling: the slab under every pre-game control, and the score sheet. */
.tiled {
  background-color: var(--deck);
  background-image:
    linear-gradient(90deg, var(--grout) var(--tile-line), transparent var(--tile-line)),
    linear-gradient(var(--grout) var(--tile-line), transparent var(--tile-line));
  background-size: var(--tile) var(--tile);
}
```

**Step 3: Add the tokens later tasks would otherwise hardcode**

Add to `:root`:

```css
  --surface: #ffffff;
  --night: #0b3a5c;
  --error: #b1372f;
```

Then use them where Task 1 already typed literals: `body { background: var(--night); }` and `.btn--ghost { background: var(--surface); }`.

**Step 4: Make the chip tappable when it is a control**

The join screen's only way back is a `.chip`, which is ~16px tall. Add a modifier with a real tap target:

```css
.chip--action {
  border: 0; min-height: 44px; display: inline-flex; align-items: center;
  font: inherit; font-family: var(--mono); font-size: 10px; letter-spacing: 0.2em;
  padding: 3px 10px; cursor: pointer;
}
```

**Step 5: Stop the webfonts blocking first paint**

`display=swap` governs when a *font file* swaps in; it does nothing about a blocking stylesheet request. On the network this game is actually played on — a LAN whose router black-holes outbound DNS rather than refusing it — that request stalls first paint until the connection times out. A blank screen at a party is worse than the fallback stack the plan already accepts. In `client/index.html`, make the stylesheet load asynchronously:

```html
<link
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&family=Space+Grotesk:wght@400;500;700&display=swap"
  rel="stylesheet"
  media="print"
  onload="this.media='all'"
/>
```

Leave both `preconnect` links as they are.

**Step 6: Let the room code be copied**

`user-select: none` on `body` blocks long-press-copy of the room code the lobby renders as text. Add:

```css
.selectable { -webkit-user-select: text; user-select: text; }
```

**Step 7: Verify and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add client/src/styles.css client/index.html
git commit -m "style: deck grows with its content, tiling utility, tappable chips, async webfonts"
```

---

## Task 2: The tile mask (pure, TDD)

The shader reads a 32×60 RGBA texture, one texel per tile: red = "this tile is part of a letter", green = a corner-cut code (`0` none, `1`–`4` which triangle) packed as `code * 63`. Two variants: a plain 5×7 font and the triangle-cut font.

**Files:**
- Create: `client/src/render/glyphs.ts`
- Create: `client/src/render/mask.ts`
- Test: `client/src/render/mask.test.ts`

**Step 1: Write the glyph tables** (transcribed verbatim from the design's `BM` / `BM_TRI`)

`client/src/render/glyphs.ts`:

```ts
// The tile font. Each glyph is a comma-separated list of rows; in the plain
// font '1' is a lit tile and '0' is empty. In the cut font '#' is a full tile,
// '.' is empty, and '1'–'4' lay a triangle into the tile — which corner is
// kept is decided in the shader, from the code carried in the mask's green
// channel. Transcribed from `Tile Concepts.dc.html`.

export const GLYPHS_PLAIN: Record<string, string> = {
  M: '10001,11011,10101,10001,10001,10001,10001',
  A: '01110,10001,10001,11111,10001,10001,10001',
  R: '11110,10001,10001,11110,10100,10010,10001',
  C: '01110,10001,10000,10000,10000,10001,01110',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  L: '10000,10000,10000,10000,10000,10000,11111',
};

export const GLYPHS_CUT: Record<string, string> = {
  M: '3....1,#3..1#,#4312#,#.42.#,#....#,#....#,#....#',
  A: '1###3,#...#,#...#,#####,#...#,#...#,#...#',
  R: '####3,#...#,#...#,####2,#..43,#...#,#...#',
  C: '1###3,#...#,#....,#....,#....,#...#,4###2',
  O: '1###3,#...#,#...#,#...#,#...#,#...#,4###2',
  P: '####3,#...#,#...#,####2,#....,#....,#....',
  L: '#....,#....,#....,#....,#....,#....,#####',
};

/** Tiles across and down. The wordmark is laid out for exactly this grid. */
export const MASK_GRID = { cols: 32, rows: 60 } as const;

/** Where the two words sit in the grid, in tiles. */
export const WORDMARK = [
  { word: 'MARCO', x: 1, y: 12 },
  { word: 'POLO', x: 4, y: 22 },
] as const;
```

**Step 2: Write the failing test**

`client/src/render/mask.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MASK_GRID } from './glyphs';
import { buildMask } from './mask';

const at = (data: Uint8Array, x: number, y: number) => {
  const i = (y * MASK_GRID.cols + x) * 4;
  return { r: data[i]!, g: data[i + 1]! };
};

describe('buildMask', () => {
  it('is one RGBA texel per tile', () => {
    expect(buildMask(false).length).toBe(MASK_GRID.cols * MASK_GRID.rows * 4);
  });

  it('lights the tiles of the plain M, and only those', () => {
    const m = buildMask(false);
    // 'MARCO' starts at tile (1,12); the M's first row is '10001'.
    expect(at(m, 1, 12).r).toBe(255);
    expect(at(m, 2, 12).r).toBe(0);
    expect(at(m, 5, 12).r).toBe(255);
    // The middle row '10101' of the same glyph.
    expect(at(m, 3, 14).r).toBe(255);
  });

  it('leaves water everywhere the wordmark is not', () => {
    const m = buildMask(false);
    expect(at(m, 0, 0).r).toBe(0);
    expect(at(m, 31, 59).r).toBe(0);
  });

  it('carries corner codes in green for the cut font', () => {
    const m = buildMask(true);
    // The cut M's first row is '3....1': a code-3 tile then a code-1 tile.
    expect(at(m, 1, 12)).toEqual({ r: 255, g: 3 * 63 });
    expect(at(m, 6, 12)).toEqual({ r: 255, g: 1 * 63 });
    // A '#' tile is lit with no cut.
    expect(at(m, 1, 13)).toEqual({ r: 255, g: 0 });
  });

  it('advances by glyph width plus one tile, so POLO clears MARCO', () => {
    const m = buildMask(false);
    // 'POLO' starts at (4,22); P's first row is '11110'.
    expect(at(m, 4, 22).r).toBe(255);
    expect(at(m, 8, 22).r).toBe(0);
  });
});
```

**Step 3: Run it to make sure it fails**

Run: `npx vitest run client/src/render/mask.test.ts`
Expected: FAIL — `Failed to resolve import "./mask"`.

**Step 4: Implement**

`client/src/render/mask.ts`:

```ts
// Builds the letter mask the tile shader samples — one RGBA texel per tile.
// Red marks a tile the wordmark occupies; green carries the corner-cut code
// (0–4) scaled by 63 so it survives a byte round-trip. Deliberately a plain
// pixel array rather than a canvas: it is testable without a DOM, and WebGL
// uploads it directly.

import { GLYPHS_CUT, GLYPHS_PLAIN, MASK_GRID, WORDMARK } from './glyphs';

export function buildMask(cut: boolean): Uint8Array {
  const { cols, rows } = MASK_GRID;
  const data = new Uint8Array(cols * rows * 4);
  const glyphs = cut ? GLYPHS_CUT : GLYPHS_PLAIN;

  for (const { word, x: ox, y: oy } of WORDMARK) {
    let cx = ox;
    for (const ch of word) {
      const glyph = glyphs[ch];
      if (!glyph) throw new Error(`tile font has no glyph for ${ch}`);
      const lines = glyph.split(',');
      lines.forEach((line, y) => {
        [...line].forEach((v, x) => {
          if (v === '.' || v === '0') return;
          const code = cut && v !== '#' ? Number.parseInt(v, 10) : 0;
          const tx = cx + x;
          const ty = oy + y;
          if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) return;
          const i = (ty * cols + tx) * 4;
          data[i] = 255;
          data[i + 1] = code * 63;
          data[i + 3] = 255;
        });
      });
      cx += (lines[0]?.length ?? 0) + 1;
    }
  }
  return data;
}
```

**Step 5: Run the tests and make sure they pass**

Run: `npx vitest run client/src/render/mask.test.ts`
Expected: PASS, 5 tests.

**Step 6: Commit**

```bash
git add client/src/render/glyphs.ts client/src/render/mask.ts client/src/render/mask.test.ts
git commit -m "feat(render): tile font and the wordmark mask the shader samples"
```

---

## Task 3: The tile floor renderer

The design compiles one shader and blits it into eleven artboards; the app needs exactly one live canvas per screen, so this renders straight to the visible canvas. Grid stays fixed at 32×60 whatever the phone's aspect — tiles stretch a little on unusual screens, which is far cheaper than a wordmark that reflows.

**Files:**
- Create: `client/src/render/tiles.ts`

**Step 1: Write it**

```ts
// The pool floor: one fragment shader, four skins. Ported from the design's
// `Tile Concepts.dc.html` — the warp, the four-step quantization and the
// interleaved-gradient dither are what make tiles read as tiles under water
// rather than as a gradient.

import { buildMask } from './mask';
import { MASK_GRID } from './glyphs';

const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform vec2 uGrid;
uniform sampler2D uMask; uniform float uInvert; uniform float uMaskOn; uniform float uWarp; uniform float uCool; uniform float uBlind;
float ign(vec2 p){ return fract(52.9829189 * fract(0.06711056*p.x + 0.00583715*p.y)); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;
  float w1 = sin(uv.y*11.0 + uT*0.85) * 0.0065;
  float w2 = sin(uv.x*8.5 - uT*0.62) * 0.0065;
  float w3 = sin((uv.x + uv.y)*19.0 + uT*1.25) * 0.0028;
  vec2 p = uv + uWarp * vec2(w1 + w3, w2 - w3);
  vec2 g = p * uGrid;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float e = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
  float tile = smoothstep(0.05, 0.075, e);
  vec4 mk = texture2D(uMask, (cell + 0.5) / uGrid);
  float m = uMaskOn * mk.r;
  float code = floor(mk.g * 255.0 / 63.0 + 0.5);
  if (code > 0.5) {
    float keep;
    float d;
    if (code < 1.5)      { keep = step(1.0, f.x + f.y); d = abs(f.x + f.y - 1.0); }
    else if (code < 2.5) { keep = step(f.x + f.y, 1.0); d = abs(f.x + f.y - 1.0); }
    else if (code < 3.5) { keep = step(f.x, f.y);       d = abs(f.y - f.x); }
    else                 { keep = step(f.y, f.x);       d = abs(f.y - f.x); }
    m *= keep;
    tile = min(tile, smoothstep(0.05, 0.085, d * 0.7071));
  }
  float c = sin(cell.x*0.62 + uT*0.7)*0.5 + sin(cell.y*0.48 - uT*0.55)*0.5;
  c = 0.52 + c*0.22 + sin((cell.x + cell.y)*0.31 + uT*0.45)*0.13 - p.y*0.18;
  float q = floor(clamp(c, 0.0, 1.0)*4.0 + ign(cell*3.0)) / 4.0;
  vec3 pale = mix(vec3(0.882,0.925,0.918), vec3(0.980,0.996,0.992), q);
  pale = mix(pale, mix(vec3(0.667,0.831,0.925), vec3(1.0,1.0,1.0), q), uCool);
  vec3 aqua = mix(vec3(0.055,0.325,0.545), vec3(0.600,0.855,0.976), q);
  vec3 field = mix(pale, aqua, uInvert);
  vec3 mark  = mix(aqua, pale, uInvert);
  vec3 col = mix(field, mark, m);
  vec3 grout = mix(vec3(0.827,0.843,0.835), vec3(0.706,0.749,0.780), uInvert);
  vec3 outc = mix(grout, col, tile);
  vec3 blindA = mix(vec3(0.086,0.090,0.098), vec3(0.180,0.188,0.204), q);
  vec3 blindB = mix(vec3(0.043,0.078,0.145), vec3(0.086,0.129,0.216), q);
  vec3 blind = mix(blindA, blindB, clamp(p.y, 0.0, 1.0));
  vec3 bgrout = mix(vec3(0.055,0.059,0.067), vec3(0.031,0.055,0.102), clamp(p.y, 0.0, 1.0));
  outc = mix(outc, mix(bgrout, blind, tile), uBlind);
  gl_FragColor = vec4(outc, 1.0);
}`;

/** `pale` is the pre-game floor, `cool` the polo view, `blind` marco's. */
export type TileSkin = 'pale' | 'cool' | 'blind';
export type TileMask = 'none' | 'plain' | 'cut';

export interface TileFrame {
  /** Seconds since the screen opened; drives the warp. */
  time: number;
  skin: TileSkin;
  mask: TileMask;
}

export interface TileFloor {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(frame: TileFrame): void;
  dispose(): void;
}

/** Two device pixels per CSS pixel is already past what the dither resolves. */
const MAX_DPR = 2;

export function createTileFloor(canvas: HTMLCanvasElement): TileFloor | null {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // One oversized triangle covers the viewport with no index buffer.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

  const upload = (data: Uint8Array) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, MASK_GRID.cols, MASK_GRID.rows, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const textures = { plain: upload(buildMask(false)), cut: upload(buildMask(true)) };

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    res: u('uRes'), t: u('uT'), grid: u('uGrid'), mask: u('uMask'),
    invert: u('uInvert'), maskOn: u('uMaskOn'), warp: u('uWarp'),
    cool: u('uCool'), blind: u('uBlind'),
  };
  gl.uniform2f(uniforms.grid, MASK_GRID.cols, MASK_GRID.rows);
  gl.uniform1i(uniforms.mask, 0);

  return {
    resize(cssWidth, cssHeight, dpr) {
      const scale = Math.min(dpr, MAX_DPR);
      const w = Math.max(1, Math.round(cssWidth * scale));
      const h = Math.max(1, Math.round(cssHeight * scale));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uniforms.res, w, h);
    },
    render({ time, skin, mask }) {
      if (gl.isContextLost()) return;
      gl.bindTexture(gl.TEXTURE_2D, mask === 'cut' ? textures.cut : textures.plain);
      gl.uniform1f(uniforms.t, time);
      gl.uniform1f(uniforms.invert, 0);
      gl.uniform1f(uniforms.maskOn, mask === 'none' ? 0 : 1);
      gl.uniform1f(uniforms.warp, 1);
      gl.uniform1f(uniforms.cool, skin === 'cool' ? 1 : 0);
      gl.uniform1f(uniforms.blind, skin === 'blind' ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(textures.plain);
      gl.deleteTexture(textures.cut);
    },
  };
}
```

**Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

It cannot be seen yet — Task 5 puts it on screen. Resist adding a scratch page for it.

**Step 3: Commit**

```bash
git add client/src/render/tiles.ts
git commit -m "feat(render): WebGL tile floor with pale, cool and blind skins"
```

---

## Task 4: Creatures replace the old palette (pure, TDD)

**Files:**
- Create: `client/src/render/creatures.ts`
- Test: `client/src/render/creatures.test.ts`
- Delete: `client/src/render/colors.ts`
- Modify: `client/src/render/draw.ts` (import path only, for now)
- Modify: `client/src/screens/ScoreboardOverlay.tsx` (import path only)

**Step 1: Write the failing test**

`client/src/render/creatures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MARCO_EMOJI, creatureFor, playerColor, playerRgba } from './creatures';

describe('creatures', () => {
  it('gives each seat its own creature and ring color', () => {
    expect(creatureFor('p1', false)).toBe('🐬');
    expect(creatureFor('p4', false)).toBe('🐙');
    expect(playerColor('p1')).toBe('#6f93b4');
    expect(playerColor('p3')).toBe('#ec87a9');
  });

  it('puts the shark on whoever is marco, but keeps their color', () => {
    expect(creatureFor('p4', true)).toBe(MARCO_EMOJI);
    expect(playerColor('p4')).toBe('#b98fd6');
  });

  it('wraps past the eighth seat rather than throwing', () => {
    expect(creatureFor('p9', false)).toBe(creatureFor('p1', false));
    expect(playerColor('p9')).toBe(playerColor('p1'));
  });

  it('survives an id it cannot parse', () => {
    expect(playerColor('nonsense')).toBe('#6f93b4');
    expect(creatureFor('nonsense', false)).toBe('🐬');
  });

  it('makes rgba from the same hue', () => {
    expect(playerRgba('p2', 0.5)).toBe('rgba(93,156,98,0.5)');
  });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run client/src/render/creatures.test.ts`
Expected: FAIL — cannot resolve `./creatures`.

**Step 3: Implement**

`client/src/render/creatures.ts`:

```ts
// Every player owns a creature and a ring color, derived from their seat the
// way the lobby intends decoration to be derived (`p1`…`p8` → index). Marco
// wears the shark whoever they are — the role has to be readable across the
// pool — but keeps their own color, so the swap is legible after a catch.
// Ring colors are the design's, in the design's order.

const RINGS = [
  '#6f93b4', '#5d9c62', '#ec87a9', '#b98fd6',
  '#8fa6b8', '#f0a04a', '#e8d36a', '#9fc4e0',
] as const;

const CREATURES = ['🐬', '🐢', '🦩', '🐙', '🦭', '🐠', '🦆', '🐡'] as const;

export const MARCO_EMOJI = '🦈';

function seatIndex(playerId: string): number {
  const n = Number.parseInt(playerId.slice(1), 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return (n - 1) % RINGS.length;
}

export function creatureFor(playerId: string, isMarco: boolean): string {
  return isMarco ? MARCO_EMOJI : CREATURES[seatIndex(playerId)]!;
}

export function playerColor(playerId: string): string {
  return RINGS[seatIndex(playerId)]!;
}

export function playerRgba(playerId: string, alpha: number): string {
  const hex = playerColor(playerId);
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
```

**Step 4: Run the tests and make sure they pass**

Run: `npx vitest run client/src/render/creatures.test.ts`
Expected: PASS, 5 tests.

**Step 5: Retire the old palette**

```bash
git rm client/src/render/colors.ts
```

Then change the import in `client/src/render/draw.ts` and `client/src/screens/ScoreboardOverlay.tsx` from `'./colors'` / `'../render/colors'` to `'./creatures'` / `'../render/creatures'`.

Run: `npm run typecheck && npm test`
Expected: PASS. Nothing else referenced `colors.ts` — confirm with `grep -rn "render/colors\|from './colors'" client/`, which must print nothing.

**Step 6: Commit**

```bash
git add -A client/src
git commit -m "feat(render): creatures and the design's ring palette replace the old seat colors"
```

---

## Task 5: Scene geometry helpers (pure, TDD)

Five small answers the painters and the HUD both need. One module, one test file — they are too small to deserve five of each.

**Files:**
- Create: `client/src/render/scene.ts`
- Test: `client/src/render/scene.test.ts`

**Step 1: Write the failing test**

`client/src/render/scene.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HeadingTracker, bobOffset, lastCallLabel, mmss, poolLayout, segmentsLit } from './scene';

describe('poolLayout', () => {
  it('inscribes the arena in the short side and centers it', () => {
    expect(poolLayout(380, 720)).toEqual({ size: 380, offsetX: 0, offsetY: 170 });
    expect(poolLayout(900, 500)).toEqual({ size: 500, offsetX: 200, offsetY: 0 });
  });
});

describe('mmss', () => {
  it('formats the round clock the way the design shows it', () => {
    expect(mmss(74)).toBe('1:14');
    expect(mmss(90)).toBe('1:30');
    expect(mmss(9)).toBe('0:09');
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-3)).toBe('0:00');
  });
});

describe('segmentsLit', () => {
  it('lights ten of sixteen at 62%, as the design does', () => {
    expect(segmentsLit(0.62, 16)).toBe(10);
    expect(segmentsLit(0, 16)).toBe(0);
    expect(segmentsLit(1, 16)).toBe(16);
  });

  it('clamps nonsense', () => {
    expect(segmentsLit(-1, 16)).toBe(0);
    expect(segmentsLit(2, 16)).toBe(16);
  });
});

describe('lastCallLabel', () => {
  it('counts up from the call, not down to the next one', () => {
    expect(lastCallLabel(5, 5)).toBe('LAST CALL 0s AGO');
    expect(lastCallLabel(3, 5)).toBe('LAST CALL 2s AGO');
    expect(lastCallLabel(0, 5)).toBe('CALL READY');
    expect(lastCallLabel(null, 5)).toBe('CALL READY');
  });
});

describe('bobOffset', () => {
  it('is a bounded oscillation, and seats do not bob in lockstep', () => {
    const a = bobOffset(0, 0);
    expect(Math.abs(a)).toBeLessThanOrEqual(1);
    expect(bobOffset(0, 0)).not.toBeCloseTo(bobOffset(0, 3));
    expect(bobOffset(2400, 0)).toBeCloseTo(bobOffset(0, 0), 5);
  });
});

describe('HeadingTracker', () => {
  it('starts pointing right and turns toward the direction of travel', () => {
    const t = new HeadingTracker();
    expect(t.update('p1', 0, 0)).toEqual({ x: 1, y: 0 });
    let h = { x: 1, y: 0 };
    for (let i = 1; i <= 40; i++) h = t.update('p1', 0, i * 0.01);
    expect(h.y).toBeGreaterThan(0.9);
    expect(Math.hypot(h.x, h.y)).toBeCloseTo(1, 5);
  });

  it('holds the last heading when a swimmer stops', () => {
    const t = new HeadingTracker();
    for (let i = 0; i <= 40; i++) t.update('p1', i * 0.01, 0);
    const moving = t.update('p1', 0.41, 0);
    const stopped = t.update('p1', 0.41, 0);
    expect(stopped).toEqual(moving);
  });

  it('forgets players who left', () => {
    const t = new HeadingTracker();
    t.update('p1', 0, 0);
    t.retain(new Set(['p2']));
    expect(t.update('p1', 0, 0)).toEqual({ x: 1, y: 0 });
  });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run client/src/render/scene.test.ts`
Expected: FAIL — cannot resolve `./scene`.

**Step 3: Implement**

`client/src/render/scene.ts`:

```ts
// Small shared answers for the painters and the HUD. Everything here is pure
// (or a tiny deterministic accumulator) because jsdom has no canvas: this is
// the layer where the drawing code's arithmetic can actually be tested.

export interface PoolLayout {
  /** Side of the square the arena circle inscribes, in CSS px. */
  size: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The tiles run full-bleed, but the arena is still a circle of radius 1 — so
 * the play area is the largest centered square, and the water outside it is
 * scenery the swimmers can never reach.
 */
export function poolLayout(viewWidth: number, viewHeight: number): PoolLayout {
  const size = Math.min(viewWidth, viewHeight);
  return { size, offsetX: (viewWidth - size) / 2, offsetY: (viewHeight - size) / 2 };
}

/** `1:14`, as the design's clock reads. Never negative. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function segmentsLit(fraction: number, count: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * count);
}

/**
 * Marco's phone reports the cooldown as "seconds until ready"; the design
 * shows the same fact the other way round — how long since the last shout.
 */
export function lastCallLabel(cooldown: number | null, total: number): string {
  if (cooldown === null || cooldown <= 0) return 'CALL READY';
  return `LAST CALL ${Math.round(total - cooldown)}s AGO`;
}

const BOB_MS = 2400;

/** −1…1. `seed` staggers seats so the pool does not bob as one body. */
export function bobOffset(nowMs: number, seed: number): number {
  return Math.sin((nowMs / BOB_MS) * Math.PI * 2 + seed * 1.7);
}

export interface Heading {
  x: number;
  y: number;
}

/** How fast the head swings round to a new direction of travel. */
const TURN = 0.18;
/** Below this per-frame movement a swimmer counts as drifting, not steering. */
const MOVED = 1e-4;

/**
 * The emoji head leads the ring, so it needs a direction the snapshots do not
 * carry. Differencing the interpolated positions gives one; smoothing it stops
 * the head snapping around on a jittery frame.
 */
export class HeadingTracker {
  private last = new Map<string, { x: number; y: number }>();
  private dir = new Map<string, Heading>();

  update(id: string, x: number, y: number): Heading {
    const prev = this.last.get(id);
    this.last.set(id, { x, y });
    const dir = this.dir.get(id) ?? { x: 1, y: 0 };
    if (!prev) {
      this.dir.set(id, dir);
      return dir;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    const mag = Math.hypot(dx, dy);
    if (mag < MOVED) return dir;
    const nx = dir.x + (dx / mag - dir.x) * TURN;
    const ny = dir.y + (dy / mag - dir.y) * TURN;
    const norm = Math.hypot(nx, ny) || 1;
    const next = { x: nx / norm, y: ny / norm };
    this.dir.set(id, next);
    return next;
  }

  /** Drop players who are no longer in the snapshot. */
  retain(ids: Set<string>): void {
    for (const id of [...this.last.keys()]) {
      if (!ids.has(id)) {
        this.last.delete(id);
        this.dir.delete(id);
      }
    }
  }
}
```

**Step 4: Run the tests and make sure they pass**

Run: `npx vitest run client/src/render/scene.test.ts`
Expected: PASS, 9 tests.

**Step 5: Commit**

```bash
git add client/src/render/scene.ts client/src/render/scene.test.ts
git commit -m "feat(render): pool layout, clock, turbo segments and heading smoothing"
```

---

## Task 6: Swimmers and the new scene painter

Rewrites `draw.ts` around the design: the arena circle sits *over* the tiles, the water outside it is scrimmed back, and every player is a thick ring with an emoji head that leads it.

**Files:**
- Create: `client/src/render/swimmer.ts`
- Rewrite: `client/src/render/draw.ts`

**Step 1: Write the swimmer painter**

`client/src/render/swimmer.ts`:

```ts
// One swimmer: a thick colored ring at the true collision radius, and an emoji
// head that leads it by about a body length and bobs. The ring's stroke sits
// outside the radius, which is why a swimmer reads bigger than they catch.

import { bobOffset, type Heading } from './scene';

export interface SwimmerOpts {
  x: number;
  y: number;
  /** Collision radius in CSS px. */
  radius: number;
  color: string;
  emoji: string;
  heading: Heading;
  nowMs: number;
  /** Staggers the bob between seats. */
  seed: number;
  /** Marco's own view is nearly extinguished; their ring goes with it. */
  dimmed?: boolean;
}

export function drawSwimmer(ctx: CanvasRenderingContext2D, o: SwimmerOpts): void {
  const stroke = Math.max(3, o.radius * 0.7);
  ctx.save();
  ctx.shadowColor = 'rgba(6,40,70,0.26)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.strokeStyle = o.dimmed ? 'rgba(111,147,180,0.9)' : o.color;
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const lead = o.radius * 2;
  const hx = o.x + o.heading.x * lead;
  const hy = o.y + o.heading.y * lead + bobOffset(o.nowMs, o.seed) * o.radius * 0.22;
  const size = Math.round(o.radius * 2.6);
  ctx.save();
  ctx.translate(hx, hy);
  // The creature glyphs face left; flip them when swimming right.
  if (o.heading.x > 0) ctx.scale(-1, 1);
  if (o.dimmed) ctx.globalAlpha = 0.85;
  ctx.font = `${size}px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(o.emoji, 0, 0);
  ctx.restore();
}
```

**Step 2: Rewrite the scene painter**

`client/src/render/draw.ts` — replace the whole file:

```ts
// One painter for both roles, drawn over the tile floor. The marco view is not
// a client-side secret: polo positions are simply absent from `positions` (the
// server never sent them), so the branches here are styling, not information
// control.

import { TUNING, type StateMessage } from '../../../protocol/game';
import { RIPPLE_MS, SPLASH_MS, type Ripple } from '../game/sessionState';
import { worldScale, worldToScreen } from '../game/camera';
import { creatureFor, playerColor, playerRgba } from './creatures';
import { HeadingTracker, type PoolLayout } from './scene';
import { drawSwimmer } from './swimmer';

export interface SceneOpts {
  layout: PoolLayout;
  youId: string;
  snapshot: StateMessage;
  positions: Map<string, { x: number; y: number }>;
  ripples: Ripple[];
  headings: HeadingTracker;
  now: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): void {
  const { layout, snapshot } = o;
  const size = layout.size;
  const marcoView = o.youId === snapshot.marcoId;

  ctx.save();
  ctx.translate(layout.offsetX, layout.offsetY);
  const center = worldToScreen(0, 0, size);

  // Water outside the arena is scenery — push it back so the pool reads as
  // the pool. The tiles beneath keep moving through the scrim.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-layout.offsetX, -layout.offsetY, size + layout.offsetX * 2, size + layout.offsetY * 2);
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2, true);
  ctx.fillStyle = marcoView ? 'rgba(2,6,12,0.78)' : 'rgba(6,40,70,0.45)';
  ctx.fill('evenodd');
  ctx.restore();

  // The pool wall: the deck's nosing, continued round the water.
  ctx.strokeStyle = marcoView ? 'rgba(159,220,247,0.22)' : '#f5f9f8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(TUNING.arenaRadius, size), 0, Math.PI * 2);
  ctx.stroke();

  // The tide: the shrink ring, which is the only thing stopping a hider.
  ctx.strokeStyle = marcoView ? 'rgba(159,220,247,0.45)' : '#9fdcf7';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, worldScale(snapshot.ringRadius, size), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ripples — one ring per ping, colored by whoever made the sound.
  // Successive pings of a burst are stamped along the shouter's path, so a
  // moving swimmer trails rings; splashes are smaller and die faster.
  for (const r of o.ripples) {
    const life = r.kind === 'splash' ? SPLASH_MS : RIPPLE_MS;
    const age = (o.now - r.at) / life; // 0..1
    if (age >= 1) continue;
    const at = worldToScreen(r.x, r.y, size);
    const alpha = 1 - age;
    ctx.strokeStyle = playerRgba(r.playerId, alpha);
    if (r.kind === 'splash') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.025 + age * 0.12, size), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2 + 2 * (1 - age);
      ctx.beginPath();
      ctx.arc(at.x, at.y, worldScale(0.06 + age * 0.5, size), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (r.word) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `700 ${Math.round(size / 26)}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.letterSpacing = '0.24em';
      ctx.fillText(r.word.toUpperCase(), at.x, at.y - worldScale(0.09, size) - age * 26);
      ctx.letterSpacing = '0px';
    }
  }

  // Players — whatever positions the server let this viewer have.
  o.headings.retain(new Set(snapshot.players.map((p) => p.id)));
  for (const p of snapshot.players) {
    const pos = o.positions.get(p.id);
    if (!pos) continue;
    const at = worldToScreen(pos.x, pos.y, size);
    const heading = o.headings.update(p.id, pos.x, pos.y);
    const isMarco = p.id === snapshot.marcoId;
    drawSwimmer(ctx, {
      x: at.x,
      y: at.y,
      radius: worldScale(TUNING.avatarRadius, size),
      color: playerColor(p.id),
      emoji: creatureFor(p.id, isMarco),
      heading,
      nowMs: o.now,
      seed: Number.parseInt(p.id.slice(1), 10) || 0,
      dimmed: marcoView,
    });
    // You are the one with a dot inside your ring — the design's own device
    // for "find yourself in the water", carried over from the host's lobby.
    if (p.id === o.youId) {
      const r = worldScale(TUNING.avatarRadius, size);
      ctx.fillStyle = playerColor(p.id);
      ctx.strokeStyle = 'rgba(245,249,248,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x - r * 0.45, at.y + r * 0.45, Math.max(2.5, r * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
```

Note `ctx.letterSpacing` is a modern-canvas property; TypeScript's DOM lib in this repo (TS 5.9) knows it. If `npm run typecheck` disagrees, drop the two lines rather than casting.

**Step 3: Verify**

Run: `npm run typecheck`
Expected: FAIL — `GameScreen.tsx` still passes `size`/`youId` in the old shape. That is the next task; do not patch it here.

**Step 4: Commit**

```bash
git add client/src/render/swimmer.ts client/src/render/draw.ts
git commit -m "feat(render): ring-and-emoji swimmers over a tiled pool with a scrimmed shore"
```

---

## Task 7: The pool backdrop component

The shared shell: a WebGL layer, a 2D layer, and a render loop, with a CSS fallback when WebGL is missing. Every screen from here on mounts one.

**Files:**
- Create: `client/src/screens/PoolBackdrop.tsx`

**Step 1: Write it**

```tsx
import { useEffect, useRef } from 'react';
import { createTileFloor, type TileMask, type TileSkin } from '../render/tiles';
import { poolLayout, type PoolLayout } from '../render/scene';

export interface PoolBackdropProps {
  skin: TileSkin;
  mask: TileMask;
  /**
   * Painted onto the 2D layer every frame, over the tiles. Given the layout so
   * callers do not each re-derive where the arena sits.
   */
  paint?: (ctx: CanvasRenderingContext2D, layout: PoolLayout, now: number) => void;
  children?: React.ReactNode;
}

/**
 * The water, on every screen: the tile shader below, a 2D layer above it for
 * anything that swims, and the screen's own chrome on top of both. One render
 * loop drives all three so the warp and the swimmers never tear apart.
 */
export function PoolBackdrop({ skin, mask, paint, children }: PoolBackdropProps) {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Read through refs inside the loop: a prop change must not restart it.
  const frameRef = useRef({ skin, mask, paint });
  frameRef.current = { skin, mask, paint };

  useEffect(() => {
    const host = hostRef.current!;
    const glCanvas = glRef.current!;
    const scene = sceneRef.current!;
    const floor = createTileFloor(glCanvas);
    if (!floor) host.classList.add('pool--fallback');
    const ctx = scene.getContext('2d');
    const started = performance.now();
    let raf = 0;

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const layout = poolLayout(w, h);
      const now = performance.now();

      floor?.resize(w, h, dpr);
      floor?.render({ time: (now - started) / 1000, ...frameRef.current });

      if (ctx) {
        const scale = Math.min(dpr, 2);
        const bw = Math.round(w * scale);
        const bh = Math.round(h * scale);
        if (scene.width !== bw || scene.height !== bh) {
          scene.width = bw;
          scene.height = bh;
        }
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, w, h);
        frameRef.current.paint?.(ctx, layout, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      floor?.dispose();
    };
  }, []);

  return (
    <div ref={hostRef} className={skin === 'blind' ? 'pool pool--blind' : 'pool'}>
      <canvas ref={glRef} />
      <canvas ref={sceneRef} />
      {children}
    </div>
  );
}
```

**Step 2: Verify**

Run: `npm run typecheck`
Expected: still the `GameScreen.tsx` failure from Task 6, and nothing new.

**Step 3: Commit**

```bash
git add client/src/screens/PoolBackdrop.tsx
git commit -m "feat(client): shared pool backdrop — tile floor, scene layer, one render loop"
```

---

## Task 8: The game screen

**Files:**
- Rewrite: `client/src/screens/GameScreen.tsx`
- Modify: `client/src/styles.css` (append the game chrome rules)

**Step 1: Append the chrome styles to `client/src/styles.css`**

```css
/* --- game chrome ------------------------------------------------------- */
.hud-top {
  position: absolute; left: 24px; right: 24px; top: 24px;
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 10px 12px;
}
.hud-top--polo { background: rgba(247, 252, 250, 0.92); color: var(--deep); }
.hud-top--marco { color: var(--pale-blue); }
.hud-top__who { font-family: var(--mono); font-size: 10px; letter-spacing: 0.18em; }
.hud-top__clock { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; }

.hud-bottom {
  position: absolute; left: 24px; right: 24px; bottom: 24px;
  display: flex; flex-direction: column; gap: 10px;
}
.hud-line {
  display: flex; justify-content: space-between;
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.18em;
}
.hud-bottom--polo .hud-line { color: var(--deep); }
.hud-bottom--marco .hud-line { color: rgba(159, 220, 247, 0.75); }

.call-btn {
  width: 100%; border: 0; border-radius: 0;
  padding: 18px 16px; background: var(--pale-blue); color: var(--ink);
  font-family: var(--display); font-size: 16px; font-weight: 700; letter-spacing: 0.28em;
  touch-action: manipulation;
}
.call-btn:disabled { background: rgba(159, 220, 247, 0.35); color: rgba(7, 34, 64, 0.6); }

/* The turbo button IS the meter: sixteen tiles that charge left to right. */
.turbo-btn {
  width: 100%; border: 0; border-radius: 0; padding: 0; background: none;
  display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px;
  touch-action: manipulation;
}
.turbo-btn__seg { height: 14px; background: rgba(14, 70, 112, 0.28); }
.turbo-btn__seg--lit { background: #1a6fa8; }
.hud-bottom--marco .turbo-btn__seg { background: rgba(159, 220, 247, 0.18); }
.hud-bottom--marco .turbo-btn__seg--lit { background: var(--pale-blue); }
.turbo-btn--held .turbo-btn__seg--lit { background: var(--pale-blue); }
```

**Step 2: Rewrite `client/src/screens/GameScreen.tsx`**

Keep every behaviour that is already there — the 50ms input throttle, the single steering pointer, `pointerdown` on the buttons so a second finger works mid-drag — and change only what is drawn. The two differences in wiring: pointer coordinates now subtract the pool's letterbox offset before `screenToWorld`, and the canvas work moves into `PoolBackdrop`'s `paint` callback.

```tsx
import { useRef, useState } from 'react';
import type { LobbyView } from '../../../vendor/lobby/client/view';
import { TUNING } from '../../../protocol/game';
import type { GameSession } from '../net/useGameSession';
import { liveRipples } from '../game/sessionState';
import { screenToWorld } from '../game/camera';
import { drawScene } from '../render/draw';
import { creatureFor, MARCO_EMOJI } from '../render/creatures';
import { HeadingTracker, lastCallLabel, mmss, poolLayout, segmentsLit } from '../render/scene';
import { PoolBackdrop } from './PoolBackdrop';
import { ScoreboardOverlay } from './ScoreboardOverlay';

const SEND_EVERY_MS = 50;
const TURBO_SEGMENTS = 16;

export function GameScreen({ game, view, youId }: { game: GameSession; view: LobbyView; youId: string }) {
  const gameRef = useRef(game);
  gameRef.current = game;
  const headingsRef = useRef(new HeadingTracker());
  const [turboHeld, setTurboHeld] = useState(false);
  const inputRef = useRef<{ tx: number | null; ty: number | null; turbo: boolean; lastSent: number }>(
    { tx: null, ty: null, turbo: false, lastSent: 0 },
  );
  // Only the pointer that touched the water steers — a second finger on the
  // MARCO or TURBO buttons must not hijack or interrupt the swim gesture.
  const steerPointerRef = useRef<number | null>(null);

  const snapshot = game.session.latest!;
  const you = snapshot.you;
  const isMarco = youId === snapshot.marcoId;
  const stillIn = snapshot.players.filter((p) => p.id !== snapshot.marcoId).length;

  function send(force: boolean): void {
    const s = inputRef.current;
    const now = performance.now();
    if (!force && now - s.lastSent < SEND_EVERY_MS) return;
    s.lastSent = now;
    gameRef.current.sendInput({ tx: s.tx, ty: s.ty, turbo: s.turbo });
  }

  function setTarget(e: React.PointerEvent<HTMLDivElement>, clear: boolean): void {
    const s = inputRef.current;
    if (clear) {
      s.tx = null;
      s.ty = null;
      send(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // The tiles are full-bleed but the arena is the centered square inside
    // them, so the letterbox offset comes off before the world transform.
    const layout = poolLayout(rect.width, rect.height);
    const w = screenToWorld(
      e.clientX - rect.left - layout.offsetX,
      e.clientY - rect.top - layout.offsetY,
      layout.size,
    );
    s.tx = Math.max(-1.5, Math.min(1.5, w.x));
    s.ty = Math.max(-1.5, Math.min(1.5, w.y));
    send(false);
  }

  function holdTurbo(held: boolean): void {
    setTurboHeld(held);
    inputRef.current.turbo = held;
    send(true);
  }

  const lit = segmentsLit(you.turbo, TURBO_SEGMENTS);

  return (
    <main
      className="game"
      onPointerDown={(e) => {
        if (steerPointerRef.current !== null) return;
        steerPointerRef.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer released before the handler ran can't be captured;
          // steering still works, moves just aren't glued to the pool.
        }
        setTarget(e, false);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        setTarget(e, false);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        steerPointerRef.current = null;
        setTarget(e, true);
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== steerPointerRef.current) return;
        steerPointerRef.current = null;
        setTarget(e, true);
      }}
      style={{ touchAction: 'none' }}
    >
      <PoolBackdrop
        skin={isMarco ? 'blind' : 'cool'}
        mask="none"
        paint={(ctx, layout) => {
          const g = gameRef.current;
          const snap = g.session.latest;
          if (!snap) return;
          drawScene(ctx, {
            layout,
            youId,
            snapshot: snap,
            positions: g.buffer.at(Date.now()),
            ripples: liveRipples(g.session.ripples, Date.now()),
            headings: headingsRef.current,
            now: Date.now(),
          });
        }}
      >
        <div className={isMarco ? 'hud-top hud-top--marco' : 'hud-top hud-top--polo'}>
          <span className="hud-top__who">
            {isMarco
              ? `MARCO ${MARCO_EMOJI} · EYES CLOSED`
              : `YOU ${creatureFor(youId, false)} · MARCO ${MARCO_EMOJI}`}
          </span>
          <span className="hud-top__clock">{mmss(snapshot.timer)}</span>
        </div>

        <div className={isMarco ? 'hud-bottom hud-bottom--marco' : 'hud-bottom hud-bottom--polo'}>
          <div className="hud-line">
            {isMarco ? (
              <>
                <span>{stillIn} STILL IN</span>
                <span>{lastCallLabel(you.callCooldown, TUNING.callCooldownSeconds)}</span>
              </>
            ) : (
              <>
                <span>TURBO</span>
                <span>{Math.round(you.turbo * 100)}%</span>
              </>
            )}
          </div>
          {isMarco && (
            <button
              className="call-btn"
              disabled={(you.callCooldown ?? 0) > 0}
              // pointerdown, not click: it must fire from a second finger while
              // the first is mid-drag on the water.
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                gameRef.current.call();
              }}
            >
              CALL MARCO
            </button>
          )}
          <button
            className={turboHeld ? 'turbo-btn turbo-btn--held' : 'turbo-btn'}
            onPointerDown={(e) => {
              e.stopPropagation();
              holdTurbo(true);
            }}
            onPointerUp={() => holdTurbo(false)}
            onPointerCancel={() => holdTurbo(false)}
            onPointerLeave={() => turboHeld && holdTurbo(false)}
          >
            {Array.from({ length: TURBO_SEGMENTS }, (_, i) => (
              <span
                key={i}
                className={i < lit ? 'turbo-btn__seg turbo-btn__seg--lit' : 'turbo-btn__seg'}
              />
            ))}
          </button>
        </div>
      </PoolBackdrop>

      {snapshot.phase === 'betweenRounds' && (
        <ScoreboardOverlay
          snapshot={snapshot}
          roundEnd={game.session.roundEnd}
          isHost={view.you?.isHost === true}
          onNext={() => gameRef.current.nextRound()}
        />
      )}
    </main>
  );
}
```

Note the `stopPropagation()` on both buttons: steering now lives on the `<main>`, so a button press would otherwise also start a swim toward that corner.

**Step 3: Verify in a browser** (the first time any of this is visible)

Run: `npm run typecheck && npm test && npm run dev:all`

Open `http://localhost:7933/marcopolo/` in three tabs, create a pool, join twice, start. Confirm:
- Tiles warp; the polo view is cool-blue, marco's is near-black.
- The arena circle is visible over the tiles, water outside it is pushed back, the dashed tide ring shrinks after the 30s grace.
- Swimmers are rings with emoji heads that lead and flip with direction; your own ring carries the dot.
- MARCO/POLO ripples expand with the word rising; turbo segments charge and drain; the clock reads `1:14`-style.
- Marco's screen shows `n STILL IN` and the last-call counter, and **no polo positions ever appear**.

**Step 4: Commit**

```bash
git add client/src/screens/GameScreen.tsx client/src/styles.css
git commit -m "feat(client): game screen on the tiled pool — floating HUD, charging turbo button"
```

---

## Task 9: Idle swimmers for the pre-game screens (pure, TDD)

The home, join and lobby screens all have creatures drifting in the water above the deck, bouncing off it. In the lobby they are the actual seated players; on home and join they are set dressing.

**Files:**
- Create: `client/src/render/idle.ts`
- Test: `client/src/render/idle.test.ts`

**Step 1: Write the failing test**

`client/src/render/idle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { idleAt, IDLE_PERIOD_MS } from './idle';

const BOUNDS = { left: 0, top: 0, right: 380, bottom: 524 };

describe('idleAt', () => {
  it('keeps every swimmer inside the water, never over the deck', () => {
    for (let seat = 0; seat < 8; seat++) {
      for (let t = 0; t < IDLE_PERIOD_MS; t += 250) {
        const p = idleAt(seat, BOUNDS, t, 26);
        expect(p.x).toBeGreaterThanOrEqual(BOUNDS.left + 26);
        expect(p.x).toBeLessThanOrEqual(BOUNDS.right - 26);
        expect(p.y).toBeGreaterThanOrEqual(BOUNDS.top + 26);
        expect(p.y).toBeLessThanOrEqual(BOUNDS.bottom - 26);
      }
    }
  });

  it('loops, so nobody teleports on the seam', () => {
    const a = idleAt(2, BOUNDS, 400, 26);
    const b = idleAt(2, BOUNDS, 400 + IDLE_PERIOD_MS, 26);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
  });

  it('spreads the seats out rather than stacking them', () => {
    const one = idleAt(0, BOUNDS, 0, 26);
    const two = idleAt(1, BOUNDS, 0, 26);
    expect(Math.hypot(one.x - two.x, one.y - two.y)).toBeGreaterThan(40);
  });

  it('reports a unit heading that follows the path', () => {
    const p = idleAt(3, BOUNDS, 1200, 26);
    expect(Math.hypot(p.heading.x, p.heading.y)).toBeCloseTo(1, 4);
  });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run client/src/render/idle.test.ts`
Expected: FAIL — cannot resolve `./idle`.

**Step 3: Implement**

`client/src/render/idle.ts`:

```ts
// Swimmers drifting in the lobby water. Closed Lissajous loops, one per seat,
// inset inside the pool so nobody clips the deck or the screen edge — the
// design's hand-drawn bezier paths, made procedural and bounded.

import type { Heading } from './scene';

export interface IdleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface IdlePoint {
  x: number;
  y: number;
  heading: Heading;
}

/** Every loop closes on this period, so the pool never jumps. */
export const IDLE_PERIOD_MS = 24000;

// Coprime-ish lobes and a per-seat phase: eight loops that share the water
// without tracing each other.
const LOBES = [
  { a: 1, b: 2 }, { a: 2, b: 1 }, { a: 1, b: 3 }, { a: 3, b: 2 },
  { a: 2, b: 3 }, { a: 3, b: 1 }, { a: 1, b: 1 }, { a: 2, b: 2 },
] as const;

function point(seat: number, b: IdleBounds, ms: number, inset: number) {
  const lobe = LOBES[seat % LOBES.length]!;
  const phase = (seat * Math.PI * 2) / LOBES.length;
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const rx = Math.max(0, (b.right - b.left) / 2 - inset);
  const ry = Math.max(0, (b.bottom - b.top) / 2 - inset);
  const t = (ms / IDLE_PERIOD_MS) * Math.PI * 2;
  return {
    x: cx + Math.sin(t * lobe.a + phase) * rx,
    y: cy + Math.sin(t * lobe.b + phase * 1.3) * ry,
  };
}

export function idleAt(seat: number, bounds: IdleBounds, ms: number, inset: number): IdlePoint {
  const here = point(seat, bounds, ms, inset);
  const ahead = point(seat, bounds, ms + 120, inset);
  const dx = ahead.x - here.x;
  const dy = ahead.y - here.y;
  const mag = Math.hypot(dx, dy) || 1;
  return { ...here, heading: { x: dx / mag, y: dy / mag } };
}
```

**Step 4: Run the tests and make sure they pass**

Run: `npx vitest run client/src/render/idle.test.ts`
Expected: PASS, 4 tests.

**Step 5: Add the painter that puts them on screen**

Append to `client/src/render/idle.ts`:

```ts
import { creatureFor, playerColor } from './creatures';
import { drawSwimmer } from './swimmer';

export interface IdleSwimmer {
  /** Seat index, 0-based — decides the loop, the creature and the color. */
  seat: number;
  /** Seat id when these are real players; used for color and creature. */
  id: string;
}

/** Paints a pool of drifting swimmers into the 2D layer. */
export function drawIdlePool(
  ctx: CanvasRenderingContext2D,
  swimmers: readonly IdleSwimmer[],
  bounds: IdleBounds,
  nowMs: number,
  radius: number,
): void {
  for (const s of swimmers) {
    const at = idleAt(s.seat, bounds, nowMs, radius * 2.6);
    drawSwimmer(ctx, {
      x: at.x,
      y: at.y,
      radius,
      color: playerColor(s.id),
      emoji: creatureFor(s.id, false),
      heading: at.heading,
      nowMs,
      seed: s.seat,
    });
  }
}
```

**Step 6: Commit**

```bash
git add client/src/render/idle.ts client/src/render/idle.test.ts
git commit -m "feat(render): drifting lobby swimmers that stay in the water"
```

---

## Task 10: The deck component and the home screen

**Files:**
- Create: `client/src/screens/Deck.tsx`
- Rewrite: `client/src/screens/HomeScreen.tsx`

**Step 1: Write the deck shell**

`client/src/screens/Deck.tsx`:

```tsx
import { useEffect, useRef } from 'react';

/** What the CSS clamps the deck to before it has measured itself. */
export const DECK_MIN_PX = 180;

/**
 * The pool deck: the tiled slab across the bottom that carries every control
 * before the game starts. It is also a wall — the lobby's swimmers bounce off
 * its edge — so the water above it has to know exactly how tall it is. Since
 * the deck is clamped by the viewport *and* grows with its contents, no
 * formula predicts that: it measures itself and hands the number over.
 */
export function Deck({
  onHeight,
  children,
}: {
  onHeight?: (px: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(el.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);

  return (
    <div className="deck tiled" ref={ref}>
      {children}
    </div>
  );
}
```

Pass a **stable** `onHeight` — a `useState` setter is stable, so `onHeight={setDeckHeight}` is correct and an inline arrow is not.

**Step 2: Rewrite `client/src/screens/HomeScreen.tsx`**

Behaviour is unchanged — `createRoom`, the `onJoined` handler that saves the seat before navigating — only the shape is new. "Join a game" now routes to its own screen instead of an inline field.

```tsx
import { useEffect, useState } from 'react';
import { connection, identity } from '../net/singletons';
import { navigateToJoin, navigateToRoom } from '../router';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

// Set dressing: three creatures in the water behind the opening screen.
const DECOR = [{ seat: 0, id: 'p1' }, { seat: 3, id: 'p4' }, { seat: 6, id: 'p7' }];

export function HomeScreen() {
  // The deck is a wall the swimmers bounce off, and only the deck knows how
  // tall it ended up.
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);

  // createRoom's `joined` arrives while still on this screen; store the seat
  // so RoomScreen's useLobbyRoom rejoins with the token instead of taking a
  // second seat.
  useEffect(() => {
    return connection().onJoined((msg) => {
      identity.saveIdentity(msg.roomId, {
        playerId: msg.playerId,
        token: msg.token,
        name: identity.rememberedName() ?? '',
      });
      navigateToRoom(msg.roomId);
    });
  }, []);

  return (
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            DECOR,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <span className="chip chip--light">ONLINE</span>
          <span className="chip chip--dark">EYES CLOSED. EARS OPEN.</span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <div className="deck__stack">
            <button
              className="btn btn--primary"
              onClick={() => connection().createRoom(identity.rememberedName() ?? undefined)}
            >
              HOST A GAME<span className="btn__pip" />
            </button>
            <button className="btn btn--ghost" onClick={() => navigateToJoin()}>
              JOIN A GAME<span className="btn__pip" />
            </button>
          </div>
          <div className="deck__footer">
            <span>ONLINE · {MIN_PLAYERS}–{MAX_PLAYERS} BATHERS</span>
            <span>MARCO POLO</span>
          </div>
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
```

**Step 3: Add the one new style**

Append to `client/src/styles.css`:

```css
.deck__stack { display: flex; flex-direction: column; gap: 8px; }
```

**Step 4: Verify**

`navigateToJoin` does not exist yet, so this will not typecheck until Task 11 — write that next and verify both together. Do **not** commit a broken tree; go straight on to Task 11 and commit them as one.

---

## Task 11: The join screen and its route (TDD for the route)

**Files:**
- Modify: `client/src/router.ts`
- Modify: `client/src/router.test.ts`
- Create: `client/src/screens/JoinScreen.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Write the failing route test**

Append to `client/src/router.test.ts`:

```ts
it('routes #/join to the join screen', () => {
  expect(parseHash('#/join')).toEqual({ screen: 'join' });
});
```

**Step 2: Run it to make sure it fails**

Run: `npx vitest run client/src/router.test.ts`
Expected: FAIL — got `{ screen: 'home' }`.

**Step 3: Implement the route**

In `client/src/router.ts`:

```ts
export type Route = { screen: 'home' } | { screen: 'join' } | { screen: 'room'; roomId: string };

export function parseHash(hash: string): Route {
  const m = /^#\/room\/([A-Za-z2-9]+)$/.exec(hash);
  if (m) return { screen: 'room', roomId: m[1]!.toUpperCase() };
  return hash === '#/join' ? { screen: 'join' } : { screen: 'home' };
}

export function navigateToJoin(): void {
  window.location.hash = '#/join';
}

export function navigateHome(): void {
  window.location.hash = '#/';
}
```

(Leave `navigateToRoom` and `useHashRoute` exactly as they are.)

**Step 4: Run the tests**

Run: `npx vitest run client/src/router.test.ts`
Expected: PASS, 3 tests.

**Step 5: Write the join screen**

Room codes are six characters from the lobby's ambiguity-free alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), so the design's four boxes become six. One real `<input>` sits invisibly over the boxes: it keeps the phone keyboard, autofill and paste working, and the boxes are just its rendering.

`client/src/screens/JoinScreen.tsx`:

```tsx
import { useRef, useState } from 'react';
import { navigateHome, navigateToRoom } from '../router';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

const CODE_LENGTH = 6;
// The lobby's alphabet: no I, O, 0 or 1 to mistype across a room.
const ALPHABET = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;
const DECOR = [{ seat: 1, id: 'p2' }, { seat: 4, id: 'p5' }, { seat: 7, id: 'p8' }];

export function JoinScreen() {
  const [code, setCode] = useState('');
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? null);

  const accept = (raw: string) =>
    setCode([...raw.toUpperCase()].filter((c) => ALPHABET.test(c)).slice(0, CODE_LENGTH).join(''));

  return (
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            DECOR,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <button className="chip chip--light chip--action" onClick={() => navigateHome()}>
            ← JOIN A GAME
          </button>
          <span className="chip chip--dark">CODE FROM HOST</span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <span className="deck__label">ROOM CODE</span>
          <div className="code" onClick={() => inputRef.current?.focus()}>
            <input
              ref={inputRef}
              className="code__input"
              value={code}
              onChange={(e) => accept(e.target.value)}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              aria-label="Room code"
              autoFocus
            />
            {boxes.map((ch, i) => (
              <span key={i} className={ch ? 'code__box' : 'code__box code__box--empty'}>
                {ch ?? (i === code.length ? <span className="code__caret" /> : null)}
              </span>
            ))}
          </div>
          <div className="code__hint">
            <span>TYPE {CODE_LENGTH} CHARACTERS</span>
          </div>
          <div className="deck__footer">
            <button
              className="btn btn--primary btn--center"
              disabled={code.length < CODE_LENGTH}
              onClick={() => navigateToRoom(code)}
            >
              JOIN
            </button>
          </div>
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
```

Append to `client/src/styles.css`:

```css
.code { position: relative; display: flex; gap: 6px; margin-top: 8px; }
/* The real field, invisible over the boxes: keyboard and paste keep working. */
.code__input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; border: 0; background: none; font: inherit; color: transparent;
}
.code__box {
  flex: 1; height: 54px; background: #fff; border: 2px solid var(--blue);
  display: grid; place-items: center;
  font-family: var(--display); font-size: 26px; font-weight: 700; color: var(--blue);
}
.code__box--empty { border-color: rgba(20, 88, 143, 0.35); }
.code__caret { width: 2px; height: 26px; background: var(--blue); }
.code__hint {
  display: flex; justify-content: space-between; margin-top: 8px;
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.16em; color: var(--slate);
}
.deck__footer .btn { flex: 1; }
```

Note the deck footer holds the JOIN button here rather than the small print — that is what artboard `2c` shows.

**Step 6: Route to it**

`client/src/App.tsx`:

```tsx
import { useHashRoute } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { JoinScreen } from './screens/JoinScreen';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const route = useHashRoute();
  if (route.screen === 'room') return <RoomScreen key={route.roomId} roomId={route.roomId} />;
  return route.screen === 'join' ? <JoinScreen /> : <HomeScreen />;
}
```

**Step 7: Verify**

Run: `npm run typecheck && npm test && npm run dev:all`

In the browser: the home screen shows the tiled MARCO POLO wordmark under warping water with three creatures drifting above the deck; HOST A GAME creates a pool; JOIN A GAME reaches the six-box code screen; typing a real code joins.

**Step 8: Commit**

```bash
git add client/src/router.ts client/src/router.test.ts client/src/App.tsx \
        client/src/screens/HomeScreen.tsx client/src/screens/JoinScreen.tsx \
        client/src/screens/Deck.tsx client/src/styles.css
git commit -m "feat(client): tiled home screen and a six-box join screen"
```

---

## Task 12: The lobby

Artboard `2b`/`1g`: QR, room code, an occupancy card, START and SHARE. The seat list is gone — the seated players *are* the swimmers in the water — so renaming moves onto the deck as your own creature chip.

**Files:**
- Rewrite: `client/src/screens/LobbyPanel.tsx`
- Modify: `client/src/styles.css`

**Step 1: Rewrite `client/src/screens/LobbyPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LobbyRoomState } from '../../../vendor/lobby/client/useLobbyRoom';
import type { LobbyView } from '../../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { creatureFor } from '../render/creatures';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

export function LobbyPanel({ view, lobby }: { view: LobbyView; lobby: LobbyRoomState }) {
  const [qr, setQr] = useState<string | null>(null);
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);
  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 240 }).then(setQr);
  }, []);

  const taken = view.seats.filter((s) => s.id !== null);
  // The swimmers in the water are the roster: seat index picks both the loop
  // and the creature, so the pool reads as "who is here".
  const swimmers = taken.map((s) => ({ seat: s.index, id: s.id! }));

  const share = () => {
    const url = window.location.href;
    if (navigator.share) void navigator.share({ title: 'Marco Polo', url }).catch(() => {});
    else void navigator.clipboard?.writeText(url);
  };

  return (
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            swimmers,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <span className="chip chip--light">LOBBY</span>
          <span className="chip chip--dark">
            {view.you?.isHost ? 'YOU START' : 'HOST STARTS'}
          </span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <div className="lobby__row">
            {qr && <img className="lobby__qr" src={qr} alt={`Join code ${view.code}`} />}
            <div className="lobby__code">
              <span className="deck__label">ROOM CODE</span>
              <span className="lobby__code-value selectable">{view.code}</span>
              <span className="lobby__hint">SCAN OR TYPE TO JOIN</span>
            </div>
            <div className="lobby__count">
              <span className="lobby__count-cap">MAXIMUM<br />{MAX_PLAYERS} BATHERS</span>
              <span className="lobby__count-rule" />
              <span className="lobby__count-value">{taken.length}</span>
              <span className="lobby__count-label">IN POOL</span>
            </div>
          </div>

          {view.you && (
            <label className="lobby__you">
              <span className="lobby__you-creature">{creatureFor(view.you.id!, false)}</span>
              <input
                className="lobby__you-name"
                defaultValue={view.you.name ?? ''}
                placeholder="YOUR NAME"
                maxLength={12}
                disabled={!view.you.canRename}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== view.you?.name) lobby.rename(name);
                }}
              />
            </label>
          )}

          <div className="lobby__actions">
            <button
              className="btn btn--primary btn--center lobby__start"
              disabled={!view.canBegin}
              onClick={() => lobby.begin()}
            >
              START<span className="btn__pip" />
            </button>
            <button className="btn btn--ghost btn--center" onClick={share}>SHARE</button>
          </div>

          {view.beginBlocked === 'notEnoughPlayers' && (
            <p className="lobby__note">NEED {MIN_PLAYERS} SWIMMERS</p>
          )}
          {view.beginBlocked === 'notHost' && <p className="lobby__note">WAITING FOR THE HOST</p>}
          {lobby.message && <p className="lobby__note lobby__note--error">{lobby.message}</p>}
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
```

SPECTATE is deliberately absent — the button returns when there is something behind it.

**Step 2: Append the lobby styles**

```css
.lobby__row { display: flex; gap: 14px; align-items: flex-start; }
.lobby__qr { width: 88px; height: 88px; flex: none; background: #fff; }
.lobby__code { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.lobby__code-value {
  font-family: var(--display); font-size: 34px; font-weight: 700;
  letter-spacing: 0.08em; color: var(--blue); line-height: 1;
}
.lobby__hint { font-family: var(--mono); font-size: 9px; letter-spacing: 0.16em; color: var(--slate); }
.lobby__count {
  width: 84px; flex: none; border: 3px solid var(--blue); background: #fff;
  text-align: center; padding: 8px 4px 9px; display: flex; flex-direction: column;
}
.lobby__count-cap { font-family: var(--mono); font-size: 8px; letter-spacing: 0.16em; color: var(--blue); line-height: 1.4; }
.lobby__count-rule { height: 2px; background: var(--blue); margin: 7px 6px; }
.lobby__count-value { font-family: var(--display); font-size: 30px; font-weight: 700; color: var(--blue); line-height: 1; }
.lobby__count-label { font-family: var(--mono); font-size: 8px; letter-spacing: 0.16em; color: var(--slate); margin-top: 3px; }

.lobby__you { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.lobby__you-creature { font-size: 22px; line-height: 1; }
.lobby__you-name {
  flex: 1; font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--blue);
  background: #fff; border: 2px solid var(--blue); border-radius: 0; padding: 8px 10px;
}
.lobby__actions { display: flex; gap: 8px; margin-top: 12px; }
.lobby__actions .btn { padding: 12px 10px; font-size: 12px; letter-spacing: 0.2em; }
.lobby__start { flex: 1.5; }
.lobby__actions .btn--ghost { flex: 1; }
.lobby__note {
  margin-top: 8px; font-family: var(--mono); font-size: 9px;
  letter-spacing: 0.16em; color: var(--slate);
}
.lobby__note--error { color: var(--error); }
```

**Step 3: Verify**

Run: `npm run typecheck && npm test && npm run dev:all`

Two phones (or two tabs): host sees the QR, the six-character code and `2 IN POOL` climbing as people join; each joiner appears as a drifting creature above the deck; renaming sticks; START is disabled below three and enabled at three; SHARE opens the sheet (or copies on desktop).

**Step 4: Commit**

```bash
git add client/src/screens/LobbyPanel.tsx client/src/styles.css
git commit -m "feat(client): lobby on the deck — QR, room code, occupancy, drifting roster"
```

---

## Task 13: The scoreboard and the notices

Not in the design; extrapolated as a deck-shaped sheet over dimmed water, which is the language everything else in the app now speaks.

**Files:**
- Rewrite: `client/src/screens/ScoreboardOverlay.tsx`
- Modify: `client/src/screens/RoomScreen.tsx`
- Modify: `client/src/styles.css`

**Step 1: Rewrite `client/src/screens/ScoreboardOverlay.tsx`**

```tsx
import type { GameEvent, StateMessage } from '../../../protocol/game';
import { creatureFor, playerColor } from '../render/creatures';

export function ScoreboardOverlay({
  snapshot,
  roundEnd,
  isHost,
  onNext,
}: {
  snapshot: StateMessage;
  roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null;
  isHost: boolean;
  onNext: () => void;
}) {
  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? id;
  const rows = [...snapshot.players].sort(
    (a, b) => (snapshot.scores[b.id] ?? 0) - (snapshot.scores[a.id] ?? 0),
  );

  return (
    <div className="overlay">
      <div className="overlay__sheet tiled">
        <span className="deck__label">
          {roundEnd?.reason === 'catch' ? 'CAUGHT' : 'TIME'} · ROUND {snapshot.round}
        </span>
        <h2 className="overlay__headline">
          {roundEnd?.reason === 'catch'
            ? `${nameOf(roundEnd.caughtId!)} IS MARCO NEXT`
            : roundEnd
              ? `THE POLOS ESCAPED — ${nameOf(roundEnd.nextMarcoId)} IS MARCO NEXT`
              : 'ROUND OVER'}
        </h2>
        <ol className="overlay__scores">
          {rows.map((p) => (
            <li key={p.id}>
              <span className="overlay__creature" style={{ color: playerColor(p.id) }}>
                {creatureFor(p.id, p.id === snapshot.marcoId)}
              </span>
              <span className="overlay__name">{p.name}</span>
              <span className="overlay__score">{snapshot.scores[p.id] ?? 0}</span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <button className="btn btn--primary btn--center" onClick={onNext}>
            NEXT ROUND<span className="btn__pip" />
          </button>
        ) : (
          <p className="lobby__note">WAITING FOR THE HOST</p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Restyle the notices in `client/src/screens/RoomScreen.tsx`**

Change only the two `<main className="notice">` blocks and the "diving in…" one:

```tsx
  if (view.terminal === 'gone')
    return (
      <main className="notice">
        <p>THIS POOL HAS DRAINED</p>
        <a className="btn btn--ghost btn--center" href="#/">START A NEW ONE</a>
      </main>
    );
  if (view.terminal === 'stale')
    return <main className="notice"><p>NEW VERSION AVAILABLE — RELOAD</p></main>;
```

and

```tsx
  if (lobby.roster?.lifecycle === 'playing') {
    return <main className="notice"><p>DIVING IN…</p></main>;
  }
```

**Step 3: Append the styles**

```css
.overlay {
  position: fixed; inset: 0; background: rgba(4, 22, 38, 0.86);
  display: flex; align-items: flex-end; justify-content: center;
}
.overlay__sheet {
  width: 100%; padding: 30px 20px 24px;
  border-top: 12px solid var(--foam);
  color: var(--deep);
  display: flex; flex-direction: column; gap: 12px;
}
.overlay__headline {
  font-size: 18px; font-weight: 700; letter-spacing: 0.06em; color: var(--blue);
}
.overlay__scores { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.overlay__scores li {
  display: flex; align-items: center; gap: 10px;
  background: #fff; padding: 8px 10px;
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em; color: var(--deep);
}
.overlay__creature { font-size: 18px; line-height: 1; }
.overlay__name { flex: 1; text-transform: uppercase; }
.overlay__score { font-family: var(--display); font-weight: 700; font-size: 16px; color: var(--blue); }

.notice {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; padding: 24px;
  background: var(--night);
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.18em;
}
.notice .btn { width: auto; background: #fff; }
```

**Step 4: Verify**

Run: `npm run typecheck && npm test && npm run dev:all`
Play a round to a catch and to a timeout; confirm both headlines, the score sheet, and that the host's NEXT ROUND advances everyone.

**Step 5: Commit**

```bash
git add client/src/screens/ScoreboardOverlay.tsx client/src/screens/RoomScreen.tsx client/src/styles.css
git commit -m "feat(client): scoreboard sheet and notices in the deck's language"
```

---

## Task 14: Whole-app pass and docs

**Files:**
- Modify: `README.md`

**Step 1: Run everything**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three pass. The build must not warn about a bundle the phones cannot parse.

**Step 2: The invariant that must not have moved**

Run: `npx vitest run server/wire.test.ts server/snapshot.test.ts`
Expected: PASS. Marco's phone is still never sent polo positions — no task here touched the server, and this proves it.

**Step 3: Real-device check**

Run `npm run dev:all`, open the printed LAN URL on three phones, and play a full round. Watch for:
- Frame rate on the oldest phone available. If the shader drags, the first lever is `MAX_DPR` in `tiles.ts` (drop to 1.5), not removing the warp.
- Landscape and notched screens: the deck stays put, the arena circle stays centered, no horizontal scroll.
- A phone with WebGL disabled (Safari → Develop → Disable WebGL, or a fresh profile): the `pool--fallback` gradient shows and the game is still completely playable.

**Step 4: Update the README**

In the Layout section, change the `client/` line to:

```
    client/        React + canvas: tile shader, swimmers, deck screens
```

And under it, add:

```
The look comes from the Claude Design project *Minimalist Marco Polo game*
(`Tile Concepts.dc.html`): a WebGL tile floor with four skins, ring-and-emoji
swimmers, and a tiled "pool deck" carrying the controls before the game
starts. The arena is still a circle drawn over the tiles; the tiles are only
ever scenery.
```

In "Not built yet (deliberately)", keep audio and obstacles, and change the spectator line to `spectator screen (the lobby's SPECTATE button is deliberately absent until there is one)`.

**Step 5: Commit and open the PR**

```bash
git add README.md
git commit -m "docs: the tile look, and where it came from"
git push -u origin feat/tile-mosaic-look
```

Then open a PR against `main` describing the four flows and linking the design project.

---

## Notes for whoever executes this

- **jsdom has neither canvas nor WebGL in this repo** (no `canvas` package installed). Do not write a test that calls `getContext`. If a piece of drawing logic feels like it needs a test, the answer is to lift the arithmetic into `scene.ts` and test that.
- **Do not touch `server/`, `protocol/`, or `vendor/lobby/`.** Every answer above was chosen to keep this a client-only change. If a task seems to need a server change, stop and ask — it means a requirement was misread.
- **The design is data, not scripture.** Where it shows four code boxes and the lobby mints six characters, six wins; where it shows `MARCOPOLO.GAME`, the app's own URL wins. Everything else — the colors, the letter-spacing, the square corners, the shader — is exact.
- Keep the existing comment voice: comments explain *why* a thing is the way it is, not what the line does.
