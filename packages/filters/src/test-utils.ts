import { createImage, fromFloat16Array, linearToOklab, lutFromFunction, oklabToLinear, toFloat16Array, type Mask, type ParamSchema, type PointwiseFilter, type Rgba } from '@rullino/core';

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

// Shared by the parity tests (GPU <-> CPU, fast <-> reference): images, param cases, mask.

function testImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = i % 52 === 0 ? 0 : 0.2 + 0.8 * rand(); // some fully transparent pixels
    data[i] = rand() * a;
    data[i + 1] = rand() * a;
    data[i + 2] = rand() * 1.5 * a; // some HDR headroom
    data[i + 3] = a;
  }
  // Quantise up front so CPU and GPU see exactly the same input.
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

export function parityCases(schema: ParamSchema): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = [['defaults', {}]];
  for (const [k, p] of Object.entries(schema)) {
    if (p.type === 'float' || p.type === 'int') out.push([`${k}=${p.min}`, { [k]: p.min }], [`${k}=${p.max}`, { [k]: p.max }]);
    if (p.type === 'bool') out.push([`${k}=${!p.default}`, { [k]: !p.default }]);
    if (p.type === 'enum') for (const o of Object.keys(p.options)) if (o !== p.default) out.push([`${k}=${o}`, { [k]: o }]);
    if (p.type === 'curve') {
      // A strong S-curve: steep in the middle, flat near the ends, so LUT indexing errors show.
      out.push([`${k}=S`, { [k]: [[0, 0], [0.3, 0.08], [0.6, 0.85], [1, 1]] }]);
    }
    if (p.type === 'lut') {
      // Non-separable and non-linear, on a grid that does not divide the test values evenly.
      out.push([`${k}=look`, { [k]: lutFromFunction(17, (r, g, b) => [g * g, 0.2 + 0.6 * Math.sqrt(b), Math.abs(r - b)]) }]);
    }
    if (p.type === 'image') {
      // Another size than the input, partial alpha (premultiplied) and a gradient: stretching,
      // interpolation and the "over" blend all show.
      const img = createImage(5, 3);
      for (let i = 0; i < 15; i++) {
        const a = 0.2 + 0.2 * (i % 5);
        img.data.set([(i / 15) * a, 0.5 * a, (1 - i / 15) * a, a], i * 4);
      }
      out.push([`${k}=img`, { [k]: img }]);
    }
    if (p.type === 'color') {
      // Saturated primaries plus a dark, desaturated colour: hue and lightness handling both show.
      out.push([`${k}=red`, { [k]: [1, 0, 0] }], [`${k}=blue`, { [k]: [0, 0.2, 1] }], [`${k}=dark`, { [k]: [0.2, 0.15, 0.1] }]);
    }
    if (p.type === 'kernel') {
      // A non-symmetric kernel catches transposed or mirrored indexing.
      const n = p.size * p.size;
      out.push([`${k}=ramp`, { [k]: Array.from({ length: n }, (_, i) => (i % 3) - 1 + (i === (n - 1) / 2 ? 2 : 0) + i / n) }]);
    }
  }
  return out;
}

/**
 * Concentric rings whose contrast fades from left to right: strong edges that continue as weak
 * ones, smooth gradients in every direction. Random noise alone never exercises things like
 * hysteresis or gradient directions properly.
 */
function structuredImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - w * 0.45, y - h * 0.55);
      const fade = 1 - 0.85 * (x / (w - 1));
      const v = 0.5 + 0.5 * fade * Math.sin(r * 0.7);
      const i = (y * w + x) * 4;
      data.set([v * v, v * 0.9, v * (1 - 0.3 * (y / h)), 1], i);
    }
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

// Mask-aware filters (inpainting) get a feathered hole, off-centre, on both sides.
export const parityMask: Mask = { kind: 'radial', center: [0.45, 0.55], radius: [0.2, 0.15], feather: 0.4 };

// Non-multiple-of-8 sizes exercise the workgroup bounds check.
export const parityImages = { noise: testImage(67, 45), rings: structuredImage(71, 53) };

/**
 * Special values the random images never hit: exact greys (zero chroma), black, white, primaries,
 * HDR, and the same colours at partial alpha (premultiplied), on a 13 x 7 grid.
 */
export function specialImage() {
  const colours = [[0, 0, 0], [1, 1, 1], [0.18, 0.18, 0.18], [0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 0.5, 0.1], [0.001, 0.001, 0.001]];
  const img = createImage(13, 7);
  for (let i = 0; i < 13 * 7; i++) {
    const [r, g, b] = colours[i % colours.length]!;
    const a = [1, 0.5, 0.25][Math.floor(i / colours.length) % 3]!;
    img.data.set([r! * a, g! * a, b! * a, a], i * 4);
  }
  return img;
}
