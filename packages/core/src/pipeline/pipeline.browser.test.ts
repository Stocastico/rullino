import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { defineFilter } from '../define';
import { createGpuContext } from '../gpu/context';
import { readImage, uploadImage } from '../gpu/texture';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage } from '../image';
import { linearToOklab, oklabToLinear } from '../oklab';
import { runChainCpu, type Step } from './chain';
import { Pipeline } from './pipeline';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Two test filters that both declare a helper called `helper`, to prove namespacing works on a real GPU.
const gain = defineFilter({
  id: 'gain',
  label: 'Gain',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: { k: { type: 'float', min: 0, max: 4, step: 0.1, default: 1.5, label: 'k' } },
  wgsl: 'fn helper(x: vec3f, k: f32) -> vec3f { return x * k; }\nfn apply(c: vec4f, p: Params) -> vec4f { return vec4f(helper(c.rgb, p.k), c.a); }',
  pixel: ([r, g, b, a], { k }) => [r * k, g * k, b * k, a],
  tolerance: { abs: 1e-6, rel: 2 ** -10 },
});
const chroma = defineFilter({
  id: 'chroma',
  label: 'Chroma',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    k: { type: 'float', min: 0, max: 2, step: 0.1, default: 0.5, label: 'k' },
    mode: { type: 'enum', options: { scale: 'Scale', zero: 'Zero' }, default: 'scale', label: 'Mode' },
  },
  wgsl: [
    'fn helper(lab: vec3f, k: f32) -> vec3f { return vec3f(lab.x, lab.yz * k); }',
    'fn apply(c: vec4f, p: Params) -> vec4f {',
    '  let k = select(p.k, 0.0, p.mode == 1u);',
    '  return vec4f(rl_oklab_to_linear(helper(rl_linear_to_oklab(c.rgb), k)), c.a);',
    '}',
  ].join('\n'),
  pixel: ([r, g, b, a], { k, mode }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const kk = mode === 'zero' ? 0 : k;
    return [...oklabToLinear(L, A * kk, B * kk), a];
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});

function testImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = i % 36 === 0 ? 0 : 0.3 + 0.7 * rand();
    for (let c = 0; c < 3; c++) data[i + c] = rand() * a;
    data[i + 3] = a;
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

const src = testImage(41, 23);
const chain: Step[] = [
  { filter: gain },
  { filter: chroma, params: { k: 1.4 } },
  { filter: gain, params: { k: 0.7 } },
  { filter: chroma, params: { mode: 'zero' }, enabled: false },
];
// Sum of per-filter tolerances: fused GPU keeps f32 between filters, CPU keeps f64.
const tol = { abs: 1e-3, rel: 6e-3 };

describe('Pipeline', () => {
  let pipe: Pipeline;
  beforeEach(() => {
    pipe?.destroy();
    pipe = new Pipeline(ctx);
    pipe.setSource(uploadImage(ctx, src));
  });

  it('matches the CPU chain', async () => {
    const out = await readImage(ctx, pipe.run(chain));
    const res = compareImages(out, runChainCpu(chain, src), tol);
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  });

  it('fuses consecutive pointwise steps into one pass', () => {
    const before = pipe.stats.passes;
    pipe.run(chain);
    expect(pipe.stats.passes - before).toBe(1);
  });

  it('does no work when nothing changed and returns the same texture', () => {
    const a = pipe.run(chain);
    const passes = pipe.stats.passes;
    expect(pipe.run(chain.map((s) => ({ ...s }))).valueOf()).toBe(a);
    expect(pipe.stats.passes).toBe(passes);
  });

  it('re-runs without recompiling when only params change', async () => {
    pipe.run(chain);
    const { passes, compiles } = pipe.stats;
    const changed = chain.map((s, i) => (i === 1 ? { ...s, params: { k: 0.2 } } : s));
    const out = await readImage(ctx, pipe.run(changed));
    expect(pipe.stats.passes - passes).toBe(1);
    expect(pipe.stats.compiles).toBe(compiles);
    expect(compareImages(out, runChainCpu(changed, src), tol).pass).toBe(true);
  });

  it('enabling a step changes the structure and the result', async () => {
    pipe.run(chain);
    const enabled = chain.map((s) => ({ ...s, enabled: true }));
    const out = await readImage(ctx, pipe.run(enabled));
    const res = compareImages(out, runChainCpu(enabled, src), tol);
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  });

  it('returns the source for an empty chain', () => {
    const tex = uploadImage(ctx, src);
    pipe.setSource(tex);
    expect(pipe.run([])).toBe(tex);
    expect(pipe.run([{ filter: gain, enabled: false }])).toBe(tex);
  });

  it('recomputes from the first changed stage only when fusion is off', () => {
    const unfused = new Pipeline(ctx, { fuse: false });
    unfused.setSource(uploadImage(ctx, src));
    const steps: Step[] = [{ filter: gain }, { filter: chroma }, { filter: gain, params: { k: 2 } }];
    unfused.run(steps);
    expect(unfused.stats.passes).toBe(3);
    unfused.run(steps.map((s, i) => (i === 2 ? { ...s, params: { k: 3 } } : s)));
    expect(unfused.stats.passes).toBe(4); // only the last stage
    unfused.run(steps.map((s, i) => (i === 1 ? { ...s, params: { k: 1 } } : s)));
    expect(unfused.stats.passes).toBe(6); // stages 2 and 3
    unfused.destroy();
  });

  it('recomputes everything after a new source', () => {
    pipe.run(chain);
    const passes = pipe.stats.passes;
    pipe.setSource(uploadImage(ctx, src));
    pipe.run(chain);
    expect(pipe.stats.passes - passes).toBe(1);
  });
});
