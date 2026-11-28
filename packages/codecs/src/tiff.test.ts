import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, decodePng, decodeTiff, type DecodedImage } from './index';
import { tiff } from './test-utils';

// The fixtures (test/tiff/, made by test/make-tiff-fixtures.py with libtiff through Pillow,
// ImageMagick and tifffile) are lossless encodings of known sources, so the decoded pixels must be
// the source's exactly: 8 / 16-bit PNGs (which decodePng reads exactly), raw float32, raw CMYK, and
// for associated alpha the stored premultiplied samples.

const dir = fileURLToPath(new URL('../test/tiff/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
const manifest: { file: string; source: string; float?: boolean; channels?: number; cmyk?: boolean; associated?: boolean }[] = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));

async function expected(m: (typeof manifest)[number]): Promise<{ bitDepth: number; data: ArrayLike<number> }> {
  const src = read(m.source);
  if (m.float) {
    const f = new Float32Array(src.buffer, src.byteOffset, src.length / 4);
    const c = m.channels!;
    const out = new Float32Array((f.length / c) * 4);
    for (let i = 0; i < f.length / c; i++) {
      out[4 * i] = f[c * i]!;
      out[4 * i + 1] = f[c * i + (c >= 3 ? 1 : 0)]!;
      out[4 * i + 2] = f[c * i + (c >= 3 ? 2 : 0)]!;
      out[4 * i + 3] = c === 4 ? f[c * i + 3]! : 1;
    }
    return { bitDepth: 32, data: out };
  }
  if (m.cmyk) {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const k = 255 - src[i + 3]!;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(((255 - src[i + c]!) * k) / 255);
      out[i + 3] = 255;
    }
    return { bitDepth: 8, data: out };
  }
  if (m.associated) {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3]!;
      for (let c = 0; c < 3; c++) out[i + c] = a === 0 ? 0 : Math.min(255, Math.round((src[i + c]! * 255) / a));
      out[i + 3] = a;
    }
    return { bitDepth: 8, data: out };
  }
  return decodePng(src);
}

function same(actual: DecodedImage, wanted: { bitDepth: number; data: ArrayLike<number> }) {
  expect(actual.bitDepth).toBe(wanted.bitDepth);
  expect(actual.data.length).toBe(wanted.data.length);
  const first = Array.prototype.findIndex.call(actual.data, (v: number, i: number) => v !== wanted.data[i]);
  if (first >= 0) expect.fail(`sample ${first} (pixel ${first >> 2}): ${actual.data[first]} vs ${wanted.data[first]}`);
}

describe('decodeTiff on lossless fixtures', () => {
  it.each(manifest.map((m) => [m.file, m] as const))('%s decodes to its source', async (_, m) => {
    const img = await decodeTiff(read(m.file));
    expect([img.width, img.height]).toEqual([23, 17]);
    same(img, await expected(m));
  });
});

describe('decodeTiff', () => {
  it('PackBits: a −128 header byte is a no-op', async () => {
    // Grey 4×1: literal [1, 2], −128 (skipped), a run of 2 × 9.
    const file = tiff({ 256: [4], 257: [1], 258: [8], 259: [32773], 262: [1], 277: [1], 278: [1] }, [Uint8Array.from([1, 1, 2, 0x80, 0xff, 9])]);
    expect(Array.from((await decodeTiff(file)).data)).toEqual([1, 1, 1, 255, 2, 2, 2, 255, 9, 9, 9, 255, 9, 9, 9, 255]);
  });

  it('RGB with an unspecified extra sample is opaque, at 8 and 16 bits', async () => {
    // ExtraSamples 0 (or absent) means the fourth sample is not alpha.
    for (const extra of [undefined, [0]]) {
      const tags8 = { 256: [2], 257: [1], 258: [8, 8, 8, 8], 259: [1], 262: [2], 277: [4], 278: [1], ...(extra ? { 338: extra } : {}) };
      expect(Array.from((await decodeTiff(tiff(tags8, [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])]))).data)).toEqual([1, 2, 3, 255, 5, 6, 7, 255]);
      const tags16 = { ...tags8, 258: [16, 16, 16, 16] };
      expect(Array.from((await decodeTiff(tiff(tags16, [Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0])]))).data)).toEqual([1, 2, 3, 65535, 5, 6, 7, 65535]);
    }
  });

  it('a tile must hold the whole tile, also past the image\'s edge', async () => {
    const tags = { 256: [20], 257: [3], 258: [8], 259: [1], 262: [1], 277: [1], 322: [16], 323: [16] };
    const whole = [new Uint8Array(256).fill(7), new Uint8Array(256).fill(9)];
    expect((await decodeTiff(tiff(tags, whole, { tiled: true }))).data[4 * 19]).toBe(9);
    // Only the 3 rows inside the image: refused, as libtiff refuses a short tile.
    await expect(decodeTiff(tiff(tags, [whole[0]!, whole[1]!.subarray(0, 48)], { tiled: true }))).rejects.toThrow(/short/);
  });

  it('refuses a tile far larger than the image before allocating it (found by the fuzz job)', async () => {
    // A 20×3 image whose TileWidth says 2^28: a tile is a buffer, so it is bounded like the image.
    const tags = { 256: [20], 257: [3], 258: [8], 259: [5], 262: [1], 277: [1], 322: [1 << 28], 323: [16] };
    await expect(decodeTiff(tiff(tags, [Uint8Array.from([128, 0])], { tiled: true }))).rejects.toThrow(/tile of .* is larger than/);
    // Real files tile small images generously: 100×100 in 256×256 tiles is fine.
    const ok = { 256: [100], 257: [100], 258: [8], 259: [1], 262: [1], 277: [1], 322: [256], 323: [256] };
    expect((await decodeTiff(tiff(ok, [new Uint8Array(256 * 256).fill(5)], { tiled: true }))).data[0]).toBe(5);
    await expect(decodeTiff(tiff(ok, [new Uint8Array(256 * 256)], { tiled: true }), { maxPixels: 100 * 100 })).rejects.toThrow(/larger than/);
  });

  it('refuses what it does not read, truncated files and sizes above maxPixels with a CodecError', async () => {
    const ok = read('rgb8-raw.tif');
    await expect(decodeTiff(read('rgb8.png'))).rejects.toThrow(/not a TIFF/);
    for (const cut of [4, 8, 100, ok.length - 10]) await expect(decodeTiff(ok.subarray(0, cut))).rejects.toThrow(CodecError);
    await expect(decodeTiff(ok, { maxPixels: 23 * 17 - 1 })).rejects.toThrow(/larger than maxPixels/);
    const big = ok.slice();
    big[2] = 43; // BigTIFF
    await expect(decodeTiff(big)).rejects.toThrow(/BigTIFF/);
    await expect(decodeTiff(read('rgb8-tiff_lzw.tif').subarray(0, 300))).rejects.toThrow(CodecError);
  });
});
