import { describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { createImage, type LinearImage } from '../image';
import type { Mask } from '../mask';
import { planBands, planSegments, runChainBand, runChainBands } from './bands';
import { runChainCpu, type Step } from './chain';

// Synthetic filters with a known reach: the real filters get their own, much larger suite in
// packages/filters (bands.test.ts); this one checks the planner and the executor in isolation.

const pass = { name: 'out', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' } as const;

/** Each pixel becomes the mean of the rows y - r .. y + r of its column (clamped to the edge). */
const columnMean = defineFilter({
  id: 'columnMean',
  label: 'Column mean',
  category: 'classic',
  kind: 'multipass',
  params: { r: { type: 'int', min: 0, max: 20, default: 1, unit: 'px', label: 'r' } },
  passes: [pass],
  reach: ({ r }) => r,
  cpu: (src, { r }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++)
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) acc += src.data[(Math.min(src.height - 1, Math.max(0, y + k)) * src.width + x) * 4 + c]!;
          out.data[(y * src.width + x) * 4 + c] = acc / (2 * r + 1);
        }
    return out;
  },
  tolerance: { abs: 0, rel: 0 },
});

/** Subtracts the mean of the whole image: needs all of it, so it is declared global. */
const centre = defineFilter({
  id: 'centre',
  label: 'Centre',
  category: 'adjust',
  kind: 'multipass',
  params: {},
  passes: [pass],
  reach: 'global',
  cpu: (src) => {
    let mean = 0;
    for (let i = 0; i < src.data.length; i += 4) mean += src.data[i]!;
    mean /= src.width * src.height;
    return createImage(src.width, src.height, src.data.map((v, i) => (i % 4 === 0 ? v - mean : v)));
  },
  tolerance: { abs: 0, rel: 0 },
});

/** No `reach` at all: must be treated as global. */
const undeclared = defineFilter({ ...centre, id: 'undeclared', reach: undefined as never });

const gain = defineFilter({
  id: 'gain',
  label: 'Gain',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: { k: { type: 'float', min: 0, max: 4, step: 0.1, default: 1.5, label: 'k' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * p.k, c.a); }',
  pixel: ([r, g, b, a], { k }) => [r * k, g * k, b * k, a],
  tolerance: { abs: 0, rel: 2 ** -10 },
});

/** Mask-aware: the value is the mask itself, so a band must be given its own rows of the mask. */
const showMask = defineFilter({
  id: 'showMask',
  label: 'Show mask',
  category: 'classic',
  kind: 'multipass',
  usesMask: true,
  params: {},
  passes: [{ ...pass, inputs: ['input', 'mask'] }],
  reach: () => 0,
  cpu: (src, _p, mask) => createImage(src.width, src.height, src.data.map((_, i) => (i % 4 === 3 ? 1 : mask![i >> 2]!))),
  tolerance: { abs: 0, rel: 0 },
});

/** The value is the row's position in the full image: only right if a band is told where it sits. */
const rowIndex = defineFilter({
  id: 'rowIndex',
  label: 'Row index',
  category: 'classic',
  kind: 'multipass',
  params: {},
  passes: [pass],
  reach: () => 0,
  cpu: (src, _p, _mask, region) => {
    const [y0, full] = region ? [region.y0, region.fullHeight] : [0, src.height];
    return createImage(src.width, src.height, src.data.map((v, i) => (i % 4 === 0 ? v + (y0 + Math.floor(i / 4 / src.width)) / full : v)));
  },
  tolerance: { abs: 0, rel: 0 },
});

function image(w: number, h: number): LinearImage {
  const data = new Float32Array(w * h * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i++) data[i] = (seed = (seed * 16807) % 2147483647) / 2147483647;
  return createImage(w, h, data);
}

const step = (filter: Step['filter'], params?: Record<string, unknown>, extra: Partial<Step> = {}): Step => ({ filter, ...(params && { params }), ...extra });

