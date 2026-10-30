import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear } from '@rullino/core';
import { clampLoad } from '../convolution';
import { toLinear } from '../fast';

/**
 * The glyph ramp, from empty to solid: 5 × 7 bitmaps, one 5-bit row per line (most significant bit
 * on the left), in the order " .:-+=*#@█" (ink: 0, 1, 2, 4, 7, 10, 15, 17, 21, 35 pixels).
 */
const GLYPHS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0b00100, 0],
  [0, 0, 0b00100, 0, 0, 0b00100, 0],
  [0, 0, 0, 0b11111, 0, 0, 0],
  [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  [0, 0, 0b11111, 0, 0b11111, 0, 0],
  [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
  [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0],
  [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
  [0b11111, 0b11111, 0b11111, 0b11111, 0b11111, 0b11111, 0b11111],
];
const N = GLYPHS.length;
const GLYPH_W = 5;
const GLYPH_H = 7;
/** The cell's tone is sampled on TAPS × TAPS pixels at the centres of equal sub-cells. */
const TAPS = 4;

/** Straight sRGB-encoded colour of an image pixel (clamped to the edge); transparent counts as black. */
function encodedAt(src: { width: number; height: number; data: Float32Array }, x: number, y: number): [number, number, number] {
  const a = clampLoad(src, x, y, 3);
  if (a <= 0) return [0, 0, 0];
  return [0, 1, 2].map((c) => Math.min(1, Math.max(0, linearToSrgb(clampLoad(src, x, y, c) / a)))) as [number, number, number];
}

/**
 * ASCII art: the image is cut into square cells of `cell` px; each cell is drawn as one glyph of a
 * ten-step ramp (empty to solid) chosen by the cell's mean tone (sRGB-encoded luminance of
 * TAPS × TAPS taps; bright = dense, or the reverse with `invert`). Glyphs are 5 × 7 bitmaps scaled
 * to the cell, drawn in `ink` on `paper`, or in the cell's mean colour with `color: 'source'`.
 * Alpha is kept.
 */
export const ascii = defineFilter({
  id: 'ascii',
  label: 'ASCII art',
  description: 'Redraws the picture as small text-like glyphs, from empty cells in the darks to solid ones in the lights.',
  tryThis: 'Raise the cell size to 16 or more to see the individual glyphs.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    cell: { type: 'int', min: 4, max: 32, default: 8, unit: 'px', label: 'Cell size (px)', description: 'Width of each glyph cell in pixels.' },
    color: { type: 'enum', options: { fixed: 'Ink colour', source: 'Image colours' }, default: 'fixed', label: 'Glyph colour', description: 'Use one ink colour on one paper colour, or take each glyph\'s colour from the picture.' },
    ink: { type: 'color', default: [0.85, 1, 0.85], label: 'Ink', description: 'Colour of the glyphs when using the ink colour.' },
    paper: { type: 'color', default: [0.04, 0.07, 0.05], label: 'Paper', description: 'Colour of the background.' },
    invert: { type: 'bool', default: false, label: 'Dark = dense', description: 'Off: bright areas get the dense glyphs. On: dark areas get them instead, which suits dark ink on light paper.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
var<private> GLYPHS = array<u32, ${N * GLYPH_H}>(${GLYPHS.flat().join(', ')});

fn encoded_at(xy: vec2i) -> vec3f {
  let s = load_input(xy);
  if (s.a <= 0.0) {
    return vec3f(0.0);
  }
  return clamp(rl_linear_to_srgb(s.rgb / s.a), vec3f(0.0), vec3f(1.0));
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let cell = p.cell;
  let origin = (xy / cell) * cell;
  var sum = vec3f(0.0);
  var tone = 0.0;
  for (var j = 0; j < ${TAPS}; j++) {
    for (var i = 0; i < ${TAPS}; i++) {
      let e = encoded_at(origin + vec2i(((2 * i + 1) * cell) / ${2 * TAPS}, ((2 * j + 1) * cell) / ${2 * TAPS}));
      sum += e;
      tone += rl_luminance(rl_srgb_to_linear(e));
    }
  }
  let mean = sum / ${TAPS * TAPS}.0;
  var idx = clamp(i32(floor(rl_linear_to_srgb(vec3f(tone / ${TAPS * TAPS}.0)).x * ${N - 1}.0 + 0.5)), 0, ${N - 1});
  if (p.invert == 1u) {
    idx = ${N - 1} - idx;
  }
  let l = xy - origin;
  let gx = ((2 * l.x + 1) * ${GLYPH_W}) / (2 * cell);
  let gy = ((2 * l.y + 1) * ${GLYPH_H}) / (2 * cell);
  let on = ((GLYPHS[idx * ${GLYPH_H} + gy] >> u32(${GLYPH_W - 1} - gx)) & 1u) == 1u;
  var e = p.paper.rgb;
  if (on) {
    e = p.ink.rgb;
    if (p.color == 1u) {
      e = mean;
    }
  }
  let a = load_input(xy).a;
  return vec4f(rl_srgb_to_linear(e) * a, a);
}`,
    },
  ],
  cpu: (src, { cell, color, ink, paper, invert }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const [ox, oy] = [Math.floor(x / cell) * cell, Math.floor(y / cell) * cell];
        const mean = [0, 0, 0];
        let tone = 0;
        for (let j = 0; j < TAPS; j++)
          for (let i = 0; i < TAPS; i++) {
            const e = encodedAt(src, ox + Math.floor(((2 * i + 1) * cell) / (2 * TAPS)), oy + Math.floor(((2 * j + 1) * cell) / (2 * TAPS)));
            e.forEach((v, c) => (mean[c]! += v));
            tone += luminance(srgbToLinear(e[0]), srgbToLinear(e[1]), srgbToLinear(e[2]));
          }
        let idx = Math.min(N - 1, Math.max(0, Math.floor(linearToSrgb(tone / (TAPS * TAPS)) * (N - 1) + 0.5)));
        if (invert) idx = N - 1 - idx;
        const [lx, ly] = [x - ox, y - oy];
        const [gx, gy] = [Math.floor(((2 * lx + 1) * GLYPH_W) / (2 * cell)), Math.floor(((2 * ly + 1) * GLYPH_H) / (2 * cell))];
        const on = ((GLYPHS[idx]![gy]! >> (GLYPH_W - 1 - gx)) & 1) === 1;
        const e = on ? (color === 'source' ? mean.map((v) => v / (TAPS * TAPS)) : ink) : paper;
        const a = src.data[(y * src.width + x) * 4 + 3]!;
        out.data.set([...e.map((v) => srgbToLinear(v) * a), a], (y * src.width + x) * 4);
      }
    return out;
  },
  fast: (src, { cell, color, ink, paper, invert }) => {
    const { width: w, height: h, data: s } = src;
    const out = createImage(w, h);
    const cw = Math.ceil(w / cell);
    const ch = Math.ceil(h / cell);
    // The reference samples a cell's taps again for each of its pixels: do it once per cell, with
    // the exact transfer functions (the glyph index is a hard decision).
    const offs = Array.from({ length: TAPS }, (_, i) => Math.floor(((2 * i + 1) * cell) / (2 * TAPS)));
    const glyph = new Uint8Array(cw * ch);
    const mean = new Float64Array(cw * ch * 3);
    for (let cy = 0; cy < ch; cy++)
      for (let cx = 0; cx < cw; cx++) {
        let tone = 0;
        let m0 = 0, m1 = 0, m2 = 0;
        for (let j = 0; j < TAPS; j++)
          for (let i = 0; i < TAPS; i++) {
            const x = Math.min(w - 1, cx * cell + offs[i]!);
            const y = Math.min(h - 1, cy * cell + offs[j]!);
            const k = (y * w + x) * 4;
            const a = s[k + 3]!;
            if (a <= 0) continue; // transparent counts as black: adds 0 to the mean and the tone
            const e0 = Math.min(1, Math.max(0, linearToSrgb(s[k]! / a)));
            const e1 = Math.min(1, Math.max(0, linearToSrgb(s[k + 1]! / a)));
            const e2 = Math.min(1, Math.max(0, linearToSrgb(s[k + 2]! / a)));
            m0 += e0;
            m1 += e1;
            m2 += e2;
            tone += luminance(srgbToLinear(e0), srgbToLinear(e1), srgbToLinear(e2));
          }
        let idx = Math.min(N - 1, Math.max(0, Math.floor(linearToSrgb(tone / (TAPS * TAPS)) * (N - 1) + 0.5)));
        if (invert) idx = N - 1 - idx;
        const c = cy * cw + cx;
        glyph[c] = idx;
        mean[c * 3] = m0 / (TAPS * TAPS);
        mean[c * 3 + 1] = m1 / (TAPS * TAPS);
        mean[c * 3 + 2] = m2 / (TAPS * TAPS);
      }
    const gx = Array.from({ length: cell }, (_, l) => Math.floor(((2 * l + 1) * GLYPH_W) / (2 * cell)));
    const gy = Array.from({ length: cell }, (_, l) => Math.floor(((2 * l + 1) * GLYPH_H) / (2 * cell)));
    const inkLin = ink.map((v) => srgbToLinear(v));
    const paperLin = paper.map((v) => srgbToLinear(v));
    const source = color === 'source';
    for (let y = 0; y < h; y++) {
      const cy = Math.floor(y / cell);
      const row = gy[y - cy * cell]!;
      for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / cell);
        const c = cy * cw + cx;
        const on = ((GLYPHS[glyph[c]!]![row]! >> (GLYPH_W - 1 - gx[x - cx * cell]!)) & 1) === 1;
        const o = (y * w + x) * 4;
        const a = s[o + 3]!;
        if (on && source) {
          out.data[o] = toLinear(mean[c * 3]!) * a;
          out.data[o + 1] = toLinear(mean[c * 3 + 1]!) * a;
          out.data[o + 2] = toLinear(mean[c * 3 + 2]!) * a;
        } else {
          const e = on ? inkLin : paperLin;
          out.data[o] = e[0]! * a;
          out.data[o + 1] = e[1]! * a;
          out.data[o + 2] = e[2]! * a;
        }
        out.data[o + 3] = a;
      }
    }
    return out;
  },
  // Hard decisions twice: the glyph index (a threshold on the cell's tone) and the glyph bits. The
  // taps are integer-exact, so only the tone's rounding can flip a whole cell.
  tolerance: { abs: 2e-3, rel: 2e-3 },
});
