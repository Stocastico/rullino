// TIFF encoder (#179): RGB or RGBA (unassociated alpha) at 8 or 16 bits or 32-bit float, in strips,
// uncompressed, Deflate or LZW, with the horizontal (integers) or floating-point (floats) predictor
// when compressed, and an optional ICC profile. Little-endian, baseline fields included, so any TIFF
// reader opens it; libtiff (through sharp) reads every combination back in the tests.

import { CodecError } from './types';
import { deflate } from './zlib';

const fail = (message: string): never => {
  throw new CodecError('tiff', message);
};

export interface TiffEncodeOptions {
  /** Default 'deflate'. */
  readonly compression?: 'none' | 'deflate' | 'lzw';
  /** Write the alpha channel (as unassociated alpha). Default: only when some pixel is not opaque. */
  readonly alpha?: boolean;
  /** An ICC profile to embed. */
  readonly icc?: Uint8Array;
}

/** An image to encode: RGBA, straight alpha, 8 or 16 bits or 32-bit float (alpha 1 = opaque). */
export type TiffImage = { readonly width: number; readonly height: number } & (
  | { readonly bitDepth: 8; readonly data: Uint8Array | Uint8ClampedArray }
  | { readonly bitDepth: 16; readonly data: Uint16Array }
  | { readonly bitDepth: 32; readonly data: Float32Array }
);

/** TIFF LZW as libtiff writes it: Clear first, the width grows when the next code no longer fits, Clear when the table is full. */
function lzw(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let n = 0;
  let width = 9;
  const put = (code: number) => {
    acc = (acc << width) | code;
    n += width;
    while (n >= 8) {
      out.push((acc >>> (n - 8)) & 255);
      n -= 8;
    }
    acc &= (1 << n) - 1;
  };
  let table = new Map<number, number>();
  let next = 258;
  put(256);
  if (data.length === 0) {
    put(257);
    if (n > 0) out.push((acc << (8 - n)) & 255);
    return Uint8Array.from(out);
  }
  let prefix = data[0]!;
  const grow = () => {
    if (next === 4094) {
      put(256);
      table = new Map();
      next = 258;
      width = 9;
    } else if (next > (1 << width) - 1) width++;
  };
  for (let i = 1; i < data.length; i++) {
    const c = data[i]!;
    const key = (prefix << 8) | c;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    put(prefix);
    table.set(key, next++);
    grow();
    prefix = c;
  }
  put(prefix);
  next++;
  grow();
  put(257);
  if (n > 0) out.push((acc << (8 - n)) & 255);
  return Uint8Array.from(out);
}

/**
 * Encodes RGBA as a TIFF file (RGB when alpha is left out). Samples are written as given: 8 / 16-bit
 * integers or 32-bit floats (values outside [0, 1] kept).
 */
