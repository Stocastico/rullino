// "Compare two renders": two 8-bit images (the browser's preview and the server's file, two library
// versions, two machines) compared channel by channel, alpha included, against a tolerance in 8-bit
// levels, with a map of where they differ. 8-bit is what people look at and what files hold; rullino's
// own parity tests compare linear floats (see docs/parity.md).

export interface Rgba8 {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface DiffOptions {
  /** Largest difference that still counts as equal, in 8-bit levels (0–255). */
  readonly levels: number;
  /** Fraction of pixels allowed beyond it (default 0). */
  readonly allowed?: number;
}

export interface Diff {
  /** Whether no more pixels than allowed differ by more than `levels` in some channel. */
  readonly agree: boolean;
  /** Largest difference in any channel, and where. */
  readonly max: number;
  readonly at: { readonly x: number; readonly y: number; readonly channel: number } | undefined;
  /** Mean absolute difference over all channels. */
  readonly mean: number;
  /** Pixels with any difference, and with one beyond `levels`. */
  readonly differing: number;
  readonly over: number;
  readonly pixels: number;
  /** RGBA: the first image faded to grey where the pixels are equal, blue within the tolerance, red beyond. */
  readonly map: Uint8ClampedArray;
}

/** Map colours: beyond the tolerance (the within-tolerance blue fades in with the difference). */
export const MAP = { over: [255, 40, 40, 255] } as const;

export function diffImages(a: Rgba8, b: Rgba8, o: DiffOptions): Diff {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError(`the images are ${a.width}×${a.height} and ${b.width}×${b.height}: a comparison needs one size`);
  const pixels = a.width * a.height;
  const map = new Uint8ClampedArray(pixels * 4);
  let max = 0;
  let at: Diff['at'];
  let sum = 0;
  let differing = 0;
  let over = 0;
  for (let p = 0; p < pixels; p++) {
    let worst = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[p * 4 + c]! - b.data[p * 4 + c]!);
      sum += d;
      if (d > worst) worst = d;
      if (d > max) {
        max = d;
        at = { x: p % a.width, y: Math.floor(p / a.width), channel: c };
      }
    }
    const i = p * 4;
    if (worst > o.levels) {
      over++;
      map.set(MAP.over, i);
    } else {
      const grey = Math.round(0.25 * (0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!)) + 40;
      const blue = worst > 0 ? Math.min(255, 120 + (135 * worst) / Math.max(1, o.levels)) : grey;
      map.set([grey, grey, blue, 255], i);
    }
    if (worst > 0) differing++;
  }
  return { agree: over <= Math.floor((o.allowed ?? 0) * pixels), max, at, mean: sum / (pixels * 4), differing, over, pixels, map };
}
