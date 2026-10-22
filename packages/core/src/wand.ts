import type { LinearImage } from './image';
import { createRasterMask, type RasterMaskData, type Vec2 } from './mask';
import { linearToOklab } from './oklab';

export interface WandOptions {
  /** Maximum distance from the seed colour: OKLab ΔE combined with the alpha difference. */
  readonly tolerance: number;
  /** Only the region connected to the seed (4-neighbours). Default true. */
  readonly contiguous?: boolean;
  /** Fraction of the tolerance over which the selection fades out, in [0, 1]. Default 0 (hard). */
  readonly softness?: number;
  /** Combine with this mask (same size as the image) instead of starting from an empty one. */
  readonly into?: RasterMaskData;
  /** Remove the selection from `into` instead of adding it (coverage minus selection). */
  readonly subtract?: boolean;
}

/**
 * Selects pixels similar to the one at `seed` (normalised coordinates), like a magic wand. Runs on
 * the CPU: a flood fill is linear in the pixel count, while GPU propagation needs as many passes
 * as the longest path through the region. Meant for images at mask resolution (≈1 MP).
 */
export function magicWand(img: LinearImage, seed: Vec2, options: WandOptions): RasterMaskData {
  const { width: w, height: h, data } = img;
  if (options.into && (options.into.width !== w || options.into.height !== h)) {
    throw new RangeError(`magicWand: mask is ${options.into.width}x${options.into.height}, image is ${w}x${h}`);
  }
  // Straight colour in OKLab plus alpha, per pixel.
  const lab = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]!;
    const [L, A, B] = a > 0 ? linearToOklab(data[i * 4]! / a, data[i * 4 + 1]! / a, data[i * 4 + 2]! / a) : [0, 0, 0];
    lab.set([L, A, B, a], i * 4);
  }
  const sx = Math.min(w - 1, Math.max(0, Math.floor(seed[0] * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(seed[1] * h)));
  const s = (sy * w + sx) * 4;
  const tol = options.tolerance;
  const inner = tol * (1 - Math.min(1, Math.max(0, options.softness ?? 0)));
  const value = (i: number) => {
    const d = Math.hypot(lab[i * 4]! - lab[s]!, lab[i * 4 + 1]! - lab[s + 1]!, lab[i * 4 + 2]! - lab[s + 2]!, lab[i * 4 + 3]! - lab[s + 3]!);
    // Exact matches first: at tolerance 0 the seed colour itself is still selected.
    if (d <= inner) return 1;
    if (d >= tol) return 0;
    const t = (d - inner) / (tol - inner);
    return 1 - t * t * (3 - 2 * t);
  };

  const selection = new Float32Array(w * h);
  if (options.contiguous ?? true) {
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const start = sy * w + sx;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const i = queue[head++]!;
      const v = value(i);
      if (v <= 0) continue;
      selection[i] = v;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || visited[j]) continue;
        visited[j] = 1;
        queue[tail++] = j;
      }
    }
  } else {
    for (let i = 0; i < w * h; i++) selection[i] = value(i);
  }

  const out = options.into ? options.into.data.slice() : new Float32Array(w * h);
  // Subtracting removes exactly the coverage the same selection would add, so add + subtract of
  // one click is a no-op even on soft edges (min(m, 1 - v) would leave them half selected).
  for (let i = 0; i < w * h; i++) out[i] = options.subtract ? Math.max(0, out[i]! - selection[i]!) : Math.max(out[i]!, selection[i]!);
  return createRasterMask(w, h, out);
}