describe('planBands', () => {
  it('cuts the rows into contiguous bands that cover the image once', () => {
    for (const [height, count] of [[17, 1], [17, 4], [17, 17], [1, 3], [45, 7]] as const) {
      const bands = planBands(height, count, 0);
      expect(bands[0]!.y0).toBe(0);
      expect(bands.at(-1)!.y1).toBe(height);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.y0).toBe(bands[i - 1]!.y1);
      expect(bands.every((b) => b.y1 > b.y0)).toBe(true);
      expect(bands.length).toBe(Math.min(count, height));
    }
  });

  it('gives each band its halo, clipped at the image', () => {
    const bands = planBands(40, 4, 3, { force: true });
    expect(bands.map((b) => [b.y0, b.y1, b.from, b.to])).toEqual([
      [0, 10, 0, 13],
      [10, 20, 7, 23],
      [20, 30, 17, 33],
      [30, 40, 27, 40],
    ]);
  });

  it('uses fewer bands when the halo would dominate, unless forced', () => {
    // 4 × halo = 40 rows per band at least: 100 rows hold two.
    expect(planBands(100, 8, 10)).toHaveLength(2);
    expect(planBands(100, 8, 10, { force: true })).toHaveLength(8);
    expect(planBands(100, 8, 0)).toHaveLength(8);
    expect(planBands(10, 8, 50)).toHaveLength(1);
  });

  it('treats a count below 1 as 1', () => {
    expect(planBands(10, 0, 0)).toHaveLength(1);
    expect(planBands(10, -3, 0)).toHaveLength(1);
  });
});

describe('planSegments', () => {
  it('merges neighbouring steps into one segment whose halo is the sum of their reaches', () => {
    const segs = planSegments([step(gain), step(columnMean, { r: 2 }), step(columnMean, { r: 3 }), step(gain)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.halo).toBe(5);
    expect(segs[0]!.steps).toHaveLength(4);
  });

  it('puts every global step, and a filter with no declared reach, in a segment of its own', () => {
    const segs = planSegments([step(gain), step(columnMean), step(centre), step(undeclared), step(undeclared), step(gain)]);
    expect(segs.map((s) => [s.steps.length, s.halo])).toEqual([[2, 1], [1, 'global'], [1, 'global'], [1, 'global'], [1, 0]]);
  });

  it('skips disabled steps and reads the reach from the scaled params', () => {
    const segs = planSegments([step(columnMean, { r: 4 }), step(columnMean, { r: 9 }, { enabled: false })], 0.5);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.steps).toHaveLength(1);
    expect(segs[0]!.halo).toBe(2);
  });

  it('rejects a reach that is not a whole, non-negative number of rows', () => {
    const odd = defineFilter({ ...columnMean, id: 'odd', reach: () => 1.5 });
    const neg = defineFilter({ ...columnMean, id: 'neg', reach: () => -1 });
    expect(() => planSegments([step(odd)])).toThrow(RangeError);
    expect(() => planSegments([step(neg)])).toThrow(RangeError);
  });
});

