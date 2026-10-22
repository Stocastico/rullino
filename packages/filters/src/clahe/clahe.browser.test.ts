import { compareImages, createGpuContext, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { fromLightness } from '../test-utils';
import { clahe } from './index';

// The registry parity suite varies one param at a time; tiles and clip limit interact.
const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

const raw = fromLightness(53, 37, (x, y) => 0.15 + 0.6 * (x / 53) + 0.05 * Math.sin(x * 2.1 + y * 1.7), 0.04, 0.02);
const src = { ...raw, data: fromFloat16Array(toFloat16Array(raw.data)) };

it.each([
  [2, 1.5],
  [5, 4],
  [16, 20],
  [7, 1],
])('%i tiles, clip %d: GPU matches the CPU', async (tiles, clipLimit) => {
  const params = { tiles, clipLimit, amount: 0.8 };
  const out = await readImage(ctx, runFilter(ctx, clahe, uploadImage(ctx, src), params));
  const res = compareImages(out, clahe.cpu(src, params), clahe.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
