// Shared by the edge operators (gradient, laplacian): sRGB-encoded luminance of the straight colour,
// clamp-to-edge, and the grey output with the input's alpha.

import { createImage, linearToSrgb, luminance, srgbToLinear, type LinearImage } from '@rullino/core';
import { clampLoad } from './convolution';

/** Encoded luminance of the straight colour at (x, y), clamped to the edge; 0 if transparent. */
export function lumAt(img: LinearImage, x: number, y: number): number {
  const a = clampLoad(img, x, y, 3);
  if (a <= 0) return 0;
  return linearToSrgb(luminance(clampLoad(img, x, y, 0) / a, clampLoad(img, x, y, 1) / a, clampLoad(img, x, y, 2) / a));
}

/** An image where every pixel is the encoded grey `value(x, y)` (clamped to [0, 1]) with the source's alpha. */
export function greyLike(src: LinearImage, value: (x: number, y: number) => number): LinearImage {
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = src.data[i + 3]!;
      const g = srgbToLinear(Math.min(1, Math.max(0, value(x, y)))) * a;
      out.data.set([g, g, g, a], i);
    }
  return out;
}

export const LUM_AT_WGSL = /* wgsl */ `
fn lum_at(xy: vec2i) -> f32 {
  let s = load_input(xy);
  if (s.a <= 0.0) {
    return 0.0;
  }
  return rl_linear_to_srgb(vec3f(rl_luminance(s.rgb / s.a))).x;
}

fn grey_out(xy: vec2i, v: f32) -> vec4f {
  let a = load_input(xy).a;
  let g = rl_srgb_to_linear(vec3f(clamp(v, 0.0, 1.0))).x * a;
  return vec4f(g, g, g, a);
}
`;
