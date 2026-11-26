import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, decode, decodeHdr, detectFormat } from './index';

// Fixtures: test/hdr/, made by make-hdr-fixtures.py. The cv-* files were written by OpenCV and the
// reference is OpenCV's own reading of them; the others are hand-written variants (flat and
// old-style scanlines, other orientations, header lines) with the RGBE -> float formula as reference.

const dir = fileURLToPath(new URL('../test/hdr/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
const manifest: Record<string, { width: number; height: number; reference: string; format: string; primaries?: number[] }> = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
const reference = (name: string) => {
  const b = read(manifest[name]!.reference);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
const hdrFiles = Object.keys(manifest).filter((n) => manifest[n]!.format === 'hdr');

describe('decodeHdr', () => {
  it.each(hdrFiles)('%s decodes to the reference, bit for bit', (name) => {
    const m = manifest[name]!;
    const img = decodeHdr(read(name));
    expect([img.width, img.height, img.bitDepth]).toEqual([m.width, m.height, 32]);
    expect(Array.from(img.data as Float32Array)).toEqual(Array.from(reference(name)));
    expect(img.linear).toBe(true);
  });

  it('says it is linear light and reports the primaries the header names', () => {
    const img = decodeHdr(read('header-40x20.hdr'));
    expect(img.primaries).toEqual({ red: [0.64, 0.33], green: [0.3, 0.6], blue: [0.15, 0.06], white: [0.3127, 0.329] });
    expect(decodeHdr(read('flat-5x7.hdr')).primaries).toBeUndefined();
  });

  it('is found by detectFormat and decode', async () => {
    expect(detectFormat(read('flat-5x7.hdr'))).toBe('hdr');
    expect((await decode(read('cv-9x5.hdr'))).format).toBe('hdr');
  });

  it('refuses what is not a Radiance file, or one it cannot read, with a CodecError', () => {
    const good = read('rle-40x20.hdr');
    const text = (s: string) => new TextEncoder().encode(s);
    const cases: [string, Uint8Array][] = [
      ['no signature', text('hello')],
      ['empty', new Uint8Array(0)],
      ['xyze', text('#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n\0\0\0\0')],
      ['no size line', text('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')],
      ['bad size line', text('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 0 +X 4\n')],
      ['transposed', text('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+X 2 -Y 2\n' + '\0'.repeat(16))],
      ['truncated', good.subarray(0, good.length - 7)],
      ['no pixels', good.subarray(0, 60)],
    ];
    for (const [name, bytes] of cases) expect(() => decodeHdr(bytes), name).toThrow(CodecError);
  });

  it('refuses a literal run of zero bytes, which would never advance', () => {
    const head = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n');
    const body = Uint8Array.of(2, 2, 0, 8, 0, 1, 1, 1, 1, 1, 1, 1, 1);
    const file = new Uint8Array(head.length + body.length + 64);
    file.set(head);
    file.set(body, head.length);
    expect(() => decodeHdr(file)).toThrow(/empty/);
  });

  it('refuses an image over maxPixels before reading any pixel, and a scanline that overruns', () => {
    expect(() => decodeHdr(read('flat-40x20.hdr'), { maxPixels: 100 })).toThrow(/larger than maxPixels/);
    const bad = read('rle-40x20.hdr').slice();
    const at = bad.findIndex((_, i) => bad[i] === 2 && bad[i + 1] === 2 && bad[i + 2] === 0 && bad[i + 3] === 40);
    bad[at + 4] = 255; // a run of 127 where 40 pixels are left
    expect(() => decodeHdr(bad)).toThrow(CodecError);
  });

  it('refuses a header line that never ends, a header without a blank line, and a repeat code with nothing to repeat', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(() => decodeHdr(text('#?RADIANCE\n' + 'A'.repeat(70000)))).toThrow(/too long/);
    expect(() => decodeHdr(text('#?RADIANCE\n' + 'X=1\n'.repeat(1200)))).toThrow(/no end/);
    const body = Uint8Array.of(1, 1, 1, 5, 0, 0, 0, 0); // an old-style repeat as the first pixel
    const head = text('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 4\n');
    expect(() => decodeHdr(Uint8Array.from([...head, ...body]))).toThrow(/nothing to repeat/);
  });
});
