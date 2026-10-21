import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, srgbToLinear, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { imageOf } from '../test-utils';
import { canny } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Long weak edges growing out of short strong segments, vertical and horizontal: hysteresis must
// match the CPU pixel for pixel after any number of iterations, not only once it has converged.
// Contrast fades gradually: a hard switch would make a T-junction, which non-maximum suppression
// breaks, and then nothing would propagate.
const enc = (v: number): [number, number, number] => {
  const l = srgbToLinear(v);
  return [l, l, l];
};
const fade = (t: number) => 0.75 * Math.min(1, Math.max(0, (t - 5) / 20));
const raw = imageOf(200, 150, (x, y) => {
  // Diagonal chain below: after non-maximum suppression it is connected only through diagonal
  // neighbours, so it catches a 4-connected hysteresis.
  if (y >= 90) return enc(x - (y - 90) < 40 ? fade(y - 90) : 1);
  if (x < 100) return enc(x < 37 ? fade(y) : 1); // vertical chain at x = 37
  return enc(y < 61 ? fade(x - 100) : 1); // horizontal chain at y = 61
});
const src = createImage(raw.width, raw.height, fromFloat16Array(toFloat16Array(raw.data)));
const params = (iterations: number) => ({ sigma: 1, low: 0.08, high: 0.3, iterations });

it('the test image actually exercises propagation', () => {
  const edges = (n: number) => Array.from(canny.cpu(src, params(n)).data).filter((v, i) => i % 4 === 0 && v > 0.5).length;
  expect(edges(1)).toBeGreaterThan(edges(0));
  expect(edges(20)).toBeGreaterThan(edges(1));
});

it.each([0, 1, 2, 7, 20, 64])('hysteresis matches the CPU exactly after %i iterations', async (n) => {
  const out = await readImage(ctx, runFilter(ctx, canny, uploadImage(ctx, src), params(n)));
  const res = compareImages(out, canny.cpu(src, params(n)), { abs: 0, rel: 0 });
  expect(res.outliers, JSON.stringify(res.worst)).toBe(0);
});
