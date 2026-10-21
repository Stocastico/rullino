// Shared building blocks for convolution filters: CPU references and matching WGSL pass sources.
// Everything runs on premultiplied linear values with clamp-to-edge, like the GPU passes.

import { createImage, type LinearImage, type PassDef } from '@rullino/core';

export const clampLoad = (img: LinearImage, x: number, y: number, c: number) =>
  img.data[(Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))) * 4 + c]!;

/** Gaussian taps -r..r with r = ceil(3σ), normalised to sum 1. σ ≈ 0 is the identity. */
export function gaussianWeights(sigma: number): number[] {
  if (sigma < 1e-3) return [1];
  const r = Math.ceil(3 * sigma);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

/** 1-D convolution along x or y with symmetric `weights` (length 2r + 1), all four channels. */
export function convolve1d(src: LinearImage, weights: readonly number[], axis: 'x' | 'y'): LinearImage {
  const r = (weights.length - 1) / 2;
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += weights[k + r]! * (axis === 'x' ? clampLoad(src, x + k, y, c) : clampLoad(src, x, y + k, c));
        out.data[(y * src.width + x) * 4 + c] = acc;
      }
  return out;
}

export const gaussianCpu = (src: LinearImage, sigma: number) => {
  const w = gaussianWeights(sigma);
  return convolve1d(convolve1d(src, w, 'x'), w, 'y');
};

/** One Gaussian pass along an axis; the `sigma` param must exist in the filter's schema. */
export const gaussianPass = (name: string, input: string, axis: 'x' | 'y'): PassDef => ({
  name,
  inputs: [input],
  wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  if (p.sigma < 1e-3) { return load_${input}(xy); }
  let r = i32(ceil(3.0 * p.sigma));
  let k2 = -0.5 / (p.sigma * p.sigma);
  var acc = vec4f(0.0);
  var total = 0.0;
  for (var k = -r; k <= r; k++) {
    let w = exp(f32(k * k) * k2);
    acc += w * load_${input}(xy + ${axis === 'x' ? 'vec2i(k, 0)' : 'vec2i(0, k)'});
    total += w;
  }
  return acc / total;
}`,
});
