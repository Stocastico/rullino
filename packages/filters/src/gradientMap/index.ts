import { defineFilter, linearToSrgb, luminance, srgbToLinear } from '@rullino/core';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Gradient map (duotone / tritone): the encoded luminance of the straight colour picks a colour
 * from a ramp, shadows at 0 and highlights at 1, optionally passing through a midtone colour at
 * `midpoint`. The ramp is interpolated in sRGB-encoded units, as photo editors do, and `amount`
 * blends the result with the original in linear light. Luminance outside [0, 1] clamps to the end
 * colours.
 */
export const gradientMap = defineFilter({
  id: 'gradientMap',
  label: 'Gradient map',
  description: 'Recolours the picture by brightness: darks get one colour, lights another, optionally with a third in between (duotone and tritone).',
  tryThis: 'Pick a deep blue for shadows and a warm yellow for highlights, then turn on the midtone colour.',
  category: 'look',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    shadows: { type: 'color', default: [0.08, 0.04, 0.25], label: 'Shadows', description: 'Colour for the darkest tones.' },
    highlights: { type: 'color', default: [1, 0.85, 0.55], label: 'Highlights', description: 'Colour for the brightest tones.' },
    tritone: { type: 'bool', default: false, label: 'Midtone colour', description: 'Add a third colour between the other two.' },
    midtones: { type: 'color', default: [0.8, 0.25, 0.35], label: 'Midtones', description: 'Colour for the middle tones; used only when the midtone colour is on.' },
    midpoint: { type: 'float', min: 0.05, max: 0.95, step: 0.01, default: 0.5, label: 'Midpoint', description: 'Which brightness gets the midtone colour; used only when the midtone colour is on.' },
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Amount', description: 'Blend between the original (0) and the full recolouring (1).' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let t = clamp(rl_linear_to_srgb(vec3f(rl_luminance(c.rgb))).x, 0.0, 1.0);
  var e = mix(p.shadows.rgb, p.highlights.rgb, t);
  if (p.tritone != 0u) {
    if (t < p.midpoint) {
      e = mix(p.shadows.rgb, p.midtones.rgb, t / p.midpoint);
    } else {
      e = mix(p.midtones.rgb, p.highlights.rgb, (t - p.midpoint) / (1.0 - p.midpoint));
    }
  }
  return vec4f(mix(c.rgb, rl_srgb_to_linear(e), p.amount), c.a);
}`,
  pixel: ([r, g, b, a], { shadows, highlights, tritone, midtones, midpoint, amount }) => {
    const t = clamp01(linearToSrgb(luminance(r, g, b)));
    const lerp = (x: readonly number[], y: readonly number[], k: number) => x.map((v, i) => v + (y[i]! - v) * k);
    const e = !tritone ? lerp(shadows, highlights, t) : t < midpoint ? lerp(shadows, midtones, t / midpoint) : lerp(midtones, highlights, (t - midpoint) / (1 - midpoint));
    const mapped = e.map(srgbToLinear);
    const src = [r, g, b];
    return [src[0]! + (mapped[0]! - src[0]!) * amount, src[1]! + (mapped[1]! - src[1]!) * amount, src[2]! + (mapped[2]! - src[2]!) * amount, a];
  },
  tolerance: { abs: 5e-4, rel: 1e-3 },
});
