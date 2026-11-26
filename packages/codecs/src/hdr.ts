// Radiance RGBE (.hdr, #182): a text header, a size line, then scanlines of 4-byte pixels (red,
// green, blue mantissas and a shared exponent), flat, with "new" run-length coding per channel
// (a 2, 2 marker and the width) or with the old (1, 1, 1, n) repeat pixels. The result is linear
// scene light as float32 RGBA (alpha 1): `float = mantissa × 2^(exponent − 136)`, as Radiance,
// OpenCV and stb_image read it. EXPOSURE lines are ignored (viewers do), PRIMARIES are reported.

import { CodecError, DEFAULT_MAX_PIXELS, plain, type Chromaticities, type DecodedImage, type DecodeOptions } from './types';

const fail = (message: string): never => {
  throw new CodecError('hdr', message);
};

const MAX_HEADER = 1 << 16;

/** Whether `bytes` starts like a Radiance file ("#?RADIANCE", "#?RGBE"…). */
export const isHdr = (b: Uint8Array) => b.length >= 3 && b[0] === 0x23 && b[1] === 0x3f;

/** Decodes a Radiance RGBE file. Throws a `CodecError` for anything else, or a file it cannot read. */
export function decodeHdr(input: Uint8Array, options: DecodeOptions = {}): Extract<DecodedImage, { bitDepth: 32 }> {
  const bytes = plain(input);
  if (!isHdr(bytes)) fail('not a Radiance file (no "#?" signature)');

  // Header lines up to the first empty one.
  let at = 0;
  const line = (): string => {
    const start = at;
    while (at < bytes.length && bytes[at] !== 0x0a) {
      if (++at - start > MAX_HEADER) fail('header line too long');
    }
    if (at >= bytes.length) fail('truncated header');
    return String.fromCharCode(...bytes.subarray(start, at++));
  };
  line(); // "#?RADIANCE"
  let primaries: Chromaticities | undefined;
  for (let n = 0; ; n++) {
    if (n > 1000) fail('header has no end');
    const l = line();
    if (l === '') break;
    const m = /^([A-Z_a-z0-9]+)\s*=\s*(.*)$/.exec(l);
    if (!m) continue; // a comment or something we do not know
    if (m[1] === 'FORMAT' && m[2]!.trim() !== '32-bit_rle_rgbe') fail(`format ${m[2]!.trim()} is not supported (only 32-bit_rle_rgbe)`);
    if (m[1] === 'PRIMARIES') {
      const v = m[2]!.trim().split(/\s+/).map(Number);
      if (v.length === 8 && v.every(Number.isFinite)) primaries = { red: [v[0]!, v[1]!], green: [v[2]!, v[3]!], blue: [v[4]!, v[5]!], white: [v[6]!, v[7]!] };
    }
  }

  // The size line: "-Y height +X width" (rows top to bottom, pixels left to right), or its flips.
  const size = /^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/.exec(line().trim());
  if (!size) fail('unsupported or missing size line (only "±Y height ±X width")');
  const height = Number(size![2]);
  const width = Number(size![4]);
  if (!(width >= 1 && height >= 1)) fail(`invalid size ${width}×${height}`);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (width * height > maxPixels) fail(`${width}×${height} is larger than maxPixels (${maxPixels})`);
  const flipY = size![1] === '+';
  const flipX = size![3] === '-';

  const out = new Float32Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  // 2^(e − 136) for every exponent byte: exact doubles, so the products below are exact too.
  const scale = new Float64Array(256);
  for (let e = 1; e < 256; e++) scale[e] = 2 ** (e - 136);

  for (let row = 0; row < height; row++) {
    if (at + 4 > bytes.length) fail('truncated pixel data');
    if (width >= 8 && width < 0x8000 && bytes[at] === 2 && bytes[at + 1] === 2 && (bytes[at + 2]! & 0x80) === 0) {
      // New-style run-length coding: the width, then each of the four channels coded on its own.
      if (((bytes[at + 2]! << 8) | bytes[at + 3]!) !== width) fail('scanline length does not match the width');
      at += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width; ) {
          if (at >= bytes.length) fail('truncated scanline');
          let count = bytes[at++]!;
          if (count > 128) {
            count -= 128;
            if (x + count > width) fail('a run goes past the end of the scanline');
            if (at >= bytes.length) fail('truncated scanline');
            const v = bytes[at++]!;
            for (let k = 0; k < count; k++) scan[4 * x++ + c] = v;
          } else {
            if (count === 0 || x + count > width) fail('a literal run is empty or goes past the end of the scanline');
            if (at + count > bytes.length) fail('truncated scanline');
            for (let k = 0; k < count; k++) scan[4 * x++ + c] = bytes[at++]!;
          }
        }
      }
    } else {
      // Flat pixels, or the old run-length coding: (1, 1, 1, n) repeats the previous pixel n << shift times.
      let shift = 0;
      for (let x = 0; x < width; ) {
        if (at + 4 > bytes.length) fail('truncated pixel data');
        const r = bytes[at]!;
        const g = bytes[at + 1]!;
        const b = bytes[at + 2]!;
        const e = bytes[at + 3]!;
        at += 4;
        if (r === 1 && g === 1 && b === 1) {
          if (x === 0) fail('a repeat code with nothing to repeat');
          const count = e << shift;
          if (x + count > width) fail('a repeat goes past the end of the scanline');
          for (let k = 0; k < count; k++, x++) scan.copyWithin(4 * x, 4 * (x - 1), 4 * x);
          shift += 8;
        } else {
          scan[4 * x] = r;
          scan[4 * x + 1] = g;
          scan[4 * x + 2] = b;
          scan[4 * x + 3] = e;
          x++;
          shift = 0;
        }
      }
    }
    const y = flipY ? height - 1 - row : row;
    for (let x = 0; x < width; x++) {
      const s = scale[scan[4 * x + 3]!]!; // 0 for exponent 0: black
      const o = (y * width + (flipX ? width - 1 - x : x)) * 4;
      out[o] = scan[4 * x]! * s;
      out[o + 1] = scan[4 * x + 1]! * s;
      out[o + 2] = scan[4 * x + 2]! * s;
      out[o + 3] = 1;
    }
  }
  return { width, height, bitDepth: 32, data: out, linear: true, ...(primaries ? { primaries } : {}) };
}
