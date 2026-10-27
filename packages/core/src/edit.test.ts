import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { applyEdit } from './edit';
import { applyGeometryCpu, IDENTITY_GEOMETRY, type Geometry } from './geometry';
import { createImage } from './image';
import { runChainCpu } from './pipeline/chain';
import { downscaleCpu, fitWithin } from './resize';
import { serializeChain } from './serialize';

const gain = defineFilter({
  id: 'gain', label: 'Gain', category: 'adjust', kind: 'pointwise', alpha: 'premultiplied',
  params: { amount: { type: 'float', min: 0, max: 4, step: 0.1, default: 1, label: 'Amount' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * p.amount, c.a); }',
  pixel: (c, p) => [c[0] * p.amount, c[1] * p.amount, c[2] * p.amount, c[3]],
  tolerance: { abs: 1e-6, rel: 1e-3 },
});
// A px param, to see that `scale` reaches the chain.
const shift = defineFilter({
  id: 'shift', label: 'Shift', category: 'adjust', kind: 'multipass',
  params: { by: { type: 'int', min: 0, max: 50, default: 0, unit: 'px', label: 'By' } },
  passes: [{ name: 'main', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy + vec2i(i32(p.by), 0)); }' }],
  cpu: (src, p) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const sx = Math.min(src.width - 1, x + Math.round(p.by));
      out.data.set(src.data.subarray((y * src.width + sx) * 4, (y * src.width + sx) * 4 + 4), (y * src.width + x) * 4);
    }
    return out;
  },
  tolerance: { abs: 1e-6, rel: 1e-3 },
});
const filters = [gain, shift];

function ramp(w: number, h: number) {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([(i % w) / w, Math.floor(i / w) / h, 0.25, 1], i * 4);
  return img;
}

describe('applyEdit (CPU)', () => {
  it('uses the filters\' fast implementations', async () => {
    // A fast path that differs from the reference, so the result shows which one ran.
    const marked = defineFilter({ ...gain, fast: (src) => createImage(src.width, src.height, new Float32Array(src.data.length).fill(0.5)) });
    const out = await applyEdit(ramp(3, 2), serializeChain([{ filter: marked }]), { filters: [marked] });
    expect(Array.from(out.data).every((v) => v === 0.5)).toBe(true);
  });

  const geometry: Geometry = { ...IDENTITY_GEOMETRY, rotate: 90, crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 } };
  const steps = [{ filter: gain, params: { amount: 1.5 } }, { filter: shift, params: { by: 4 } }];

  it('is geometry, then the chain, then the long-side shrink', async () => {
    const src = ramp(40, 30);
    const doc = JSON.parse(JSON.stringify(serializeChain(steps, { geometry, output: { longSide: 10 } })));
    const framed = applyGeometryCpu(src, geometry);
    const chained = runChainCpu(steps, framed);
    const expected = downscaleCpu(chained, ...fitWithin(chained.width, chained.height, 10));
    const out = await applyEdit(src, doc, { filters });
    expect([out.width, out.height]).toEqual([expected.width, expected.height]);
    expect(Array.from(out.data)).toEqual(Array.from(expected.data));
  });

  it('never enlarges, and works without geometry or output', async () => {
    const src = ramp(12, 8);
    const out = await applyEdit(src, serializeChain(steps, { output: { longSide: 1000 } }), { filters });
    expect([out.width, out.height]).toEqual([12, 8]);
    expect(Array.from(out.data)).toEqual(Array.from(runChainCpu(steps, src).data));
  });

  it('scales pixel params when the source is a reduced copy of the original', async () => {
    const src = ramp(20, 4);
    const out = await applyEdit(src, serializeChain([{ filter: shift, params: { by: 8 } }]), { filters, scale: 0.5 });
    expect(Array.from(out.data)).toEqual(Array.from(runChainCpu([{ filter: shift, params: { by: 4 } }], src).data));
  });

  it('reads version 1 documents and does not change the source', async () => {
    const src = ramp(6, 6);
    const before = Array.from(src.data);
    const out = await applyEdit(src, { version: 1, steps: [{ filter: 'gain', params: { amount: 2 } }] }, { filters });
    expect(out.data[0]).toBeCloseTo(0, 6);
    expect(out.data[4]).toBeCloseTo((1 / 6) * 2, 6);
    expect(Array.from(src.data)).toEqual(before);
  });

  it('reports invalid documents like parseChain', async () => {
    await expect(applyEdit(ramp(2, 2), { version: 2, steps: [{ filter: 'nope', params: {} }] }, { filters })).rejects.toThrow(/nope/);
  });
});
