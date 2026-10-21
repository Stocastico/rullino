import { describe, expect, it } from 'vitest';
import { decodeSrgb8, encodeSrgb8, linearToSrgb, srgbToLinear } from './color';

describe('sRGB transfer function', () => {
  it('maps the endpoints to themselves', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('matches known reference values', () => {
    // sRGB 0.5 is ~21.4% linear light; 18% grey is ~0.4613 encoded.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.461356, 6);
  });

  it('uses the linear segment near black', () => {
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
    expect(linearToSrgb(0.002)).toBeCloseTo(0.002 * 12.92, 12);
  });

  it('round-trips', () => {
    for (let i = 0; i <= 100; i++) {
      const v = i / 100;
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
    }
  });

  it('extends to values above 1 (HDR headroom after exposure)', () => {
    expect(linearToSrgb(srgbToLinear(1.5))).toBeCloseTo(1.5, 10);
  });
});

describe('8-bit sRGB <-> linear premultiplied image', () => {
  it('decodes to linear, premultiplied floats', () => {
    const img = decodeSrgb8(new Uint8ClampedArray([255, 128, 0, 255, 255, 255, 255, 51]), 2, 1);
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(img.data[0]).toBeCloseTo(1, 6);
    expect(img.data[1]).toBeCloseTo(srgbToLinear(128 / 255), 6);
    expect(img.data[2]).toBe(0);
    expect(img.data[3]).toBe(1);
    // Second pixel: white at alpha 0.2 -> premultiplied rgb = 0.2.
    expect(img.data[4]).toBeCloseTo(0.2, 6);
    expect(img.data[7]).toBeCloseTo(0.2, 6);
  });

  it('round-trips every 8-bit value exactly', () => {
    const src = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) src.set([i, 255 - i, i, 255], i * 4);
    expect(encodeSrgb8(decodeSrgb8(src, 256, 1))).toEqual(src);
  });

  it('round-trips colour under partial alpha', () => {
    const src = new Uint8ClampedArray([200, 100, 50, 128]);
    const out = encodeSrgb8(decodeSrgb8(src, 1, 1));
    expect(Array.from(out)).toEqual([200, 100, 50, 128]);
  });

  it('encodes fully transparent pixels as zero', () => {
    const out = encodeSrgb8({ width: 1, height: 1, data: new Float32Array([0, 0, 0, 0]) });
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('rejects a buffer whose size does not match the dimensions', () => {
    expect(() => decodeSrgb8(new Uint8ClampedArray(12), 2, 2)).toThrow(RangeError);
  });
});
