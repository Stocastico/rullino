import { describe, expect, it } from 'vitest';
import { createRasterMask, maskImage, maskValue, resampleRaster, validateMask, type Mask } from './mask';

const W = 40;
const H = 20;
const at = (m: Mask, x: number, y: number, w = W, h = H) => maskValue(m, x, y, w, h);

describe('linear gradient mask', () => {
  const m: Mask = { kind: 'linear', from: [0.25, 0.5], to: [0.75, 0.5] };

  it('ramps from 0 at `from` to 1 at `to`, constant outside', () => {
    expect(at(m, 0, 10)).toBe(0);
    expect(at(m, 39, 10)).toBe(1);
    expect(at({ kind: 'linear', from: [0, 0.5], to: [1, 0.5] }, 19.5, 3)).toBeCloseTo(0.5, 6); // halfway (pixel centre 20)
    for (let x = 1; x < W; x++) expect(at(m, x, 10)).toBeGreaterThanOrEqual(at(m, x - 1, 10));
  });

  it('is constant along lines perpendicular to it, measured in pixels (not stretched by the aspect ratio)', () => {
    // 45° in pixel space on a 2:1 image: from (10, 5) px towards (20, 15) px.
    const d: Mask = { kind: 'linear', from: [10 / W, 5 / H], to: [20 / W, 15 / H] };
    // (15, 10) is the midpoint; (19, 6) is on the perpendicular through it.
    expect(at(d, 14.5, 9.5)).toBeCloseTo(at(d, 18.5, 5.5), 6);
  });
});

describe('radial gradient mask', () => {
  const m: Mask = { kind: 'radial', center: [0.5, 0.5], radius: [0.25, 0.25], feather: 0.5 };

  it('is 1 at the centre, 0 outside the radius, smooth in the feather band', () => {
    expect(at(m, 19.5, 9.5)).toBe(1);
    expect(at(m, 0, 0)).toBe(0);
    // Radius 0.25 of the longer side = 10 px; feather 0.5 -> fades between 5 and 10 px.
    expect(at(m, 19.5 + 4, 9.5)).toBe(1);
    expect(at(m, 19.5 + 7.5, 9.5)).toBeCloseTo(0.5, 6);
    expect(at(m, 19.5 + 10.5, 9.5)).toBe(0);
  });

  it('supports ellipses', () => {
    const e: Mask = { kind: 'radial', center: [0.5, 0.5], radius: [0.4, 0.1], feather: 0.1 };
    expect(at(e, 19.5 + 12, 9.5)).toBe(1);
    expect(at(e, 19.5, 9.5 + 6)).toBe(0);
  });
});

describe('raster mask', () => {
  const r = createRasterMask(4, 2, new Float32Array([0, 0.25, 0.5, 1, 1, 1, 0, 0]));

  it('reads pixel centres exactly at its own resolution', () => {
    const m: Mask = { kind: 'raster', raster: r };
    expect([0, 1, 2, 3].map((x) => at(m, x, 0, 4, 2))).toEqual([0, 0.25, 0.5, 1]);
    expect([0, 1, 2, 3].map((x) => at(m, x, 1, 4, 2))).toEqual([1, 1, 0, 0]);
  });

  it('interpolates bilinearly when the image is larger, clamping at the edges', () => {
    const m: Mask = { kind: 'raster', raster: r };
    // 8x4 image: pixel (3, 0) has centre u = 3.5 / 8 -> raster x = 1.25, y clamps to row 0.
    expect(at(m, 3, 0, 8, 4)).toBeCloseTo(0.25 + 0.25 * 0.25, 6);
    expect(at(m, 0, 0, 8, 4)).toBe(0);
    expect(at(m, 7, 3, 8, 4)).toBe(0);
  });
});

describe('common mask options', () => {
  it('inverts and scales by opacity', () => {
    const base: Mask = { kind: 'linear', from: [0, 0.5], to: [1, 0.5] };
    expect(at({ ...base, invert: true }, 0, 0)).toBeCloseTo(1 - at(base, 0, 0), 6);
    expect(at({ ...base, opacity: 0.5 }, 39, 0)).toBeCloseTo(0.5 * at(base, 39, 0), 6);
    expect(at({ ...base, invert: true, opacity: 0.5 }, 39, 0)).toBeCloseTo(0.5 * (1 - at(base, 39, 0)), 6);
  });

  it('rejects malformed masks', () => {
    expect(() => validateMask({ kind: 'linear', from: [0, 0], to: [0, 0] })).toThrow(/distinct/);
    expect(() => validateMask({ kind: 'radial', center: [0.5, 0.5], radius: [0, 0.1], feather: 0.5 })).toThrow(/radius/);
    expect(() => validateMask({ kind: 'radial', center: [0.5, 0.5], radius: [0.1, 0.1], feather: 2 })).toThrow(/feather/);
    expect(() => validateMask({ kind: 'linear', from: [0, NaN], to: [1, 0], opacity: 0.5 })).toThrow(/finite/);
    expect(() => validateMask({ kind: 'linear', from: [0, 0], to: [1, 0], opacity: 1.5 })).toThrow(/opacity/);
    expect(() => createRasterMask(2, 2, new Float32Array(3))).toThrow(/4/);
    expect(() => validateMask({ kind: 'blob' } as never)).toThrow(/kind/);
  });
});

describe('resampleRaster', () => {
  it('resamples to a new size with the mask sampler, so the mask means the same', () => {
    const r = createRasterMask(4, 2, new Float32Array([0, 0.25, 0.5, 1, 1, 1, 0, 0]));
    const big = resampleRaster(r, 8, 3);
    expect([big.width, big.height]).toEqual([8, 3]);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 8; x++) expect(big.data[y * 8 + x]).toBeCloseTo(maskValue({ kind: 'raster', raster: r }, x, y, 8, 3), 6);
    expect(resampleRaster(r, 4, 2)).toBe(r);
  });
});

describe('maskImage', () => {
  it('evaluates the mask at every pixel centre', () => {
    const m: Mask = { kind: 'radial', center: [0.3, 0.6], radius: [0.4, 0.2], feather: 0.5, invert: true, opacity: 0.7 };
    const img = maskImage(m, 9, 5);
    expect(img).toHaveLength(45);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) expect(img[y * 9 + x]).toBeCloseTo(maskValue(m, x, y, 9, 5), 6);
  });
});
