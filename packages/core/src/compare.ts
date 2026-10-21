import type { LinearImage } from './image';

export interface Tolerance {
  /** Absolute slack, in linear-light units. */
  readonly abs: number;
  /** Relative slack, as a fraction of |expected|. */
  readonly rel: number;
  /**
   * Fraction of channels allowed to exceed abs/rel (default 0). For filters with hard
   * decisions (thresholds, comparisons), where f16 intermediates can flip a few borderline pixels.
   */
  readonly outliers?: number;
}

export interface Mismatch {
  readonly x: number;
  readonly y: number;
  readonly channel: number;
  readonly actual: number;
  readonly expected: number;
}

export interface Comparison {
  readonly pass: boolean;
  /** The channel that exceeds its tolerance by the most, if any. */
  readonly worst: Mismatch | undefined;
  /** How many channels exceeded the tolerance. */
  readonly outliers: number;
}

/** Per-channel check: |actual - expected| <= abs + rel * |expected|. NaN never passes. */
export function compareImages(actual: LinearImage, expected: LinearImage, tol: Tolerance): Comparison {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new RangeError(
      `size mismatch: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`,
    );
  }
  let worst: Mismatch | undefined;
  let worstExcess = 0;
  let outliers = 0;
  let nan = false;
  for (let i = 0; i < actual.data.length; i++) {
    const a = actual.data[i]!;
    const e = expected.data[i]!;
    const excess = Math.abs(a - e) - (tol.abs + tol.rel * Math.abs(e));
    if (excess > 0 || Number.isNaN(excess)) outliers++;
    if (excess > worstExcess || Number.isNaN(excess)) {
      const px = i >> 2;
      worst = { x: px % actual.width, y: Math.floor(px / actual.width), channel: i & 3, actual: a, expected: e };
      if (Number.isNaN(excess)) {
        nan = true;
        break;
      }
      worstExcess = excess;
    }
  }
  const allowed = Math.floor((tol.outliers ?? 0) * actual.data.length);
  return { pass: !nan && outliers <= allowed, worst, outliers };
}
