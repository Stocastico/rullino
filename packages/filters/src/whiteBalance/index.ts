import { defineFilter, luminance, type Rgba } from '@rullino/core';

/** Stops of red/blue (temperature) or green (tint) shift at the ends of the sliders. */
const RANGE = 0.5;

function gains(temperature: number, tint: number): [number, number, number] {
  const r = 2 ** (RANGE * temperature);
  const g = 2 ** (-RANGE * tint);
  const b = 2 ** (-RANGE * temperature);
  const y = luminance(r, g, b); // normalise so neutrals keep their luminance
  return [r / y, g / y, b / y];
}

/**
 * Temperature / tint as per-channel gains in linear RGB, normalised to preserve the luminance
 * of neutrals. A simple creative control, not a CCT-based chromatic adaptation (see auto WB, tier B).
 * Linear in colour, so it runs on premultiplied values directly.
 */
export const whiteBalance = defineFilter({
  id: 'whiteBalance',
  label: 'White balance',
  description: 'Corrects the colour of the light so that neutral things look neutral: cooler or warmer, greener or more magenta.',
  tryThis: 'Drag Temperature until something that should be white or grey looks neutral.',
  preview: { temperature: 0.5 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    temperature: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Temperature', description: 'Negative makes the picture cooler (bluer), positive warmer (more orange).' },
    tint: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Tint', description: 'Negative adds green, positive adds magenta.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let g = exp2(vec3f(${RANGE} * p.temperature, -${RANGE} * p.tint, -${RANGE} * p.temperature));
  return vec4f(c.rgb * g / rl_luminance(g), c.a);
}`,
  pixel: ([r, g, b, a], { temperature, tint }): Rgba => {
    const [kr, kg, kb] = gains(temperature, tint);
    return [r * kr, g * kg, b * kb, a];
  },
  tolerance: { abs: 1e-6, rel: 2 ** -10 },
});
