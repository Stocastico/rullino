// Output colour spaces (RFC #181): sRGB, Display P3, Adobe RGB (1998) and Rec. 2020, each its
// primaries (D65 white) and transfer function; conversion from rullino's working space (extended
// linear sRGB) and the CSS Color 4 gamut mapping in OKLCh for colours a space cannot hold.

import { linearToSrgb, srgbToLinear } from './color';
import type { Mat3 } from './geometry';
import { inv3, mul3, rgbToXyzD50, SRGB_PRIMARIES, writeIcc, type IccCurve, type Primaries } from './icc';
import { linearToOklab, oklabToLinear } from './oklab';

export const COLOR_SPACES = ['srgb', 'display-p3', 'adobe-rgb', 'rec2020'] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];
/** What happens to colours outside the output space: per-channel clipping, or the CSS Color 4 mapping in OKLCh. */
export type GamutMapping = 'clip' | 'map';

const D65 = [0.3127, 0.329] as const;
export const PRIMARIES: Record<ColorSpace, Primaries> = {
  srgb: SRGB_PRIMARIES,
  'display-p3': { red: [0.68, 0.32], green: [0.265, 0.69], blue: [0.15, 0.06], white: D65 },
  'adobe-rgb': { red: [0.64, 0.33], green: [0.21, 0.71], blue: [0.15, 0.06], white: D65 },
  rec2020: { red: [0.708, 0.292], green: [0.17, 0.797], blue: [0.131, 0.046], white: D65 },
};

const SRGB_TO_XYZ = rgbToXyzD50(SRGB_PRIMARIES);
const TO: Record<ColorSpace, Mat3> = Object.fromEntries(COLOR_SPACES.map((s) => [s, mul3(inv3(rgbToXyzD50(PRIMARIES[s])), SRGB_TO_XYZ)])) as Record<ColorSpace, Mat3>;
const FROM: Record<ColorSpace, Mat3> = Object.fromEntries(COLOR_SPACES.map((s) => [s, inv3(TO[s])])) as Record<ColorSpace, Mat3>;

/** Linear sRGB → this space's linear RGB (`'srgb'` is the identity, not a matrix product). */
export function fromLinearSrgb(space: ColorSpace, v: readonly number[]): number[] {
  if (space === 'srgb') return [v[0]!, v[1]!, v[2]!];
  const m = TO[space];
  return [m[0] * v[0]! + m[1] * v[1]! + m[2] * v[2]!, m[3] * v[0]! + m[4] * v[1]! + m[5] * v[2]!, m[6] * v[0]! + m[7] * v[1]! + m[8] * v[2]!];
}

/** This space's linear RGB → linear sRGB. */
export function toLinearSrgb(space: ColorSpace, v: readonly number[]): number[] {
  if (space === 'srgb') return [v[0]!, v[1]!, v[2]!];
  const m = FROM[space];
  return [m[0] * v[0]! + m[1] * v[1]! + m[2] * v[2]!, m[3] * v[0]! + m[4] * v[1]! + m[5] * v[2]!, m[6] * v[0]! + m[7] * v[1]! + m[8] * v[2]!];
}

/** The matrix of {@link fromLinearSrgb} (row-major). */
export const linearSrgbTo = (space: ColorSpace): Mat3 => TO[space];

const ADOBE = 563 / 256;
const ALPHA = 1.09929682680944;
const BETA = 0.018053968510807;

/** A space's transfer function, linear → encoded (mirrored for negatives, like the sRGB curve). */
export function encodeTransfer(space: ColorSpace, v: number): number {
  if (space === 'srgb' || space === 'display-p3') return linearToSrgb(v);
  const a = Math.abs(v);
  const e = space === 'adobe-rgb' ? a ** (1 / ADOBE) : a < BETA ? 4.5 * a : ALPHA * a ** 0.45 - (ALPHA - 1);
  return Math.sign(v) * e;
}

/** Inverse of {@link encodeTransfer}. */
export function decodeTransfer(space: ColorSpace, v: number): number {
  if (space === 'srgb' || space === 'display-p3') return srgbToLinear(v);
  const a = Math.abs(v);
  const l = space === 'adobe-rgb' ? a ** ADOBE : a < 4.5 * BETA ? a / 4.5 : ((a + ALPHA - 1) / ALPHA) ** (1 / 0.45);
  return Math.sign(v) * l;
}

