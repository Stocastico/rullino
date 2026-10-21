import { describe, expect, it } from 'vitest';
import { float16ToFloat32, float32ToFloat16 } from './half';

describe('float16 conversion', () => {
  it.each([
    [0, 0x0000],
    [1, 0x3c00],
    [-2, 0xc000],
    [0.5, 0x3800],
    [65504, 0x7bff], // largest finite half
    [2 ** -14, 0x0400], // smallest normal
    [2 ** -24, 0x0001], // smallest subnormal
  ])('encodes %d exactly', (f, h) => {
    expect(float32ToFloat16(f)).toBe(h);
    expect(float16ToFloat32(h)).toBe(f);
  });

  it('rounds to nearest even', () => {
    // 1 + 2^-11 is exactly halfway between 1 and the next half (1 + 2^-10).
    expect(float32ToFloat16(1 + 2 ** -11)).toBe(0x3c00);
    expect(float32ToFloat16(1 + 3 * 2 ** -11)).toBe(0x3c02);
  });

  it('overflows to infinity and keeps NaN', () => {
    expect(float32ToFloat16(1e6)).toBe(0x7c00);
    expect(float16ToFloat32(0x7c00)).toBe(Infinity);
    expect(Number.isNaN(float16ToFloat32(float32ToFloat16(NaN)))).toBe(true);
  });

  it('keeps relative error within half precision', () => {
    for (let v = 1e-3; v < 6e4; v *= 1.37) {
      const back = float16ToFloat32(float32ToFloat16(v));
      expect(Math.abs(back - v) / v).toBeLessThanOrEqual(2 ** -11);
    }
  });
});
