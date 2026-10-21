import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { curves } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// The registry parity test changes one curve at a time, where the order of RGB and channel
// curves does not matter. Here all four differ, so the order (RGB first) is checked on the GPU.
it('applies the RGB curve before the channel curves on the GPU too', async () => {
  const data = new Float32Array(32 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([(i % 37) / 36, (i % 23) / 22, (i % 11) / 10, 1], i);
  const src = createImage(32, 8, fromFloat16Array(toFloat16Array(data)));
  const params = {
    rgb: [[0, 0.1], [0.5, 0.7], [1, 0.9]],
    red: [[0, 0], [0.4, 0.1], [1, 1]],
    green: [[0, 0.3], [1, 0.6]],
    blue: [[0, 1], [1, 0]],
  } as never;
  const out = await readImage(ctx, runFilter(ctx, curves, uploadImage(ctx, src), params));
  const res = compareImages(out, curves.cpu(src, params), curves.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
