import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear, type LinearImage } from '@rullino/core';
import { clampLoad } from '../convolution';

/** Screen angles relative to the base angle: cyan, magenta, yellow (the classic 15° / 75° / 0° at 45°). */
const CMY_OFFSETS = [-30, 30, -45] as const;

/**
 * Ink (0..1) at pixel (x, y) for one screen: the dot of the cell the pixel falls in, rotated by
 * `deg`, has the area of the ink coverage sampled at the cell centre; edges are antialiased over a
 * pixel and dots smaller than a pixel fade out. `coverage(px, py)` reads the image at a pixel.
 */
function ink(x: number, y: number, size: number, deg: number, coverage: (px: number, py: number) => number): number {
  const t = (deg * Math.PI) / 180;
  const [cs, sn] = [Math.cos(t), Math.sin(t)];
  const [px, py] = [x + 0.5, y + 0.5];
  const [ux, uy] = [(cs * px + sn * py) / size, (-sn * px + cs * py) / size];
  const [cx, cy] = [Math.floor(ux) + 0.5, Math.floor(uy) + 0.5];
  const k = coverage(Math.floor((cs * cx - sn * cy) * size), Math.floor((sn * cx + cs * cy) * size));
  const r = size * Math.sqrt(Math.max(0, k) / Math.PI);
  const d = Math.hypot(ux - cx, uy - cy) * size;
  const t2 = Math.min(1, Math.max(0, (d - (r - 0.5)) / 1));
  return (1 - t2 * t2 * (3 - 2 * t2)) * Math.min(1, r);
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
  let cc = floor(u) + 0.5;
  let centre = vec2i(floor(vec2f(cs * cc.x - sn * cc.y, sn * cc.x + cs * cc.y) * size));
  let k = 1.0 - encoded_at(centre, c);
  let r = size * sqrt(max(0.0, k) / 3.141592653589793);
  let d = length(u - cc) * size;
  return (1.0 - smoothstep(r - 0.5, r + 0.5, d)) * min(1.0, r);
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
  cpu: (src, { size, angle, mode }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const a = src.data[(y * src.width + x) * 4 + 3]!;
        const e =
          mode === 'cmy'
            ? CMY_OFFSETS.map((o, c) => 1 - ink(x, y, size, angle + o, (px, py) => 1 - encoded(src, px, py, c)))
            : Array<number>(3).fill(1 - ink(x, y, size, angle, (px, py) => 1 - encoded(src, px, py, 3)));
        out.data.set([...e.map((v) => srgbToLinear(v) * a), a], (y * src.width + x) * 4);
      }
    return out;
  },
  // Dot centres land on a pixel by floor(): f32 and f64 rotations can pick a neighbouring pixel.
  tolerance: { abs: 2e-3, rel: 2e-3, outliers: 0.01 },
});
