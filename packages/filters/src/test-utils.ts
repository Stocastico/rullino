import { createImage, linearToOklab, type PointwiseFilter, type Rgba } from '@rullino/core';

/** Runs a filter's CPU reference on a single premultiplied pixel. */
export function px<F extends PointwiseFilter<any>>(f: F, c: Rgba, params?: Parameters<F['cpu']>[1]): Rgba {
  const out = f.cpu(createImage(1, 1, new Float32Array(c)), params).data;
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

export const grey = (v: number, a = 1): Rgba => [v * a, v * a, v * a, a];

export const chroma = ([r, g, b]: Rgba) => {
  const [, A, B] = linearToOklab(r, g, b);
  return Math.hypot(A, B);
};

export const lightness = ([r, g, b]: Rgba) => linearToOklab(r, g, b)[0];
