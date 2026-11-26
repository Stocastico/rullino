import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CodecError, decodeJpeg, decodePng, encodeJpeg } from './index';
import { STANDARD_HUFFMAN } from './jpeg-encode';

// The references (test/jpeg-encode/, made by test/make-jpeg-fixtures.py) are what libjpeg-turbo writes
// through Pillow, standard Huffman tables, for PNG inputs (a photo crop, coloured noise, one-pixel-wide
// and odd sizes) at qualities 1 / 50 / 75 / 100 and every subsampling. The encoder must write the
// same bytes.

const dir = fileURLToPath(new URL('../test/jpeg-encode/', import.meta.url));
const references = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
const read = (path: string) => new Uint8Array(readFileSync(path));

describe('encodeJpeg against libjpeg-turbo (Pillow)', () => {
  it.each(references)('%s: the same file, byte for byte', async (name) => {
    const [, image, q, sub] = /^(.+)-q(\d+)-(\d+|grey)\.jpg$/.exec(name)!;
    const input = await decodePng(read(`${dir}${image}.png`));
    const ours = encodeJpeg(input as { width: number; height: number; data: Uint8Array }, sub === 'grey' ? { quality: Number(q) / 100, grey: true } : { quality: Number(q) / 100, subsampling: `${sub![0]}:${sub![1]}:${sub![2]}` as '4:4:4' });
    const theirs = read(dir + name);
    if (ours.length !== theirs.length || ours.some((v, i) => v !== theirs[i])) {
      const first = ours.findIndex((v, i) => v !== theirs[i]);
      expect.fail(`${ours.length} bytes vs ${theirs.length}; first difference at byte ${first}`);
    }
  });
});

describe('encodeJpeg', () => {
  it('uses the Annex K Huffman tables, as found in a file libjpeg-turbo wrote', () => {
    // Pillow's baseline file (no optimize): its four DHT segments are the standard tables.
    const b = read(fileURLToPath(new URL('../test/jpeg/baseline-420.jpg', import.meta.url)));
    const tables: Record<string, { counts: number[]; symbols: number[] }> = {};
    for (let i = 2; b[i] === 0xff && b[i + 1] !== 0xda; ) {
      const length = (b[i + 2]! << 8) | b[i + 3]!;
      if (b[i + 1] === 0xc4)
        for (let j = i + 4; j < i + 2 + length; ) {
          const counts = Array.from(b.subarray(j + 1, j + 17));
          const n = counts.reduce((s, c) => s + c, 0);
          tables[(b[j]! >> 4 ? 'ac' : 'dc') + (b[j]! & 15 ? 'Chrominance' : 'Luminance')] = { counts, symbols: Array.from(b.subarray(j + 17, j + 17 + n)) };
          j += 17 + n;
        }
      i += 2 + length;
    }
    expect(tables).toEqual(STANDARD_HUFFMAN);
  });

  it('round trip: our decoder and libjpeg-turbo read the file back alike, close to the input', async () => {
    const input = await decodePng(read(dir + 'photo.png'));
    const jpeg = encodeJpeg(input as { width: number; height: number; data: Uint8Array }, { quality: 0.9 });
    const back = await decodeJpeg(jpeg);
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    let err = 0;
    for (let i = 0, j = 0; i < back.data.length; i += 4, j += 3)
      for (let c = 0; c < 3; c++) {
        expect(back.data[i + c]).toBe(data[j + c]);
        err += (back.data[i + c]! - input.data[i + c]!) ** 2;
      }
    const psnr = 10 * Math.log10((255 * 255) / (err / (input.width * input.height * 3)));
    expect(psnr).toBeGreaterThan(30);
  });

  it('embeds an ICC profile over APP2 segments', async () => {
    const icc = Uint8Array.from({ length: 140_000 }, (_, i) => (i * 7) & 255);
    const jpeg = encodeJpeg({ width: 2, height: 2, data: new Uint8Array(16).fill(200) }, { icc });
    expect(Array.from((await decodeJpeg(jpeg)).icc!)).toEqual(Array.from(icc));
    expect((await sharp(jpeg).metadata()).icc?.length).toBe(icc.length);
  });

  it('refuses bad sizes, data and options with a CodecError', () => {
    const ok = { width: 1, height: 1, data: new Uint8Array(4) };
    expect(() => encodeJpeg({ width: 0, height: 1, data: new Uint8Array(0) })).toThrow(CodecError);
    expect(() => encodeJpeg({ width: 70_000, height: 1, data: new Uint8Array(280_000) })).toThrow(/65535/);
    expect(() => encodeJpeg({ width: 2, height: 1, data: new Uint8Array(4) })).toThrow(/expected 8 bytes/);
    expect(() => encodeJpeg(ok, { quality: 1.5 })).toThrow(/quality/);
    expect(() => encodeJpeg(ok, { subsampling: '4:1:1' as '4:2:0' })).toThrow(/subsampling/);
    expect(encodeJpeg(ok, { quality: 0 })[0]).toBe(0xff); // quality 0 is libjpeg's 1
  });
});
