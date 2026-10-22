import { describe, expect, it } from 'vitest';
import { histogramSrgb8 } from './histogram';

describe('histogramSrgb8', () => {
  it('counts each channel and the luminance of straight sRGB bytes, skipping transparent pixels', () => {
    const bytes = new Uint8ClampedArray([
      255, 0, 0, 255, // red
      0, 255, 0, 128, // green, half transparent (counted)
      10, 20, 30, 0, // transparent: skipped
      100, 100, 100, 255, // grey
    ]);
    const h = histogramSrgb8(bytes);
    expect(h.count).toBe(3);
    for (const ch of [h.red, h.green, h.blue, h.luma]) expect(ch.reduce((a, b) => a + b, 0)).toBe(3);
    expect([h.red[255], h.red[0], h.red[100]]).toEqual([1, 1, 1]);
    expect([h.green[255], h.green[0], h.green[100]]).toEqual([1, 1, 1]);
    expect(h.blue[0]).toBe(2);
    // Rec. 709 weights on the encoded values: red 54, green 182, grey 100.
    expect([h.luma[54], h.luma[182], h.luma[100]]).toEqual([1, 1, 1]);
  });

  it('rejects data that is not RGBA', () => {
    expect(() => histogramSrgb8(new Uint8ClampedArray(6))).toThrow(/multiple of 4/);
  });
});
