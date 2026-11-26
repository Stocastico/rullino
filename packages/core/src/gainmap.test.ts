import { describe, expect, it } from 'vitest';
import { applyGainMap, gainMapWeight, makeGainMap, sdrFromHdr, type GainMapMetadata } from './gainmap';
import { createImage } from './image';

const meta = (over: Partial<GainMapMetadata> = {}): GainMapMetadata => ({
  gainMapMin: [0, 0, 0],
  gainMapMax: [2, 2, 2],
  gamma: [1, 1, 1],
  baseOffset: [0, 0, 0],
  alternateOffset: [0, 0, 0],
  baseHdrHeadroom: 0,
  alternateHdrHeadroom: 2,
  ...over,
});
const one = (rgb: number[], a = 1) => createImage(1, 1, Float32Array.of(rgb[0]! * a, rgb[1]! * a, rgb[2]! * a, a));
const map = (values: number[], width = values.length, channels: 1 | 3 | 4 = 1) => ({ data: Uint8Array.from(values), width, height: values.length / channels / width, channels });

describe('applyGainMap', () => {
  it('multiplies the SDR light by 2^(gain): the map value runs from the minimum to the maximum log gain', () => {
    expect(Array.from(applyGainMap(one([0.5, 0.25, 0.125]), map([255]), meta()).data)).toEqual([2, 1, 0.5, 1]); // 2^2 = 4× the SDR... of the gain, 0.5 · 4
    expect(Array.from(applyGainMap(one([0.5, 0.25, 0.125]), map([0]), meta()).data)).toEqual([0.5, 0.25, 0.125, 1]); // gain 2^0
    const half = applyGainMap(one([0.5, 0.5, 0.5]), map([255]), meta({ gainMapMin: [-1, -1, -1], gainMapMax: [3, 3, 3] }));
    expect(half.data[0]).toBeCloseTo(0.5 * 8, 5);
    const mid = applyGainMap(one([1, 1, 1]), map([128]), meta({ gainMapMin: [-1, -1, -1], gainMapMax: [3, 3, 3] }));
    expect(mid.data[0]).toBeCloseTo(2 ** (-1 + 4 * (128 / 255)), 5);
  });

  it('applies the gamma, the offsets and the weight', () => {
    const g = applyGainMap(one([0.5, 0.5, 0.5]), map([64]), meta({ gamma: [2, 2, 2] }));
    expect(g.data[0]).toBeCloseTo(0.5 * 2 ** (2 * Math.sqrt(64 / 255)), 5);
    const o = applyGainMap(one([0.25, 0.25, 0.25]), map([255]), meta({ baseOffset: [0.015625, 0.015625, 0.015625], alternateOffset: [0.03125, 0.03125, 0.03125] }));
    expect(o.data[0]).toBeCloseTo((0.25 + 0.015625) * 4 - 0.03125, 5);
    const w = applyGainMap(one([0.5, 0.5, 0.5]), map([255]), meta(), 0.5);
    expect(w.data[0]).toBeCloseTo(0.5 * 2, 5); // half the stops: 2^(2 · 0.5)
  });

  it('works per channel when the map has three, and on straight colour under partial alpha', () => {
    const rgb = applyGainMap(one([0.5, 0.5, 0.5]), map([0, 128, 255], 1, 3), meta());
    expect(Array.from(rgb.data.slice(0, 3))).toEqual([0.5, expect.closeTo(0.5 * 2 ** (2 * (128 / 255)), 5), 2]);
    const half = applyGainMap(one([0.5, 0.25, 0.125], 0.5), map([255]), meta());
    expect(Array.from(half.data)).toEqual([1, 0.5, 0.25, 0.5]); // straight 0.5 → 2, premultiplied by 0.5 ... = 1
  });

  it('upsamples a smaller map bilinearly', () => {
    const img = createImage(4, 1, Float32Array.of(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    const out = applyGainMap(img, map([0, 255]), meta());
    const factors = [0, 1, 2, 3].map((x) => out.data[x * 4]!);
    // map coordinates (x + 0.5) / 4 · 2 − 0.5 = −0.25, 0.25, 0.75, 1.25: clamped at the ends
    expect(factors[0]).toBeCloseTo(1, 5);
    expect(factors[3]).toBeCloseTo(4, 5);
    expect(factors[1]).toBeCloseTo(2 ** (2 * 0.25), 3);
    expect(factors[2]).toBeCloseTo(2 ** (2 * 0.75), 3);
  });

  it('leaves transparent pixels alone and does not change its input', () => {
    const img = createImage(1, 1, Float32Array.of(0, 0, 0, 0));
    expect(Array.from(applyGainMap(img, map([255]), meta()).data)).toEqual([0, 0, 0, 0]);
    const src = one([0.3, 0.3, 0.3]);
    const before = Array.from(src.data);
    applyGainMap(src, map([255]), meta());
    expect(Array.from(src.data)).toEqual(before);
  });
});

describe('gainMapWeight', () => {
  it('is how far a display\'s headroom goes between the base and the HDR rendition, 0 to 1', () => {
    const m = meta({ baseHdrHeadroom: 0, alternateHdrHeadroom: 3 });
    expect(gainMapWeight(m, 0)).toBe(0);
    expect(gainMapWeight(m, 1.5)).toBe(0.5);
    expect(gainMapWeight(m, 3)).toBe(1);
    expect(gainMapWeight(m, 10)).toBe(1);
    expect(gainMapWeight(m, -2)).toBe(0);
    expect(gainMapWeight(meta({ alternateHdrHeadroom: 0 }), 5)).toBe(1); // no range: all or nothing
  });
});

describe('sdrFromHdr', () => {
  it('leaves what is below the knee alone, rolls the highlights off towards 1, keeps hue and order', () => {
    const img = createImage(5, 1, Float32Array.of(0.2, 0.1, 0.05, 1, 0.8, 0.4, 0.2, 1, 1.05, 1, 0.95, 1, 4, 3.9, 3.8, 1, 100, 99, 98, 1));
    const out = sdrFromHdr(img);
    expect(Array.from(out.data.slice(0, 4))).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.1, 6), expect.closeTo(0.05, 6), 1]);
    for (let p = 1; p < 5; p++) {
      const y = (i: number) => 0.2126 * out.data[i]! + 0.7152 * out.data[i + 1]! + 0.0722 * out.data[i + 2]!;
      expect(y(p * 4)).toBeGreaterThan(y((p - 1) * 4));
      for (let c = 0; c < 3; c++) {
        expect(out.data[p * 4 + c]).toBeLessThanOrEqual(1);
        expect(out.data[p * 4 + c]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(out.data[8]! / out.data[9]!).toBeCloseTo(1.05, 4); // hue kept (as long as no channel clips)
    expect(out.data[8]!).toBeLessThan(1);
    expect(out.data[16]!).toBeGreaterThan(0.99); // 100× SDR white is (almost) white
  });

  it('clips negative channels (colours outside sRGB) and keeps alpha', () => {
    const out = sdrFromHdr(createImage(1, 1, Float32Array.of(-0.2, 0.5, 2, 0.5)));
    expect(out.data[0]).toBe(0);
    expect(out.data[3]).toBe(0.5);
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('makeGainMap and applyGainMap together', () => {
  /** A picture with SDR-range shadows and highlights up to 12 times SDR white. */
  const hdr = (w: number, h: number) => {
    const img = createImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = 12 ** (x / (w - 1)) - 0.4;
        img.data.set([t * (0.6 + 0.4 * (y / h)), t * 0.5, t * (1 - 0.5 * (y / h)), 1], (y * w + x) * 4);
      }
    return img;
  };

  it('rebuilds the HDR picture from the SDR one and the map, within what 8 bits of gain allow', () => {
    const src = hdr(48, 6);
    const sdr = sdrFromHdr(src);
    const { map: m, metadata } = makeGainMap(sdr, src);
    expect([m.width, m.height, m.channels]).toEqual([48, 6, 3]);
    expect(Math.max(...metadata.gainMapMax)).toBeGreaterThan(1.5); // the bright end needs more than 1.5 stops
    expect(metadata.alternateHdrHeadroom).toBeCloseTo(Math.max(...metadata.gainMapMax), 5);
    const back = applyGainMap(sdr, m, metadata);
    let worst = 0;
    for (let i = 0; i < back.data.length; i += 4)
      for (let c = 0; c < 3; c++) {
        const a = src.data[i + c]!;
        const b = back.data[i + c]!;
        if (a > 0.05) worst = Math.max(worst, Math.abs(b - a) / a);
      }
    expect(worst).toBeLessThan(0.05);
  });

  it('with one channel it is the luminance ratio: right for light that keeps its colour, not where the SDR picture clipped a channel', () => {
    const grey = createImage(24, 2);
    for (let i = 0; i < 48; i++) grey.data.set([0.2 + i * 0.3, 0.2 + i * 0.3, 0.2 + i * 0.3, 1], i * 4);
    const sdrGrey = sdrFromHdr(grey);
    const one = makeGainMap(sdrGrey, grey, { channels: 1 });
    expect(one.map.channels).toBe(1);
    expect(one.metadata.gainMapMax[0]).toBe(one.metadata.gainMapMax[2]);
    const back = applyGainMap(sdrGrey, one.map, one.metadata);
    for (let i = 0; i < grey.data.length; i += 4) if (grey.data[i]! > 0.05) expect(Math.abs(back.data[i]! - grey.data[i]!) / grey.data[i]!).toBeLessThan(0.05);
    // A saturated highlight clips a channel of the SDR picture: only the three-channel map gets it back.
    const red = createImage(8, 1);
    for (let i = 0; i < 8; i++) red.data.set([3 + i, 0.2, 0.1, 1], i * 4);
    const sdrRed = sdrFromHdr(red);
    const lum1 = applyGainMap(sdrRed, makeGainMap(sdrRed, red, { channels: 1 }).map, makeGainMap(sdrRed, red, { channels: 1 }).metadata);
    const three = makeGainMap(sdrRed, red);
    const full = applyGainMap(sdrRed, three.map, three.metadata);
    expect(Math.abs(full.data[0]! - 3) / 3).toBeLessThan(0.05);
    expect(Math.abs(lum1.data[0]! - 3) / 3).toBeGreaterThan(0.1);
  });

  it('a picture that stays inside the SDR range needs no gain: a flat map of the minimum, and the same picture back', () => {
    const src = createImage(8, 2, Float32Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 1 : 0.1 + (i % 7) * 0.1)));
    const sdr = sdrFromHdr(src);
    const { map: m, metadata } = makeGainMap(sdr, src);
    expect(new Set(m.data).size).toBeLessThanOrEqual(3);
    expect(metadata.gainMapMax[0]).toBeGreaterThanOrEqual(metadata.gainMapMin[0]);
    const back = applyGainMap(sdr, m, metadata);
    for (let i = 0; i < back.data.length; i++) expect(back.data[i]).toBeCloseTo(src.data[i]!, 3);
  });

  it('makes a smaller map for a large picture, when asked', () => {
    const src = hdr(64, 32);
    const { map: m } = makeGainMap(sdrFromHdr(src), src, { maxSide: 16 });
    expect([m.width, m.height, m.channels]).toEqual([16, 8, 3]);
  });

  it('refuses pictures of different sizes', () => {
    expect(() => makeGainMap(createImage(2, 2), createImage(3, 2))).toThrow(/size/);
  });
});
