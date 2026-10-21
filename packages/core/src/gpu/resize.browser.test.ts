import { afterAll, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage } from '../image';
import { downscaleCpu } from '../resize';
import { createGpuContext } from './context';
import { downscale } from './resize';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

it.each([
  [67, 45, 20, 13],
  [64, 64, 32, 32],
  [101, 7, 100, 3],
  [9, 9, 1, 1],
])('downscale %ix%i -> %ix%i matches the CPU area average', async (w, h, dw, dh) => {
  const data = new Float32Array(w * h * 4);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = rand();
    for (let c = 0; c < 3; c++) data[i + c] = rand() * 2 * a;
    data[i + 3] = a;
  }
  const src = createImage(w, h, fromFloat16Array(toFloat16Array(data)));
  const out = await readImage(ctx, downscale(ctx, uploadImage(ctx, src), dw, dh));
  expect([out.width, out.height]).toEqual([dw, dh]);
  const res = compareImages(out, downscaleCpu(src, dw, dh), { abs: 1e-4, rel: 2 ** -9 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
