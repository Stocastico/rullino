// OpenEXR (.exr, #182): scanline images with half, float or uint channels, compressions none, RLE,
// ZIPS, ZIP and PIZ (the lossless ones: PXR24, B44 and DWA are refused by name). The result is the
// scene-linear colour as float32 RGBA with straight alpha (EXR stores colour premultiplied, so it is
// divided by alpha; colour under zero alpha is 0), grey (Y) replicated, a missing alpha opaque.
// Written from the OpenEXR file layout and the algorithms of ImfPizCompressor, ImfHuf, ImfWav,
// ImfZip and ImfRle; checked against files written by OpenEXR (`test/hdr/`).

import { inflate } from './zlib';
import { CodecError, DEFAULT_MAX_PIXELS, plain, type Chromaticities, type DecodedImage, type DecodeOptions } from './types';

const fail = (message: string): never => {
  throw new CodecError('exr', message);
};

/** Whether `bytes` starts like an OpenEXR file (magic number 20000630). */
export const isExr = (b: Uint8Array) => b.length >= 4 && b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01;

const COMPRESSION_NAMES = ['none', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];
const LINES_PER_BLOCK = [1, 1, 1, 16, 32, 16, 32, 32, 32, 256];
const SUPPORTED = 4; // compressions 0..4

interface Channel {
  readonly name: string;
  /** 0 uint, 1 half, 2 float. */
  readonly type: number;
  /** Bytes per sample. */
  readonly size: number;
}

let halfTable: Float32Array | undefined;
/** Half-precision bits to float, as a 65 536-entry table built on first use. */
function halfToFloat(): Float32Array {
  if (halfTable) return halfTable;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const e = (h >> 10) & 31;
    const m = h & 1023;
    const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m === 0 ? Infinity : NaN) : (1 + m / 1024) * 2 ** (e - 15);
    t[h] = h & 0x8000 ? -v : v;
  }
  return (halfTable = t);
}

