import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear } from '@rullino/core';
import { clampLoad } from '../convolution';

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
  category: 'stylize',
  kind: 'multipass',
  params: {
    cell: { type: 'int', min: 4, max: 32, default: 8, unit: 'px', label: 'Cell size (px)' },
    color: { type: 'enum', options: { fixed: 'Ink colour', source: 'Image colours' }, default: 'fixed', label: 'Glyph colour' },
    ink: { type: 'color', default: [0.85, 1, 0.85], label: 'Ink' },
    paper: { type: 'color', default: [0.04, 0.07, 0.05], label: 'Paper' },
    invert: { type: 'bool', default: false, label: 'Dark = dense' },
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
  // Hard decisions twice: the glyph index (a threshold on the cell's tone) and the glyph bits. The
  // taps are integer-exact, so only the tone's rounding can flip a whole cell.
  tolerance: { abs: 2e-3, rel: 2e-3 },
});
