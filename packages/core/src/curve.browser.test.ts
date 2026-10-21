import { afterAll, expect, it } from 'vitest';
import { compareImages } from './compare';
import { sampleCurve } from './curve';
import { defineFilter } from './define';
import { createGpuContext } from './gpu/context';
import { readImage, uploadImage } from './gpu/texture';
import { fromFloat16Array, toFloat16Array } from './half';
import { createImage } from './image';
import { runChainCpu } from './pipeline/chain';
import { Pipeline } from './pipeline/pipeline';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Two filters with a curve param of the same name, fused into one shader: their samplers must
// stay apart and each read its own LUT.
const mk = (id: string, def: readonly (readonly [number, number])[]) =>
  defineFilter({
    id,
    label: id,
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'premultiplied',
    params: { tone: { type: 'curve', default: def, label: 'Tone' } },
    wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(curve_tone(c.r), curve_tone(c.g), curve_tone(c.b), c.a); }',
    pixel: ([r, g, b, a], { tone }) => [sampleCurve(tone, r), sampleCurve(tone, g), sampleCurve(tone, b), a],
    tolerance: { abs: 2e-4, rel: 2 ** -9 },
  });
const s = mk('sCurve', [[0, 0], [0.25, 0.1], [0.7, 0.9], [1, 1]]);
const lift = mk('lift', [[0, 0.2], [0.5, 0.6], [1, 1]]);

const data = new Float32Array(41 * 9 * 4);
for (let i = 0; i < data.length; i++) data[i] = (i % 47) / 30 - 0.2; // includes < 0 and > 1
const src = createImage(41, 9, fromFloat16Array(toFloat16Array(data)));

it('curve samplers match the CPU, including extrapolation, in a fused chain', async () => {
  const steps = [{ filter: s }, { filter: lift }, { filter: s, params: { tone: [[0, 0.1], [1, 0.8]] } }];
  const p = new Pipeline(ctx);
  p.setSource(uploadImage(ctx, src));
  const out = await readImage(ctx, p.run(steps));
  expect(p.stats.passes).toBe(1);
  const res = compareImages(out, runChainCpu(steps, src), { abs: 1e-3, rel: 2e-3 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  p.destroy();
});