/** Decodes an OpenEXR scanline file. Throws a `CodecError` for anything else, or what it cannot read. */
export async function decodeExr(input: Uint8Array, options: DecodeOptions = {}): Promise<Extract<DecodedImage, { bitDepth: 32 }>> {
  const b = plain(input);
  if (!isExr(b)) fail('not an OpenEXR file (bad magic number)');
  if (b.length < 8) fail('truncated header');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[4] !== 2) fail(`unsupported version ${b[4]}`);
  if (b[5]! & 0x02) fail('tiled images are not supported');
  if (b[5]! & 0x08) fail('deep images are not supported');
  if (b[5]! & 0x10) fail('multi-part files are not supported');

  // ---- header ------------------------------------------------------------------------------
  let at = 8;
  const cstring = (limit = 256): string => {
    const start = at;
    while (at < b.length && b[at] !== 0) {
      if (at - start > limit) fail('attribute name too long');
      at++;
    }
    if (at >= b.length) fail('truncated header');
    return String.fromCharCode(...b.subarray(start, at++));
  };
  let channels: Channel[] | undefined;
  let compression: number | undefined;
  let window: [number, number, number, number] | undefined;
  let primaries: Chromaticities | undefined;
  for (let n = 0; ; n++) {
    if (at >= b.length) fail('truncated header');
    if (b[at] === 0) {
      at++;
      break;
    }
    if (n > 1000) fail('header has no end');
    const name = cstring();
    const type = cstring();
    if (at + 4 > b.length) fail('truncated header');
    const size = view.getInt32(at, true);
    at += 4;
    if (size < 0 || at + size > b.length) fail(`attribute ${name} runs past the end of the file`);
    const end = at + size;
    if (name === 'channels' && type === 'chlist') {
      channels = [];
      const save = at;
      while (at < end && b[at] !== 0) {
        const cname = cstring();
        if (at + 16 > end) fail('truncated channel list');
        const pixelType = view.getInt32(at, true);
        const xs = view.getInt32(at + 8, true);
        const ys = view.getInt32(at + 12, true);
        at += 16;
        if (pixelType < 0 || pixelType > 2) fail(`channel ${cname} has an unknown pixel type ${pixelType}`);
        if (xs !== 1 || ys !== 1) fail(`channel ${cname} is subsampled, which is not supported`);
        channels.push({ name: cname, type: pixelType, size: pixelType === 1 ? 2 : 4 });
      }
      at = save;
    } else if (name === 'compression' && type === 'compression' && size >= 1) compression = b[at]!;
    else if (name === 'dataWindow' && type === 'box2i' && size >= 16) window = [view.getInt32(at, true), view.getInt32(at + 4, true), view.getInt32(at + 8, true), view.getInt32(at + 12, true)];
    else if (name === 'chromaticities' && type === 'chromaticities' && size >= 32) {
      const v = Array.from({ length: 8 }, (_, i) => view.getFloat32(at + 4 * i, true));
      if (v.every(Number.isFinite)) primaries = { red: [v[0]!, v[1]!], green: [v[2]!, v[3]!], blue: [v[4]!, v[5]!], white: [v[6]!, v[7]!] };
    }
    at = end;
  }
  if (!channels || channels.length === 0) fail('no channel list');
  if (compression === undefined) fail('no compression attribute');
  if (!window) fail('no data window');
  const [xMin, yMin, xMax, yMax] = window!;
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  if (!(width >= 1 && height >= 1)) fail(`invalid data window ${width}×${height}`);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (width * height > maxPixels) fail(`${width}×${height} is larger than maxPixels (${maxPixels})`);
  const comp = compression!;
  if (!(comp >= 0 && comp < COMPRESSION_NAMES.length)) fail(`unknown compression ${comp}`);
  if (comp > SUPPORTED) fail(`compression ${COMPRESSION_NAMES[comp]} is not supported (none, RLE, ZIPS, ZIP and PIZ are)`);

  // Channels in the file's order (alphabetical), and where R, G, B, A (or Y) go in the output.
  const sorted = [...channels!].sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0));
  const names = new Set(sorted.map((c) => c.name));
  const grey = !names.has('R') && !names.has('G') && !names.has('B') && names.has('Y');
  if (!grey && !(names.has('R') && names.has('G') && names.has('B'))) fail('the image has no R, G, B (or Y) channels');
  const slot = (name: string) => (grey ? (name === 'Y' ? 0 : -1) : ({ R: 0, G: 1, B: 2, A: 3 } as Record<string, number>)[name] ?? -1);
  let lineBytes = 0;
  const offsets: number[] = [];
  for (const c of sorted) {
    offsets.push(lineBytes);
    lineBytes += c.size * width;
  }
  const hasAlpha = !grey && names.has('A');

  // ---- offset table and blocks ---------------------------------------------------------------
  const lpb = LINES_PER_BLOCK[comp]!;
  const blocks = Math.ceil(height / lpb);
  if (at + blocks * 8 > b.length) fail('truncated offset table');
  const out = new Float32Array(width * height * 4);
  const seen = new Uint8Array(blocks);
  const half = halfToFloat();
  const outView = out;
  for (let k = 0; k < blocks; k++) {
    const lo = view.getUint32(at + 8 * k, true);
    const hi = view.getUint32(at + 8 * k + 4, true);
    const offset = hi * 4294967296 + lo;
    if (offset < at + blocks * 8 || offset + 8 > b.length) fail('the file is incomplete (an offset points outside it)');
    const y = view.getInt32(offset, true);
    const size = view.getInt32(offset + 4, true);
    const index = (y - yMin) / lpb;
    if (!Number.isInteger(index) || index < 0 || index >= blocks) fail(`a block starts at line ${y}, which is not a block boundary of the data window`);
    if (seen[index]) fail(`line ${y} appears twice`);
    seen[index] = 1;
    const lines = Math.min(lpb, height - index * lpb);
    const unpacked = lines * lineBytes;
    if (size <= 0 || offset + 8 + size > b.length) fail('a block runs past the end of the file');
    if (size > unpacked) fail('a block is larger than the pixels it holds');
    const data = b.subarray(offset + 8, offset + 8 + size);
    let raw: Uint8Array;
    if (size === unpacked) raw = data; // stored uncompressed when compressing did not help
    else if (comp === 1) raw = undoPredictor(rleDecode(data, unpacked));
    else if (comp === 2 || comp === 3) raw = undoPredictor(await inflate(data, 'exr', 'ZIP block', unpacked));
    else if (comp === 4) raw = pizDecode(data, lines, width, sorted);
    else raw = fail('a block is smaller than its pixels but the file is not compressed');
    const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let line = 0; line < lines; line++) {
      const rowStart = ((y - yMin + line) * width) * 4;
      const lineStart = line * lineBytes;
      for (let ci = 0; ci < sorted.length; ci++) {
        const s = slot(sorted[ci]!.name);
        if (s < 0) continue;
        const c = sorted[ci]!;
        let p = lineStart + offsets[ci]!;
        for (let x = 0; x < width; x++, p += c.size) {
          const v = c.type === 1 ? half[rawView.getUint16(p, true)]! : c.type === 2 ? rawView.getFloat32(p, true) : rawView.getUint32(p, true);
          outView[rowStart + 4 * x + s] = v;
        }
      }
    }
  }

  // Grey into R, G, B; straight alpha (colour was stored premultiplied); an opaque alpha when there is none.
  for (let i = 0; i < out.length; i += 4) {
    if (grey) {
      out[i + 1] = out[i]!;
      out[i + 2] = out[i]!;
    }
    if (hasAlpha) {
      const a = out[i + 3]!;
      if (a > 0) {
        out[i] = out[i]! / a;
        out[i + 1] = out[i + 1]! / a;
        out[i + 2] = out[i + 2]! / a;
      } else {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
      }
    } else out[i + 3] = 1;
  }
  return { width, height, bitDepth: 32, data: out, linear: true, ...(primaries ? { primaries } : {}) };
}

