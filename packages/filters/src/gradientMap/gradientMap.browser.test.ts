import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { gradientMap } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// The registry parity test changes one param at a time and `tritone` defaults to off, so the midtone
// colour and the midpoint never act there. Here they do, on a luminance ramp (with HDR and
// semi-transparent pixels) so that every segment of the ramp is crossed.
const data = new Float32Array(41 * 9 * 4);
for (let i = 0, n = 0; i < data.length; i += 4, n++) {
  const t = (n % 41) / 30; // up to ~1.33: above 1 clamps
  const a = n % 9 === 8 ? 0.5 : 1;
  data.set([t * (0.6 + 0.4 * ((n % 5) / 4)) * a, t * (0.5 + 0.5 * ((n % 7) / 6)) * a, t * (1 - 0.5 * ((n % 3) / 2)) * a, a], i);
}
const src = createImage(41, 9, fromFloat16Array(toFloat16Array(data)));

it.each([0.05, 0.3, 0.5, 0.8, 0.95])('matches the CPU as a tritone, midpoint %s', async (midpoint) => {
  const params = { tritone: true, midpoint, shadows: [0.05, 0.1, 0.4], midtones: [0.9, 0.2, 0.5], highlights: [1, 0.95, 0.6], amount: 0.8 } as never;
  const out = await readImage(ctx, runFilter(ctx, gradientMap, uploadImage(ctx, src), params));
  const res = compareImages(out, gradientMap.cpu(src, params), gradientMap.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
