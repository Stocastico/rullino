import { describe, expect, it } from 'vitest';
import { float16ToFloat32, float32ToFloat16, fromFloat16Array, toFloat16Array } from './half';

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

// The array functions are the fast paths (tables, no per-element calls); the scalar functions are
// the specification they must match bit for bit.
describe('array conversion matches the scalar functions', () => {
  it('fromFloat16Array: every one of the 65 536 halves', () => {
    const all = new Uint16Array(65536).map((_, i) => i);
    const out = fromFloat16Array(all);
    for (let h = 0; h < 65536; h++) {
      if (!Object.is(out[h], Math.fround(float16ToFloat32(h)))) throw new Error(`half 0x${h.toString(16)}: ${out[h]} vs ${float16ToFloat32(h)}`);
    }
  });

  it('toFloat16Array: rounding edges in every exponent, specials and random bit patterns', () => {
    const bits: number[] = [];
    // Around each half's rounding boundary: the exact halfway points (ties to even) and their
    // neighbours, for every float32 exponent (subnormal halves, normals, overflow), both signs.
    for (let exp = 0; exp < 256; exp++) {
      for (const mant of [0, 1, 0x7fffff, 0x0fff, 0x1000, 0x1001, 0x2fff, 0x3000, 0x3001, 0x400000, 0x401000, 0x7fe000, 0x7ff000]) {
        bits.push((exp << 23) | mant, (0x80000000 | (exp << 23) | mant) >>> 0);
      }
      // Subnormal halves round at other bit positions: halfway points for every shift.
      for (let shift = 1; shift < 24; shift++) {
        const half = 1 << (shift - 1);
        for (const m of [half - 1, half, half + 1, 3 * half, (1 << shift) | half]) bits.push((exp << 23) | (m & 0x7fffff));
      }
    }
    let seed = 12345;
    for (let i = 0; i < 2_000_000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bits.push(seed);
    }
    const src = new Float32Array(new Uint32Array(bits).buffer);
    const out = toFloat16Array(src);
    for (let i = 0; i < src.length; i++) {
      const expected = float32ToFloat16(src[i]!);
      if (out[i] !== expected) throw new Error(`0x${bits[i]!.toString(16)} (${src[i]}): 0x${out[i]!.toString(16)} vs 0x${expected.toString(16)}`);
    }
  });
});
