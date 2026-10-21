import { describe, expect, it } from 'vitest';
import { linearToOklab, luminance, oklabToLinear } from './oklab';

describe('OKLab', () => {
  it('matches reference values (Ottosson)', () => {
    const [L, a, b] = linearToOklab(1, 0, 0);
    expect(L).toBeCloseTo(0.627955, 5);
    expect(a).toBeCloseTo(0.224863, 5);
    expect(b).toBeCloseTo(0.125846, 5);
  });

  it('maps neutrals to zero chroma with L = cbrt(Y)', () => {
    for (const y of [0, 0.18, 1, 4]) {
      const [L, a, b] = linearToOklab(y, y, y);
      expect(L).toBeCloseTo(Math.cbrt(y), 5);
      expect(Math.abs(a)).toBeLessThan(1e-4);
      expect(Math.abs(b)).toBeLessThan(1e-4);
    }
  });

  it('round-trips, including out-of-gamut and negative components', () => {
    for (const c of [[0.2, 0.5, 0.9], [1.5, 0.1, 0], [-0.05, 0.3, 0.2]]) {
      const back = oklabToLinear(...linearToOklab(c[0]!, c[1]!, c[2]!));
      c.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 5));
    }
  });
});

describe('luminance', () => {
  it('uses Rec. 709 / sRGB weights on linear values', () => {
    expect(luminance(1, 1, 1)).toBeCloseTo(1, 6);
    expect(luminance(0, 1, 0)).toBeCloseTo(0.7152, 6);
  });
});
