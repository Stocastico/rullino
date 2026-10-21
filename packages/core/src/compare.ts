import type { LinearImage } from './image';

export interface Tolerance {
  /** Absolute slack, in linear-light units. */
  readonly abs: number;
  /** Relative slack, as a fraction of |expected|. */
  readonly rel: number;
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
  for (let i = 0; i < actual.data.length; i++) {
    const a = actual.data[i]!;
    const e = expected.data[i]!;
    const excess = Math.abs(a - e) - (tol.abs + tol.rel * Math.abs(e));
    if (excess > worstExcess || Number.isNaN(excess)) {
      const px = i >> 2;
      worst = { x: px % actual.width, y: Math.floor(px / actual.width), channel: i & 3, actual: a, expected: e };
      if (Number.isNaN(excess)) break;
      worstExcess = excess;
    }
  }
  return { pass: worst === undefined, worst };
}
