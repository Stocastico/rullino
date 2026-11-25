import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CodecError, decodeJpeg } from './index';
import { idct } from './jpeg';

// The fixtures (test/jpeg/, made by test/make-jpeg-fixtures.py from a CC0 sample photo) cover every
// sampling layout, baseline and progressive, restart intervals, grey, RGB, CMYK, YCCK and tiny sizes;
// the playground's sample photos are real camera files. The reference is sharp (libvips + mozjpeg,
// whose decoder is libjpeg-turbo's): YCbCr, grey and RGB files must decode to the same bytes.

const dir = fileURLToPath(new URL('../test/jpeg/', import.meta.url));
const samples = fileURLToPath(new URL('../../../apps/playground/public/samples/', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.jpg') && !/cmyk|ycck/.test(f));
const photos = readdirSync(samples).filter((f) => f.endsWith('.jpg'));
const read = (path: string) => new Uint8Array(readFileSync(path));

/** sharp's 8-bit RGBA, no colour management (raw libjpeg samples, grey replicated). */
async function reference(bytes: Uint8Array) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = i * info.channels;
    out.set(info.channels === 1 ? [data[s]!, data[s]!, data[s]!, 255] : [data[s]!, data[s + 1]!, data[s + 2]!, 255], i * 4);
  }
  return { width: info.width, height: info.height, data: out };
}

function same(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  expect(actual.length).toBe(expected.length);
  let diff = 0;
  let first = -1;
  for (let i = 0; i < actual.length; i++)
    if (actual[i] !== expected[i]) {
      diff++;
      if (first < 0) first = i;
    }
  if (diff) expect.fail(`${diff} of ${actual.length} samples differ; first at ${first} (pixel ${first >> 2}): ${actual[first]} vs ${expected[first]}`);
}

describe('decodeJpeg against libjpeg-turbo (sharp)', () => {
  it.each(fixtures)('%s decodes to the same bytes', async (name) => {
    const bytes = read(dir + name);
    const img = await decodeJpeg(bytes);
    const ref = await reference(bytes);
    expect([img.width, img.height, img.bitDepth]).toEqual([ref.width, ref.height, 8]);
    same(img.data, ref.data);
  });

  it.each(photos)('sample photo %s decodes to the same bytes', { timeout: 60_000 }, async (name) => {
    const bytes = read(samples + name);
    const img = await decodeJpeg(bytes);
    const ref = await reference(bytes);
    expect([img.width, img.height]).toEqual([ref.width, ref.height]);
    same(img.data, ref.data);
  });
});

