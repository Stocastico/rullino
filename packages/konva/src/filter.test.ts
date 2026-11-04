import { applyLutCpu, encodeSrgb8, createImage, runChainCpu, type Step } from '@rullino/core';
import { contrast, exposure, filters, gaussianBlur, saturation, vignette } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { bakeLut } from '@rullino/presets';
import { konvaFilter } from './filter';

// A 64 x 48 picture: RGB ramps and a hue sweep, with a fully transparent and a half transparent column.
function picture() {
  const w = 64, h = 48;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 255) / (w - 1);
      data[i + 1] = (y * 255) / (h - 1);
      data[i + 2] = (((x * 7 + y * 13 + 9) % 64) * 255) / 63;
      data[i + 3] = x === 0 ? 0 : x === 1 ? 128 : 255;
    }
  return { data, width: w, height: h };
}

const doc = (steps: object[]) => ({ version: 2, steps });
const colour = doc([
  { filter: 'exposure', params: { ev: 0.4 } },
  { filter: 'contrast', params: { amount: 0.3 } },
  { filter: 'saturation', params: { amount: -0.25 } },
]);

describe('konvaFilter', () => {
  it('gives what the CPU renderer gives for a colour edit, within the one-LUT rounding', () => {
    const img = picture();
    konvaFilter(colour)(img);
    const steps: Step[] = [{ filter: exposure, params: { ev: 0.4 } }, { filter: contrast, params: { amount: 0.3 } }, { filter: saturation, params: { amount: -0.25 } }];
    const source = picture();
    const linear = createImage(source.width, source.height);
    for (let i = 0; i < source.data.length; i += 4) {
      const a = source.data[i + 3]! / 255;
      for (let c = 0; c < 3; c++) linear.data[i + c] = srgbToLinear(source.data[i + c]! / 255) * a;
      linear.data[i + 3] = a;
    }
    const expected = encodeSrgb8(runChainCpu(steps, linear));
    let sum = 0, worst = 0, n = 0, moved = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (source.data[i + 3] !== 255) continue; // partial alpha is compared through premultiplied rounding, not here
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(img.data[i + c]! - expected[i + c]!);
        sum += d;
        worst = Math.max(worst, d);
        moved += Math.abs(img.data[i + c]! - source.data[i + c]!);
        n++;
      }
    }
    expect(sum / n).toBeLessThan(0.7);
    expect(worst).toBeLessThanOrEqual(6);
    expect(moved / n).toBeGreaterThan(5); // it did change the picture: the agreement above is not that of two identities
  });

  it('is the baked LUT, sampled trilinearly, at every pixel (the first and the last included)', () => {
    const img = picture();
    const before = picture();
    konvaFilter(colour)(img);
    const lut = bakeLut([{ filter: exposure, params: { ev: 0.4 } }, { filter: contrast, params: { amount: 0.3 } }, { filter: saturation, params: { amount: -0.25 } }]);
    for (let i = 0; i < img.data.length; i += 4) {
      const want = applyLutCpu(lut, before.data[i]! / 255, before.data[i + 1]! / 255, before.data[i + 2]! / 255);
      for (let c = 0; c < 3; c++) expect(Math.abs(img.data[i + c]! - Math.min(255, Math.max(0, want[c]! * 255))), `pixel ${i / 4} channel ${c}`).toBeLessThanOrEqual(0.51);
    }
  });

  it('leaves alpha alone and changes colour at every alpha', () => {
    const before = picture();
    const img = picture();
    konvaFilter(colour)(img);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(before.data[i]);
    const px = (x: number) => (x * 4);
    expect(img.data[px(1)]).not.toBe(before.data[px(1)]); // the half transparent column changed too
  });

  it('an edit with no steps is the identity, byte for byte', () => {
    const before = picture();
    const img = picture();
    konvaFilter(doc([]))(img);
    expect(Array.from(img.data)).toEqual(Array.from(before.data));
  });

  it('applies a named look (the LUT is resolved by name, as in every renderer)', () => {
    const before = picture();
    const img = picture();
    konvaFilter(doc([{ filter: 'applyLut', params: { look: { ref: 'look:noir' } } }]))(img);
    // noir is black and white: the three channels agree
    let grey = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 255 && Math.abs(img.data[i]! - img.data[i + 1]!) <= 2 && Math.abs(img.data[i + 1]! - img.data[i + 2]!) <= 2) grey++;
    expect(grey).toBeGreaterThan(0.95 * 62 * 48);
    expect(Array.from(img.data)).not.toEqual(Array.from(before.data));
  });

  it('says what it cannot do instead of doing less', () => {
    expect(() => konvaFilter(doc([{ filter: 'gaussianBlur', params: { sigma: 2 } }]))).toThrow(/konvaFilter.*gaussianBlur.*colour/i);
    expect(() => konvaFilter(doc([{ filter: 'vignette', params: {} }]))).toThrow(/konvaFilter.*vignette/);
    expect(() => konvaFilter(doc([{ filter: 'exposure', params: { ev: 1 }, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } }]))).toThrow(/konvaFilter.*exposure.*mask/);
    expect(() => konvaFilter({ ...colour, geometry: { rotate: 90, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, width: 1, height: 1 } } })).toThrow(/konvaFilter.*geometry/);
    expect(() => konvaFilter(doc([{ filter: 'exposur', params: {} }]))).toThrow(/unknown filter/);
  });

  it('skips steps that are switched off, and ignores the export settings', () => {
    const before = picture();
    const img = picture();
    konvaFilter({ version: 2, steps: [{ filter: 'gaussianBlur', params: { sigma: 5 }, enabled: false }], output: { format: 'jpeg', longSide: 10 } })(img);
    expect(Array.from(img.data)).toEqual(Array.from(before.data));
  });

  it('works with the filters you give it', () => {
    expect(() => konvaFilter(doc([{ filter: 'exposure', params: {} }]), { filters: [vignette] })).toThrow(/unknown filter "exposure"/);
    expect(() => konvaFilter(doc([{ filter: 'exposure', params: {} }]), { filters })).not.toThrow();
    void gaussianBlur;
  });
});

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
