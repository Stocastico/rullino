import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CodecError, decodePng, type DecodedImage } from './index';
import { crc32 } from './png';
import { ihdr, png, zlib } from './test-utils';

// PngSuite (Willem van Schaik, free for any use: test/pngsuite/PngSuite.LICENSE): every colour type,
// bit depth, filter, interlacing, palette and transparency case, plus the x*.png files that must be
// refused. The reference is sharp (libvips + libspng), expanded here to RGBA at the file's own depth.

const dir = fileURLToPath(new URL('../test/pngsuite/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
const valid = files.filter((f) => !f.startsWith('x'));
const corrupt = files.filter((f) => f.startsWith('x'));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));

/** sharp's decode of `bytes` as RGBA at 8 or 16 bits (grey replicated, alpha added as opaque). */
async function reference(bytes: Uint8Array, bitDepth: 8 | 16): Promise<Uint8Array | Uint16Array> {
  // At 16 bits sharp must be told to stay in grey16 / rgb16: its raw output otherwise converts to 8-bit sRGB.
  const space = (await sharp(bytes).metadata()).space;
  const decoded = bitDepth === 16 ? sharp(bytes).toColourspace(space) : sharp(bytes);
  const { data, info } = await decoded.raw({ depth: bitDepth === 16 ? 'ushort' : 'uchar' }).toBuffer({ resolveWithObject: true });
  const src = bitDepth === 16 ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : new Uint8Array(data.buffer, data.byteOffset, data.length);
  const n = info.width * info.height;
  const out = bitDepth === 16 ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  const max = bitDepth === 16 ? 65535 : 255;
  const c = info.channels;
  for (let i = 0; i < n; i++) {
    const s = i * c;
    const [r, g, b, a] = c === 1 ? [src[s]!, src[s]!, src[s]!, max] : c === 2 ? [src[s]!, src[s]!, src[s]!, src[s + 1]!] : c === 3 ? [src[s]!, src[s + 1]!, src[s + 2]!, max] : [src[s]!, src[s + 1]!, src[s + 2]!, src[s + 3]!];
    out.set([r, g, b, a], i * 4);
  }
  return out;
}

describe('decodePng on PngSuite', () => {
  it.each(valid)('%s decodes to the same RGBA as sharp', async (name) => {
    const bytes = read(name);
    const img: DecodedImage = await decodePng(bytes);
    const meta = await sharp(bytes).metadata();
    expect([img.width, img.height]).toEqual([meta.width, meta.height]);
    expect(img.bitDepth).toBe(meta.depth === 'ushort' ? 16 : 8);
    expect(img.data).toBeInstanceOf(img.bitDepth === 16 ? Uint16Array : Uint8Array);
    expect(img.data.length).toBe(img.width * img.height * 4);
    const ref = await reference(bytes, img.bitDepth as 8 | 16);
    // Compare as plain arrays only on failure (a 32×32 image is 4096 values).
    if (!img.data.every((v, i) => v === ref[i])) expect(Array.from(img.data)).toEqual(Array.from(ref));
  });

  it.each(corrupt)('%s is refused with a CodecError', async (name) => {
    await expect(decodePng(read(name))).rejects.toThrow(CodecError);
  });
});

