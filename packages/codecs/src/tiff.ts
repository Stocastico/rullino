// TIFF decoder (#179): baseline TIFF and the extensions photo and scientific software writes:
// strips and tiles, chunky and planar samples, no compression / LZW / Deflate / PackBits, the
// horizontal and floating-point predictors, 1 / 2 / 4 / 8 / 16-bit integer and 32-bit float samples,
// grey (either polarity), RGB, palette and CMYK, associated or unassociated alpha, ICC profiles.
// The first image of the file is decoded. Strict like the other decoders: offsets or counts outside
// the file, short strips or tiles and unsupported fields are CodecErrors; sizes are checked against
// maxPixels before anything is allocated, and every chunk is inflated only to the size it must have.

import { CodecError, DEFAULT_MAX_PIXELS, plain, type DecodedImage, type DecodeOptions } from './types';
import { inflate } from './zlib';

const fail = (message: string): never => {
  throw new CodecError('tiff', message);
};

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  fillOrder: 266,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planar: 284,
  predictor: 317,
  colorMap: 320,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  inkSet: 332,
  extraSamples: 338,
  sampleFormat: 339,
  icc: 34675,
} as const;

/** Bytes per value of each field type (1 BYTE … 12 DOUBLE, 13 IFD). */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

interface Field {
  readonly type: number;
  readonly count: number;
  /** Offset of the values in the file. */
  readonly at: number;
}

class Reader {
  readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    readonly little: boolean,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u16(at: number) {
    if (at + 2 > this.bytes.length) fail('truncated file');
    return this.view.getUint16(at, this.little);
  }
  u32(at: number) {
    if (at + 4 > this.bytes.length) fail('truncated file');
    return this.view.getUint32(at, this.little);
  }
  /** The values of an integer field. */
  numbers(f: Field): number[] {
    if (f.type !== 1 && f.type !== 3 && f.type !== 4 && f.type !== 13) fail(`field of type ${f.type} where an integer was expected`);
    const size = TYPE_SIZE[f.type]!;
    if (f.at + f.count * size > this.bytes.length) fail('a field runs past the end of the file');
    return Array.from({ length: f.count }, (_, i) => (size === 1 ? this.bytes[f.at + i]! : size === 2 ? this.view.getUint16(f.at + 2 * i, this.little) : this.view.getUint32(f.at + 4 * i, this.little)));
  }
}

/** TIFF LZW (MSB-first codes, the width grows one code early). */
function lzw(src: Uint8Array, size: number): Uint8Array {
  if (src[0] === 0 && (src[1]! & 1) === 1) fail('old-style (pre-6.0) LZW is not supported');
  const out = new Uint8Array(size);
  let n = 0;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = first[i] = i;
    length[i] = 1;
    prefix[i] = -1;
  }
  let next = 258;
  let width = 9;
  let old = -1;
  let bitPos = 0;
  const total = src.length * 8;
  while (n < size) {
    if (bitPos + width > total) break; // ran out: the strip is short (checked below)
    let code = 0;
    for (let i = 0; i < width; i++, bitPos++) code = (code << 1) | ((src[bitPos >> 3]! >> (7 - (bitPos & 7))) & 1);
    if (code === 257) break; // EOI
    if (code === 256) {
      next = 258;
      width = 9;
      old = -1;
      continue;
    }
    let entry: number;
    if (code < next) {
      entry = code;
      if (old >= 0 && next < 4096) {
        prefix[next] = old;
        suffix[next] = first[code]!;
        first[next] = first[old]!;
        length[next] = length[old]! + 1;
        next++;
      }
    } else if (code === next && old >= 0 && next < 4096) {
      prefix[next] = old;
      suffix[next] = first[old]!;
      first[next] = first[old]!;
      length[next] = length[old]! + 1;
      entry = next++;
    } else fail('corrupt LZW data');
    // Write the string of `entry` backwards from its end.
    const len = length[entry!]!;
    const end = Math.min(n + len, size);
    let e = entry!;
    for (let i = n + len - 1; i >= n; i--) {
      if (i < end) out[i] = suffix[e]!;
      e = prefix[e]!;
    }
    n = end;
    old = entry!;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  if (n < size) fail(`truncated LZW data: ${n} of ${size} bytes`);
  return out;
}

