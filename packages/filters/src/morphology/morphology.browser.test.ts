import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { morphology } from './index';

// The registry parity suite varies one param at a time; operations and shapes interact.
const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

let seed = 9;
const [w, h] = [29, 19];
const src = createImage(w, h, fromFloat16Array(toFloat16Array(Float32Array.from({ length: w * h * 4 }, () => (seed = (seed * 16807) % 2147483647) / 2147483647))));
type Op = keyof typeof morphology.params.operation.options;
type Shape = keyof typeof morphology.params.shape.options;
const cases = (Object.keys(morphology.params.operation.options) as Op[]).flatMap((operation) =>
  (Object.keys(morphology.params.shape.options) as Shape[]).map((shape) => [operation, shape] as const),
);

it.each(cases)('%s with a %s element matches the CPU', async (operation, shape) => {
  const params = { operation, shape, radius: 2 } as const;
  const out = await readImage(ctx, runFilter(ctx, morphology, uploadImage(ctx, src), params));
  const res = compareImages(out, morphology.cpu(src, params), morphology.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
