import { afterAll, describe, expect, it } from 'vitest';
import { srgbToLinear } from '../color';
import { createImage } from '../image';
import { createGpuContext } from './context';
import { exportImage } from './export';
import { readSrgb8 } from './io';
import { uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// 37x23: left half opaque gradient, right half fully transparent, a semi-transparent column.
const w = 37;
const h = 23;
const img = createImage(w, h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const a = x >= 20 ? 0 : x === 10 ? 0.3 : 1;
    const v = srgbToLinear((x + y) / (w + h));
    img.data.set([v * a, srgbToLinear(y / h) * a, 0.2 * a, a], (y * w + x) * 4);
  }
}
const tex = uploadImage(ctx, img);

/** Decodes an encoded image with the browser, without colour management, to straight RGBA bytes. */
async function decode(blob: Blob) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  c.drawImage(bitmap, 0, 0);
  return c.getImageData(0, 0, bitmap.width, bitmap.height).data;
}
const opaque = (i: number) => i % w < 20 && i % w !== 10;

describe('exportImage', () => {
  it('writes a lossless 8-bit PNG by default', async () => {
    const blob = await exportImage(ctx, tex);
    expect(blob.type).toBe('image/png');
    const [got, want] = [await decode(blob), await readSrgb8(ctx, tex)];
    for (let i = 0; i < w * h; i++) if (opaque(i)) expect([...got.subarray(i * 4, i * 4 + 4)]).toEqual([...want.subarray(i * 4, i * 4 + 4)]);
    expect(got[(5 * w + 30) * 4 + 3]).toBe(0);
  });

  it('writes 16-bit PNGs that decode to the same image', async () => {
    const [b8, b16] = [await exportImage(ctx, tex), await exportImage(ctx, tex, { format: 'png', bitDepth: 16 })];
    expect(b16.size).toBeGreaterThan(b8.size);
    const [a, b] = [await decode(b8), await decode(b16)];
    for (let i = 0; i < w * h; i++) if (opaque(i)) for (let c = 0; c < 4; c++) expect(Math.abs(a[i * 4 + c]! - b[i * 4 + c]!)).toBeLessThanOrEqual(1);
  });

  it('flattens JPEG onto a background (white by default) and honours quality', async () => {
    const hi = await exportImage(ctx, tex, { format: 'jpeg', quality: 0.95 });
    expect(hi.type).toBe('image/jpeg');
    const px = await decode(hi);
    const at = (x: number, y: number) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
    for (const v of at(30, 12)) expect(v).toBeGreaterThan(245);
    const black = await decode(await exportImage(ctx, tex, { format: 'jpeg', background: [0, 0, 0] }));
    expect(black[(12 * w + 30) * 4]).toBeLessThan(10);
    expect((await exportImage(ctx, tex, { format: 'jpeg', quality: 0.3 })).size).toBeLessThan(hi.size);
  });

  it('writes WebP with alpha', async () => {
    const blob = await exportImage(ctx, tex, { format: 'webp', quality: 1 });
    expect(blob.type).toBe('image/webp');
    const px = await decode(blob);
    expect(px[(5 * w + 30) * 4 + 3]).toBe(0);
    expect(px[(5 * w + 2) * 4 + 3]).toBe(255);
  });
});
