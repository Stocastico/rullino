import { createImage, linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { autoAdjust } from './auto';
import { levels } from './levels';
import { whiteBalance } from './whiteBalance';

/** A w x h image from sRGB-encoded colours, straight alpha 1 (premultiplied = straight). */
function encoded(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([...f(x, y).map(srgbToLinear), 1], (y * w + x) * 4);
  return img;
}
/** Neutral greys spanning the full range, with a few mildly coloured pixels. */
const neutral = (x: number, y: number): [number, number, number] => {
  const v = (x + y * 64) / (64 * 64 - 1);
  return y % 8 === 0 ? [v, v * 0.95, v * 0.9] : [v, v, v];
};

describe('autoAdjust', () => {
  it('leaves a neutral, full-range image (almost) alone', () => {
    const a = autoAdjust(encoded(64, 64, neutral));
    expect(Math.abs(a.whiteBalance.temperature)).toBeLessThan(0.05);
    expect(Math.abs(a.whiteBalance.tint)).toBeLessThan(0.05);
    expect(a.levels.inBlack).toBeLessThan(0.01);
    expect(a.levels.inWhite).toBeGreaterThan(0.99);
    expect(a.levels.gamma).toBeGreaterThan(0.9);
    expect(a.levels.gamma).toBeLessThan(1.15);
  });

  it('reduces a colour cast on near-neutral content (70%: less than half remains)', () => {
    // A warm cast: linear gains on a neutral scene.
    const img = encoded(64, 64, neutral);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i]! * 1.25;
      img.data[i + 2] = img.data[i + 2]! * 0.75;
    }
    const a = autoAdjust(img);
    expect(a.whiteBalance.temperature).toBeLessThan(-0.15);
    const out = whiteBalance.cpu(img, a.whiteBalance);
    const ratio = (d: Float32Array) => {
      let r = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) [r, b] = [r + d[i]!, b + d[i + 2]!];
      return r / b;
    };
    expect(Math.log(ratio(out.data))).toBeLessThan(0.5 * Math.log(ratio(img.data)));
    expect(Math.log(ratio(out.data))).toBeGreaterThan(0);
  });

  it('ignores saturated colours: a blue sky does not make the image warmer', () => {
    const a = autoAdjust(encoded(64, 64, (x, y) => (y < 32 ? [0.35, 0.6, 0.95] : neutral(x, y))));
    expect(Math.abs(a.whiteBalance.temperature)).toBeLessThan(0.05);
  });

  it('stretches a low-contrast image to the full range with levels', () => {
    const img = encoded(64, 64, (x, y) => {
      const v = 0.25 + 0.4 * ((x + y * 64) / (64 * 64 - 1));
      return [v, v, v];
    });
    const a = autoAdjust(img);
    expect(a.levels.inBlack).toBeCloseTo(0.25, 1);
    expect(a.levels.inWhite).toBeCloseTo(0.65, 1);
    const out = levels.cpu(img, a.levels).data;
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < out.length; i += 4) [lo, hi] = [Math.min(lo, linearToSrgb(out[i]!)), Math.max(hi, linearToSrgb(out[i]!))];
    expect(lo).toBeLessThan(0.02);
    expect(hi).toBeGreaterThan(0.98);
  });

  it('brightens a dark image through gamma, within limits', () => {
    const img = encoded(64, 64, (x, y) => {
      const t = (x + y * 64) / (64 * 64 - 1);
      const v = t ** 3; // most pixels dark, a few bright
      return [v, v, v];
    });
    const a = autoAdjust(img);
    expect(a.levels.gamma).toBeGreaterThan(1.2);
    expect(a.levels.gamma).toBeLessThanOrEqual(1.5);
  });

  it('ignores transparent pixels', () => {
    const img = encoded(64, 64, neutral);
    for (let i = 0; i < img.data.length / 2; i += 4) img.data.set([0, 0, 0, 0], i);
    expect(() => autoAdjust(img)).not.toThrow();
    expect(autoAdjust(img).levels.inWhite).toBeGreaterThan(0.99);
  });
});
