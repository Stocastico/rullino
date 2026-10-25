import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear, type LinearImage } from '@rullino/core';
import { clampLoad } from '../convolution';

/** Screen angles relative to the base angle: cyan, magenta, yellow (the classic 15° / 75° / 0° at 45°). */
const CMY_OFFSETS = [-30, 30, -45] as const;

/** Row spacing of the hex grid relative to the dot spacing (rows of a triangular lattice). */
const HEX_ROW = Math.sqrt(3) / 2;
/** Inner radius of a ring relative to its outer radius. */
const RING_INNER = 0.55;
/** Ring area in units of π·R². */
const RING_AREA = 1 - RING_INNER * RING_INNER;

type Shape = 'circle' | 'square' | 'ring';
type Grid = 'square' | 'hex';

/**
 * Ink (0..1) at pixel (x, y) for one screen: the dot of the cell the pixel falls in, rotated by
 * `deg`, has the area of the ink coverage sampled at the cell centre (a hex grid has rows offset by
 * half a spacing, closer by √3/2, so its cells are smaller); edges are antialiased over a pixel and
 * dots smaller than a pixel fade out. `coverage(px, py)` reads the image at a pixel.
 */
function ink(x: number, y: number, size: number, deg: number, shape: Shape, grid: Grid, coverage: (px: number, py: number) => number): number {
  const t = (deg * Math.PI) / 180;
  const [cs, sn] = [Math.cos(t), Math.sin(t)];
  const [px, py] = [x + 0.5, y + 0.5];
  const [ux, uy] = [(cs * px + sn * py) / size, (-sn * px + cs * py) / size];
  const rowH = grid === 'hex' ? HEX_ROW : 1;
  const row = Math.floor(uy / rowH);
  const shift = grid === 'hex' && row % 2 !== 0 ? 0.5 : 0;
  const [cx, cy] = [Math.floor(ux - shift) + 0.5 + shift, (row + 0.5) * rowH];
  // + 0.25: centres often fall exactly on a pixel boundary (screens at 0° / 90°, the 45° diagonal),
  // where f32 and f64 would floor to different pixels.
  const k = Math.max(0, coverage(Math.floor((cs * cx - sn * cy) * size + 0.25), Math.floor((sn * cx + cs * cy) * size + 0.25)));
  const [dx, dy] = [(ux - cx) * size, (uy - cy) * size];
  let sd: number;
  let reach: number; // the dot's size in px, for the fade of dots below a pixel
  if (shape === 'square') {
    reach = (size * Math.sqrt(k * rowH)) / 2;
    sd = Math.max(Math.abs(dx), Math.abs(dy)) - reach;
  } else if (shape === 'ring') {
    reach = size * Math.sqrt((k * rowH) / (RING_AREA * Math.PI));
    const d = Math.hypot(dx, dy);
    sd = Math.max(d - reach, RING_INNER * reach - d);
  } else {
    reach = size * Math.sqrt((k * rowH) / Math.PI);
    sd = Math.hypot(dx, dy) - reach;
  }
  const t2 = Math.min(1, Math.max(0, sd + 0.5));
  return (1 - t2 * t2 * (3 - 2 * t2)) * Math.min(1, reach);
}

/** Straight sRGB-encoded channel c (3 = luminance) of an image pixel, clamped to the edge. */
function encoded(img: LinearImage, x: number, y: number, c: number): number {
  const a = clampLoad(img, x, y, 3);
  if (a <= 0) return 1;
  const [r, g, b] = [0, 1, 2].map((i) => clampLoad(img, x, y, i) / a) as [number, number, number];
  return Math.min(1, Math.max(0, linearToSrgb(c === 3 ? luminance(r, g, b) : [r, g, b][c]!)));
}

/**
 * Print-style halftone: ink dots on rotated screens, dot area = ink coverage (1 − sRGB-encoded
 * tone) sampled at each dot's centre. Mono prints luminance in black; CMY prints cyan, magenta and
 * yellow on their own screens (subtractive, per channel). Paper is white; alpha is kept.
 */
