import { linearToSrgb } from './color';
import type { LinearImage } from './image';
import { createRasterMask, type RasterMaskData } from './mask';
import { luminance } from './oklab';

export interface RefineOptions {
  /** Window radius in units of the longer side, like mask radii. */
  readonly radius: number;
  /** Regularisation: small values follow guide edges closely, large ones approach a plain blur. */
  readonly epsilon: number;
}

/** Mean over a (2r + 1)² window clamped to the image (fewer samples at the borders), via an integral image. */
function boxMean(src: Float64Array, w: number, h: number, r: number): Float64Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]!;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sat[y1 * (w + 1) + x1]! - sat[y0 * (w + 1) + x1]! - sat[y1 * (w + 1) + x0]! + sat[y0 * (w + 1) + x0]!;
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Guided filter (He, Sun & Tang) of a mask with the image's perceptual luminance as guide: the
 * mask's edges move to nearby edges in the image, flat regions are smoothed. CPU, linear in the
 * pixel count (integral images); meant for masks at mask resolution, with a guide of the same size.
 */
export function refineMask(mask: RasterMaskData, guide: LinearImage, options: RefineOptions): RasterMaskData {
  const { width: w, height: h } = mask;
  if (guide.width !== w || guide.height !== h) throw new RangeError(`refineMask: guide is ${guide.width}x${guide.height}, mask is ${w}x${h}`);
  const r = Math.max(1, Math.round(options.radius * Math.max(w, h)));
  const n = w * h;
  const I = new Float64Array(n);
  const p = Float64Array.from(mask.data);
  for (let i = 0; i < n; i++) {
    const a = guide.data[i * 4 + 3]!;
    // Luminance of the straight colour, sRGB-encoded so edges are weighted as they look.
    I[i] = a > 0 ? linearToSrgb(luminance(guide.data[i * 4]! / a, guide.data[i * 4 + 1]! / a, guide.data[i * 4 + 2]! / a)) * a : 0;
  }
  const mul = (x: Float64Array, y: Float64Array) => x.map((v, i) => v * y[i]!);
  const meanI = boxMean(I, w, h, r);
  const meanP = boxMean(p, w, h, r);
  const corrII = boxMean(mul(I, I), w, h, r);
  const corrIP = boxMean(mul(I, p), w, h, r);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrII[i]! - meanI[i]! ** 2;
    a[i] = (corrIP[i]! - meanI[i]! * meanP[i]!) / (varI + options.epsilon);
    b[i] = meanP[i]! - a[i]! * meanI[i]!;
  }
  const meanA = boxMean(a, w, h, r);
  const meanB = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, meanA[i]! * I[i]! + meanB[i]!));
  return createRasterMask(w, h, out);
}
