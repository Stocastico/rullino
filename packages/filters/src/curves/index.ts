import { defineFilter, linearToSrgb, sampleCurve, srgbToLinear } from '@rullino/core';
import { curveLut, sampleCurveLut } from '@rullino/core/internal';
import { mapChannels, toLinear, toSrgb } from '../fast';

const IDENTITY = [[0, 0], [1, 1]] as const;

/**
 * Tone curves in sRGB-encoded (perceptual) units on straight colour, like a photo editor's curve
 * tool: the RGB curve first, then the per-channel curves. Monotone cubic through the points;
 * outside [0, 1] curves extend linearly, so HDR values survive the identity.
 */
export const curves = defineFilter({
  id: 'curves',
  label: 'Curves',
  description: 'Redraws the tone response with a curve: drag points to lift or lower any range of tones, overall or per colour channel.',
  tryThis: 'Pull the middle of the RGB curve up for a brighter mood, or drag the ends in for a faded look.',
  preview: { rgb: [[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]] },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    rgb: { type: 'curve', default: IDENTITY, label: 'RGB', description: 'The curve for all channels together: brightness and contrast.' },
    red: { type: 'curve', default: IDENTITY, label: 'Red', description: 'Applied to red only, after the RGB curve.' },
    green: { type: 'curve', default: IDENTITY, label: 'Green', description: 'Applied to green only, after the RGB curve.' },
    blue: { type: 'curve', default: IDENTITY, label: 'Blue', description: 'Applied to blue only, after the RGB curve.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let e = rl_linear_to_srgb(c.rgb);
  let r = curve_red(curve_rgb(e.r));
  let g = curve_green(curve_rgb(e.g));
  let b = curve_blue(curve_rgb(e.b));
  return vec4f(rl_srgb_to_linear(vec3f(r, g, b)), c.a);
}`,
  pixel: ([r, g, b, a], p) => [
    srgbToLinear(sampleCurve(p.red, sampleCurve(p.rgb, linearToSrgb(r)))),
    srgbToLinear(sampleCurve(p.green, sampleCurve(p.rgb, linearToSrgb(g)))),
    srgbToLinear(sampleCurve(p.blue, sampleCurve(p.rgb, linearToSrgb(b)))),
    a,
  ],
  fast: (src, p) => {
    const rgb = curveLut(p.rgb);
    const ch = [p.red, p.green, p.blue].map((c) => curveLut(c)) as [Float32Array, Float32Array, Float32Array];
    const f = (c: Float32Array) => (v: number) => toLinear(sampleCurveLut(c, sampleCurveLut(rgb, toSrgb(v))));
    return mapChannels(src, f(ch[0]), f(ch[1]), f(ch[2]));
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
