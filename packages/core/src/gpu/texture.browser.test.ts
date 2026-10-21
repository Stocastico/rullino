import { afterAll, describe, expect, it } from 'vitest';
import { createImage } from '../image';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createGpuContext } from './context';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

describe('texture upload / readback', () => {
  it('round-trips an image through rgba16float with half-precision quantisation only', async () => {
    // Odd width so rows are not 256-byte aligned and readback padding is exercised.
    const w = 37;
    const h = 5;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i) * 4;
    const src = createImage(w, h, data);

    const out = await readImage(ctx, uploadImage(ctx, src));

    expect(out.width).toBe(w);
    expect(out.height).toBe(h);
    expect(Array.from(out.data)).toEqual(Array.from(fromFloat16Array(toFloat16Array(data))));
  });
});
