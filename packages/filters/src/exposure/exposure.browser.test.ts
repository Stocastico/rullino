import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runPointwise, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { exposure } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

function testImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < data.length; i += 4) {
    const a = rand();
    data[i] = rand() * a;
    data[i + 1] = rand() * a;
    data[i + 2] = rand() * 1.5 * a; // some HDR headroom
    data[i + 3] = a;
  }
  // Quantise up front so CPU and GPU see exactly the same input.
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

describe('exposure GPU <-> CPU parity', () => {
  // Non-multiple-of-8 size exercises the workgroup bounds check.
  const src = testImage(67, 45);

  it.each([-3, -0.5, 0, 1.25, 4])('matches at %d EV', async (ev) => {
    const out = await readImage(ctx, runPointwise(ctx, exposure, uploadImage(ctx, src), { ev }));
    const result = compareImages(out, exposure.cpu(src, { ev }), exposure.tolerance);
    expect(result.worst ?? null, JSON.stringify(result.worst)).toBeNull();
    expect(result.pass).toBe(true);
  });
});
