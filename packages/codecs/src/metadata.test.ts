import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readExif, readIptc, readMetadata } from './index';

// The fixtures (test/metadata/, made by test/make-metadata-fixtures.py) carry the same metadata in
// every format, written by exiftool; <file>.json is exiftool's own reading, the reference here.

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
const reference = (name: string): Record<string, unknown> => JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8'));
const icc = read('srgb.icc');

/** EXIF tags exiftool names, by IFD and tag number. */
const EXIF_NAMES: [string, 'ifd0' | 'exif' | 'gps', number][] = [
  ['IFD0:Make', 'ifd0', 0x010f],
  ['IFD0:Model', 'ifd0', 0x0110],
  ['IFD0:Orientation', 'ifd0', 0x0112],
  ['IFD0:Software', 'ifd0', 0x0131],
  ['IFD0:Artist', 'ifd0', 0x013b],
  ['IFD0:Copyright', 'ifd0', 0x8298],
  ['ExifIFD:DateTimeOriginal', 'exif', 0x9003],
  ['ExifIFD:OwnerName', 'exif', 0xa430],
  ['ExifIFD:SerialNumber', 'exif', 0xa431],
  ['ExifIFD:LensSerialNumber', 'exif', 0xa435],
  ['ExifIFD:ImageUniqueID', 'exif', 0xa420],
  ['GPS:GPSLatitudeRef', 'gps', 0x0001],
  ['GPS:GPSLongitudeRef', 'gps', 0x0003],
];

describe('readMetadata', () => {
  it.each(['photo.jpg', 'photo.png', 'photo.webp'])('%s: EXIF, XMP, IPTC and ICC as exiftool reads them', async (name) => {
    const meta = await readMetadata(read(name));
    const ref = reference(name);
    const entries = readExif(meta.exif!);
    const value = (ifd: string, tag: number) => entries.find((e) => e.ifd === ifd && e.tag === tag)?.value;
    for (const [key, ifd, tag] of EXIF_NAMES) expect([key, value(ifd, tag)]).toEqual([key, ref[key]]);
    // GPS position as rationals: degrees, minutes, seconds.
    const lat = value('gps', 0x0002) as number[];
    expect(lat[0]! + lat[1]! / 60 + lat[2]! / 3600).toBeCloseTo(ref['GPS:GPSLatitude'] as number, 6);
    expect(entries.some((e) => e.ifd === 'ifd1')).toBe(true); // the thumbnail's IFD
    expect(meta.xmp).toContain('Jane Photographer');
    expect(meta.xmp).toContain('<x:xmpmeta');
    expect(Array.from(meta.icc!)).toEqual(Array.from(icc));
    if (name !== 'photo.webp') {
      // WebP has no IPTC (exiftool writes it into XMP there).
      const iptc = readIptc(meta.iptc!);
      const get = (n: number) => iptc.filter((d) => d.record === 2 && d.dataset === n).map((d) => new TextDecoder().decode(d.data));
      expect(get(80)).toEqual([ref['IPTC:By-line']]);
      expect(get(120)).toEqual([ref['IPTC:Caption-Abstract']]);
      expect(get(25)).toEqual(ref['IPTC:Keywords']);
      expect(get(90)).toEqual([ref['IPTC:City']]);
    }
  });

  it('PNG: the other text chunks are kept, by keyword', async () => {
    const meta = await readMetadata(read('photo.png'));
    expect(meta.text).toEqual([
      { keyword: 'Artist', text: 'Jane Photographer' },
      { keyword: 'Copyright', text: 'CC0' },
      { keyword: 'Make', text: 'RullinoCam' },
      { keyword: 'Model', text: 'Test Model 1' },
      { keyword: 'Software', text: 'fixture' },
    ]);
  });

  it('TIFF: XMP, IPTC and ICC (its EXIF lives in the image directory and is not read yet)', async () => {
    const meta = await readMetadata(read('photo.tif'));
    expect(meta.xmp).toContain('Jane Photographer');
    expect(readIptc(meta.iptc!).some((d) => d.dataset === 80)).toBe(true);
    expect(Array.from(meta.icc!)).toEqual(Array.from(icc));
    expect(meta.exif).toBeUndefined();
  });

  it('an ICC profile with a chunk missing is left out (found by the fuzz test: a sequence number of 255)', async () => {
    const jpeg = read('photo.jpg').slice();
    const at = jpeg.findIndex((v, i) => v === 0xff && jpeg[i + 1] === 0xe2);
    jpeg[at + 4 + 12] = 2; // "chunk 2 of 1": the only chunk is not the first
    expect((await readMetadata(jpeg)).icc).toBeUndefined();
    jpeg[at + 4 + 12] = 255;
    expect((await readMetadata(jpeg)).icc).toBeUndefined();
  });

  it('a file without metadata gives an empty object; an unknown format is a CodecError', async () => {
    const plain = new Uint8Array(readFileSync(fileURLToPath(new URL('../test/jpeg/baseline-420.jpg', import.meta.url))));
    expect(await readMetadata(plain)).toEqual({});
    await expect(readMetadata(new TextEncoder().encode('not an image'))).rejects.toThrow(/unknown format/);
  });
});
