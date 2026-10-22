import { defineFilter, linearToOklab, oklabToLinear, srgbToLinear } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

/** OKLab chroma added at strength 1 where a range has full weight. */
const TINT_CHROMA = 0.1;
/** Picked colours with less chroma than this count as grey: no direction, no tint. */
const MIN_CHROMA = 1e-4;

/** The OKLab a/b tint for a picked sRGB colour: its hue direction, scaled by strength. */
function tint(c: readonly [number, number, number], strength: number): [number, number] {
  const [, A, B] = linearToOklab(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
  const C = Math.hypot(A, B);
  if (C < MIN_CHROMA) return [0, 0];
  return [(A / C) * strength * TINT_CHROMA, (B / C) * strength * TINT_CHROMA];
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Three-way colour grading (split toning with midtones): shifts the OKLab a/b of shadows,
 * midtones and highlights towards three picked hues; lightness is kept. Range weights sum to one:
 * shadows fade out from L = 0 to the balance point m, highlights fade in from m to L = 1,
 * midtones are the rest (peaking at m). Balance moves m from 0.5 down (+) or up (−) by up to 0.3.
 */
export const colorGrading = defineFilter({
  id: 'colorGrading',
  label: 'Colour grading',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    shadows: { type: 'color', default: [0.2, 0.45, 0.6], label: 'Shadows' },
    shadowsStrength: { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Shadows strength' },
    midtones: { type: 'color', default: [0.75, 0.6, 0.45], label: 'Midtones' },
    midtonesStrength: { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Midtones strength' },
    highlights: { type: 'color', default: [1, 0.7, 0.35], label: 'Highlights' },
    highlightsStrength: { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Highlights strength' },
    balance: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Balance' },
  },
  wgsl: /* wgsl */ `
fn tint(c: vec4f, strength: f32) -> vec2f {
  let lab = rl_linear_to_oklab(rl_srgb_to_linear(c.rgb));
  let C = length(lab.yz);
  if (C < ${MIN_CHROMA}) {
    return vec2f(0.0);
  }
  return lab.yz / C * strength * ${TINT_CHROMA};
}

fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let m = 0.5 - 0.3 * p.balance;
  let ws = 1.0 - smoothstep(0.0, m, lab.x);
  let wh = smoothstep(m, 1.0, lab.x);
  let wm = 1.0 - ws - wh;
  let ab = lab.yz + ws * tint(p.shadows, p.shadowsStrength) + wm * tint(p.midtones, p.midtonesStrength) + wh * tint(p.highlights, p.highlightsStrength);
  return vec4f(rl_oklab_to_linear(vec3f(lab.x, ab)), c.a);
}`,
  pixel: ([r, g, b, a], p) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const m = 0.5 - 0.3 * p.balance;
    const ws = 1 - smoothstep(0, m, L);
    const wh = smoothstep(m, 1, L);
    const wm = 1 - ws - wh;
    const [sa, sb] = tint(p.shadows, p.shadowsStrength);
    const [ma, mb] = tint(p.midtones, p.midtonesStrength);
    const [ha, hb] = tint(p.highlights, p.highlightsStrength);
    return [...oklabToLinear(L, A + ws * sa + wm * ma + wh * ha, B + ws * sb + wm * mb + wh * hb), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
