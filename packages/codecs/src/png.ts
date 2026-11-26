// PNG decoder (#179): every colour type and bit depth of the specification (grey, RGB, palette, grey +
// alpha, RGBA; 1 / 2 / 4 / 8 / 16 bits), tRNS transparency, Adam7 interlacing, the five filters,
// iCCP profiles. Inflating goes through the runtime's DecompressionStream (browsers, Node, Deno, Bun),
// so the package needs no zlib of its own. Strict where a lenient decoder would guess: a bad CRC, a
// missing IEND, an unknown critical chunk or short image data is a CodecError, never a partial image.
// Sizes are checked on the header before anything is allocated, and inflating stops at the size the
// header implies, so a small file cannot make the decoder allocate more than the image it describes.

import { CodecError, DEFAULT_MAX_PIXELS, plain, type DecodedImage, type DecodeOptions } from './types';
import { inflate } from './zlib';

const fail = (message: string, cause?: unknown): never => {
  throw new CodecError('png', message, cause === undefined ? undefined : { cause });
};

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Allowed bit depths per colour type. */
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7 passes: first column, first row, column step, row step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
/** The largest ICC profile accepted (they are a few KB, rarely a few hundred). */
const MAX_ICC = 16 * 1024 * 1024;

let table: Uint32Array | undefined;
/** CRC-32 (ISO 3309, as PNG and zip use it). */
export function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = table[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

interface Header {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colour: number;
  readonly interlaced: boolean;
}

/** The passes of an image (one, or Adam7's seven) with their sizes; empty passes are skipped. */
function passes(h: Header) {
  const list = h.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  return list
    .map(([x0, y0, dx, dy]) => ({ x0, y0, dx, dy, w: Math.ceil((h.width - x0) / dx), h: Math.ceil((h.height - y0) / dy) }))
    .filter((p) => p.w > 0 && p.h > 0);
}

/** Reverses the scanline filters of one pass in place; `raw` holds (1 + rowBytes) bytes per row. */
function unfilter(raw: Uint8Array, rows: number, rowBytes: number, bpp: number): void {
  const stride = rowBytes + 1;
  for (let y = 0; y < rows; y++) {
    const at = y * stride;
    const type = raw[at]!;
    const cur = at + 1;
    const prev = cur - stride; // only read when y > 0
    switch (type) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < rowBytes; i++) raw[cur + i] = (raw[cur + i]! + raw[cur + i - bpp]!) & 255;
        break;
      case 2:
        if (y > 0) for (let i = 0; i < rowBytes; i++) raw[cur + i] = (raw[cur + i]! + raw[prev + i]!) & 255;
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? raw[cur + i - bpp]! : 0;
          const up = y > 0 ? raw[prev + i]! : 0;
          raw[cur + i] = (raw[cur + i]! + ((left + up) >> 1)) & 255;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? raw[cur + i - bpp]! : 0;
          const b = y > 0 ? raw[prev + i]! : 0;
          const c = i >= bpp && y > 0 ? raw[prev + i - bpp]! : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          raw[cur + i] = (raw[cur + i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
        break;
      default:
        fail(`unknown filter type ${type} on row ${y}`);
    }
  }
}

/**
 * Decodes a PNG file. Resolves to RGBA at 8 bits (bit depths 1 to 8, palettes) or 16 bits, straight
 * alpha, samples as stored; rejects with a `CodecError` for anything malformed, truncated or larger
 * than `maxPixels`. gAMA, cHRM, sRGB, sBIT, bKGD and text chunks are read past (colour management
 * from them is not done here); an iCCP profile is returned as `icc`.
 */
export async function decodePng(input: Uint8Array, options: DecodeOptions = {}): Promise<DecodedImage> {
  const bytes = plain(input);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) fail('not a PNG file (bad signature)');

  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  let icc: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let idatEnded = false;
  let ended = false;

  for (let at = 8; !ended; ) {
    if (at + 12 > bytes.length) fail(header ? 'truncated file: no IEND chunk' : 'truncated file');
    const length = u32(bytes, at);
    if (length > 0x7fffffff) fail(`chunk length ${length} out of range`);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type)) fail(`invalid chunk type at byte ${at}`);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > bytes.length) fail(`truncated ${type} chunk`);
    if (crc32(bytes, at + 4, end) !== u32(bytes, end)) fail(`bad CRC in the ${type} chunk`);
    const data = bytes.subarray(start, end);
    at = end + 4;

    if (!header && type !== 'IHDR') fail('the first chunk is not IHDR');
    if (type !== 'IDAT' && idat.length > 0) idatEnded = true;
    switch (type) {
      case 'IHDR': {
        if (header) fail('a second IHDR chunk');
        if (length !== 13) fail('IHDR must be 13 bytes');
        const [width, height, depth, colour] = [u32(data, 0), u32(data, 4), data[8]!, data[9]!];
        if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) fail(`invalid size ${width}×${height}`);
        if (!DEPTHS[colour]) fail(`invalid colour type ${colour}`);
        if (!DEPTHS[colour]!.includes(depth)) fail(`invalid bit depth ${depth} for colour type ${colour}`);
        if (data[10] !== 0 || data[11] !== 0) fail('unknown compression or filter method');
        if (data[12]! > 1) fail(`unknown interlace method ${data[12]}`);
        if (width * height > maxPixels) fail(`${width}×${height} is larger than maxPixels (${maxPixels})`);
        header = { width, height, depth, colour, interlaced: data[12] === 1 };
        break;
      }
      case 'PLTE':
        if (idat.length) fail('PLTE after IDAT');
        if (palette) fail('a second PLTE chunk');
        if (header!.colour === 0 || header!.colour === 4) fail('PLTE in a grey image');
        if (length === 0 || length % 3 !== 0 || length > 768) fail('PLTE length must be a multiple of 3, at most 768');
        palette = data;
        break;
      case 'tRNS': {
        if (idat.length) fail('tRNS after IDAT');
        const c = header!.colour;
        if (c === 4 || c === 6) fail('tRNS in an image with an alpha channel');
        if (c === 3 && !palette) fail('tRNS before PLTE');
        if (c === 3 && length > palette!.length / 3) fail('tRNS longer than the palette');
        if ((c === 0 && length !== 2) || (c === 2 && length !== 6)) fail(`tRNS must be ${c === 0 ? 2 : 6} bytes for colour type ${c}`);
        trns = data;
        break;
      }
      case 'iCCP': {
        if (idat.length || palette) fail('iCCP after PLTE or IDAT');
        const zero = data.indexOf(0);
        if (zero < 1 || zero > 79 || data[zero + 1] !== 0) fail('malformed iCCP chunk');
        icc = await inflate(data.subarray(zero + 2), 'png', 'ICC profile', { limit: MAX_ICC });
        break;
      }
      case 'IDAT':
        if (idatEnded) fail('IDAT chunks are not consecutive');
        idat.push(data);
        break;
      case 'IEND':
        ended = true;
        break;
      default:
        // Bit 5 of the first letter: lower case = ancillary (safe to skip), upper case = critical.
        if (type.charCodeAt(0) & 32) break;
        fail(`unknown critical chunk ${type}`);
    }
  }

  const h = header!;
  if (idat.length === 0) fail('no IDAT chunk');
  if (h.colour === 3 && !palette) fail('palette image without a PLTE chunk');

  const channels = CHANNELS[h.colour]!;
  const bitsPerPixel = channels * h.depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const list = passes(h);
  const sizes = list.map((p) => ({ ...p, rowBytes: Math.ceil((p.w * bitsPerPixel) / 8) }));
  const total = sizes.reduce((n, p) => n + p.h * (p.rowBytes + 1), 0);

  let compressed: Uint8Array;
  if (idat.length === 1) compressed = idat[0]!;
  else {
    compressed = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
    let o = 0;
    for (const d of idat) {
      compressed.set(d, o);
      o += d.length;
    }
  }
  const raw = await inflate(compressed, 'png', 'image data', total);

  const sixteen = h.depth === 16;
  const max = sixteen ? 65535 : 255;
  const n = h.width * h.height;
  const out = sixteen ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  const scale = h.depth < 8 && h.colour === 0 ? 255 / ((1 << h.depth) - 1) : 1;
  const mask = (1 << h.depth) - 1;
  // tRNS for grey / RGB: the one colour (raw samples, at the file's depth) that is transparent.
  const key = trns && (h.colour === 0 || h.colour === 2) ? Array.from({ length: trns.length / 2 }, (_, i) => (trns![2 * i]! << 8) | trns![2 * i + 1]!) : undefined;
  const entries = palette ? palette.length / 3 : 0;
  const s = new Array<number>(channels);

  let offset = 0;
  for (const p of sizes) {
    const pass = raw.subarray(offset, offset + p.h * (p.rowBytes + 1));
    offset += pass.length;
    unfilter(pass, p.h, p.rowBytes, bpp);
    for (let py = 0; py < p.h; py++) {
      const row = py * (p.rowBytes + 1) + 1;
      const y = p.y0 + py * p.dy;
      for (let px = 0; px < p.w; px++) {
        for (let c = 0; c < channels; c++) {
          const k = px * channels + c;
          if (h.depth === 8) s[c] = pass[row + k]!;
          else if (sixteen) s[c] = (pass[row + 2 * k]! << 8) | pass[row + 2 * k + 1]!;
          else {
            const bit = k * h.depth;
            s[c] = (pass[row + (bit >> 3)]! >> (8 - h.depth - (bit & 7))) & mask;
          }
        }
        const o = ((y * h.width) + p.x0 + px * p.dx) * 4;
        switch (h.colour) {
          case 0: {
            const g = s[0]! * scale;
            out[o] = out[o + 1] = out[o + 2] = g;
            out[o + 3] = key && s[0] === key[0] ? 0 : max;
            break;
          }
          case 2:
            out[o] = s[0]!;
            out[o + 1] = s[1]!;
            out[o + 2] = s[2]!;
            out[o + 3] = key && s[0] === key[0] && s[1] === key[1] && s[2] === key[2] ? 0 : max;
            break;
          case 3: {
            const i = s[0]!;
            if (i >= entries) fail(`palette index ${i} past the palette's ${entries} entries`);
            out[o] = palette![3 * i]!;
            out[o + 1] = palette![3 * i + 1]!;
            out[o + 2] = palette![3 * i + 2]!;
            out[o + 3] = trns && i < trns.length ? trns[i]! : 255;
            break;
          }
          case 4:
            out[o] = out[o + 1] = out[o + 2] = s[0]!;
            out[o + 3] = s[1]!;
            break;
          default:
            out[o] = s[0]!;
            out[o + 1] = s[1]!;
            out[o + 2] = s[2]!;
            out[o + 3] = s[3]!;
        }
      }
    }
  }
  const image = sixteen ? { width: h.width, height: h.height, bitDepth: 16 as const, data: out as Uint16Array } : { width: h.width, height: h.height, bitDepth: 8 as const, data: out as Uint8Array };
  return icc ? { ...image, icc } : image;
}