export const inGamut = (v: readonly number[]) => v[0]! >= 0 && v[0]! <= 1 && v[1]! >= 0 && v[1]! <= 1 && v[2]! >= 0 && v[2]! <= 1;
const clip = (v: readonly number[]) => v.map((x) => Math.min(1, Math.max(0, x)));
const deltaEOK = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

const JND = 0.02;
const EPSILON = 0.0001;

/**
 * The CSS Color 4 gamut mapping (binary search on OKLCh chroma at constant lightness and hue, with
 * the local MINDE test: JND 0.02, ε 0.0001) of an OKLab colour into a space; returns that space's
 * linear RGB, in [0, 1]. L ≥ 1 is white and L ≤ 0 black.
 */
export function gamutMapOklab(space: ColorSpace, lab: readonly number[]): number[] {
  const [L, a, b] = lab as [number, number, number];
  if (L >= 1) return [1, 1, 1];
  if (L <= 0) return [0, 0, 0];
  const dest = (l: number, aa: number, bb: number) => fromLinearSrgb(space, oklabToLinear(l, aa, bb));
  const labOf = (rgb: readonly number[]) => {
    const s = toLinearSrgb(space, rgb);
    return linearToOklab(s[0]!, s[1]!, s[2]!);
  };
  const origin = dest(L, a, b);
  if (inGamut(origin)) return origin;
  let clipped = clip(origin);
  if (deltaEOK(labOf(clipped), lab) < JND) return clipped;
  const C = Math.hypot(a, b);
  const ca = a / C;
  const cb = b / C;
  let min = 0;
  let max = C;
  let minInGamut = true;
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2;
    const current = [L, chroma * ca, chroma * cb];
    const d = dest(L, current[1]!, current[2]!);
    if (minInGamut && inGamut(d)) {
      min = chroma;
      continue;
    }
    clipped = clip(d);
    const E = deltaEOK(labOf(clipped), current);
    if (E < JND) {
      if (JND - E < EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else max = chroma;
  }
  return clipped;
}

/**
 * Straight linear sRGB (one pixel, possibly outside sRGB) → the space's encoded values in [0, 1]:
 * converted, brought into the gamut (`'map'` or `'clip'`), encoded with the space's transfer.
 */
export function encodeColour(space: ColorSpace, gamut: GamutMapping, rgb: readonly number[]): number[] {
  let d = fromLinearSrgb(space, rgb);
  if (!inGamut(d)) d = gamut === 'map' ? gamutMapOklab(space, linearToOklab(rgb[0]!, rgb[1]!, rgb[2]!)) : clip(d);
  return d.map((v) => encodeTransfer(space, v));
}

const NAMES: Record<ColorSpace, string> = { srgb: 'sRGB (rullino)', 'display-p3': 'Display P3 (rullino)', 'adobe-rgb': 'Adobe RGB (1998) compatible (rullino)', rec2020: 'Rec. 2020 (rullino)' };
const SRGB_PARA = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
const CURVES: Record<ColorSpace, Extract<IccCurve, { type: 'para' }>> = {
  srgb: { type: 'para', kind: 3, params: SRGB_PARA },
  'display-p3': { type: 'para', kind: 3, params: SRGB_PARA },
  'adobe-rgb': { type: 'para', kind: 0, params: [ADOBE] },
  rec2020: { type: 'para', kind: 3, params: [1 / 0.45, 1 / ALPHA, (ALPHA - 1) / ALPHA, 1 / 4.5, 4.5 * BETA] },
};
const profiles = new Map<ColorSpace, Uint8Array>();

/** The ICC profile (v4.3 matrix/TRC, under 600 bytes) that describes samples written in a space. A fresh copy each call. */
export function outputProfile(space: ColorSpace): Uint8Array {
  if (!profiles.has(space)) profiles.set(space, writeIcc(PRIMARIES[space], CURVES[space], NAMES[space]));
  return profiles.get(space)!.slice();
}