function packBits(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let n = 0;
  for (let i = 0; n < size; ) {
    if (i >= src.length) fail(`truncated PackBits data: ${n} of ${size} bytes`);
    const h = (src[i++]! << 24) >> 24;
    if (h >= 0) {
      const count = Math.min(h + 1, size - n);
      if (i + count > src.length) fail('truncated PackBits data');
      out.set(src.subarray(i, i + count), n);
      n += count;
      i += h + 1;
    } else if (h !== -128) {
      if (i >= src.length) fail('truncated PackBits data');
      const count = Math.min(1 - h, size - n);
      out.fill(src[i++]!, n, n + count);
      n += count;
    }
  }
  return out;
}

/** Undoes the horizontal predictor on one row of 16-bit values: each adds the one a pixel to its left. */
function predict16(data: Uint8Array, row: number, values: number, perPixel: number, little: boolean): void {
  const lo = little ? 0 : 1;
  const hi = 1 - lo;
  for (let i = perPixel; i < values; i++) {
    const j = row + 2 * i;
    const k = j - 2 * perPixel;
    const v = (data[j + lo]! | (data[j + hi]! << 8)) + (data[k + lo]! | (data[k + hi]! << 8));
    data[j + lo] = v & 255;
    data[j + hi] = (v >> 8) & 255;
  }
}

/** Reads `count` 16-bit values in the file's byte order from `data` at `row` into `samples` at `o`. */
function place16(data: Uint8Array, row: number, count: number, samples: Uint16Array, o: number, little: boolean): void {
  const lo = little ? 0 : 1;
  const hi = 1 - lo;
  for (let k = 0, j = row; k < count; k++, j += 2) samples[o + k] = data[j + lo]! | (data[j + hi]! << 8);
}

/** One row of `cols` chunky 8-bit RGB(A) pixels, `spp` samples each, into RGBA `out` at `o` (alpha from the fourth sample, or opaque). */
function rgbaFrom8(data: Uint8Array, row: number, cols: number, spp: number, out: Uint8Array, o: number, alpha: boolean): void {
  if (spp === 4 && alpha) {
    out.set(data.subarray(row, row + 4 * cols), o);
    return;
  }
  for (let x = 0, j = row; x < cols; x++, j += spp, o += 4) {
    out[o] = data[j]!;
    out[o + 1] = data[j + 1]!;
    out[o + 2] = data[j + 2]!;
    out[o + 3] = alpha ? data[j + 3]! : 255;
  }
}

/** The same for 16-bit samples in the file's byte order. */
function rgbaFrom16(data: Uint8Array, row: number, cols: number, spp: number, out: Uint16Array, o: number, alpha: boolean, little: boolean): void {
  const lo = little ? 0 : 1;
  const hi = 1 - lo;
  for (let x = 0, j = row; x < cols; x++, j += 2 * spp, o += 4) {
    out[o] = data[j + lo]! | (data[j + hi]! << 8);
    out[o + 1] = data[j + 2 + lo]! | (data[j + 2 + hi]! << 8);
    out[o + 2] = data[j + 4 + lo]! | (data[j + 4 + hi]! << 8);
    out[o + 3] = alpha ? data[j + 6 + lo]! | (data[j + 6 + hi]! << 8) : 65535;
  }
}

/**
 * Decodes the first image of a TIFF file to RGBA: 8-bit for samples of up to 8 bits and palettes,
 * 16-bit for 16-bit samples, 32-bit float for float samples; straight alpha (associated alpha is
 * divided out), the samples as stored otherwise. CMYK is converted with the naive formula
 * R = (max − C)(max − K) / max. Rejects with a `CodecError` for what it cannot decode.
 */
