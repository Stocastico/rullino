import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { colorGrading } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// The registry parity test changes one param at a time, and every strength defaults to 0, so the
// colours and the balance never act there. Here they all do, on a lightness ramp with colours.
const data = new Float32Array(33 * 9 * 4);
for (let i = 0, n = 0; i < data.length; i += 4, n++) {
  const t = (n % 33) / 32;
  data.set([t * (0.6 + 0.4 * ((n % 5) / 4)), t * (0.5 + 0.5 * ((n % 7) / 6)), t * (1 - 0.5 * ((n % 3) / 2)), 1], i);
}
const src = createImage(33, 9, fromFloat16Array(toFloat16Array(data)));

it.each([-1, -0.4, 0, 0.6, 1])('matches the CPU with every range tinted, balance %s', async (balance) => {
  const params = {
    shadows: [0.1, 0.5, 0.7],
    shadowsStrength: 1,
    midtones: [0.9, 0.2, 0.6],
    midtonesStrength: 0.7,
    highlights: [1, 0.8, 0.1],
    highlightsStrength: 0.9,
    balance,
  } as never;
  const out = await readImage(ctx, runFilter(ctx, colorGrading, uploadImage(ctx, src), params));
  const res = compareImages(out, colorGrading.cpu(src, params), colorGrading.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