// ---- RLE, ZIP --------------------------------------------------------------------------------

/** OpenEXR's byte run lengths: a negative count n is -n literal bytes, a count n ≥ 0 repeats the next byte n + 1 times. */
function rleDecode(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (i < data.length) {
    const count = (data[i++]! << 24) >> 24;
    if (count < 0) {
      const n = -count;
      if (i + n > data.length || o + n > size) fail('corrupt RLE block');
      out.set(data.subarray(i, i + n), o);
      i += n;
      o += n;
    } else {
      const n = count + 1;
      if (i >= data.length || o + n > size) fail('corrupt RLE block');
      out.fill(data[i++]!, o, o + n);
      o += n;
    }
  }
  if (o !== size) fail('an RLE block is shorter than its pixels');
  return out;
}

/** RLE and ZIP data were delta-coded and split into even and odd bytes before compression: undo both. */
function undoPredictor(t: Uint8Array): Uint8Array {
  for (let i = 1; i < t.length; i++) t[i] = (t[i - 1]! + t[i]! - 128) & 255;
  const out = new Uint8Array(t.length);
  const half = (t.length + 1) >> 1;
  for (let i = 0, a = 0, c = half; i < t.length; ) {
    out[i++] = t[a++]!;
    if (i < t.length) out[i++] = t[c++]!;
  }
  return out;
}

// ---- PIZ -------------------------------------------------------------------------------------

/** One block of PIZ data: a value-range bitmap, Huffman coded 16-bit wavelet coefficients, per channel planes. */
function pizDecode(data: Uint8Array, lines: number, width: number, channels: readonly Channel[]): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Per channel: where its plane starts in the 16-bit buffer, and how many 16-bit words one sample takes.
  const words = channels.map((c) => c.size >> 1);
  const starts: number[] = [];
  let total = 0;
  for (const w of words) {
    starts.push(total);
    total += width * lines * w;
  }
  let at = 0;
  if (data.length < 4) fail('a PIZ block is too short');
  const minNonZero = view.getUint16(0, true);
  const maxNonZero = view.getUint16(2, true);
  at = 4;
  if (maxNonZero >= 8192) fail('a PIZ block has an invalid value range');
  const bitmap = new Uint8Array(8192);
  if (minNonZero <= maxNonZero) {
    const n = maxNonZero - minNonZero + 1;
    if (at + n > data.length) fail('a PIZ block is truncated');
    bitmap.set(data.subarray(at, at + n), minNonZero);
    at += n;
  }
  // The values that occur, in order (0 always): the wavelet data was remapped onto their ranks.
  const lut = new Uint16Array(65536);
  let k = 0;
  for (let i = 0; i < 65536; i++) if (i === 0 || bitmap[i >> 3]! & (1 << (i & 7))) lut[k++] = i;
  const maxValue = k - 1;

  if (at + 4 > data.length) fail('a PIZ block is truncated');
  const length = view.getInt32(at, true);
  at += 4;
  if (length < 0 || at + length > data.length) fail('a PIZ block is truncated');
  const tmp = new Uint16Array(total);
  hufUncompress(data, at, length, tmp);

  channels.forEach((_, ci) => {
    for (let j = 0; j < words[ci]!; j++) wav2Decode(tmp, starts[ci]! + j, width, words[ci]!, lines, width * words[ci]!, maxValue);
  });
  for (let i = 0; i < total; i++) tmp[i] = lut[tmp[i]!]!;

  // Back to scanline order: line by line, channel by channel.
  const out = new Uint8Array(total * 2);
  const outView = new DataView(out.buffer);
  const next = starts.slice();
  let o = 0;
  for (let y = 0; y < lines; y++)
    for (let ci = 0; ci < channels.length; ci++) {
      const n = width * words[ci]!;
      for (let x = 0; x < n; x++, o += 2) outView.setUint16(o, tmp[next[ci]!++]!, true);
    }
  return out;
}

