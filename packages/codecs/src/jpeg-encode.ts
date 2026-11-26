// JPEG encoder (#179): baseline, YCbCr, 4:4:4 / 4:2:2 / 4:2:0, the standard (Annex K) tables scaled
// by quality as libjpeg does, standard Huffman tables. Every step follows libjpeg-turbo's C encoder
// (jccolor.c, jcsample.c, jfdctint.c, jcdctmgr.c, jccoefct.c, jcparam.c), so a file is the one
// libjpeg-turbo (Pillow, cjpeg) writes for the same settings, from the quantisation tables to the
// last bit, and the same in every runtime. Alpha is dropped (JPEG has none): flatten first.

import { CodecError } from './types';

const fail = (message: string): never => {
  throw new CodecError('jpeg', message);
};

export interface JpegEncodeOptions {
  /** 0–1, libjpeg's quality / 100 (rounded to a whole percent). Default 0.9. */
  readonly quality?: number;
  /** Chroma subsampling. Default '4:2:0' (what libjpeg, Pillow and browsers write). */
  readonly subsampling?: '4:4:4' | '4:2:2' | '4:2:0';
  /** One component (the luma of the RGB, 8-bit grey), as Pillow writes an 'L' image: a third of the work and no chroma. Default false. */
  readonly grey?: boolean;
  /** An ICC profile to embed (APP2 segments). */
  readonly icc?: Uint8Array;
}

/** An image to encode: 8-bit RGBA (alpha ignored). */
export interface Rgba8 {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15,
  23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** Annex K quantisation tables, natural order (jcparam.c). */
const LUMINANCE_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24,
  35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMINANCE_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

/** Annex K Huffman tables: code counts per length 1..16, then the symbols. */
export const STANDARD_HUFFMAN = {
  dcLuminance: { counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  dcChrominance: { counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  acLuminance: {
    counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
    symbols: [
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1,
      0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
      0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a,
      0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
      0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
      0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
    ],
  },
  acChrominance: {
    counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
    symbols: [
      0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1,
      0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36,
      0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
      0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a,
      0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
      0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
    ],
  },
};

/** libjpeg's quality scaling (jpeg_quality_scaling + jpeg_add_quant_table with force_baseline). */
function scaledTable(base: readonly number[], quality: number): Uint8Array {
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
  return Uint8Array.from(base, (b) => Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))));
}

/** Code and length for every symbol of a Huffman table (canonical codes). */
function codes(t: { counts: readonly number[]; symbols: readonly number[] }) {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < t.counts[len - 1]!; i++, k++, c++) {
      code[t.symbols[k]!] = c;
      size[t.symbols[k]!] = len;
    }
    c <<= 1;
  }
  return { code, size };
}

// RGB → YCbCr tables of jccolor.c (SCALEBITS 16; Cb and Cr rounded with 0.5 − ε).
const SCALEBITS = 16;
const FIX = (x: number) => Math.floor(x * (1 << SCALEBITS) + 0.5);
const HALF = 1 << (SCALEBITS - 1);
const CBCR_OFFSET = 128 << SCALEBITS;
const T = new Int32Array(8 * 256);
for (let i = 0; i < 256; i++) {
  T[i] = FIX(0.299) * i;
  T[256 + i] = FIX(0.587) * i;
  T[512 + i] = FIX(0.114) * i + HALF;
  T[768 + i] = -FIX(0.16874) * i;
  T[1024 + i] = -FIX(0.33126) * i;
  T[1280 + i] = FIX(0.5) * i + CBCR_OFFSET + HALF - 1; // B → Cb and R → Cr
  T[1536 + i] = -FIX(0.41869) * i;
  T[1792 + i] = -FIX(0.08131) * i;
}

