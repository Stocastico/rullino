import { defineFilter, linearToOklab, oklabToLinear, type FloatParam } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

/**
 * Hue bands with their centres on the OKLab hue circle (degrees), placed on typical colours:
 * orange covers skin tones, blue the sky. Weights are tents between neighbouring centres, so they
 * always sum to one: the same change on every band acts uniformly.
 */
export const BANDS = [
  { id: 'red', label: 'Red', centre: 29 },
  { id: 'orange', label: 'Orange', centre: 58 },
  { id: 'yellow', label: 'Yellow', centre: 105 },
  { id: 'green', label: 'Green', centre: 140 },
  { id: 'aqua', label: 'Aqua', centre: 195 },
  { id: 'blue', label: 'Blue', centre: 260 },
  { id: 'purple', label: 'Purple', centre: 295 },
  { id: 'magenta', label: 'Magenta', centre: 330 },
] as const;

/** Chroma below which a colour counts as grey: changes fade in linearly up to it. */
const GREY_CHROMA = 0.04;
/** Lightness change at luminance ±1: L × (1 ± 0.4). */
const LUM_RANGE = 0.4;

const gaps = BANDS.map((b, i) => {
  const prev = BANDS[(i + BANDS.length - 1) % BANDS.length]!.centre;
  const next = BANDS[(i + 1) % BANDS.length]!.centre;
  return { prev: (b.centre - prev + 360) % 360, next: (next - b.centre + 360) % 360 };
});

const params: Record<string, FloatParam> = {};
for (const b of BANDS) {
  params[`${b.id}Hue`] = { type: 'float', min: -30, max: 30, step: 1, default: 0, label: `${b.label} (°)`, group: 'Hue', description: `Rotates the hue of ${b.label.toLowerCase()} tones.` };
  params[`${b.id}Sat`] = { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: b.label, group: 'Saturation', description: `How colourful ${b.label.toLowerCase()} tones are.` };
  params[`${b.id}Lum`] = { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: b.label, group: 'Luminance', description: `How light or dark ${b.label.toLowerCase()} tones are.` };
}

/** Signed angle from a to b in degrees, in [-180, 180). */
const wrap = (d: number) => d - 360 * Math.floor((d + 180) / 360);

/**
 * HSL-style colour mixer in OKLCh: per hue band, shift the hue, scale the chroma and the lightness.
 * Greys (chroma below `GREY_CHROMA`) are left alone, fading in so nothing jumps.
 */
export const colorMixer = defineFilter({
  id: 'colorMixer',
  label: 'Colour mixer',
  description: 'Adjusts hue, saturation and lightness separately for eight colour ranges, so you can change the sky without touching the skin.',
  tryThis: 'Darken Blue and raise its saturation for a deeper sky, then shift Orange slightly to warm the skin.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params,
  wgsl: /* wgsl */ `
fn wrap180(d: f32) -> f32 {
  return d - 360.0 * floor((d + 180.0) / 360.0);
}

fn tent(h: f32, centre: f32, prev: f32, next: f32) -> f32 {
  let d = wrap180(h - centre);
  return select(max(0.0, 1.0 - d / next), max(0.0, 1.0 + d / prev), d < 0.0);
}

fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let C = length(lab.yz);
  if (C == 0.0) {
    return c;
  }
  let g = min(1.0, C / ${GREY_CHROMA});
  let h = degrees(atan2(lab.z, lab.y));
  var dh = 0.0;
  var ds = 0.0;
  var dl = 0.0;
  var w = 0.0;
${BANDS.map(
  (b, i) => `  w = tent(h, ${b.centre}.0, ${gaps[i]!.prev}.0, ${gaps[i]!.next}.0) * g;
  dh += w * p.${b.id}Hue;
  ds += w * p.${b.id}Sat;
  dl += w * p.${b.id}Lum;`,
).join('\n')}
  let t = radians(h + dh);
  let C2 = C * max(0.0, 1.0 + ds);
  let L = lab.x * (1.0 + ${LUM_RANGE} * dl);
  return vec4f(rl_oklab_to_linear(vec3f(L, C2 * cos(t), C2 * sin(t))), c.a);
}`,
  pixel: ([r, g, b, a], p) => {
    const v = p as Record<string, number>;
    const [L, A, B] = linearToOklab(r, g, b);
    const C = Math.hypot(A, B);
    if (C === 0) return [r, g, b, a];
    const grey = Math.min(1, C / GREY_CHROMA);
    const h = (Math.atan2(B, A) * 180) / Math.PI;
    let dh = 0;
    let ds = 0;
    let dl = 0;
    BANDS.forEach((band, i) => {
      const d = wrap(h - band.centre);
      const w = (d < 0 ? Math.max(0, 1 + d / gaps[i]!.prev) : Math.max(0, 1 - d / gaps[i]!.next)) * grey;
      dh += w * v[`${band.id}Hue`]!;
      ds += w * v[`${band.id}Sat`]!;
      dl += w * v[`${band.id}Lum`]!;
    });
    const t = ((h + dh) * Math.PI) / 180;
    const C2 = C * Math.max(0, 1 + ds);
    return [...oklabToLinear(L * (1 + LUM_RANGE * dl), C2 * Math.cos(t), C2 * Math.sin(t)), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
