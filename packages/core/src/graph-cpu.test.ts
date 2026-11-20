import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { applyGeometryCpu, IDENTITY_GEOMETRY } from './geometry';
import { parseEdit } from './graph';
import { runGraphCpu } from './graph-cpu';
import { createImage, type LinearImage } from './image';
import { maskImage } from './mask';
import { runChainCpu } from './pipeline/chain';
import { downscaleCpu, fitWithin } from './resize';
import { parseChain } from './serialize';

// A pointwise gain and a neighbourhood filter with a pixel-unit param, so scale handling shows.
const gain = defineFilter({
  id: 'gain', label: 'Gain', category: 'adjust', kind: 'pointwise', alpha: 'premultiplied',
  params: { amount: { type: 'float', min: 0, max: 4, step: 0.1, default: 1, label: 'Amount' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * p.amount, c.a); }',
  pixel: ([r, g, b, a], p) => [r * p.amount, g * p.amount, b * p.amount, a],
  tolerance: { abs: 0, rel: 0 },
});
/** Each pixel becomes the mean of its row neighbours within `radius` px (clamped): reads `scale`. */
const smear = defineFilter({
  id: 'smear', label: 'Smear', category: 'blur', kind: 'multipass', reach: 0,
  params: { radius: { type: 'float', min: 0, max: 50, step: 0.5, default: 2, unit: 'px', label: 'Radius' } },
  passes: [{ name: 'out', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' }],
  cpu: (img: LinearImage, p: { radius: number }) => {
    const r = Math.round(p.radius);
    const out = createImage(img.width, img.height);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let d = -r; d <= r; d++) sum += img.data[(y * img.width + Math.min(img.width - 1, Math.max(0, x + d))) * 4 + c]!;
          out.data[(y * img.width + x) * 4 + c] = sum / (2 * r + 1);
        }
    return out;
  },
  tolerance: { abs: 0, rel: 0 },
} as never);
const filters = [gain, smear];
const opts = { filters };

function picture(w: number, h: number, seed = 1): LinearImage {
  const img = createImage(w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = i % 4 === 3 ? 0.5 + (s % 100) / 200 : (s % 1000) / 1000;
  }
  return img;
}

const same = (a: LinearImage, b: LinearImage) => {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  expect(a.data).toEqual(b.data);
};