describe('decodeJpeg', () => {
  it.each(['cmyk', 'ycck', 'ycck-adobe1'])('%s.jpg: CMYK through the naive formula, from the same CMYK samples as libjpeg-turbo', async (name) => {
    const img = await decodeJpeg(read(dir + name + '.jpg'));
    // Pillow's decode (libjpeg-turbo) as ink amounts, saved by make-jpeg-fixtures.py.
    const ink = read(dir + name + '.cmyk');
    expect(ink.length).toBe(img.width * img.height * 4);
    const expected = new Uint8Array(ink.length);
    for (let i = 0; i < ink.length; i += 4) {
      const k = 255 - ink[i + 3]!;
      for (let c = 0; c < 3; c++) expected[i + c] = Math.round(((255 - ink[i + c]!) * k) / 255);
      expected[i + 3] = 255;
    }
    same(img.data, expected);
  });

  it('the IDCT range limit is libjpeg\'s C one: +128, clamped, wrapping on 10 bits far out of range', () => {
    // A block with only a DC coefficient decodes to (dc·q + 4) >> 3 everywhere, before the +128.
    const flat = (value: number) => {
      const coef = new Int16Array(64);
      coef[0] = value * 8;
      const out = new Uint8Array(64);
      idct(coef, 0, new Uint16Array(64).fill(1), out, 0, 8);
      expect(new Set(out).size).toBe(1);
      return out[0];
    };
    expect([flat(-128), flat(0), flat(127)]).toEqual([0, 128, 255]);
    expect([flat(128), flat(300), flat(383), flat(384), flat(511)]).toEqual([255, 255, 255, 255, 255]);
    expect([flat(-129), flat(-300), flat(-512)]).toEqual([0, 0, 0]);
    expect([flat(512), flat(895), flat(1000), flat(-600)]).toEqual([0, 0, 104, 255]); // −600 & 1023 = 424
  });

  it('keeps an ICC profile split over APP2 chunks, in order', async () => {
    const profile = Uint8Array.from({ length: 150_000 }, (_, i) => (i * 13) & 255);
    // sharp embeds the profile it is given; 150 KB needs three APP2 chunks of at most 65 519 bytes.
    const bytes = await withProfile(read(dir + 'baseline-420.jpg'), profile);
    expect(Array.from((await decodeJpeg(bytes)).icc!)).toEqual(Array.from(profile));
    expect((await decodeJpeg(read(dir + 'baseline-420.jpg'))).icc).toBeUndefined();
  });

  it('refuses truncated files, a missing EOI and unsupported kinds with a CodecError', async () => {
    const ok = read(dir + 'baseline-420.jpg');
    for (const cut of [1, 20, 200, ok.length - 300, ok.length - 2]) await expect(decodeJpeg(ok.subarray(0, cut))).rejects.toThrow(CodecError);
    const prog = read(dir + 'progressive-420.jpg');
    await expect(decodeJpeg(prog.subarray(0, prog.length - 200))).rejects.toThrow(CodecError);
    await expect(decodeJpeg(read(dir + '../pngsuite/basn2c08.png'))).rejects.toThrow(/not a JPEG/);
    const sof = (marker: number, precision = 8) => {
      const b = ok.slice();
      const i = b.findIndex((v, j) => v === 0xff && b[j + 1] === 0xc0);
      b[i + 1] = marker;
      b[i + 4] = precision;
      return b;
    };
    await expect(decodeJpeg(sof(0xc9))).rejects.toThrow(/arithmetic/);
    await expect(decodeJpeg(sof(0xc3))).rejects.toThrow(/lossless/);
    await expect(decodeJpeg(sof(0xc0, 12))).rejects.toThrow(/12-bit/);
  });

  it('refuses an image above maxPixels on its header', async () => {
    const ok = read(dir + 'baseline-420.jpg');
    await expect(decodeJpeg(ok, { maxPixels: 61 * 43 - 1 })).rejects.toThrow(/larger than maxPixels/);
    await expect(decodeJpeg(ok, { maxPixels: 61 * 43 })).resolves.toBeDefined();
  });

  it('a restart marker out of sequence is an error', async () => {
    const b = read(dir + 'restart-blocks-420.jpg').slice();
    const sos = b.findIndex((v, j) => v === 0xff && b[j + 1] === 0xda);
    const rst = b.findIndex((v, j) => j > sos && v === 0xff && b[j + 1] === 0xd0);
    b[rst + 1] = 0xd3;
    await expect(decodeJpeg(b)).rejects.toThrow(/restart marker/);
  });
});

/** `jpeg` with an ICC profile in APP2 chunks after SOI (as libjpeg's jpeg_write_icc_profile does). */
async function withProfile(jpeg: Uint8Array, profile: Uint8Array): Promise<Uint8Array> {
  const MAX = 65519;
  const count = Math.ceil(profile.length / MAX);
  const parts: number[] = [0xff, 0xd8];
  for (let i = 0; i < count; i++) {
    const chunk = profile.subarray(i * MAX, (i + 1) * MAX);
    const length = 2 + 14 + chunk.length;
    parts.push(0xff, 0xe2, length >> 8, length & 255, ...new TextEncoder().encode('ICC_PROFILE\0'), i + 1, count, ...chunk);
  }
  return Uint8Array.from([...parts, ...jpeg.subarray(2)]);
}