const HUF_DECBITS = 14;
const HUF_ENCSIZE = (1 << 16) + 1;
const SHORT_ZEROCODE_RUN = 59;
const LONG_ZEROCODE_RUN = 63;
const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;
const MAX_CODE_BITS = 32;

/** Huffman decoding of OpenEXR (ImfHuf): a packed canonical code table, then `nBits` of codes with a run-length symbol. */
function hufUncompress(data: Uint8Array, start: number, length: number, out: Uint16Array): void {
  const nRaw = out.length;
  if (length === 0) {
    if (nRaw !== 0) fail('a PIZ block has no Huffman data');
    return;
  }
  if (length < 20) fail('a PIZ block is truncated');
  const v = new DataView(data.buffer, data.byteOffset + start, length);
  const im = v.getUint32(0, true);
  const iM = v.getUint32(4, true);
  const nBits = v.getUint32(12, true);
  if (im >= HUF_ENCSIZE || iM >= HUF_ENCSIZE || im > iM) fail('invalid Huffman table range');
  const end = start + length;
  let p = start + 20;

  // The code lengths, 6 bits each, with run-length coded zeros.
  const len = new Uint8Array(HUF_ENCSIZE);
  let c = 0;
  let lc = 0;
  const bits = (n: number): number => {
    while (lc < n) {
      if (p >= end) fail('truncated Huffman table');
      c = ((c & 0xffffff) << 8) | data[p++]!;
      lc += 8;
    }
    lc -= n;
    return (c >>> lc) & ((1 << n) - 1);
  };
  for (let s = im; s <= iM; s++) {
    const l = bits(6);
    if (l === LONG_ZEROCODE_RUN) {
      const run = bits(8) + SHORTEST_LONG_RUN;
      if (s + run > iM + 1) fail('invalid Huffman table (a run of zeros is too long)');
      s += run - 1;
    } else if (l >= SHORT_ZEROCODE_RUN) {
      const run = l - SHORT_ZEROCODE_RUN + 2;
      if (s + run > iM + 1) fail('invalid Huffman table (a run of zeros is too long)');
      s += run - 1;
    } else len[s] = l;
  }
  const streamStart = p;
  if (nBits > 8 * (end - streamStart)) fail('a PIZ block is truncated');

  // Canonical codes: from the longest length down, each length starts where the previous ones leave off.
  const count = new Array<number>(59).fill(0);
  for (let s = im; s <= iM; s++) count[len[s]!]!++;
  for (let l = MAX_CODE_BITS + 1; l < 59; l++) if (count[l]) fail('Huffman codes longer than 32 bits are not supported');
  const first = new Array<number>(59).fill(0);
  let code = 0;
  for (let l = 58; l > 0; l--) {
    const nc = Math.floor((code + count[l]!) / 2);
    first[l] = code;
    code = nc;
  }
  const next = first.slice();
  const shortLen = new Uint8Array(1 << HUF_DECBITS);
  const shortSym = new Uint32Array(1 << HUF_DECBITS);
  const longFirst = first.slice();
  const longSyms: number[][] = Array.from({ length: 59 }, () => []);
  for (let s = im; s <= iM; s++) {
    const l = len[s]!;
    if (l === 0) continue;
    const cd = next[l]!++;
    if (cd >= 2 ** l) fail('invalid Huffman table entry');
    if (l > HUF_DECBITS) longSyms[l]!.push(s);
    else {
      const base = cd << (HUF_DECBITS - l);
      const n = 1 << (HUF_DECBITS - l);
      for (let i = 0; i < n; i++) {
        if (shortLen[base + i]) fail('invalid Huffman table entry');
        shortLen[base + i] = l;
        shortSym[base + i] = s;
      }
    }
  }

  // The bit stream.
  const window = (pos: number): number => {
    const i = streamStart + (pos >>> 3);
    const off = pos & 7;
    const w = ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    return ((w << off) | ((data[i + 4] ?? 0) >>> (8 - off))) >>> 0;
  };
  let pos = 0;
  let o = 0;
  while (pos < nBits) {
    const win = window(pos);
    const top = win >>> (32 - HUF_DECBITS);
    let sym = -1;
    let l = shortLen[top]!;
    if (l) sym = shortSym[top]!;
    else
      for (l = HUF_DECBITS + 1; l <= MAX_CODE_BITS; l++) {
        const syms = longSyms[l]!;
        if (syms.length === 0) continue;
        const idx = (win >>> (32 - l)) - longFirst[l]!;
        if (idx >= 0 && idx < syms.length) {
          sym = syms[idx]!;
          break;
        }
      }
    if (sym < 0) fail('invalid Huffman code');
    pos += l;
    if (pos > nBits) fail('a Huffman code runs past the end of the data');
    if (sym === iM) {
      // The run-length symbol: the next 8 bits say how often to repeat the previous value.
      if (pos + 8 > nBits) fail('a Huffman run runs past the end of the data');
      const n = (window(pos) >>> 24) & 255;
      pos += 8;
      if (o === 0) fail('a Huffman run has nothing to repeat');
      if (o + n > nRaw) fail('too much Huffman data');
      out.fill(out[o - 1]!, o, o + n);
      o += n;
    } else {
      if (o >= nRaw) fail('too much Huffman data');
      out[o++] = sym;
    }
  }
  if (o !== nRaw) fail('not enough Huffman data');
}