describe('decodePng', () => {
  it('keeps an embedded ICC profile (iCCP) as bytes', async () => {
    const profile = Array.from({ length: 300 }, (_, i) => (i * 7) & 255);
    const bytes = png([
      ['IHDR', ihdr(1, 1, 8, 0)],
      ['iCCP', [...'test\0'].map((c) => c.charCodeAt(0)).concat([0], [...(await zlib(profile))])],
      ['IDAT', await zlib([0, 128])],
      ['IEND', []],
    ]);
    const img = await decodePng(bytes);
    expect(Array.from(img.icc!)).toEqual(profile);
    expect(Array.from(img.data)).toEqual([128, 128, 128, 255]);
  });

  it('grows the buffer for a large profile, and refuses one that inflates past 16 MB', async () => {
    const chunk = async (size: number) => png([
      ['IHDR', ihdr(1, 1, 8, 0)],
      ['iCCP', [...'big\0'].map((c) => c.charCodeAt(0)).concat([0], [...(await zlib(new Uint8Array(size).fill(7)))])],
      ['IDAT', await zlib([0, 1])],
      ['IEND', []],
    ]);
    expect((await decodePng(await chunk(300_000))).icc!.length).toBe(300_000);
    await expect(decodePng(await chunk(16 * 1024 * 1024 + 1))).rejects.toThrow(/ICC profile inflates to more than/);
  });

  it('has no icc without an iCCP chunk', async () => {
    expect((await decodePng(read('basn2c08.png'))).icc).toBeUndefined();
  });

  it('refuses an image above maxPixels before inflating anything', async () => {
    // 100 000 × 100 000 with one byte of data: must fail on the header, not try to allocate 40 GB.
    const bytes = png([['IHDR', ihdr(100_000, 100_000, 8, 6)], ['IDAT', await zlib([0])], ['IEND', []]]);
    await expect(decodePng(bytes)).rejects.toThrow(/100000×100000 is larger than maxPixels/);
    await expect(decodePng(read('basn2c08.png'), { maxPixels: 1023 })).rejects.toThrow(CodecError);
    await expect(decodePng(read('basn2c08.png'), { maxPixels: 1024 })).resolves.toBeDefined();
  });

  it('refuses truncated image data, a missing IEND and a cut file', async () => {
    const full = await zlib([0, 1, 2, 3, 0, 4, 5, 6]);
    await expect(decodePng(png([['IHDR', ihdr(1, 2, 8, 2)], ['IDAT', await zlib([0, 1, 2, 3])], ['IEND', []]]))).rejects.toThrow(/truncated/);
    await expect(decodePng(png([['IHDR', ihdr(1, 2, 8, 2)], ['IDAT', full]]))).rejects.toThrow(/IEND/);
    const ok = png([['IHDR', ihdr(1, 2, 8, 2)], ['IDAT', full], ['IEND', []]]);
    await expect(decodePng(ok)).resolves.toMatchObject({ width: 1, height: 2 });
    for (const cut of [10, 30, ok.length - 5]) await expect(decodePng(ok.subarray(0, cut))).rejects.toThrow(CodecError);
  });

  it('refuses a palette image without PLTE, a bad filter type and IDAT chunks split by another chunk', async () => {
    await expect(decodePng(png([['IHDR', ihdr(1, 1, 8, 3)], ['IDAT', await zlib([0, 0])], ['IEND', []]]))).rejects.toThrow(/PLTE/);
    await expect(decodePng(png([['IHDR', ihdr(1, 1, 8, 0)], ['IDAT', await zlib([5, 0])], ['IEND', []]]))).rejects.toThrow(/filter/);
    const data = await zlib([0, 7, 0, 9]);
    const split = png([['IHDR', ihdr(1, 2, 8, 0)], ['IDAT', data.subarray(0, 4)], ['tEXt', [65, 0, 66]], ['IDAT', data.subarray(4)], ['IEND', []]]);
    await expect(decodePng(split)).rejects.toThrow(/IDAT/);
    const consecutive = png([['IHDR', ihdr(1, 2, 8, 0)], ['IDAT', data.subarray(0, 4)], ['IDAT', data.subarray(4)], ['IEND', []]]);
    expect(Array.from((await decodePng(consecutive)).data)).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);
  });

  it('a palette index past the palette is an error', async () => {
    await expect(decodePng(png([['IHDR', ihdr(1, 1, 8, 3)], ['PLTE', [1, 2, 3]], ['IDAT', await zlib([0, 1])], ['IEND', []]]))).rejects.toThrow(/palette/);
  });

  it('the RGB tRNS key must match all three samples, at 8 and 16 bits', async () => {
    const rgb8 = png([['IHDR', ihdr(4, 1, 8, 2)], ['tRNS', [0, 1, 0, 2, 0, 3]], ['IDAT', await zlib([0, 1, 2, 3, 1, 9, 3, 9, 2, 3, 1, 2, 9])], ['IEND', []]]);
    expect(Array.from((await decodePng(rgb8)).data)).toEqual([1, 2, 3, 0, 1, 9, 3, 255, 9, 2, 3, 255, 1, 2, 9, 255]);
    const rgb16 = png([['IHDR', ihdr(4, 1, 16, 2)], ['tRNS', [1, 0, 2, 0, 3, 0]], ['IDAT', await zlib([0, 1, 0, 2, 0, 3, 0, 1, 0, 2, 0, 3, 1, 1, 0, 2, 1, 3, 0, 1, 1, 2, 0, 3, 0])], ['IEND', []]]);
    expect(Array.from((await decodePng(rgb16)).data)).toEqual([256, 512, 768, 0, 256, 512, 769, 65535, 256, 513, 768, 65535, 257, 512, 768, 65535]);
  });

  it('skips an unknown ancillary chunk and refuses an unknown critical one', async () => {
    const body = await zlib([0, 50]);
    expect(Array.from((await decodePng(png([['IHDR', ihdr(1, 1, 8, 0)], ['ruLn', [1, 2, 3]], ['IDAT', body], ['IEND', []]]))).data)).toEqual([50, 50, 50, 255]);
    await expect(decodePng(png([['IHDR', ihdr(1, 1, 8, 0)], ['RuLn', [1, 2, 3]], ['IDAT', body], ['IEND', []]]))).rejects.toThrow(/critical chunk RuLn/);
  });

  it('Paeth breaks ties with the upper-left byte towards the left one, then the upper one', async () => {
    // Grey 2×2, rows [c, b] (no filter) and [a, ·] (Paeth). Pixel (0, 1) predicts from up = c, so it
    // stores a − c; pixel (1, 1) stores 0 and so decodes to its predictor from left a, up b, upper left c.
    const predictor = async (a: number, b: number, c: number) =>
      (await decodePng(png([['IHDR', ihdr(2, 2, 8, 0)], ['IDAT', await zlib([0, c, b, 4, (a - c) & 255, 0])], ['IEND', []]]))).data[12];
    expect(await predictor(0, 30, 20)).toBe(0); // p = 10: pa = 10, pb = 20, pc = 10 → a
    expect(await predictor(30, 0, 20)).toBe(0); // p = 10: pa = 20, pb = 10, pc = 10 → b
    expect(await predictor(30, 40, 20)).toBe(40); // p = 50: pa = 20, pb = 10, pc = 30 → b
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('crc32 equals the bitwise definition on every length and offset up to 40 bytes', () => {
    const bitwise = (b: Uint8Array, from: number, to: number) => {
      let c = 0xffffffff;
      for (let i = from; i < to; i++) {
        c ^= b[i]!;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const bytes = Uint8Array.from({ length: 48 }, (_, i) => (i * 167 + 13) & 255);
    for (let from = 0; from < 8; from++) for (let to = from; to <= from + 40; to++) expect(crc32(bytes, from, to)).toBe(bitwise(bytes, from, to));
    expect(crc32(bytes.subarray(3))).toBe(bitwise(bytes, 3, 48));
  });
});
