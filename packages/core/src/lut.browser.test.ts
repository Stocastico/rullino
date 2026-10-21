import { afterAll, expect, it } from 'vitest';
import { compareImages } from './compare';
import { defineFilter } from './define';
import { createGpuContext } from './gpu/context';
import { runFilter } from './gpu/run';
import { readImage, uploadImage } from './gpu/texture';
import { fromFloat16Array, toFloat16Array } from './half';
import { createImage } from './image';
import { applyLutCpu, createLut, lutFromFunction } from './lut';
import { Pipeline } from './pipeline/pipeline';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Applies a LUT param to premultiplied values directly (enough to test the sampler).
const applyRaw = defineFilter({
  id: 'applyRaw',
  label: 'Apply raw',
  category: 'look',
  kind: 'multipass',
  params: { look: { type: 'lut', default: lutFromFunction(2, (r, g, b) => [r, g, b]), label: 'Look' } },
  passes: [{ name: 'out', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { let c = load_input(xy); return vec4f(lut_look(c.rgb), c.a); }' }],
  cpu: (src, { look }) => {
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) out.data.set([...applyLutCpu(look, src.data[i]!, src.data[i + 1]!, src.data[i + 2]!), src.data[i + 3]!], i);
    return out;
  },
  tolerance: { abs: 1e-4, rel: 2 ** -9 },
});

const data = new Float32Array(33 * 17 * 4);
for (let i = 0; i < data.length; i++) data[i] = ((i * 37) % 101) / 84 - 0.1; // [-0.1, 1.1]: exercises clamping
const src = createImage(33, 17, fromFloat16Array(toFloat16Array(data)));

it.each([
  ['non-linear 9³', lutFromFunction(9, (r, g, b) => [g * g, Math.sqrt(b), 1 - r])],
  ['2³ with a [0, 2] domain', createLut(2, Float32Array.from({ length: 24 }, (_, i) => ((i * 7) % 11) / 10), { domainMax: [2, 2, 2] })],
  ['33³ (a typical .cube size)', lutFromFunction(33, (r, g, b) => [0.9 * r + 0.1 * b, g ** 1.3, (r + g + b) / 3])],
])('trilinear LUT sampling matches the CPU: %s', async (_, look) => {
  const out = await readImage(ctx, runFilter(ctx, applyRaw, uploadImage(ctx, src), { look }));
  const res = compareImages(out, applyRaw.cpu(src, { look }), applyRaw.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});

it('caches stages by LUT identity, not by serialising its data', () => {
  const a = lutFromFunction(17, (r, g, b) => [r, g, b]);
  const b = lutFromFunction(17, (r, g, b) => [b, g, r]);
  const p = new Pipeline(ctx);
  p.setSource(uploadImage(ctx, src));
  p.run([{ filter: applyRaw, params: { look: a } }]);
  const passes = p.stats.passes;
  p.run([{ filter: applyRaw, params: { look: a } }]);
  expect(p.stats.passes).toBe(passes);
  p.run([{ filter: applyRaw, params: { look: b } }]);
  expect(p.stats.passes).toBe(passes + 1);
  p.destroy();
});