export async function decodeTiff(input: Uint8Array, options: DecodeOptions = {}): Promise<DecodedImage> {
  const bytes = plain(input);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (bytes.length < 8) fail('not a TIFF file');
  const order = String.fromCharCode(bytes[0]!, bytes[1]!);
  if (order !== 'II' && order !== 'MM') fail('not a TIFF file (bad byte order mark)');
  const r = new Reader(bytes, order === 'II');
  const magic = r.u16(2);
  if (magic === 43) fail('BigTIFF is not supported');
  if (magic !== 42) fail('not a TIFF file (bad magic number)');

  // The first IFD.
  const ifd = r.u32(4);
  const count = r.u16(ifd);
  const fields = new Map<number, Field>();
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const n = r.u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 0) * n;
    if (!TYPE_SIZE[type]) continue; // an unknown type: skip the field, as readers must
    fields.set(tag, { type, count: n, at: size <= 4 ? e + 8 : r.u32(e + 8) });
  }
  const get = (tag: number) => {
    const f = fields.get(tag);
    return f ? r.numbers(f) : undefined;
  };
  const one = (tag: number, fallback?: number): number => {
    const v = get(tag);
    if (v === undefined || v.length === 0) {
      if (fallback === undefined) fail(`missing required field ${tag}`);
      return fallback!;
    }
    return v[0]!;
  };

  const width = one(TAG.width);
  const height = one(TAG.height);
  if (width === 0 || height === 0) fail(`invalid size ${width}×${height}`);
  if (width * height > maxPixels) fail(`${width}×${height} is larger than maxPixels (${maxPixels})`);
  const spp = one(TAG.samplesPerPixel, 1);
  if (spp < 1 || spp > 16) fail(`${spp} samples per pixel`);
  const bpsAll = get(TAG.bitsPerSample) ?? [1];
  const bps = bpsAll[0]!;
  if (bpsAll.length !== 1 && bpsAll.length !== spp) fail('BitsPerSample does not match SamplesPerPixel');
  if (bpsAll.some((b) => b !== bps)) fail('samples of different bit depths are not supported');
  const format = (get(TAG.sampleFormat) ?? [1])[0]!;
  const compression = one(TAG.compression, 1);
  const photometric = one(TAG.photometric);
  const planar = one(TAG.planar, 1) === 2;
  const predictor = one(TAG.predictor, 1);
  if (one(TAG.fillOrder, 1) !== 1) fail('FillOrder 2 (least significant bit first) is not supported');

  const isFloat = format === 3;
  if (format !== 1 && !isFloat) fail(`SampleFormat ${format} (signed integers) is not supported`);
  if (isFloat ? bps !== 32 : ![1, 2, 4, 8, 16].includes(bps)) fail(`${bps}-bit ${isFloat ? 'float' : 'integer'} samples are not supported`);
  const colours = photometric === 2 ? 3 : photometric === 5 ? 4 : photometric <= 1 || photometric === 3 ? 1 : fail(`PhotometricInterpretation ${photometric} is not supported`);
  if (photometric === 5 && one(TAG.inkSet, 1) !== 1) fail('CMYK with an ink set other than 1 is not supported');
  if (spp < colours) fail(`${spp} samples per pixel for a ${colours}-colour image`);
  if (bps < 8 && (photometric > 1 && photometric !== 3)) fail(`${bps}-bit samples are only supported for grey and palette images`);
  if (bps < 8 && spp !== 1) fail(`${bps}-bit samples with ${spp} samples per pixel are not supported`);
  if (isFloat && (photometric === 3 || photometric === 5 || photometric === 0)) fail('float samples are only supported for black-is-zero grey and RGB');
  if (photometric === 3 && bps === 16) fail('16-bit palettes are not supported');
  const extra = get(TAG.extraSamples) ?? [];
  const alpha = spp > colours && (extra[0] === 1 || extra[0] === 2) ? (extra[0] as 1 | 2) : 0;
  if (![1, 2, 3].includes(predictor)) fail(`predictor ${predictor} is not supported`);
  if (predictor === 2 && bps < 8) fail('the horizontal predictor needs 8- or 16-bit samples');
  if (predictor === 3 && !isFloat) fail('the floating-point predictor needs float samples');
  let palette: number[] | undefined;
  if (photometric === 3) {
    palette = get(TAG.colorMap);
    if (!palette || palette.length !== 3 << bps) fail('palette image without a colour map of the right size');
  }

  // Chunks: strips or tiles, each `cw` × `ch` pixels of one plane (planar) or of all samples.
  const tiled = fields.has(TAG.tileWidth);
  const cw = tiled ? one(TAG.tileWidth) : width;
  const ch = tiled ? one(TAG.tileLength) : Math.min(one(TAG.rowsPerStrip, height), height);
  if (cw === 0 || ch === 0) fail('zero tile or strip size');
  if (tiled && (cw % 16 || ch % 16)) fail('tile sizes must be multiples of 16');
  // A tile is a buffer we allocate: bounded like the image (maxPixels), and to at most four times
  // the image or 1 MP, which every real file stays within (small images in 256 × 256 tiles included).
  const tileLimit = Math.min(maxPixels, Math.max(4 * width * height, 1 << 20));
  if (tiled && cw * ch > tileLimit) fail(`a tile of ${cw}×${ch} is larger than the image allows (${tileLimit} pixels)`);
  const across = Math.ceil(width / cw);
  const down = Math.ceil(height / ch);
  const planes = planar ? spp : 1;
  const offsets = get(tiled ? TAG.tileOffsets : TAG.stripOffsets);
  const counts = get(tiled ? TAG.tileByteCounts : TAG.stripByteCounts);
  const chunks = across * down * planes;
  if (!offsets || offsets.length < chunks) fail(`${tiled ? 'tile' : 'strip'} offsets missing or too few`);
  if (!counts || counts.length < chunks) fail(`${tiled ? 'tile' : 'strip'} byte counts missing or too few`);
  const perPixel = planar ? 1 : spp;
  const rowBytes = Math.ceil((cw * perPixel * bps) / 8);
  const bytesPerSample = bps >> 3;

  const n = width * height;
  const depth = isFloat ? 32 : bps === 16 ? 16 : 8;
  const max = isFloat ? 1 : depth === 16 ? 65535 : 255;
  // Decoded samples of all channels at the file's depth, chunky, before colour conversion.
  const out = isFloat ? new Float32Array(n * 4) : depth === 16 ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  // Chunky RGB with no alpha or unassociated alpha goes straight into the output; everything else
  // through the samples first, then the colour conversion below.
  const direct = !planar && photometric === 2 && alpha !== 1 && bps >= 8;
  const samples = direct ? out : isFloat ? new Float32Array(n * spp) : depth === 16 ? new Uint16Array(n * spp) : new Uint8Array(n * spp);

  const decodeChunk = async (c: number) => {
    const plane = Math.floor(c / (across * down));
    const index = c % (across * down);
    const x0 = (index % across) * cw;
    const y0 = Math.floor(index / across) * ch;
    // A strip's last chunk holds only the rows left; a tile always holds the whole tile.
    const rows = tiled ? ch : Math.min(ch, height - y0);
    const size = rowBytes * rows;
    const at = offsets![c]!;
    const len = counts![c]!;
    if (at + len > bytes.length) fail(`${tiled ? 'tile' : 'strip'} ${c} runs past the end of the file`);
    const src = bytes.subarray(at, at + len);
    let data: Uint8Array;
    switch (compression) {
      case 1:
        if (len < size) fail(`${tiled ? 'tile' : 'strip'} ${c} is short: ${len} of ${size} bytes`);
        data = src.slice(0, size);
        break;
      case 5:
        data = lzw(src, size);
        break;
      case 8:
      case 32946:
        data = await inflate(src, 'tiff', `${tiled ? 'tile' : 'strip'} ${c}`, size);
        break;
      case 32773:
        data = packBits(src, size);
        break;
      default:
        return fail(`compression ${compression} is not supported`);
    }

    // Predictors work row by row.
    const values = cw * perPixel;
    for (let y = 0; y < rows; y++) {
      const row = y * rowBytes;
      if (predictor === 2 && bps === 8) for (let i = perPixel; i < values; i++) data[row + i] = (data[row + i]! + data[row + i - perPixel]!) & 255;
      else if (predictor === 2) {
        predict16(data, row, values, perPixel, r.little);
      } else if (predictor === 3) {
        // libtiff's fpAcc: undo byte differencing over the row (stride = samples per pixel), then the
        // bytes of each value come from its byte planes, most significant first.
        const bytesInRow = values * bytesPerSample;
        for (let i = perPixel; i < bytesInRow; i++) data[row + i] = (data[row + i]! + data[row + i - perPixel]!) & 255;
        const tmp = data.slice(row, row + bytesInRow);
        const view = new DataView(data.buffer, data.byteOffset + row, bytesInRow);
        for (let i = 0; i < values; i++) {
          const v = (tmp[i]! << 24) | (tmp[values + i]! << 16) | (tmp[2 * values + i]! << 8) | tmp[3 * values + i]!;
          view.setUint32(4 * i, v >>> 0, r.little);
        }
      }
    }

    // Into the image: a row of a chunk is contiguous in `samples` when the file is chunky.
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const lo = r.little ? 0 : 1;
    const hi = 1 - lo;
    const cols = Math.min(cw, width - x0);
    for (let y = 0; y < rows && y0 + y < height; y++) {
      const row = y * rowBytes;
      if (direct) {
        const o = ((y0 + y) * width + x0) * 4;
        if (bps === 8) rgbaFrom8(data, row, cols, spp, out as Uint8Array, o, alpha !== 0);
        else if (bps === 16) rgbaFrom16(data, row, cols, spp, out as Uint16Array, o, alpha !== 0, r.little);
        else for (let x = 0; x < cols; x++) for (let c = 0; c < 4; c++) out[o + 4 * x + c] = c < 3 || alpha ? view.getFloat32(row + 4 * (x * spp + c), r.little) : 1;
        continue;
      }
      const o = ((y0 + y) * width + x0) * spp;
      if (!planar && bps === 8) samples.set(data.subarray(row, row + cols * perPixel), o);
      else if (!planar && bps === 16) {
        place16(data, row, cols * perPixel, samples as Uint16Array, o, r.little);
      } else if (!planar && bps === 32) {
        for (let k = 0; k < cols * perPixel; k++) samples[o + k] = view.getFloat32(row + 4 * k, r.little);
      } else
        for (let x = 0; x < cols; x++)
          for (let s = 0; s < perPixel; s++) {
            const k = x * perPixel + s;
            let v: number;
            if (bps === 8) v = data[row + k]!;
            else if (bps === 16) v = data[row + 2 * k + lo]! | (data[row + 2 * k + hi]! << 8);
            else if (bps === 32) v = view.getFloat32(row + 4 * k, r.little);
            else {
              const bit = k * bps;
              v = (data[row + (bit >> 3)]! >> (8 - bps - (bit & 7))) & ((1 << bps) - 1);
            }
            samples[o + x * spp + (planar ? plane : s)] = v;
          }
    }
  };
  // Several chunks are in flight at once: where the runtime inflates on other threads (Node), they
  // inflate in parallel while this thread restores and places the ones that are done. Chunks cover
  // disjoint pixels (or planes), so the order they finish in does not matter.
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < chunks && !failed) {
      try {
        await decodeChunk(next++);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, chunks) }, worker));

  // Colour conversion to RGBA.
  const low = bps < 8 ? 255 / ((1 << bps) - 1) : 1;
  if (!direct) {
    for (let i = 0; i < n; i++) {
      const s = i * spp;
      const o = i * 4;
      const a = alpha ? samples[s + colours]! : max;
      if (photometric <= 1) {
        let g = samples[s]!;
        if (photometric === 0) g = (bps < 8 ? (1 << bps) - 1 : max) - g;
        out[o] = out[o + 1] = out[o + 2] = g * low;
      } else if (photometric === 3) {
        const p = samples[s]!;
        const entries = 1 << bps;
        out[o] = palette![p]! >> 8;
        out[o + 1] = palette![entries + p]! >> 8;
        out[o + 2] = palette![2 * entries + p]! >> 8;
      } else if (photometric === 2) {
        out[o] = samples[s]!;
        out[o + 1] = samples[s + 1]!;
        out[o + 2] = samples[s + 2]!;
      } else {
        const k = max - samples[s + 3]!;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(((max - samples[s + c]!) * k) / max);
      }
      out[o + 3] = a;
      if (alpha === 1) {
        // Associated alpha: divide it out (a colour over zero alpha is zero).
        for (let c = 0; c < 3; c++) out[o + c] = a === 0 ? 0 : isFloat ? out[o + c]! / a : Math.min(max, Math.round((out[o + c]! * max) / a));
      }
    }
  }

  const iccField = fields.get(TAG.icc);
  const icc = iccField && iccField.at + iccField.count <= bytes.length ? bytes.slice(iccField.at, iccField.at + iccField.count) : undefined;
  const base = { width, height, ...(icc ? { icc } : {}) };
  if (isFloat) return { ...base, bitDepth: 32, data: out as Float32Array };
  if (depth === 16) return { ...base, bitDepth: 16, data: out as Uint16Array };
  return { ...base, bitDepth: 8, data: out as Uint8Array };
}
