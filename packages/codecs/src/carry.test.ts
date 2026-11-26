import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { carryMetadata, encodeJpeg, readExif, readMetadata, readXmpEdit } from './index';

const source = new Uint8Array(readFileSync(fileURLToPath(new URL('../test/metadata/photo.jpg', import.meta.url))));
const encoded = encodeJpeg({ width: 4, height: 3, data: new Uint8Array(48).fill(90) });
const EDIT = '{"version":3,"inputs":{"main":{}},"nodes":[]}';

describe('carryMetadata', () => {
  it("carries the source's metadata onto the export, made true of it, with the edit embedded", async () => {
    const out = await readMetadata(await carryMetadata(source, encoded, { width: 4, height: 3, edit: EDIT }));
    const exif = readExif(out.exif!);
    expect(exif.find((e) => e.tag === 0x0112)!.value).toBe(1);
    expect(exif.find((e) => e.tag === 0xa002)!.value).toBe(4);
    expect(exif.some((e) => e.ifd === 'gps')).toBe(true);
    expect(readXmpEdit(out.xmp!)).toBe(EDIT);
    expect(out.icc).toBeDefined();
  });

  it("'strip' keeps the colour profile only; no source means just the edit", async () => {
    expect(Object.keys(await readMetadata(await carryMetadata(source, encoded, { metadata: 'strip', width: 4, height: 3, edit: EDIT })))).toEqual(['icc']);
    const none = await readMetadata(await carryMetadata(undefined, encoded, { width: 4, height: 3, edit: EDIT }));
    expect(Object.keys(none)).toEqual(['xmp']);
    expect(readXmpEdit(none.xmp!)).toBe(EDIT);
  });

  it('returns the export untouched when there is nothing to carry, and ignores a source it cannot read', async () => {
    expect(await carryMetadata(undefined, encoded, { width: 4, height: 3 })).toBe(encoded);
    const junk = new TextEncoder().encode('not an image');
    expect(await carryMetadata(junk, encoded, { width: 4, height: 3 })).toBe(encoded);
  });
});
