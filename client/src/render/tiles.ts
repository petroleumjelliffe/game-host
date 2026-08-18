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
export const MAX_DPR = 2;

/**
 * One floor per canvas: `getContext` hands back the same context for the same
 * element, so a second floor on one canvas would silently hijack the first's
 * program. A lost context takes every object here with it — do not try to
 * revive a `TileFloor`, throw it away and make another.
 */
export function createTileFloor(canvas: HTMLCanvasElement): TileFloor | null {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('tile shader failed to compile:', gl.getShaderInfoLog(s));
    }
    return s;
  };
  const program = gl.createProgram()!;
  const vert = compile(gl.VERTEX_SHADER, VERT);
  const frag = compile(gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('tile shader failed to link:', gl.getProgramInfoLog(program));
    return null;
  }
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

  // A canvas that has never been sized still reports 300×150, so matching
  // those numbers must not be mistaken for "already sized" — that would skip
  // the one call that sets uRes, and the shader would divide by zero.
  let sized = false;

  return {
    resize(cssWidth, cssHeight, dpr) {
      const scale = Math.min(dpr, MAX_DPR);
      const w = Math.max(1, Math.round(cssWidth * scale));
      const h = Math.max(1, Math.round(cssHeight * scale));
      if (sized && canvas.width === w && canvas.height === h) return;
      sized = true;
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
      // A context outlives its deleted objects and sits on the detached canvas
      // until GC. Browsers cap live contexts and evict the oldest, so leaking
      // one per screen eventually kills the pool you are actually looking at.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
