import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CodecError, decodeTiff, encodeTiff, type TiffImage } from './index';

// What encodeTiff writes must read back exactly, through decodeTiff and through libtiff (sharp), for
// every depth, with and without alpha, in every compression.

function noise(width: number, height: number, bitDepth: 8 | 16 | 32, seed: number, alpha: boolean): TiffImage {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) / 2 ** 24;
  const n = width * height * 4;
  const max = bitDepth === 8 ? 255 : bitDepth === 16 ? 65535 : 1;
  const data = bitDepth === 8 ? new Uint8Array(n) : bitDepth === 16 ? new Uint16Array(n) : new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = i % 4 === 3 && !alpha ? max : bitDepth === 32 ? rnd() * 3 - 0.5 : Math.floor(rnd() * (max + 1));
  return { width, height, bitDepth, data } as TiffImage;
}

/** libtiff's reading through sharp, as RGBA at the file's depth. */
async function libtiff(file: Uint8Array, bitDepth: 8 | 16 | 32) {
  const meta = await sharp(file).metadata();
  // Past 8 bits sharp must be told to keep the file's colour space, or it converts to 8-bit sRGB.
  const s = bitDepth === 8 ? sharp(file) : sharp(file).toColourspace(meta.space!);
  const { data, info } = await s.raw({ depth: bitDepth === 8 ? 'uchar' : bitDepth === 16 ? 'ushort' : 'float' }).toBuffer({ resolveWithObject: true });
  const src = bitDepth === 8 ? new Uint8Array(data) : bitDepth === 16 ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : new Float32Array(data.buffer, data.byteOffset, data.length / 4);
  const max = bitDepth === 8 ? 255 : bitDepth === 16 ? 65535 : 1;
  const out = Array.from({ length: info.width * info.height * 4 }, (_, i) => (i % 4 === 3 && info.channels === 3 ? max : src[Math.floor(i / 4) * info.channels + (i % 4)]!));
  return out;
}

/** Equal sample for sample; on failure names the first difference (a full diff of 250 000 values takes minutes). */
function same(actual: ArrayLike<number>, wanted: ArrayLike<number>) {
  expect(actual.length).toBe(wanted.length);
  for (let i = 0; i < actual.length; i++) if (!Object.is(actual[i], wanted[i])) expect.fail(`sample ${i}: ${actual[i]} vs ${wanted[i]}`);
}

const cases = [8, 16, 32].flatMap((bitDepth) => [false, true].flatMap((alpha) => (['none', 'deflate', 'lzw'] as const).map((compression) => ({ bitDepth: bitDepth as 8 | 16 | 32, alpha, compression }))));

describe('encodeTiff', () => {
  it.each(cases)('$bitDepth-bit, alpha $alpha, $compression: decodeTiff and libtiff read the input back exactly', async ({ bitDepth, alpha, compression }) => {
    const img = noise(37, 23, bitDepth, bitDepth * 7 + (alpha ? 1 : 0), alpha);
    const file = await encodeTiff(img, { compression });
    const ours = await decodeTiff(file);
    expect(ours.bitDepth).toBe(bitDepth);
    same(ours.data, img.data);
    same(await libtiff(file, bitDepth), img.data);
  });

  it('LZW past several table resets, read back by libtiff', async () => {
    const img = noise(301, 211, 8, 5, true);
    const file = await encodeTiff(img, { compression: 'lzw' });
    same(await libtiff(file, 8), img.data);
    same((await decodeTiff(file)).data, img.data);
  });

  it('alpha is written only when needed unless asked, and an ICC profile travels', async () => {
    const opaque = noise(5, 4, 8, 1, false);
    expect((await sharp(await encodeTiff(opaque)).metadata()).channels).toBe(3);
    expect((await sharp(await encodeTiff(opaque, { alpha: true })).metadata()).channels).toBe(4);
    const icc = Uint8Array.from({ length: 1001 }, (_, i) => i & 255);
    const file = await encodeTiff(opaque, { icc });
    expect(Array.from((await decodeTiff(file)).icc!)).toEqual(Array.from(icc));
  });

  it('puts the IFD on a word boundary, as the specification requires, after strip data of odd length', async () => {
    // 1×1 RGB uncompressed: 3 bytes of strip data after the 8-byte header.
    const file = await encodeTiff({ width: 1, height: 1, bitDepth: 8, data: Uint8Array.from([1, 2, 3, 255]) }, { compression: 'none' });
    expect(new DataView(file.buffer).getUint32(4, true)).toBe(12);
  });

  it('refuses bad input with a CodecError', async () => {
    await expect(encodeTiff({ width: 0, height: 1, bitDepth: 8, data: new Uint8Array(0) })).rejects.toThrow(CodecError);
    await expect(encodeTiff({ width: 2, height: 1, bitDepth: 8, data: new Uint8Array(4) })).rejects.toThrow(/expected 8/);
    await expect(encodeTiff({ width: 1, height: 1, bitDepth: 8, data: new Uint8Array(4) }, { compression: 'jpeg' as 'lzw' })).rejects.toThrow(/compression/);
  });
});
