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

let tables: Uint32Array | undefined;
/**
 * CRC-32 (ISO 3309, as PNG and zip use it), four bytes per step ("slicing by 4": table k holds the
 * CRC of a byte followed by k zero bytes).
 */
export function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  if (!tables) {
    tables = new Uint32Array(1024);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tables[n] = c >>> 0;
    }
    for (let n = 0; n < 256; n++) for (let k = 1; k < 4; k++) tables[256 * k + n] = (tables[256 * (k - 1) + n]! >>> 8) ^ tables[tables[256 * (k - 1) + n]! & 255]!;
  }
  const t = tables;
  let c = 0xffffffff;
  let i = from;
  for (const end4 = to - 3; i < end4; i += 4) {
    c ^= bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
    c = t[768 + (c & 255)]! ^ t[512 + ((c >>> 8) & 255)]! ^ t[256 + ((c >>> 16) & 255)]! ^ t[c >>> 24]!;
  }
  for (; i < to; i++) c = t[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
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

/**
 * Reverses the scanline filters of rows [from, to) of one pass in place (rows before `from` already
 * unfiltered); `raw` holds (1 + rowBytes) bytes per row. The
 * first row (no row above) and the first `bpp` bytes of a row (no byte to the left) are their own
 * loops, so the inner loops carry no bounds tests: with a = left, b = up and c = upper left read as
 * 0 where they do not exist, Average is (b >> 1) at the start of a row and (a >> 1) on the first row,
 * and Paeth picks b at the start of a row and a on the first row.
 */
function unfilter(raw: Uint8Array, from: number, to: number, rowBytes: number, bpp: number): void {
  const stride = rowBytes + 1;
  for (let y = from; y < to; y++) {
    const at = y * stride;
    const type = raw[at]!;
    const cur = at + 1;
    const end = cur + rowBytes;
    const first = cur + Math.min(bpp, rowBytes);
    switch (type) {
      case 0:
        break;
      case 1:
        for (let i = first; i < end; i++) raw[i] = (raw[i]! + raw[i - bpp]!) & 255;
        break;
      case 2:
        if (y > 0) for (let i = cur; i < end; i++) raw[i] = (raw[i]! + raw[i - stride]!) & 255;
        break;
      case 3:
        if (y === 0) {
          for (let i = first; i < end; i++) raw[i] = (raw[i]! + (raw[i - bpp]! >> 1)) & 255;
        } else {
          for (let i = cur; i < first; i++) raw[i] = (raw[i]! + (raw[i - stride]! >> 1)) & 255;
          for (let i = first; i < end; i++) raw[i] = (raw[i]! + ((raw[i - bpp]! + raw[i - stride]!) >> 1)) & 255;
        }
        break;
      case 4:
        if (y === 0) {
          for (let i = first; i < end; i++) raw[i] = (raw[i]! + raw[i - bpp]!) & 255;
        } else {
          for (let i = cur; i < first; i++) raw[i] = (raw[i]! + raw[i - stride]!) & 255;
          for (let i = first; i < end; i++) {
            const a = raw[i - bpp]!;
            const b = raw[i - stride]!;
            const c = raw[i - stride - bpp]!;
            // p = a + b - c, so |p - a| = |b - c|, |p - b| = |a - c|, |p - c| = |a + b - 2c|.
            let pa = b - c;
            let pb = a - c;
            let pc = pa + pb;
            if (pa < 0) pa = -pa;
            if (pb < 0) pb = -pb;
            if (pc < 0) pc = -pc;
            raw[i] = (raw[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          }
        }
        break;
      default:
        fail(`unknown filter type ${type} on row ${y}`);
    }
  }
}

interface Pass {
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly w: number;
  readonly h: number;
  readonly rowBytes: number;
}

/** Writes rows [from, to) of an unfiltered 8-bit pass of grey, RGB, grey + alpha or RGBA samples into RGBA `out`. */
function write8(pass: Uint8Array, p: Pass, width: number, colour: number, out: Uint8Array, key: readonly number[] | undefined, from: number, to: number): void {
  const stride = p.rowBytes + 1;
  const step = 4 * p.dx;
  for (let py = from; py < to; py++) {
    let i = py * stride + 1;
    const end = i + p.rowBytes;
    let o = ((p.y0 + py * p.dy) * width + p.x0) * 4;
    switch (colour) {
      case 6:
        if (step === 4) out.set(pass.subarray(i, end), o);
        else
          for (; i < end; i += 4, o += step) {
            out[o] = pass[i]!;
            out[o + 1] = pass[i + 1]!;
            out[o + 2] = pass[i + 2]!;
            out[o + 3] = pass[i + 3]!;
          }
        break;
      case 2:
        if (key) {
          const [kr, kg, kb] = key as [number, number, number];
          for (; i < end; i += 3, o += step) {
            const r = (out[o] = pass[i]!);
            const g = (out[o + 1] = pass[i + 1]!);
            const b = (out[o + 2] = pass[i + 2]!);
            out[o + 3] = r === kr && g === kg && b === kb ? 0 : 255;
          }
        } else
          for (; i < end; i += 3, o += step) {
            out[o] = pass[i]!;
            out[o + 1] = pass[i + 1]!;
            out[o + 2] = pass[i + 2]!;
            out[o + 3] = 255;
          }
        break;
      case 4:
        for (; i < end; i += 2, o += step) {
          out[o] = out[o + 1] = out[o + 2] = pass[i]!;
          out[o + 3] = pass[i + 1]!;
        }
        break;
      default: {
        const k = key ? key[0]! : -1;
        for (; i < end; i++, o += step) {
          const g = (out[o] = out[o + 1] = out[o + 2] = pass[i]!);
          out[o + 3] = g === k ? 0 : 255;
        }
      }
    }
  }
}

/** Writes rows [from, to) of an unfiltered 16-bit (big-endian) pass of grey, RGB, grey + alpha or RGBA samples into RGBA `out`. */
function write16(pass: Uint8Array, p: Pass, width: number, colour: number, out: Uint16Array, key: readonly number[] | undefined, from: number, to: number): void {
  const stride = p.rowBytes + 1;
  const step = 4 * p.dx;
  const be = (i: number) => (pass[i]! << 8) | pass[i + 1]!;
  for (let py = from; py < to; py++) {
    let i = py * stride + 1;
    const end = i + p.rowBytes;
    let o = ((p.y0 + py * p.dy) * width + p.x0) * 4;
    switch (colour) {
      case 6:
        for (; i < end; i += 8, o += step) {
          out[o] = be(i);
          out[o + 1] = be(i + 2);
          out[o + 2] = be(i + 4);
          out[o + 3] = be(i + 6);
        }
        break;
      case 2: {
        const [kr, kg, kb] = key ? (key as [number, number, number]) : [-1, -1, -1];
        for (; i < end; i += 6, o += step) {
          const r = (out[o] = be(i));
          const g = (out[o + 1] = be(i + 2));
          const b = (out[o + 2] = be(i + 4));
          out[o + 3] = r === kr && g === kg && b === kb ? 0 : 65535;
        }
        break;
      }
      case 4:
        for (; i < end; i += 4, o += step) {
          out[o] = out[o + 1] = out[o + 2] = be(i);
          out[o + 3] = be(i + 2);
        }
        break;
      default: {
        const k = key ? key[0]! : -1;
        for (; i < end; i += 2, o += step) {
          const g = (out[o] = out[o + 1] = out[o + 2] = be(i));
          out[o + 3] = g === k ? 0 : 65535;
        }
      }
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

  /** Bit depths below 8 and palettes: one sample at a time. */
  const writeOther = (pass: Uint8Array, p: Pass, from: number, to: number) => {
    for (let py = from; py < to; py++) {
      const row = py * (p.rowBytes + 1) + 1;
      const y = p.y0 + py * p.dy;
      for (let px = 0; px < p.w; px++) {
        for (let c = 0; c < channels; c++) {
          const k = px * channels + c;
          if (h.depth === 8) s[c] = pass[row + k]!;
          else {
            const bit = k * h.depth;
            s[c] = (pass[row + (bit >> 3)]! >> (8 - h.depth - (bit & 7))) & mask;
          }
        }
        const o = ((y * h.width) + p.x0 + px * p.dx) * 4;
        if (h.colour === 0) {
          const g = s[0]! * scale;
          out[o] = out[o + 1] = out[o + 2] = g;
          out[o + 3] = key && s[0] === key[0] ? 0 : max;
        } else {
          const i = s[0]!;
          if (i >= entries) fail(`palette index ${i} past the palette's ${entries} entries`);
          out[o] = palette![3 * i]!;
          out[o + 1] = palette![3 * i + 1]!;
          out[o + 2] = palette![3 * i + 2]!;
          out[o + 3] = trns && i < trns.length ? trns[i]! : 255;
        }
      }
    }
  };

  // Rows are unfiltered and written as soon as they are inflated: where the runtime inflates on
  // another thread (Node), this work overlaps with inflating the rest.
  let passIndex = 0;
  let passStart = 0;
  let rowsDone = 0;
  const consume = (raw: Uint8Array, available: number) => {
    while (passIndex < sizes.length) {
      const p = sizes[passIndex]!;
      const stride = p.rowBytes + 1;
      const rows = Math.min(p.h, Math.floor((available - passStart) / stride));
      if (rows > rowsDone) {
        const pass = raw.subarray(passStart, passStart + p.h * stride);
        unfilter(pass, rowsDone, rows, p.rowBytes, bpp);
        if (h.depth === 8 && h.colour !== 3) write8(pass, p, h.width, h.colour, out as Uint8Array, key, rowsDone, rows);
        else if (sixteen) write16(pass, p, h.width, h.colour, out as Uint16Array, key, rowsDone, rows);
        else writeOther(pass, p, rowsDone, rows);
        rowsDone = rows;
      }
      if (rowsDone < p.h) return;
      passIndex++;
      passStart += p.h * stride;
      rowsDone = 0;
    }
  };
  await inflate(compressed, 'png', 'image data', total, consume);
  const image = sixteen ? { width: h.width, height: h.height, bitDepth: 16 as const, data: out as Uint16Array } : { width: h.width, height: h.height, bitDepth: 8 as const, data: out as Uint8Array };
  return icc ? { ...image, icc } : image;
}