// The integer forward DCT of libjpeg (jfdctint.c, jpeg_fdct_islow); output scaled up by 8.
const CONST_BITS = 13;
const PASS1_BITS = 2;
const descale = (x: number, n: number) => (x + (1 << (n - 1))) >> n;
function fdct(d: Int32Array): void {
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 1 : 8; // rows, then columns
    const line = pass === 0 ? 8 : 1;
    const shift = pass === 0 ? CONST_BITS - PASS1_BITS : CONST_BITS + PASS1_BITS;
    for (let l = 0; l < 8; l++) {
      const o = l * line;
      const d0 = d[o]!;
      const d1 = d[o + step]!;
      const d2 = d[o + 2 * step]!;
      const d3 = d[o + 3 * step]!;
      const d4 = d[o + 4 * step]!;
      const d5 = d[o + 5 * step]!;
      const d6 = d[o + 6 * step]!;
      const d7 = d[o + 7 * step]!;
      const tmp0 = d0 + d7;
      let tmp7 = d0 - d7;
      const tmp1 = d1 + d6;
      let tmp6 = d1 - d6;
      const tmp2 = d2 + d5;
      let tmp5 = d2 - d5;
      const tmp3 = d3 + d4;
      let tmp4 = d3 - d4;
      const tmp10 = tmp0 + tmp3;
      const tmp13 = tmp0 - tmp3;
      const tmp11 = tmp1 + tmp2;
      const tmp12 = tmp1 - tmp2;
      if (pass === 0) {
        d[o] = (tmp10 + tmp11) << PASS1_BITS;
        d[o + 4 * step] = (tmp10 - tmp11) << PASS1_BITS;
      } else {
        d[o] = descale(tmp10 + tmp11, PASS1_BITS);
        d[o + 4 * step] = descale(tmp10 - tmp11, PASS1_BITS);
      }
      let z1 = (tmp12 + tmp13) * 4433;
      d[o + 2 * step] = descale(z1 + tmp13 * 6270, shift);
      d[o + 6 * step] = descale(z1 + tmp12 * -15137, shift);
      z1 = tmp4 + tmp7;
      let z2 = tmp5 + tmp6;
      let z3 = tmp4 + tmp6;
      let z4 = tmp5 + tmp7;
      const z5 = (z3 + z4) * 9633;
      tmp4 *= 2446;
      tmp5 *= 16819;
      tmp6 *= 25172;
      tmp7 *= 12299;
      z1 *= -7373;
      z2 *= -20995;
      z3 = z3 * -16069 + z5;
      z4 = z4 * -3196 + z5;
      d[o + 7 * step] = descale(tmp4 + z1 + z3, shift);
      d[o + 5 * step] = descale(tmp5 + z2 + z4, shift);
      d[o + 3 * step] = descale(tmp6 + z2 + z3, shift);
      d[o + step] = descale(tmp7 + z1 + z4, shift);
    }
  }
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private acc = 0;
  private n = 0;

  private ensure(extra: number) {
    if (this.length + extra <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(this.buf.length * 2, this.length + extra));
    grown.set(this.buf.subarray(0, this.length));
    this.buf = grown;
  }
  byte(b: number) {
    this.ensure(1);
    this.buf[this.length++] = b;
  }
  bytes(b: ArrayLike<number>) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  u16(v: number) {
    this.byte(v >> 8);
    this.byte(v & 255);
  }
  segment(marker: number, body: ArrayLike<number>) {
    this.byte(0xff);
    this.byte(marker);
    this.u16(body.length + 2);
    this.bytes(body);
  }
  /** Entropy-coded bits, 0xFF followed by a stuffed 0x00. */
  bits(code: number, size: number) {
    this.acc = (this.acc << size) | code;
    this.n += size;
    while (this.n >= 8) {
      const b = (this.acc >> (this.n - 8)) & 255;
      this.byte(b);
      if (b === 0xff) this.byte(0);
      this.n -= 8;
    }
    this.acc &= (1 << this.n) - 1;
  }
  /** Pads the last byte with 1 bits, as libjpeg does. */
  flush() {
    if (this.n > 0) this.bits((1 << (8 - this.n)) - 1, 8 - this.n);
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

/** Bits needed for |v| (the JPEG "size" category). */
const category = (v: number) => (v === 0 ? 0 : 32 - Math.clz32(v < 0 ? -v : v));

/**
 * Encodes 8-bit RGBA as a baseline JPEG (YCbCr, alpha dropped). With the same quality and
 * subsampling, the bytes after the JFIF header are those libjpeg-turbo writes with its standard
 * Huffman tables (Pillow without `optimize`, cjpeg without `-optimize`).
 */
export function encodeJpeg(image: Rgba8, options: JpegEncodeOptions = {}): Uint8Array {
  const { width, height, data } = image;
  if (!(width >= 1 && height >= 1 && width <= 65535 && height <= 65535 && Number.isInteger(width) && Number.isInteger(height))) fail(`cannot encode a ${width}×${height} image (1 to 65535 per side)`);
  if (data.length !== width * height * 4) fail(`expected ${width * height * 4} bytes of RGBA, got ${data.length}`);
  const q = options.quality ?? 0.9;
  if (!(q >= 0 && q <= 1)) fail('quality must be in [0, 1]');
  const quality = Math.min(100, Math.max(1, Math.round(q * 100)));
  const grey = options.grey === true;
  const sub = grey ? '4:4:4' : (options.subsampling ?? '4:2:0');
  if (sub !== '4:4:4' && sub !== '4:2:2' && sub !== '4:2:0') fail(`unknown subsampling ${String(sub)}`);
  const hmax = sub === '4:4:4' ? 1 : 2;
  const vmax = sub === '4:2:0' ? 2 : 1;

  // Colour conversion at full resolution, rows padded to a multiple of vmax and columns to the
  // downsampler's input width by repeating the last ones (jcprepct.c, expand_right_edge).
  const mcusX = Math.ceil(width / (8 * hmax));
  const mcusY = Math.ceil(height / (8 * vmax));
  const fullW = mcusX * 8 * hmax;
  const fullH = Math.ceil(height / vmax) * vmax;
  const planes = [new Uint8Array(fullW * fullH), new Uint8Array(fullW * fullH), new Uint8Array(fullW * fullH)];
  for (let y = 0; y < fullH; y++) {
    const sy = Math.min(y, height - 1);
    for (let x = 0; x < fullW; x++) {
      const s = (sy * width + Math.min(x, width - 1)) * 4;
      const r = data[s]!;
      const g = data[s + 1]!;
      const b = data[s + 2]!;
      const o = y * fullW + x;
      planes[0]![o] = (T[r]! + T[256 + g]! + T[512 + b]!) >> SCALEBITS;
      planes[1]![o] = (T[768 + r]! + T[1024 + g]! + T[1280 + b]!) >> SCALEBITS;
      planes[2]![o] = (T[1280 + r]! + T[1536 + g]! + T[1792 + b]!) >> SCALEBITS;
    }
  }

  // Components: Y at full resolution, Cb and Cr downsampled (jcsample.c, no smoothing), each padded
  // to whole MCUs vertically by repeating its last row (pre_process_data).
  interface Comp {
    readonly h: number;
    readonly v: number;
    readonly bw: number;
    readonly bh: number;
    readonly stride: number;
    readonly samples: Uint8Array;
    readonly q: Uint8Array;
    readonly dc: ReturnType<typeof codes>;
    readonly ac: ReturnType<typeof codes>;
    pred: number;
  }
  const lumQ = scaledTable(LUMINANCE_Q, quality);
  const chromQ = scaledTable(CHROMINANCE_Q, quality);
  const dcL = codes(STANDARD_HUFFMAN.dcLuminance);
  const acL = codes(STANDARD_HUFFMAN.acLuminance);
  const dcC = codes(STANDARD_HUFFMAN.dcChrominance);
  const acC = codes(STANDARD_HUFFMAN.acChrominance);
  const comps: Comp[] = (grey ? [0] : [0, 1, 2]).map((ci) => {
    const h = ci === 0 ? hmax : 1;
    const v = ci === 0 ? vmax : 1;
    const cw = Math.ceil((width * h) / hmax);
    const ch = Math.ceil((height * v) / vmax);
    const bw = Math.ceil(cw / 8);
    const bh = Math.ceil(ch / 8);
    const stride = mcusX * h * 8;
    const rows = mcusY * v * 8;
    const outCols = bw * 8;
    const samples = new Uint8Array(stride * rows);
    const src = planes[ci]!;
    const fx = hmax / h;
    const fy = vmax / v;
    const realRows = fullH / fy;
    for (let y = 0; y < realRows; y++) {
      if (fx === 1 && fy === 1) samples.set(src.subarray(y * fullW, y * fullW + outCols), y * stride);
      else if (fy === 1) {
        let bias = 0;
        for (let x = 0; x < outCols; x++, bias ^= 1) samples[y * stride + x] = (src[y * fullW + 2 * x]! + src[y * fullW + 2 * x + 1]! + bias) >> 1;
      } else {
        let bias = 1;
        const r0 = 2 * y * fullW;
        const r1 = r0 + fullW;
        for (let x = 0; x < outCols; x++, bias ^= 3) samples[y * stride + x] = (src[r0 + 2 * x]! + src[r0 + 2 * x + 1]! + src[r1 + 2 * x]! + src[r1 + 2 * x + 1]! + bias) >> 2;
      }
    }
    for (let y = realRows; y < rows; y++) samples.copyWithin(y * stride, (realRows - 1) * stride, (realRows - 1) * stride + stride);
    return { h, v, bw, bh, stride, samples, q: ci === 0 ? lumQ : chromQ, dc: ci === 0 ? dcL : dcC, ac: ci === 0 ? acL : acC, pred: 0 };
  });

  const w = new Writer();
  w.bytes([0xff, 0xd8]);
  w.segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // JFIF 1.01, aspect 1:1, no thumbnail
  if (options.icc) {
    const icc = options.icc;
    const MAX = 65519;
    const count = Math.ceil(icc.length / MAX);
    if (count > 255) fail('ICC profile too large for APP2 (more than 255 segments)');
    for (let i = 0; i < count; i++) {
      const chunk = icc.subarray(i * MAX, (i + 1) * MAX);
      const body = new Uint8Array(14 + chunk.length);
      body.set([0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0, i + 1, count]);
      body.set(chunk, 14);
      w.segment(0xe2, body);
    }
  }
  for (const [id, t] of [
    [0, lumQ],
    [1, chromQ],
  ] as const)
    if (!grey || id === 0) w.segment(0xdb, [id, ...Array.from({ length: 64 }, (_, k) => t[ZIGZAG[k]!]!)]);
  w.segment(0xc0, grey ? [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0] : [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, (hmax << 4) | vmax, 0, 2, 0x11, 1, 3, 0x11, 1]);
  for (const [tc, th, t] of [
    [0, 0, STANDARD_HUFFMAN.dcLuminance],
    [1, 0, STANDARD_HUFFMAN.acLuminance],
    [0, 1, STANDARD_HUFFMAN.dcChrominance],
    [1, 1, STANDARD_HUFFMAN.acChrominance],
  ] as const)
    if (!grey || th === 0) w.segment(0xc4, [(tc << 4) | th, ...t.counts, ...t.symbols]);
  w.segment(0xda, grey ? [1, 1, 0x00, 0, 63, 0] : [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  // Blocks in MCU order; those past a component's own blocks are libjpeg's dummy blocks (jccoefct.c):
  // all zero but the DC, copied from the block before in the same component, which is the DC its
  // predictor holds (so they code as a zero difference and an end of block).
  const block = new Int32Array(64);
  const quantised = new Int32Array(64);
  const encodeBlock = (c: Comp, dc: number) => {
    const diff = dc - c.pred;
    c.pred = dc;
    const s = category(diff);
    w.bits(c.dc.code[s]!, c.dc.size[s]!);
    if (s) w.bits(diff < 0 ? diff - 1 + (1 << s) : diff, s);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = quantised[ZIGZAG[k]!]!;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        w.bits(c.ac.code[0xf0]!, c.ac.size[0xf0]!);
        run -= 16;
      }
      const size = category(v);
      const sym = (run << 4) | size;
      w.bits(c.ac.code[sym]!, c.ac.size[sym]!);
      w.bits(v < 0 ? v - 1 + (1 << size) : v, size);
      run = 0;
    }
    if (run > 0) w.bits(c.ac.code[0]!, c.ac.size[0]!);
  };
  for (let my = 0; my < mcusY; my++)
    for (let mx = 0; mx < mcusX; mx++)
      for (const c of comps)
        for (let by = 0; by < c.v; by++)
          for (let bx = 0; bx < c.h; bx++) {
            const gx = mx * c.h + bx;
            const gy = my * c.v + by;
            if (gx >= c.bw || gy >= c.bh) {
              quantised.fill(0);
              encodeBlock(c, c.pred);
              continue;
            }
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = c.samples[(gy * 8 + y) * c.stride + gx * 8 + x]! - 128;
            fdct(block);
            for (let i = 0; i < 64; i++) {
              const qv = c.q[i]! << 3;
              const t = block[i]!;
              quantised[i] = t < 0 ? -Math.floor((-t + (qv >> 1)) / qv) : Math.floor((t + (qv >> 1)) / qv);
            }
            encodeBlock(c, quantised[0]!);
          }
  w.flush();
  w.bytes([0xff, 0xd9]);
  return w.result();
}
