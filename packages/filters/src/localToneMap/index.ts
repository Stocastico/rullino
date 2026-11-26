import { createImage, defineFilter, type LinearImage } from '@rullino/core';
import { convolve1d, gaussianPass, gaussianReach, gaussianWeights } from '../convolution';

// Local tone mapping (#182, "brilliance"): compress the *base* brightness of the picture, keep (or
// boost) its detail. Brightness is the log of the Rec. 709 luminance of the premultiplied linear
// light, the base is its Gaussian blur, the detail is what is left (log L − base):
//   log L' = mid + (base − mid)(1 − strength) + (log L − base) · detail,      mid = log 0.18
// and the colour channels are scaled by L' / L, so hue and saturation (as ratios) stay. Strength 1
// brings every region to mid grey, 0 leaves the base alone; detail 1 leaves local contrast alone.
// Large radii limit the halos a Gaussian base makes next to strong edges.

const MID = Math.log(0.18);
const EPS = 1e-4;

export const localToneMap = defineFilter({
  id: 'localToneMap',
  label: 'Local tone map',
  description: 'Evens out bright and dark areas locally, lifting shadows and taming highlights while keeping the fine detail, like the brilliance slider of a photo app.',
  tryThis: 'Raise Strength on a high-contrast scene, then use Detail to bring back the crispness.',
  category: 'adjust',
  kind: 'multipass',
  params: {
    strength: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Strength', description: 'How much the broad brightness differences are flattened: 0 leaves them, 1 brings every area to mid grey.' },
    detail: { type: 'float', min: 0.25, max: 3, step: 0.01, default: 1, label: 'Detail', description: 'Local contrast: above 1 boosts fine detail, below 1 softens it; 1 leaves it as it is.' },
    sigma: { type: 'float', min: 1, max: 100, step: 0.5, default: 20, unit: 'px', label: 'Scale σ (px)', description: 'Size of the areas whose brightness is evened out, in pixels. Larger areas mean fewer halos at edges.' },
  },
  passes: [
    {
      name: 'lum',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let l = max(dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0);
  return vec4f(log(max(l, ${EPS})), 0.0, 0.0, 0.0);
}`,
    },
    gaussianPass('h', 'lum', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'out',
      inputs: ['input', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let l = max(dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0);
  let log_l = log(max(l, ${EPS}));
  let base = load_v(xy).r;
  let target_l = ${MID} + (base - ${MID}) * (1.0 - p.strength) + (log_l - base) * p.detail;
  return vec4f(c.rgb * exp(target_l - log_l), c.a);
}`,
    },
  ],
  reach: ({ sigma }) => gaussianReach(sigma),
  cpu: (src, { strength, detail, sigma }) => {
    const brightness = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) brightness.data[i] = Math.log(Math.max(luminance(src.data, i), EPS));
    const w = gaussianWeights(sigma);
    const base = convolve1d(convolve1d(brightness, w, 'x'), w, 'y');
    return map(src, base, strength, detail);
  },
  // Three f16 intermediates (the log, the two blur passes) and an exp() of their sum: measured 0.4% worst on the parity images (HDR values up to 1e3 included), allowed 0.6%.
  tolerance: { abs: 1e-3, rel: 6e-3 },
});

const luminance = (d: Float32Array, i: number) => Math.max(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!, 0);

function map(src: LinearImage, base: LinearImage, strength: number, detail: number): LinearImage {
  const out = createImage(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const logL = Math.log(Math.max(luminance(src.data, i), EPS));
    const b = base.data[i]!;
    const gain = Math.exp(MID + (b - MID) * (1 - strength) + (logL - b) * detail - logL);
    for (let c = 0; c < 3; c++) out.data[i + c] = src.data[i + c]! * gain;
    out.data[i + 3] = src.data[i + 3]!;
  }
  return out;
}
