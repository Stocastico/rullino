import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CodecError, decode, decodeJpeg, decodePng, decodeTiff, detectFormat, type DecodedImage } from './index';

const file = (path: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../test/${path}`, import.meta.url))));

describe('detectFormat', () => {
  it('names the formats from their first bytes', async () => {
    const pixel = { create: { width: 2, height: 2, channels: 3 as const, background: '#c83' } };
    const made = async (f: 'webp' | 'avif' | 'heif' | 'gif' | 'jxl') => new Uint8Array(await sharp(pixel).toFormat(f, f === 'heif' ? { compression: 'av1' } : {}).toBuffer());
    expect(detectFormat(file('pngsuite/basn2c08.png'))).toBe('png');
    expect(detectFormat(file('jpeg/baseline-420.jpg'))).toBe('jpeg');
    expect(detectFormat(file('tiff/rgb8-raw.tif'))).toBe('tiff');
    expect(detectFormat(file('tiff/rgb8-msb.tif'))).toBe('tiff');
    expect(detectFormat(await made('webp'))).toBe('webp');
    expect(detectFormat(await made('avif'))).toBe('avif');
    expect(detectFormat(await made('gif'))).toBe('gif');
    // HEIC (HEVC) and JPEG XL by their signatures, as sharp's prebuilt binaries write neither.
    expect(detectFormat(Uint8Array.from([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1heic')]))).toBe('heic');
    expect(detectFormat(Uint8Array.from([0, 0, 0, 24, ...new TextEncoder().encode('ftypmif1'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1avif')]))).toBe('avif');
    expect(detectFormat(Uint8Array.from([0xff, 0x0a, 0xfa, 0x18]))).toBe('jxl');
    expect(detectFormat(Uint8Array.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]))).toBe('jxl');
    expect(detectFormat(Uint8Array.from([0x42, 0x4d, ...new Array(20).fill(0)]))).toBe('bmp');
    expect(detectFormat(new TextEncoder().encode('hello, world'))).toBeUndefined();
    expect(detectFormat(new Uint8Array(0))).toBeUndefined();
  });
});

describe('decode', () => {
  it('uses the built-in decoder of each format and says which it was', async () => {
    for (const [path, d, format] of [
      ['pngsuite/basn2c08.png', decodePng, 'png'],
      ['jpeg/baseline-420.jpg', decodeJpeg, 'jpeg'],
      ['tiff/rgb16.tif', decodeTiff, 'tiff'],
    ] as const) {
      const bytes = file(path);
      const img = await decode(bytes);
      expect(img.format).toBe(format);
      expect(Array.from(img.data)).toEqual(Array.from((await d(bytes)).data));
    }
  });

  it('takes decoders for other formats, and can replace a built-in one', async () => {
    const webp = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).webp({ lossless: true }).toBuffer());
    const viaSharp = async (bytes: Uint8Array): Promise<DecodedImage> => {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, bitDepth: 8, data: new Uint8Array(data) };
    };
    await expect(decode(webp)).rejects.toThrow(/no decoder for webp: pass one as decoders: \{ webp: … \}/);
    const img = await decode(webp, { decoders: { webp: viaSharp } });
    expect([img.format, img.width, img.height, ...img.data.subarray(0, 4)]).toEqual(['webp', 3, 2, 10, 20, 30, 255]);
    let used = false;
    await decode(file('pngsuite/basn2c08.png'), { decoders: { png: (b) => ((used = true), decodePng(b)) } });
    expect(used).toBe(true);
  });

  it('checks what an injected decoder returns, and passes it maxPixels', async () => {
    const webp = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).webp().toBuffer());
    const returning = (img: unknown) => decode(webp, { decoders: { webp: () => img as DecodedImage } });
    await expect(returning({ width: 2, height: 2, bitDepth: 8, data: new Uint8Array(15) })).rejects.toThrow(/15 samples for 2×2 RGBA/);
    await expect(returning({ width: 2, height: 2, bitDepth: 16, data: new Uint8Array(16) })).rejects.toThrow(/Uint8Array for 16-bit/);
    await expect(returning({ width: 0, height: 2, bitDepth: 8, data: new Uint8Array(0) })).rejects.toThrow(/invalid size/);
    await expect(returning({ width: 2, height: 2, bitDepth: 12, data: new Uint8Array(16) })).rejects.toThrow(/bit depth 12/);
    await expect(returning(undefined)).rejects.toThrow(CodecError);
    let seen = 0;
    await decode(webp, { maxPixels: 99, decoders: { webp: (_, o) => ((seen = o.maxPixels!), { width: 2, height: 2, bitDepth: 8, data: new Uint8Array(16) }) } });
    expect(seen).toBe(99);
    await expect(decode(webp, { maxPixels: 3, decoders: { webp: () => ({ width: 2, height: 2, bitDepth: 8, data: new Uint8Array(16) }) } })).rejects.toThrow(/larger than maxPixels/);
  });

  it('an unknown format is a CodecError', async () => {
    await expect(decode(new TextEncoder().encode('not an image'))).rejects.toThrow(/unknown format/);
  });
});