let ra = 0;
let rb = 0;
/** The inverse of OpenEXR's 14-bit wavelet step (values below 2^14, differences in 15 bits). */
function wdec14(l: number, h: number): void {
  const ls = (l << 16) >> 16;
  const hs = (h << 16) >> 16;
  const ai = ls + (hs & 1) + (hs >> 1);
  ra = ai & 0xffff;
  rb = (ai - hs) & 0xffff;
}
/** The inverse of the 16-bit step (modulo 2^16). */
function wdec16(l: number, h: number): void {
  const bb = (l - (h >> 1)) & 0xffff;
  ra = (h + bb - 32768) & 0xffff;
  rb = bb;
}

/** The 2-D inverse wavelet transform of a plane (ImfWav `wav2Decode`): `ox` / `oy` are the strides of x and y. */
function wav2Decode(buf: Uint16Array, start: number, nx: number, ox: number, ny: number, oy: number, mx: number): void {
  const dec = mx < 1 << 14 ? wdec14 : wdec16;
  const n = nx > ny ? ny : nx;
  let p = 1;
  while (p <= n) p <<= 1;
  p >>= 1;
  let p2 = p;
  p >>= 1;
  while (p >= 1) {
    let py = start;
    const ey = start + oy * (ny - p2);
    const oy1 = oy * p;
    const oy2 = oy * p2;
    const ox1 = ox * p;
    const ox2 = ox * p2;
    for (; py <= ey; py += oy2) {
      let px = py;
      const ex = py + ox * (nx - p2);
      for (; px <= ex; px += ox2) {
        const p01 = px + ox1;
        const p10 = px + oy1;
        const p11 = p10 + ox1;
        dec(buf[px]!, buf[p10]!);
        const i00 = ra;
        const i10 = rb;
        dec(buf[p01]!, buf[p11]!);
        const i01 = ra;
        const i11 = rb;
        dec(i00, i01);
        buf[px] = ra;
        buf[p01] = rb;
        dec(i10, i11);
        buf[p10] = ra;
        buf[p11] = rb;
      }
      if (nx & p) {
        const p10 = px + oy1;
        dec(buf[px]!, buf[p10]!);
        buf[px] = ra;
        buf[p10] = rb;
      }
    }
    if (ny & p) {
      let px = py;
      const ex = py + ox * (nx - p2);
      for (; px <= ex; px += ox2) {
        const p01 = px + ox1;
        dec(buf[px]!, buf[p01]!);
        buf[px] = ra;
        buf[p01] = rb;
      }
    }
    p2 = p;
    p >>= 1;
  }
}