export async function encodeTiff(image: TiffImage, options: TiffEncodeOptions = {}): Promise<Uint8Array> {
  const { width, height, bitDepth, data } = image;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 0xffffffff && height <= 0xffffffff)) fail(`cannot encode a ${width}×${height} image`);
  if (bitDepth !== 8 && bitDepth !== 16 && bitDepth !== 32) fail(`bit depth ${String(bitDepth)} (8, 16 or 32)`);
  if (data.length !== width * height * 4) fail(`expected ${width * height * 4} RGBA samples, got ${data.length}`);
  const compression = options.compression ?? 'deflate';
  if (compression !== 'none' && compression !== 'deflate' && compression !== 'lzw') fail(`unknown compression ${String(compression)}`);
  const opaque = bitDepth === 8 ? 255 : bitDepth === 16 ? 65535 : 1;
  let alpha = options.alpha;
  if (alpha === undefined) {
    alpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== opaque) {
      alpha = true;
      break;
    }
  }
  const spp = alpha ? 4 : 3;
  const bytes = bitDepth / 8;
  const rowBytes = width * spp * bytes;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(65536 / rowBytes)));
  const strips = Math.ceil(height / rowsPerStrip);
  const predictor = compression === 'none' ? 1 : bitDepth === 32 ? 3 : 2;

  // Strip data: samples little-endian, predictor applied per row.
  const chunks: Uint8Array[] = [];
  for (let s = 0; s < strips; s++) {
    const y0 = s * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - y0);
    const raw = new Uint8Array(rows * rowBytes);
    const view = new DataView(raw.buffer);
    for (let y = 0; y < rows; y++) {
      const row = y * rowBytes;
      const values = width * spp;
      const src = (y0 + y) * width * 4;
      const sample = (i: number) => data[src + Math.floor(i / spp) * 4 + (i % spp)]!;
      if (bitDepth === 8) for (let i = 0; i < values; i++) raw[row + i] = (sample(i) - (predictor === 2 && i >= spp ? sample(i - spp) : 0)) & 255;
      else if (bitDepth === 16) for (let i = 0; i < values; i++) view.setUint16(row + 2 * i, (sample(i) - (predictor === 2 && i >= spp ? sample(i - spp) : 0)) & 0xffff, true);
      else if (predictor !== 3) for (let i = 0; i < values; i++) view.setFloat32(row + 4 * i, sample(i), true);
      else {
        // libtiff's fpDiff: the bytes of each value into byte planes (most significant first), then
        // differences of the bytes across the row with a stride of the samples per pixel.
        const be = new DataView(new ArrayBuffer(4));
        for (let i = 0; i < values; i++) {
          be.setFloat32(0, sample(i), false);
          for (let b = 0; b < 4; b++) raw[row + b * values + i] = be.getUint8(b);
        }
        for (let i = 4 * values - 1; i >= spp; i--) raw[row + i] = (raw[row + i]! - raw[row + i - spp]!) & 255;
      }
    }
    chunks.push(compression === 'deflate' ? await deflate(raw) : compression === 'lzw' ? lzw(raw) : raw);
  }

  // Fields, ascending: [tag, type, values]. Types: 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED.
  const fields: [number, number, number[]][] = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, new Array(spp).fill(bitDepth)],
    [259, 3, [compression === 'none' ? 1 : compression === 'lzw' ? 5 : 8]],
    [262, 3, [2]],
    [273, 4, new Array(strips).fill(0)],
    [277, 3, [spp]],
    [278, 4, [rowsPerStrip]],
    [279, 4, chunks.map((c) => c.length)],
    [282, 5, [72, 1]],
    [283, 5, [72, 1]],
    [284, 3, [1]],
    [296, 3, [2]],
  ];
  if (predictor !== 1) fields.push([317, 3, [predictor]]);
  if (alpha) fields.push([338, 3, [2]]);
  if (bitDepth === 32) fields.push([339, 3, new Array(spp).fill(3)]);
  if (options.icc) fields.push([34675, 7, Array.from(options.icc)]);

  const size = (type: number, values: number[]) => (type === 3 ? 2 * values.length : type === 4 ? 4 * values.length : type === 5 ? 4 * values.length : values.length);
  const dataLength = chunks.reduce((s, c) => s + c.length, 0);
  const ifdAt = 8 + dataLength + (dataLength & 1);
  const ifdLength = 2 + 12 * fields.length + 4;
  let extraAt = ifdAt + ifdLength;
  const placed = fields.map(([tag, type, values]) => {
    const bytesLong = size(type, values);
    const at = bytesLong > 4 ? extraAt : -1;
    if (bytesLong > 4) extraAt += bytesLong + (bytesLong & 1);
    return { tag, type, values, at };
  });
  const out = new Uint8Array(extraAt);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  view.setUint32(4, ifdAt, true);
  let o = 8;
  const offsets: number[] = [];
  for (const c of chunks) {
    offsets.push(o);
    out.set(c, o);
    o += c.length;
  }
  placed.find((f) => f.tag === 273)!.values = offsets;
  view.setUint16(ifdAt, placed.length, true);
  placed.forEach(({ tag, type, values, at }, i) => {
    const e = ifdAt + 2 + 12 * i;
    view.setUint16(e, tag, true);
    view.setUint16(e + 2, type, true);
    view.setUint32(e + 4, type === 5 ? values.length / 2 : values.length, true);
    const target = at >= 0 ? at : e + 8;
    if (at >= 0) view.setUint32(e + 8, at, true);
    values.forEach((v, j) => {
      if (type === 3) view.setUint16(target + 2 * j, v, true);
      else if (type === 4 || type === 5) view.setUint32(target + 4 * j, v, true);
      else out[target + j] = v;
    });
  });
  view.setUint32(ifdAt + 2 + 12 * placed.length, 0, true);
  return out;
}
