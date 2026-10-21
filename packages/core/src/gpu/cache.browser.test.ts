import { afterAll, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { createImage } from '../image';
import { createGpuContext } from './context';
import { runFilter } from './run';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

const src = createImage(3, 2, new Float32Array(24).fill(0.5));

// Two different filters that happen to share an id (e.g. a user filter reusing a built-in's id)
// must not share a compiled shader.
const pointwise = (k: number) =>
  defineFilter({
    id: 'sameId',
    label: 'Same id',
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'premultiplied',
    params: {},
    wgsl: `fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * ${k}.0, c.a); }`,
    pixel: ([r, g, b, a]) => [r * k, g * k, b * k, a],
    tolerance: { abs: 0, rel: 0 },
  });

const multipass = (k: number) =>
  defineFilter({
    id: 'sameIdMp',
    label: 'Same id',
    category: 'classic',
    kind: 'multipass',
    params: {},
    passes: [{ name: 'out', inputs: ['input'], wgsl: `fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy) * ${k}.0; }` }],
    cpu: (img) => img,
    tolerance: { abs: 0, rel: 0 },
  });

it('does not share shaders between pointwise filters with the same id', async () => {
  const a = await readImage(ctx, runFilter(ctx, pointwise(2), uploadImage(ctx, src)));
  const b = await readImage(ctx, runFilter(ctx, pointwise(3), uploadImage(ctx, src)));
  expect(a.data[0]).toBe(1);
  expect(b.data[0]).toBe(1.5);
});

it('does not share shaders between multipass filters with the same id', async () => {
  const a = await readImage(ctx, runFilter(ctx, multipass(2), uploadImage(ctx, src)));
  const b = await readImage(ctx, runFilter(ctx, multipass(3), uploadImage(ctx, src)));
  expect(a.data[0]).toBe(1);
  expect(b.data[0]).toBe(1.5);
});
