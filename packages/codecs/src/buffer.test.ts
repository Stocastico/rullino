import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { carryMetadata, decode, decodeTiff, editExif, encodeJpeg, exportMetadata, readExif, readMetadata, writeMetadata } from './index';
import { tiff } from './test-utils';

// Node's Buffer is a Uint8Array whose slice() is a view, not a copy. Code that copies with slice()
// and then writes would write into the caller's file (found through the CLI, which reads files as
// Buffers: editExif zeroed the IFD its "copied" entries still pointed into, and lost them all).
// Every entry point takes a Buffer as it takes a Uint8Array, and never writes into it.

const file = (path: string) => readFileSync(fileURLToPath(new URL(`../test/${path}`, import.meta.url)));

describe('Node Buffers in, same results, inputs untouched', () => {
  it('readMetadata / exportMetadata / editExif / writeMetadata / carryMetadata', async () => {
    const buf = file('metadata/photo.jpg');
    const copy = Buffer.from(buf);
    const plain = new Uint8Array(buf);
    const [a, b] = [await readMetadata(buf), await readMetadata(plain)];
    expect(readExif(editExif(a.exif!, { orientation: 1, dropThumbnail: true }))).toEqual(readExif(editExif(b.exif!, { orientation: 1, dropThumbnail: true })));
    const ea = exportMetadata(a, { width: 2, height: 2 });
    expect(readExif(ea.exif!).some((e) => e.ifd === 'gps')).toBe(true);
    const target = Buffer.from(encodeJpeg({ width: 2, height: 2, data: new Uint8Array(16) }));
    const targetCopy = Buffer.from(target);
    const written = await writeMetadata(target, ea);
    expect(Array.from((await readMetadata(written.bytes)).exif!)).toEqual(Array.from(ea.exif!));
    await carryMetadata(buf, target, { width: 2, height: 2 });
    expect(buf.equals(copy)).toBe(true);
    expect(target.equals(targetCopy)).toBe(true);
    expect(readExif(a.exif!)).toEqual(readExif(b.exif!)); // the read blocks were not edited either
  });

  it('editExif on a Buffer: the same edit as on a Uint8Array, the Buffer untouched', async () => {
    const exif = Buffer.from((await readMetadata(file('metadata/photo.jpg'))).exif!);
    const copy = Buffer.from(exif);
    const edits = { orientation: 1, dropThumbnail: true, remove: { gps: true, personal: true } };
    expect(Array.from(editExif(exif, edits))).toEqual(Array.from(editExif(new Uint8Array(exif), edits)));
    expect(exif.equals(copy)).toBe(true);
  });

  it('decodeTiff: an uncompressed strip with the horizontal predictor, from a Buffer, leaves the file as it was', async () => {
    const bytes = Buffer.from(tiff({ 256: [3], 257: [1], 258: [8], 259: [1], 262: [1], 277: [1], 278: [1], 317: [2] }, [Uint8Array.from([1, 1, 1])]));
    const copy = Buffer.from(bytes);
    expect(Array.from((await decodeTiff(bytes)).data)).toEqual([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]);
    expect(bytes.equals(copy)).toBe(true);
  });

  it.each(['tiff/rgb8-lzw-predictor.tif', 'tiff/rgb16-deflate-predictor.tif', 'tiff/frgb-deflate-predictor.tif', 'tiff/rgb8-raw.tif', 'pngsuite/basn6a16.png', 'jpeg/progressive-420.jpg'])('decode(%s) from a Buffer', async (path) => {
    const buf = file(path);
    const copy = Buffer.from(buf);
    const [a, b] = [await decode(buf), await decode(new Uint8Array(buf))];
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(buf.equals(copy)).toBe(true);
  });
});
