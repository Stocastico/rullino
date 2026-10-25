import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { halftone } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// The registry parity test changes one param at a time: shapes and grids are never combined there
// (hex rows with square or ring dots, CMY screens on a hex grid). Odd size, rotated, tones across the range.
const data = new Float32Array(67 * 45 * 4);
for (let i = 0, n = 0; i < data.length; i += 4, n++) {
  const [x, y] = [n % 67, Math.floor(n / 67)];
  const t = 0.1 + 0.8 * ((x + y) / 110);
  data.set([t, t * (0.6 + 0.4 * ((x % 7) / 6)), t * (1 - 0.5 * ((y % 5) / 4)), 1], i);
}
const src = createImage(67, 45, fromFloat16Array(toFloat16Array(data)));

it.each([
  { shape: 'square', grid: 'hex', mode: 'mono', angle: 20 },
  { shape: 'ring', grid: 'hex', mode: 'mono', angle: 63 },
  { shape: 'ring', grid: 'square', mode: 'cmy', angle: 45 },
  { shape: 'square', grid: 'hex', mode: 'cmy', angle: 10 },
])('matches the CPU: %o', async (extra) => {
  const params = { size: 9, ...extra } as never;
  const out = await readImage(ctx, runFilter(ctx, halftone, uploadImage(ctx, src), params));
  const res = compareImages(out, halftone.cpu(src, params), halftone.tolerance);
  expect(res.pass, `${res.outliers} channels out of tolerance, worst ${JSON.stringify(res.worst)}`).toBe(true);
});
