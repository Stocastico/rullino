import { describe, expect, it } from 'vitest';
import { CURVE_SAMPLES, curveLut, sampleCurve, sampleCurveLut } from './curve';

const identity = [[0, 0], [1, 1]] as const;
const sCurve = [[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]] as const;

describe('curves', () => {
  it('samples the identity exactly, including outside [0, 1] (linear extrapolation)', () => {
    const lut = curveLut(identity);
    expect(lut).toHaveLength(CURVE_SAMPLES);
    for (const x of [0, 0.1, 0.5, 0.99, 1]) expect(sampleCurveLut(lut, x)).toBeCloseTo(x, 6);
    expect(sampleCurveLut(lut, 1.5)).toBeCloseTo(1.5, 5);
    expect(sampleCurveLut(lut, -0.2)).toBeCloseTo(-0.2, 5);
  });

  it('passes through its control points', () => {
    for (const [x, y] of sCurve) expect(sampleCurve(sCurve, x)).toBeCloseTo(y, 3);
  });

  it('is monotone and does not overshoot (Fritsch-Carlson)', () => {
    const steep = [[0, 0], [0.45, 0.05], [0.55, 0.95], [1, 1]] as const;
    const lut = curveLut(steep);
    for (let i = 1; i < lut.length; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]! - 1e-7);
    expect(Math.min(...lut)).toBeGreaterThanOrEqual(-1e-7);
    expect(Math.max(...lut)).toBeLessThanOrEqual(1 + 1e-7);
  });

  it('is flat beyond the first and last points inside [0, 1]', () => {
    const c = [[0.2, 0.3], [0.8, 0.6]] as const;
    expect(sampleCurve(c, 0.05)).toBeCloseTo(0.3, 6);
    expect(sampleCurve(c, 0.95)).toBeCloseTo(0.6, 6);
  });
});
