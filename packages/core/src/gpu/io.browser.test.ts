import { afterAll, describe, expect, it } from 'vitest';
import { decodeSrgb8, encodeSrgb8 } from '../color';
import { compareImages } from '../compare';
import { createGpuContext } from './context';
import { encodeToTexture, importImage, readSrgb8, uploadSrgb8 } from './io';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
// Hardware sRGB texture decoding is a bit coarser than the CPU's pow(): ~0.4 of an 8-bit step on an RTX 40.
const software = (await navigator.gpu.requestAdapter())?.info.isFallbackAdapter ?? true;
afterAll(() => ctx.device.destroy());

/** Every 8-bit value on every channel, with a spread of alpha values (incl. 0 and 255). */
function sample(): ImageData {
  const w = 61; // odd width: exercises readback row padding
  const h = 9;
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = (i * 37) % 256;
    const alpha = [255, 255, 128, 1, 0, 200, 255][i % 7]!;
    img.data.set([v, 255 - v, (v * 7) % 256, alpha], i * 4);
  }
  return img;
}

const maxByteDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, onlyOpaque = false) => {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    if (onlyOpaque && b[i - (i % 4) + 3] !== 255) continue;
    max = Math.max(max, Math.abs(a[i]! - b[i]!));
  }
  return max;
};

describe('GPU image I/O', () => {
  const src = sample();

  it('imports 8-bit sRGB into linear premultiplied rgba16float like decodeSrgb8', async () => {
    const tex = importImage(ctx, src);
    expect(tex.format).toBe('rgba16float');
    const out = await readImage(ctx, tex);
    const res = compareImages(out, decodeSrgb8(src.data, src.width, src.height), { abs: 1e-4, rel: 2 ** -9 });
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  });

  it('uploads raw 8-bit RGBA bytes (no browser image types: works on Dawn too) like decodeSrgb8', async () => {
    for (const bytes of [new Uint8Array(src.data), src.data]) {
      const out = await readImage(ctx, uploadSrgb8(ctx, bytes, src.width, src.height));
      expect([out.width, out.height]).toEqual([src.width, src.height]);
      const res = compareImages(out, decodeSrgb8(src.data, src.width, src.height), { abs: software ? 1e-4 : 2.5e-3, rel: 2 ** -9 });
      expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
    }
    expect(() => uploadSrgb8(ctx, new Uint8Array(12), 2, 2)).toThrow(RangeError);
  });

  it('reads back many times, concurrently too, without mixing results', async () => {
    const a = importImage(ctx, src);
    const flipped = new ImageData(new Uint8ClampedArray(src.data).reverse(), src.width, src.height);
    const b = importImage(ctx, flipped);
    const first = await readSrgb8(ctx, a);
    for (let i = 0; i < 3; i++) {
      const [ra, rb] = await Promise.all([readSrgb8(ctx, a), readSrgb8(ctx, b)]);
      expect(Array.from(ra)).toEqual(Array.from(first));
      expect(Array.from(rb)).not.toEqual(Array.from(first));
    }
  });

  it('imports an ImageBitmap', async () => {
    const bitmap = await createImageBitmap(src, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const out = await readImage(ctx, importImage(ctx, bitmap));
    const expected = decodeSrgb8(src.data, src.width, src.height);
    // Only opaque pixels: browsers may store bitmaps premultiplied in 8 bits, losing colour under low alpha.
    for (let i = 0; i < out.data.length; i += 4) {
      if (src.data[i + 3] !== 255) continue;
      for (let c = 0; c < 4; c++) expect(out.data[i + c]).toBeCloseTo(expected.data[i + c]!, 2);
    }
  });

  it('round-trips opaque pixels exactly and the rest within 1/255', async () => {
    const bytes = await readSrgb8(ctx, importImage(ctx, src));
    expect(maxByteDiff(bytes, src.data, true)).toBe(0);
    // Colour under alpha 1/255 is not recoverable by anyone; compare against the CPU path instead.
    expect(maxByteDiff(bytes, encodeSrgb8(decodeSrgb8(src.data, src.width, src.height)))).toBeLessThanOrEqual(1);
  });

  it('encodes like encodeSrgb8, clamping HDR values', async () => {
    const lin = decodeSrgb8(src.data, src.width, src.height);
    for (let i = 0; i < lin.data.length; i += 4) for (let c = 0; c < 3; c++) lin.data[i + c]! *= 3;
    const bytes = await readSrgb8(ctx, uploadImage(ctx, lin));
    expect(maxByteDiff(bytes, encodeSrgb8(lin))).toBeLessThanOrEqual(1);
  });

  it('can encode premultiplied output for a premultiplied canvas', async () => {
    const dst = ctx.device.createTexture({
      size: [src.width, src.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    encodeToTexture(ctx, importImage(ctx, src), dst, { alpha: 'premultiplied' });
    const straight = await readSrgb8(ctx, importImage(ctx, src));
    const pm = await readSrgb8(ctx, dst);
    for (let i = 0; i < pm.length; i += 4) {
      const a = straight[i + 3]! / 255;
      for (let c = 0; c < 3; c++) expect(Math.abs(pm[i + c]! - straight[i + c]! * a)).toBeLessThanOrEqual(1);
      expect(pm[i + 3]).toBe(straight[i + 3]);
    }
  });
});
