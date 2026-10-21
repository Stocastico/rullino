// Tone curves: monotone cubic interpolation (Fritsch-Carlson) through control points, sampled
// into a 256-entry LUT. CPU and GPU both read the same LUT with linear interpolation, and
// extrapolate linearly outside [0, 1] so an identity curve leaves HDR values alone.

export type CurvePoints = readonly (readonly [number, number])[];

export const CURVE_SAMPLES = 256;

/** Monotone cubic interpolant through the points (x strictly increasing); flat beyond the ends. */
function monotone(points: CurvePoints): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = Array.from({ length: n - 1 }, (_, k) => (ys[k + 1]! - ys[k]!) / (xs[k + 1]! - xs[k]!));
  const m = Array.from({ length: n }, (_, k) =>
    k === 0 ? d[0]! : k === n - 1 ? d[n - 2]! : d[k - 1]! * d[k]! <= 0 ? 0 : (d[k - 1]! + d[k]!) / 2,
  );
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k]! / d[k]!;
    const b = m[k + 1]! / d[k]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k]!;
      m[k + 1] = t * b * d[k]!;
    }
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let k = 0;
    while (x > xs[k + 1]!) k++;
    const h = xs[k + 1]! - xs[k]!;
    const t = (x - xs[k]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k]! + (t3 - 2 * t2 + t) * h * m[k]! + (-2 * t3 + 3 * t2) * ys[k + 1]! + (t3 - t2) * h * m[k + 1]!;
  };
}

/** The curve sampled at i / 255, as f32 (exactly what the GPU receives). */
export function curveLut(points: CurvePoints): Float32Array {
  const f = monotone(points);
  return Float32Array.from({ length: CURVE_SAMPLES }, (_, i) => f(i / (CURVE_SAMPLES - 1)));
}

/** Linear interpolation in the LUT, linear extrapolation outside [0, 1]. Mirrors the WGSL sampler. */
export function sampleCurveLut(lut: Float32Array, x: number): number {
  const last = CURVE_SAMPLES - 1;
  if (x > 1) return lut[last]! + (x - 1) * (lut[last]! - lut[last - 1]!) * last;
  if (x < 0) return lut[0]! + x * (lut[1]! - lut[0]!) * last;
  const t = x * last;
  const i = Math.min(Math.floor(t), last - 1);
  const f = t - i;
  return lut[i]! + (lut[i + 1]! - lut[i]!) * f;
}

const luts = new WeakMap<object, Float32Array>();

/** sampleCurveLut with the LUT cached per points array (resolved params are reused within a run). */
export function sampleCurve(points: CurvePoints, x: number): number {
  let lut = luts.get(points);
  if (!lut) luts.set(points, (lut = curveLut(points)));
  return sampleCurveLut(lut, x);
}

/** WGSL twin of sampleCurveLut for one curve param, reading the LUT through `access`. */
export function curveSamplerWgsl(fnName: string, access: string): string {
  const last = CURVE_SAMPLES - 1;
  const at = (i: string) => `${access}[(${i}) / 4u][(${i}) % 4u]`;
  return /* wgsl */ `fn ${fnName}(x: f32) -> f32 {
  if (x > 1.0) { return ${at(`${last}u`)} + (x - 1.0) * (${at(`${last}u`)} - ${at(`${last - 1}u`)}) * ${last}.0; }
  if (x < 0.0) { return ${at('0u')} + x * (${at('1u')} - ${at('0u')}) * ${last}.0; }
  let t = x * ${last}.0;
  let i = min(u32(floor(t)), ${last - 1}u);
  let f = t - f32(i);
  return mix(${at('i')}, ${at('i + 1u')}, f);
}`;
}