describe('runChainBands', () => {
  const w = 9;
  const h = 31;
  const src = image(w, h);
  const same = (steps: Step[], bands: number, fast = false) => {
    const whole = runChainCpu(steps, src, { fast });
    const tiled = runChainBands(steps, src, { fast, bands, force: true });
    expect(tiled.width).toBe(w);
    expect(tiled.height).toBe(h);
    expect(Array.from(tiled.data)).toEqual(Array.from(whole.data));
  };

  it('equals the whole image for any number of bands, down to a band per row and beyond', () => {
    const chain = [step(gain), step(columnMean, { r: 2 }), step(gain, { k: 0.7 }), step(columnMean, { r: 3 })];
    for (const bands of [1, 2, 3, 4, 7, 10, h - 1, h, h + 5]) same(chain, bands);
  });

  it('handles bands shorter than the halo and a halo larger than the image', () => {
    same([step(columnMean, { r: 12 }), step(columnMean, { r: 12 })], 8);
    same([step(columnMean, { r: 20 }), step(columnMean, { r: 20 })], 5);
  });

  it('runs a global step on the whole image between banded segments', () => {
    const chain = [step(columnMean, { r: 2 }), step(centre), step(columnMean, { r: 1 }), step(gain)];
    for (const bands of [2, 5, 9]) same(chain, bands);
  });

  it('evaluates masks at the position of each row in the full image', () => {
    const radial: Mask = { kind: 'radial', center: [0.4, 0.55], radius: [0.3, 0.2], feather: 0.5 };
    const linear: Mask = { kind: 'linear', from: [0.1, 0.2], to: [0.8, 0.9] };
    const chain = [step(columnMean, { r: 2 }, { mask: radial }), step(gain, { k: 2 }, { mask: linear }), step(showMask, {}, { mask: radial })];
    for (const bands of [2, 3, 8]) same(chain, bands);
  });

  it('gives mask-aware filters their own rows of the mask', () => {
    const radial: Mask = { kind: 'radial', center: [0.5, 0.5], radius: [0.4, 0.3], feather: 0.3 };
    for (const bands of [1, 3, 6]) same([step(showMask, {}, { mask: radial })], bands);
  });

  it('tells a filter where its band sits in the full image (the frame)', () => {
    for (const bands of [2, 5, h]) same([step(rowIndex)], bands);
    same([step(columnMean, { r: 2 }), step(rowIndex), step(columnMean, { r: 1 })], 4);
  });

  it('hands the frame to a filter called through its own wrapper', () => {
    const out = rowIndex.cpu(createImage(2, 3, new Float32Array(24)), {}, undefined, { y0: 4, fullHeight: 10 });
    expect([out.data[0]!, out.data[8]!, out.data[16]!].map((v) => Number(v.toFixed(6)))).toEqual([0.4, 0.5, 0.6]);
  });

  it('runChainBand gives a band exactly the rows the whole image has there, and refuses a global step', () => {
    const steps = [step(columnMean, { r: 2 }), step(gain), step(columnMean, { r: 1 })];
    const whole = runChainCpu(steps, src);
    for (const band of planBands(h, 4, 3, { force: true })) {
      const rows = runChainBand(steps, src, band, {});
      expect(rows.height).toBe(band.y1 - band.y0);
      expect(Array.from(rows.data)).toEqual(Array.from(whole.data.subarray(band.y0 * w * 4, band.y1 * w * 4)));
    }
    expect(() => runChainBand([step(centre)], src, planBands(h, 2, 0)[0]!)).toThrow(/global/);
  });

  it('applies disabled steps nowhere and returns a copy when nothing runs', () => {
    const out = runChainBands([step(gain, {}, { enabled: false })], src, { bands: 4 });
    expect(out).not.toBe(src);
    expect(out.data).not.toBe(src.data);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('does not change its input', () => {
    const copy = src.data.slice();
    runChainBands([step(columnMean, { r: 2 }), step(gain)], src, { bands: 5, force: true });
    expect(Array.from(src.data)).toEqual(Array.from(copy));
  });

  it('is wrong when the declared reach is too small (the tests above can fail)', () => {
    const tight = defineFilter({ ...columnMean, id: 'tight', reach: ({ r }) => r - 1 });
    const steps = [step(tight, { r: 3 })];
    const whole = runChainCpu(steps, src);
    const tiled = runChainBands(steps, src, { bands: 4, force: true });
    expect(Array.from(tiled.data)).not.toEqual(Array.from(whole.data));
  });

  it('falls back to the whole image for a filter whose reach is not declared, whatever the band count', () => {
    same([step(undeclared)], 6);
  });

  it('keeps the usual errors', () => {
    expect(() => runChainBands([step(showMask)], src, { bands: 2 })).toThrow(/needs a mask/);
  });
});
