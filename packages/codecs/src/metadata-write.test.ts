import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { encodeJpeg, readMetadata, writeMetadata, type ImageMetadata } from './index';

// What writeMetadata puts into a file must come back through readMetadata and through libvips
// (sharp), and leave the pixels alone, for every container and kind of bitstream.

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const source = await readMetadata(new Uint8Array(readFileSync(dir + 'photo.png')));
const meta: ImageMetadata = { ...source, text: [...source.text!, { keyword: 'Comment', text: 'città ✓' }] };

const rgba = { width: 9, height: 7, data: Uint8Array.from({ length: 9 * 7 * 4 }, (_, i) => (i % 4 === 3 ? (i % 8 === 3 ? 255 : 128) : (i * 29) % 256)) };
const raw = { raw: { width: 9, height: 7, channels: 4 as const } };
const bases: [string, () => Promise<Uint8Array>][] = [
  ['JPEG (our encoder)', async () => encodeJpeg(rgba)],
  ['JPEG (libjpeg, with its own APP segments)', async () => new Uint8Array(await sharp(rgba.data, raw).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'old' } } }).toBuffer())],
  ['PNG', async () => new Uint8Array(await sharp(rgba.data, raw).png().toBuffer())],
  ['WebP lossless (VP8L, alpha)', async () => new Uint8Array(await sharp(rgba.data, raw).webp({ lossless: true }).toBuffer())],
  ['WebP lossy (VP8 + ALPH)', async () => new Uint8Array(await sharp(rgba.data, raw).webp({ quality: 80 }).toBuffer())],
  ['WebP lossy opaque (simple VP8)', async () => new Uint8Array(await sharp(rgba.data, raw).removeAlpha().webp({ quality: 80 }).toBuffer())],
  ['WebP with an ICC profile already (VP8X)', async () => new Uint8Array(await sharp(rgba.data, raw).webp({ lossless: true }).withMetadata({ icc: 'p3' }).toBuffer())],
];

// Without colour management: libvips would convert through the embedded profile, which writeMetadata changes.
const pixels = async (b: Uint8Array) => Array.from(await sharp(b, { ignoreIcc: true }).ensureAlpha().raw().toBuffer());

describe.each(bases)('writeMetadata into %s', (_, make) => {
  it('every block comes back, through readMetadata and libvips, and the pixels are unchanged', async () => {
    const base = await make();
    const { bytes, dropped } = await writeMetadata(base, meta);
    expect(dropped).toEqual([]);
    const back = await readMetadata(bytes);
    expect(Array.from(back.exif!)).toEqual(Array.from(meta.exif!));
    expect(back.xmp).toBe(meta.xmp);
    expect(Array.from(back.icc!)).toEqual(Array.from(meta.icc!));
    const isWebp = bytes[8] === 0x57;
    if (!isWebp) expect(Array.from(back.iptc!)).toEqual(Array.from(meta.iptc!));
    if (bytes[1] === 0x50) expect(back.text).toEqual(meta.text);
    const vips = await sharp(bytes).metadata();
    expect(Array.from(vips.icc!)).toEqual(Array.from(meta.icc!));
    expect(new TextDecoder().decode(vips.xmp)).toBe(meta.xmp);
    const exif = new Uint8Array(vips.exif!);
    expect(Array.from(exif.subarray(exif.length - meta.exif!.length))).toEqual(Array.from(meta.exif!)); // libvips may prefix "Exif\0\0"
    expect(await pixels(bytes)).toEqual(await pixels(base));
  });

  it('writing again replaces the blocks instead of adding a second set', async () => {
    const once = (await writeMetadata(await make(), meta)).bytes;
    const twice = (await writeMetadata(once, { exif: meta.exif!, xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>' })).bytes;
    const back = await readMetadata(twice);
    expect(back.xmp).toBe('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>');
    expect(back.icc).toBeUndefined();
    expect(back.iptc).toBeUndefined();
    expect(back.text).toBeUndefined();
    expect(await pixels(twice)).toEqual(await pixels(once));
  });

  it('no metadata: the image keeps its pixels and carries none of ours', async () => {
    const base = await make();
    const { bytes } = await writeMetadata(base, {});
    const back = await readMetadata(bytes);
    expect(back.xmp ?? back.iptc ?? back.text).toBeUndefined();
    expect(await pixels(bytes)).toEqual(await pixels(base));
  });
});

describe('writeMetadata', () => {
  it('a JPEG block too large for its segment is dropped and reported, never truncated', async () => {
    const big: ImageMetadata = { exif: new Uint8Array(70_000), xmp: 'x'.repeat(70_000), icc: new Uint8Array(200_000).fill(3) };
    const { bytes, dropped } = await writeMetadata(encodeJpeg(rgba), big);
    expect(dropped.sort()).toEqual(['exif', 'xmp']);
    expect((await readMetadata(bytes)).icc!.length).toBe(200_000); // ICC spans segments
  });

  it('refuses a format it cannot write into', async () => {
    await expect(writeMetadata(new TextEncoder().encode('GIF89a......'), {})).rejects.toThrow(/gif/);
  });
});