describe('runGraphCpu', () => {
  const v2s = [
    { version: 2, steps: [] },
    { version: 2, steps: [{ filter: 'gain', params: { amount: 1.7 } }, { filter: 'smear', params: { radius: 3 } }] },
    {
      version: 2,
      geometry: { ...IDENTITY_GEOMETRY, rotate: 90, crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 } },
      steps: [{ filter: 'gain', params: { amount: 0.5 }, mask: { kind: 'radial', center: [0.4, 0.5], radius: [0.3, 0.2], feather: 0.5 } }, { filter: 'smear', params: {}, enabled: false }],
    },
  ];

  it('renders a v1 / v2 document bit for bit as the chain path does (geometry, then steps)', () => {
    const src = picture(23, 17);
    for (const doc of v2s)
      for (const scale of [1, 0.5])
        for (const fast of [false, true]) {
          const { steps, geometry } = parseChain(doc, opts);
          const framed = geometry ? applyGeometryCpu(src, geometry) : src;
          same(runGraphCpu(parseEdit(doc, opts), src, { scale, fast }), runChainCpu(steps, framed, { scale, fast }));
        }
  });

  it('never changes or returns its sources', () => {
    const src = picture(5, 4);
    const copy = src.data.slice();
    const out = runGraphCpu(parseEdit({ version: 2, steps: [] }, opts), src);
    expect(out).not.toBe(src);
    expect(out.data).not.toBe(src.data);
    expect(src.data).toEqual(copy);
  });

  const mixDoc = (amount: number, mask?: unknown) => ({
    version: 3,
    inputs: { photo: {} },
    nodes: [
      { id: 'bright', from: 'photo', steps: [{ filter: 'gain', params: { amount: 2 } }] },
      { id: 'out', kind: 'mix', from: ['photo', 'bright'], amount, ...(mask ? { mask } : {}) },
    ],
  });

  it('mixes two nodes: amount 0 is the first, 1 the second, in between a linear blend, times the mask', () => {
    const src = picture(9, 7);
    const bright = runChainCpu(parseChain({ version: 2, steps: [{ filter: 'gain', params: { amount: 2 } }] }, opts).steps, src);
    same(runGraphCpu(parseEdit(mixDoc(0), opts), src), src);
    same(runGraphCpu(parseEdit(mixDoc(1), opts), src), bright);
    const half = runGraphCpu(parseEdit(mixDoc(0.25), opts), src);
    for (let i = 0; i < half.data.length; i++) expect(half.data[i]).toBeCloseTo(src.data[i]! + (bright.data[i]! - src.data[i]!) * 0.25, 6);
    const mask = { kind: 'linear', from: [0, 0], to: [1, 0] } as const;
    const masked = runGraphCpu(parseEdit(mixDoc(0.5, mask), opts), src);
    const m = maskImage(mask, 9, 7);
    for (let i = 0; i < masked.data.length; i++) expect(masked.data[i]).toBeCloseTo(src.data[i]! + (bright.data[i]! - src.data[i]!) * 0.5 * m[i >> 2]!, 6);
  });

  it('refuses to mix two images of different sizes, and says what to do', () => {
    const doc = {
      version: 3,
      inputs: { photo: {} },
      nodes: [
        { id: 'small', kind: 'resize', from: 'photo', scale: 0.5 },
        { id: 'out', kind: 'mix', from: ['photo', 'small'] },
      ],
    };
    expect(() => runGraphCpu(parseEdit(doc, opts), picture(20, 10))).toThrow(/mix "out": its inputs are 20×10 and 10×5; resize one of them first/);
  });

  const resizeDoc = (resize: Record<string, number>) => ({
    version: 3,
    inputs: { photo: {} },
    nodes: [
      { id: 'small', kind: 'resize', from: 'photo', ...resize },
      { id: 'sharp', from: 'small', steps: [{ filter: 'smear', params: { radius: 2 } }] },
    ],
  });

  it('resizes in linear light like output.longSide, and px params after it are pixels of the resized image', () => {
    const src = picture(40, 24);
    const [w, h] = fitWithin(40, 24, 20);
    const small = downscaleCpu(src, w, h);
    const smearSteps = parseChain({ version: 2, steps: [{ filter: 'smear', params: { radius: 2 } }] }, opts).steps;
    same(runGraphCpu(parseEdit(resizeDoc({ longSide: 20 }), opts), src), runChainCpu(smearSteps, small));
    same(runGraphCpu(parseEdit(resizeDoc({ scale: 0.25 }), opts), src), runChainCpu(smearSteps, downscaleCpu(src, 10, 6)));
    // Never enlarges.
    same(runGraphCpu(parseEdit(resizeDoc({ longSide: 400 }), opts), src), runChainCpu(smearSteps, src));
  });

  it('keeps a preview in proportion through a resize: the preview scale carries through', () => {
    // The full photo is 40×24; a quarter-size preview of it is 10×6. Resized to a long side of 20,
    // the full render is 20×12, so the preview must be 5×3, smeared with the radius scaled by ¼.
    const preview = picture(10, 6);
    const out = runGraphCpu(parseEdit(resizeDoc({ longSide: 20 }), opts), preview, { scale: 0.25 });
    const smearSteps = parseChain({ version: 2, steps: [{ filter: 'smear', params: { radius: 2 } }] }, opts).steps;
    same(out, runChainCpu(smearSteps, downscaleCpu(preview, 5, 3), { scale: 0.25 }));
  });

  it('feeds one node to several (fan-out) and binds named inputs', () => {
    const a = picture(6, 5, 1);
    const b = picture(6, 5, 2);
    const doc = {
      version: 3,
      inputs: { a: {}, b: {} },
      nodes: [
        { id: 'x', from: 'a', steps: [{ filter: 'gain', params: { amount: 3 } }] },
        { id: 'y', kind: 'mix', from: ['x', 'b'], amount: 0.5 },
        { id: 'z', kind: 'mix', from: ['x', 'y'], amount: 0.5 },
      ],
    };
    const x = runChainCpu(parseChain({ version: 2, steps: [{ filter: 'gain', params: { amount: 3 } }] }, opts).steps, a);
    const out = runGraphCpu(parseEdit(doc, opts), { a, b });
    for (let i = 0; i < out.data.length; i++) {
      const y = x.data[i]! + (b.data[i]! - x.data[i]!) * 0.5;
      expect(out.data[i]).toBeCloseTo(x.data[i]! + (y - x.data[i]!) * 0.5, 6);
    }
  });

  it('names a missing or an unexpected input', () => {
    const doc = parseEdit({ version: 3, inputs: { a: {}, b: {} }, nodes: [{ id: 'm', kind: 'mix', from: ['a', 'b'] }] }, opts);
    expect(() => runGraphCpu(doc, { a: picture(2, 2) })).toThrow(/input "b" is missing/);
    expect(() => runGraphCpu(doc, { a: picture(2, 2), b: picture(2, 2), c: picture(2, 2) })).toThrow(/input "c" is not one the document reads \(a, b\)/);
    expect(() => runGraphCpu(doc, picture(2, 2))).toThrow(/the document reads 2 inputs \(a, b\): pass them by name/);
  });
});
