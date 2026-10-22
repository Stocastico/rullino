import { createImage, linearToOklab, oklabToLinear, type PointwiseFilter, type Rgba } from '@rullino/core';

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

/** A w x h image filled with a function of (x, y) giving straight colour, alpha 1. */
export function imageOf(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) img.data.set([...f(x, y), 1], (y * w + x) * 4);
  return img;
}

export const at = (img: { width: number; data: Float32Array }, x: number, y: number, c = 0) => img.data[(y * img.width + x) * 4 + c]!;

export const sum = (img: { data: Float32Array }, c = 0) => {
  let s = 0;
  for (let i = c; i < img.data.length; i += 4) s += img.data[i]!;
  return s;
};

/** An image from OKLab lightness per pixel, with a fixed hue and chroma; alpha 1. */
export function fromLightness(w: number, h: number, L: (x: number, y: number) => number, a = 0.03, b = -0.02) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([...oklabToLinear(L(x, y), a, b), 1], (y * w + x) * 4);
  return img;
}

/** OKLab of pixel i of an opaque image. */
export const lab = (img: { data: Float32Array }, i: number) => linearToOklab(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
