import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, exportMetadata, readExif, readIptc, readMetadata, readXmpEdit, type ImageMetadata } from './index';

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const jpeg = await readMetadata(new Uint8Array(readFileSync(dir + 'photo.jpg')));
const png = await readMetadata(new Uint8Array(readFileSync(dir + 'photo.png')));
const EDIT = '{"version":3,"inputs":{"main":{}},"nodes":[{"id":"edit","from":"main","steps":[]}]}';
const PERSONAL = ['Jane Photographer', 'Jane Doe', 'SN-123456', 'LSN-987', 'private note'];

/** Every block's text, to search for what must not be there. */
const allText = (m: ImageMetadata) =>
  [m.exif, m.iptc].map((b) => (b ? String.fromCharCode(...b) : '')).join('|') + (m.xmp ?? '') + (m.text ?? []).map((t) => `${t.keyword}=${t.text}`).join('|');
const exifValue = (m: ImageMetadata, ifd: string, tag: number) => readExif(m.exif!).find((e) => e.ifd === ifd && e.tag === tag)?.value;

describe('exportMetadata', () => {
  it("'keep' (the default): everything stays, orientation 1, the new size, no thumbnail, the edit embedded", () => {
    const out = exportMetadata(jpeg, { width: 800, height: 600, edit: EDIT });
    expect(exifValue(out, 'ifd0', 0x0112)).toBe(1);
    expect([exifValue(out, 'exif', 0xa002), exifValue(out, 'exif', 0xa003)]).toEqual([800, 600]);
    expect(readExif(out.exif!).some((e) => e.ifd === 'ifd1')).toBe(false);
    expect(readExif(out.exif!).some((e) => e.ifd === 'gps')).toBe(true);
    expect(readXmpEdit(out.xmp!)).toBe(EDIT);
    expect(out.xmp).toContain('Jane Photographer');
    expect(Array.from(out.iptc!)).toEqual(Array.from(jpeg.iptc!));
    expect(Array.from(out.icc!)).toEqual(Array.from(jpeg.icc!));
    for (const s of PERSONAL.slice(0, 3)) expect(allText(out)).toContain(s);
  });

  it("'strip': only the colour profile stays (it says how to read the pixels), no edit embedded", () => {
    const out = exportMetadata(png, { metadata: 'strip', width: 8, height: 6, edit: EDIT });
    expect(Object.keys(out)).toEqual(['icc']);
    expect(Array.from(out.icc!)).toEqual(Array.from(png.icc!));
  });

  it("{ strip: ['gps'] }: no coordinates in EXIF or XMP, the rest kept", () => {
    const out = exportMetadata(jpeg, { metadata: { strip: ['gps'] }, width: 8, height: 6 });
    expect(readExif(out.exif!).some((e) => e.ifd === 'gps' || e.tag === 0x8825)).toBe(false);
    expect(out.xmp).not.toMatch(/GPS/);
    expect(allText(out)).toContain('Jane Photographer');
  });

  it("{ strip: ['personal'] }: no name, owner, serial number or comment in any block, GPS kept", () => {
    for (const m of [jpeg, png]) {
      for (const s of PERSONAL.slice(0, 3)) expect(allText(m)).toContain(s);
      const out = exportMetadata(m, { metadata: { strip: ['personal'] }, width: 8, height: 6, edit: EDIT });
      for (const s of PERSONAL) expect([s, allText(out).includes(s)]).toEqual([s, false]);
      expect(readExif(out.exif!).some((e) => e.ifd === 'gps')).toBe(true);
      expect(readXmpEdit(out.xmp!)).toBe(EDIT);
      if (out.iptc) expect(readIptc(out.iptc).some((d) => d.dataset === 80)).toBe(false);
      expect(allText(out)).toContain('Milano');
    }
    expect(exportMetadata(png, { metadata: { strip: ['personal'] }, width: 1, height: 1 }).text!.map((t) => t.keyword)).toEqual(['Copyright', 'Make', 'Model', 'Software']);
  });

  it('a block it cannot read is dropped, never copied as it is', () => {
    const broken = { ...jpeg, exif: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), xmp: '<x:xmpmeta><a></b>', iptc: Uint8Array.from([7, 7, 7]) };
    const out = exportMetadata(broken, { metadata: { strip: ['gps'] }, width: 1, height: 1, edit: EDIT });
    expect(out.exif).toBeUndefined();
    expect(out.iptc).toBeUndefined();
    expect(readXmpEdit(out.xmp!)).toBe(EDIT); // a fresh packet for the edit
    expect(out.xmp).not.toContain('<a>');
    expect(exportMetadata({ xmp: '<x' }, { width: 1, height: 1 }).xmp).toBeUndefined();
  });

  it('refuses an unknown policy', () => {
    expect(() => exportMetadata(jpeg, { metadata: 'drop' as 'strip', width: 1, height: 1 })).toThrow(CodecError);
    expect(() => exportMetadata(jpeg, { metadata: { strip: ['faces' as 'gps'] }, width: 1, height: 1 })).toThrow(/faces/);
  });
});
