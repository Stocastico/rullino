import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeOriented, encodeJpeg, exifOrientation, orient, writeMetadata, type DecodedImage } from './index';

/** A 5 × 3 image whose every pixel differs: any wrong permutation shows. */
const image = (): DecodedImage => {
  const data = new Uint8Array(5 * 3 * 4);
  for (let i = 0; i < 15; i++) data.set([i * 16, 255 - i * 16, (i * 37) % 256, 255 - i], i * 4);
  return { width: 5, height: 3, bitDepth: 8, data };
};

describe('orient', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('orientation %i is what sharp (libvips) makes of the EXIF tag', async (o) => {
    const src = image();
    const tagged = await sharp(Buffer.from(src.data), { raw: { width: 5, height: 3, channels: 4 } }).withMetadata({ orientation: o }).png().toBuffer();
    const { data, info } = await sharp(tagged).rotate().raw().toBuffer({ resolveWithObject: true });
    const out = orient(src, o);
    expect([out.width, out.height]).toEqual([info.width, info.height]);
    expect(Array.from(out.data as Uint8Array)).toEqual(Array.from(data));
    expect(out.bitDepth).toBe(8);
  });

  it('keeps 16-bit and float samples, the profile, and does not touch its input', () => {
    const src: DecodedImage = { width: 2, height: 1, bitDepth: 16, data: Uint16Array.of(1, 2, 3, 4, 5, 6, 7, 8), icc: Uint8Array.of(9) };
    const before = Array.from(src.data);
    const out = orient(src, 2);
    expect(out.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(out.data)).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    expect(out.icc).toEqual(Uint8Array.of(9));
    expect(Array.from(src.data)).toEqual(before);
    const f: DecodedImage = { width: 1, height: 2, bitDepth: 32, data: Float32Array.of(1.5, 0, 0, 1, 2.5, 0, 0, 1) };
    expect(Array.from(orient(f, 6).data)).toEqual([2.5, 0, 0, 1, 1.5, 0, 0, 1]);
  });

  it('returns the image itself for orientation 1 or one it does not know', () => {
    const src = image();
    expect(orient(src, 1)).toBe(src);
    expect(orient(src, 9)).toBe(src);
    expect(orient(src, 0)).toBe(src);
  });
});

describe('decodeOriented', () => {
  it('decodes and turns the pixels as the EXIF orientation says', async () => {
    const src = image();
    const jpeg = encodeJpeg({ width: 5, height: 3, data: src.data as Uint8Array }, { quality: 1 });
    const tagged = (await writeMetadata(jpeg, { exif: exifWith(6) })).bytes;
    const plain = await decodeOriented(jpeg);
    const turned = await decodeOriented(tagged);
    expect([plain.width, plain.height, plain.orientation]).toEqual([5, 3, 1]);
    expect([turned.width, turned.height, turned.orientation]).toEqual([3, 5, 6]);
    expect(Array.from(turned.data as Uint8Array)).toEqual(Array.from(orient(plain, 6).data as Uint8Array));
    expect(turned.format).toBe('jpeg');
  });

  it('reads the orientation out of an EXIF blob', () => {
    expect(exifOrientation(exifWith(8))).toBe(8);
    expect(exifOrientation(undefined)).toBe(1);
    expect(exifOrientation(new Uint8Array(4))).toBe(1); // broken: 1, not an error
  });
});

/** A little-endian EXIF with IFD0 holding only Orientation. */
function exifWith(orientation: number): Uint8Array {
  const b = new Uint8Array(8 + 2 + 12 + 4);
  const v = new DataView(b.buffer);
  b.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x0112, true);
  v.setUint16(12, 3, true);
  v.setUint32(14, 1, true);
  v.setUint16(18, orientation, true);
  return b;
}