export const halftone = defineFilter({
  id: 'halftone',
  label: 'Halftone',
  category: 'stylize',
  kind: 'multipass',
  params: {
    size: { type: 'float', min: 2, max: 64, step: 0.5, default: 8, unit: 'px', label: 'Dot spacing (px)' },
    angle: { type: 'float', min: 0, max: 90, step: 1, default: 45, label: 'Angle (°)' },
    mode: { type: 'enum', options: { mono: 'Mono', cmy: 'CMY' }, default: 'mono', label: 'Inks' },
    shape: { type: 'enum', options: { circle: 'Round', square: 'Square', ring: 'Ring' }, default: 'circle', label: 'Dot shape' },
    grid: { type: 'enum', options: { square: 'Square grid', hex: 'Hex grid' }, default: 'square', label: 'Grid' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn encoded_at(xy: vec2i, c: i32) -> f32 {
  let s = load_input(xy);
  if (s.a <= 0.0) {
    return 1.0;
  }
  let rgb = s.rgb / s.a;
  var v = rgb[min(c, 2)];
  if (c == 3) {
    v = rl_luminance(rgb);
  }
  return clamp(rl_linear_to_srgb(vec3f(v)).x, 0.0, 1.0);
}

fn ink(xy: vec2i, deg: f32, c: i32) -> f32 {
  let size = params.size;
  let t = radians(deg);
  let cs = cos(t);
  let sn = sin(t);
  let pp = vec2f(xy) + 0.5;
  let u = vec2f(cs * pp.x + sn * pp.y, -sn * pp.x + cs * pp.y) / size;
  var rowH = 1.0;
  if (params.grid == 1u) {
    rowH = ${HEX_ROW};
  }
  let row = floor(u.y / rowH);
  var shift = 0.0;
  if (params.grid == 1u && (i32(row) & 1) != 0) {
    shift = 0.5;
  }
  let cc = vec2f(floor(u.x - shift) + 0.5 + shift, (row + 0.5) * rowH);
  let centre = vec2i(floor(vec2f(cs * cc.x - sn * cc.y, sn * cc.x + cs * cc.y) * size + 0.25));
  let k = max(0.0, 1.0 - encoded_at(centre, c));
  let dv = (u - cc) * size;
  var sd: f32;
  var reach: f32;
  if (params.shape == 1u) {
    reach = size * sqrt(k * rowH) / 2.0;
    sd = max(abs(dv.x), abs(dv.y)) - reach;
  } else if (params.shape == 2u) {
    reach = size * sqrt(k * rowH / (${RING_AREA} * 3.141592653589793));
    let d = length(dv);
    sd = max(d - reach, ${RING_INNER} * reach - d);
  } else {
    reach = size * sqrt(k * rowH / 3.141592653589793);
    sd = length(dv) - reach;
  }
  return (1.0 - smoothstep(-0.5, 0.5, sd)) * min(1.0, reach);
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let a = load_input(xy).a;
  var e = vec3f(1.0 - ink(xy, p.angle, 3));
  if (p.mode == 1u) {
    e = vec3f(1.0 - ink(xy, p.angle + ${CMY_OFFSETS[0]}.0, 0), 1.0 - ink(xy, p.angle + ${CMY_OFFSETS[1]}.0, 1), 1.0 - ink(xy, p.angle + ${CMY_OFFSETS[2]}.0, 2));
  }
  return vec4f(rl_srgb_to_linear(e) * a, a);
}`,
    },
  ],
  cpu: (src, { size, angle, mode, shape, grid }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const a = src.data[(y * src.width + x) * 4 + 3]!;
        const e =
          mode === 'cmy'
            ? CMY_OFFSETS.map((o, c) => 1 - ink(x, y, size, angle + o, shape, grid, (px, py) => 1 - encoded(src, px, py, c)))
            : Array<number>(3).fill(1 - ink(x, y, size, angle, shape, grid, (px, py) => 1 - encoded(src, px, py, 3)));
        out.data.set([...e.map((v) => srgbToLinear(v) * a), a], (y * src.width + x) * 4);
      }
    return out;
  },
  // Dot edges amplify tone differences (Δink ≈ 1.5 · dr/dk · Δk with dr/dk = size / (2√(πk))): ~5x at
  // mid tones, unbounded for near-white tones, where the GPU's pow() in the sRGB encoding (accurate to
  // ~1e-4) decides whether a sub-pixel dot exists at all. Measured: ~1% of channels on the parity
  // rings in CMY mode, all at dot edges or tiny dots.
  tolerance: { abs: 1e-2, rel: 1e-2, outliers: 0.02 },
});
