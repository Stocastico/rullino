import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, decode, decodeExr, detectFormat } from './index';

// Fixtures: test/hdr/, made by make-hdr-fixtures.py with imagecodecs (OpenEXR 3). The compressions
// OpenEXR writes losslessly (none, RLE, ZIPS, ZIP, PIZ) must decode to the array that was written,
// bit for bit (colour divided by alpha: EXR stores it premultiplied); PXR24 (float is lossy), B44 and
// DWA are refused by name.

const dir = fileURLToPath(new URL('../test/hdr/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
type Entry = { width: number; height: number; reference: string; format: string; compression?: number; lossless?: boolean };
const manifest: Record<string, Entry> = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
const exrs = Object.keys(manifest).filter((n) => manifest[n]!.format === 'exr');
const reference = (name: string) => {
  const b = read(manifest[name]!.reference);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};

describe('decodeExr', () => {
  it.each(exrs.filter((n) => manifest[n]!.lossless))('%s decodes to the reference, bit for bit', async (name) => {
    const m = manifest[name]!;
    const img = await decodeExr(read(name));
    expect([img.width, img.height, img.bitDepth]).toEqual([m.width, m.height, 32]);
    const got = img.data as Float32Array;
    const want = reference(name);
    const wrong = Array.from(got).findIndex((v, i) => !Object.is(v, want[i]));
    expect(wrong, `sample ${wrong}: ${got[wrong]} against ${want[wrong]}`).toBe(-1);
    expect(img.linear).toBe(true);
  });

  it.each(exrs.filter((n) => !manifest[n]!.lossless))('%s: a compression it does not read is refused by name', async (name) => {
    await expect(decodeExr(read(name))).rejects.toThrow(/compression/);
  });

  it('is found by detectFormat and decode', async () => {
    expect(detectFormat(read('one-none-half.exr'))).toBe('exr');
    expect((await decode(read('block-zip-half.exr'))).format).toBe('exr');
  });

  it('refuses what it cannot read with a CodecError, never a wrong image', async () => {
    const good = read('rgba-zip-float32.exr');
    const cases: [string, Uint8Array][] = [
      ['empty', new Uint8Array(0)],
      ['not EXR', new TextEncoder().encode('hello world, this is not an image')],
      ['bad version', Uint8Array.from(good, (v, i) => (i === 4 ? 9 : v))],
      ['tiled', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x02 : v))],
      ['deep', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x08 : v))],
      ['multipart', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x10 : v))],
      ['header only', good.subarray(0, 60)],
      ['no pixel data', good.subarray(0, good.length - 40)],
      ['truncated offset table', good.subarray(0, 600)],
    ];
    for (const [name, bytes] of cases) await expect(decodeExr(bytes), name).rejects.toThrow(CodecError);
  });

  it('checks the size against maxPixels before reading pixels', async () => {
    await expect(decodeExr(read('rgba-none-float16.exr'), { maxPixels: 100 })).rejects.toThrow(/larger than maxPixels/);
  });

  it('reads the chromaticities the file names, when it names some', async () => {
    const img = await decodeExr(read('rgba-none-float16.exr'));
    // imagecodecs writes none: absent means Rec. 709
    expect(img.primaries).toBeUndefined();
  });
});
