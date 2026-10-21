import type { Tolerance } from '@rullino/core';

/** OKLab lightness of 18% linear grey: the pivot for contrast. */
export const MID_GREY_L = Math.cbrt(0.18);

/** Tolerance for filters that round-trip through OKLab (cbrt / cube in f32 vs f64). */
export const OKLAB_TOLERANCE: Tolerance = { abs: 2e-4, rel: 2e-3 };
