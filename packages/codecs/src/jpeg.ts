// JPEG decoder (#179): baseline, extended sequential and progressive Huffman-coded JPEG, 8 bits per
// sample, any sampling factors, restart intervals, grey / YCbCr / RGB / CMYK / YCCK, ICC profiles in
// APP2. The maths follows libjpeg-turbo step for step (the integer "islow" IDCT of jidctint.c, the
// "fancy" triangle upsampling of jdsample.c, the fixed-point YCbCr tables of jdcolor.c), so for YCbCr,
// grey and RGB files the result is that of libjpeg-turbo, which Chrome, Firefox, sharp and Pillow use,
// bit for bit, and the same in every runtime. Arithmetic coding, lossless and hierarchical JPEG and
// 12-bit samples are refused with a CodecError, as is anything malformed or truncated.

import { CodecError, DEFAULT_MAX_PIXELS, plain, type DecodedImage, type DecodeOptions } from './types';

const fail = (message: string): never => {
  throw new CodecError('jpeg', message);
};

/** Position k of the zigzag scan → index in the natural (row-major) 8×8 order. */
const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15,
  23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
  // Indices past 63 (a corrupt run that overshoots) land on a scratch coefficient, as in libjpeg.
  63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63,
]);

// ---------------------------------------------------------------------------------------------------
// Huffman tables (jdhuff.c): canonical codes, a 9-bit lookahead table, then maxcode for longer codes.

const LOOKAHEAD = 9;

interface Huffman {
  /** For a 9-bit prefix: (code length << 8) | symbol, or 0 when the code is longer than 9 bits. */
  readonly look: Uint16Array;
  /** Largest code of each length (−1 when there is none), index 1..16; [17] is a sentinel. */
  readonly maxcode: Int32Array;
  /** Symbol index offset for each length. */
  readonly valoffset: Int32Array;
  readonly values: Uint8Array;
}

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxcode = new Int32Array(18).fill(-1);
  const valoffset = new Int32Array(18);
  const look = new Uint16Array(1 << LOOKAHEAD);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1]!;
    if (n) {
      valoffset[len] = k - code;
      for (let i = 0; i < n; i++, k++, code++) {
        if (len <= LOOKAHEAD) {
          const shift = LOOKAHEAD - len;
          for (let j = 0; j < 1 << shift; j++) look[(code << shift) | j] = (len << 8) | values[k]!;
        }
      }
      maxcode[len] = code - 1;
    }
    if (code > 1 << len) fail('bad Huffman table');
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { look, maxcode, valoffset, values };
}

// ---------------------------------------------------------------------------------------------------
// Entropy-coded data: bytes with 0xFF 0x00 stuffing, ending at a marker. Past the marker, zero bits
// are supplied as libjpeg does, but reading any of them means the data was cut short: an error here.

class Bits {
  pos: number;
  private acc = 0;
  private n = 0;
  /** Zero bits appended after a marker or the end of the file (the lowest `fake` bits of acc). */
  private fake = 0;
  /** The marker the data stopped at, once reached. */
  marker = -1;

  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }

  private fill(): void {
    while (this.n <= 24) {
      let byte = 0;
      if (this.marker < 0 && this.pos < this.data.length) {
        byte = this.data[this.pos]!;
        if (byte === 0xff) {
          let next = this.data[this.pos + 1];
          // Fill bytes (several 0xFF) may precede a marker.
          let at = this.pos + 1;
          while (next === 0xff) next = this.data[++at];
          if (next === 0) this.pos += 2;
          else {
            this.marker = next === undefined ? -2 : next;
            byte = 0;
            this.fake += 8;
          }
        } else this.pos++;
      } else this.fake += 8;
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
  }

  private take(count: number): void {
    this.n -= count;
    if (this.n < this.fake) fail(this.marker === -2 || this.marker < 0 ? 'truncated file' : 'truncated scan data (a marker came early)');
  }

  bits(count: number): number {
    if (count === 0) return 0;
    if (this.n < count) this.fill();
    const v = (this.acc >>> (this.n - count)) & ((1 << count) - 1);
    this.take(count);
    return v;
  }

  bit(): number {
    return this.bits(1);
  }

  decode(h: Huffman): number {
    if (this.n < 16) this.fill();
    const e = h.look[(this.acc >>> (this.n - LOOKAHEAD)) & ((1 << LOOKAHEAD) - 1)]!;
    if (e) {
      this.take(e >> 8);
      return e & 255;
    }
    let len = LOOKAHEAD + 1;
    let code = (this.acc >>> (this.n - len)) & ((1 << len) - 1);
    while (code > h.maxcode[len]!) {
      len++;
      if (len > 16) fail('bad Huffman code');
      code = (this.acc >>> (this.n - len)) & ((1 << len) - 1);
    }
    this.take(len);
    return h.values[(code + h.valoffset[len]!) & 255]!;
  }

  /** A value of `s` bits, sign-extended as in JPEG (F.2.2.1). */
  receiveExtend(s: number): number {
    if (s === 0) return 0;
    if (s > 16) fail('bad coefficient size');
    const v = this.bits(s);
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
  }

  /** Discards the bits left in the current byte and expects the restart marker `rst` (0–7). */
  restart(rst: number): void {
    this.acc = this.n = this.fake = 0;
    if (this.marker < 0) {
      // Not reached yet: the next bytes must be the marker (fill bytes allowed).
      while (this.data[this.pos] === 0xff && this.data[this.pos + 1] === 0xff) this.pos++;
      if (this.data[this.pos] === 0xff) this.marker = this.data[this.pos + 1] ?? -2;
      else fail('missing restart marker');
    }
    if (this.marker !== 0xd0 + rst) fail(`expected restart marker ${rst}, found 0x${this.marker.toString(16)}`);
    this.pos += 2;
    this.marker = -1;
  }
}

// ---------------------------------------------------------------------------------------------------
// The integer IDCT of libjpeg (jidctint.c, jpeg_idct_islow), with its output range limit.

const CONST_BITS = 13;
const PASS1_BITS = 2;
const FIX_0_298631336 = 2446;
const FIX_0_390180644 = 3196;
const FIX_0_541196100 = 4433;
const FIX_0_765366865 = 6270;
const FIX_0_899976223 = 7373;
const FIX_1_175875602 = 9633;
const FIX_1_501321110 = 12299;
const FIX_1_847759065 = 15137;
const FIX_1_961570560 = 16069;
const FIX_2_053119869 = 16819;
const FIX_2_562915447 = 20995;
const FIX_3_072711026 = 25172;

/**
 * libjpeg's post-IDCT range limit: the value plus 128, clamped, on the low 10 bits (RANGE_MASK), so
 * a far out-of-range value wraps. Only coefficients no 8-bit encoder writes get there; libjpeg-turbo's
 * SIMD builds (16-bit multiplies, saturating packs) give other values for them, the C code these.
 */
const RANGE = (() => {
  const t = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) t[i] = i < 128 ? i + 128 : i < 512 ? 255 : i < 896 ? 0 : i - 896;
  return t;
})();

const workspace = new Int32Array(64);

/** IDCT of one dequantised block (`coef` from `at`, natural order) into `out` at `o`, stride `stride`. */
export function idct(coef: Int16Array, at: number, q: Uint16Array, out: Uint8Array, o: number, stride: number): void {
  const ws = workspace;
  for (let c = 0; c < 8; c++) {
    const i = at + c;
    if (coef[i + 8] === 0 && coef[i + 16] === 0 && coef[i + 24] === 0 && coef[i + 32] === 0 && coef[i + 40] === 0 && coef[i + 48] === 0 && coef[i + 56] === 0) {
      const dc = (coef[i]! * q[c]!) << PASS1_BITS;
      for (let r = 0; r < 64; r += 8) ws[c + r] = dc;
      continue;
    }
    let z2 = coef[i + 16]! * q[c + 16]!;
    let z3 = coef[i + 48]! * q[c + 48]!;
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 + z3 * -FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = coef[i]! * q[c]!;
    z3 = coef[i + 32]! * q[c + 32]!;
    let tmp0 = (z2 + z3) << CONST_BITS;
    let tmp1 = (z2 - z3) << CONST_BITS;
    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;
    tmp0 = coef[i + 56]! * q[c + 56]!;
    tmp1 = coef[i + 40]! * q[c + 40]!;
    tmp2 = coef[i + 24]! * q[c + 24]!;
    tmp3 = coef[i + 8]! * q[c + 8]!;
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    const R = 1 << (CONST_BITS - PASS1_BITS - 1);
    const S = CONST_BITS - PASS1_BITS;
    ws[c] = (tmp10 + tmp3 + R) >> S;
    ws[c + 56] = (tmp10 - tmp3 + R) >> S;
    ws[c + 8] = (tmp11 + tmp2 + R) >> S;
    ws[c + 48] = (tmp11 - tmp2 + R) >> S;
    ws[c + 16] = (tmp12 + tmp1 + R) >> S;
    ws[c + 40] = (tmp12 - tmp1 + R) >> S;
    ws[c + 24] = (tmp13 + tmp0 + R) >> S;
    ws[c + 32] = (tmp13 - tmp0 + R) >> S;
  }
  const R = 1 << (CONST_BITS + PASS1_BITS + 3 - 1);
  const S = CONST_BITS + PASS1_BITS + 3;
  for (let r = 0; r < 64; r += 8, o += stride) {
    // (The all-zero-row shortcut of libjpeg gives the same values as the full computation.)
    let z2 = ws[r + 2]!;
    let z3 = ws[r + 6]!;
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 + z3 * -FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    let tmp0 = (ws[r]! + ws[r + 4]!) << CONST_BITS;
    let tmp1 = (ws[r]! - ws[r + 4]!) << CONST_BITS;
    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;
    tmp0 = ws[r + 7]!;
    tmp1 = ws[r + 5]!;
    tmp2 = ws[r + 3]!;
    tmp3 = ws[r + 1]!;
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    out[o] = RANGE[((tmp10 + tmp3 + R) >> S) & 1023]!;
    out[o + 7] = RANGE[((tmp10 - tmp3 + R) >> S) & 1023]!;
    out[o + 1] = RANGE[((tmp11 + tmp2 + R) >> S) & 1023]!;
    out[o + 6] = RANGE[((tmp11 - tmp2 + R) >> S) & 1023]!;
    out[o + 2] = RANGE[((tmp12 + tmp1 + R) >> S) & 1023]!;
    out[o + 5] = RANGE[((tmp12 - tmp1 + R) >> S) & 1023]!;
    out[o + 3] = RANGE[((tmp13 + tmp0 + R) >> S) & 1023]!;
    out[o + 4] = RANGE[((tmp13 - tmp0 + R) >> S) & 1023]!;
  }
}

// ---------------------------------------------------------------------------------------------------
// Frame and scans.

interface Component {
  readonly id: number;
  readonly h: number;
  readonly v: number;
  readonly tq: number;
  /** Blocks per line / column of the component's own samples (what a single-component scan covers). */
  readonly bw: number;
  readonly bh: number;
  /** Blocks per line / column padded to whole MCUs (the coefficient buffer). */
  readonly pw: number;
  readonly ph: number;
  /** The component's size in samples (libjpeg's downsampled_width / height). */
  readonly sw: number;
  readonly sh: number;
  readonly coef: Int16Array;
  dcTable: number;
  acTable: number;
  pred: number;
}

interface Frame {
  readonly progressive: boolean;
  readonly width: number;
  readonly height: number;
  readonly components: Component[];
  readonly hmax: number;
  readonly vmax: number;
  readonly mcusX: number;
  readonly mcusY: number;
}

interface Scan {
  readonly components: Component[];
  readonly ss: number;
  readonly se: number;
  readonly ah: number;
  readonly al: number;
}

function decodeScan(
  data: Uint8Array,
  start: number,
  frame: Frame,
  scan: Scan,
  dc: (Huffman | undefined)[],
  ac: (Huffman | undefined)[],
  restartInterval: number,
): number {
  const bits = new Bits(data, start);
  const { components, ss, se, ah, al } = scan;
  const single = components.length === 1;
  const units = single ? components[0]!.bw * components[0]!.bh : frame.mcusX * frame.mcusY;
  for (const c of components) {
    c.pred = 0;
    if (frame.progressive ? ss === 0 && ah === 0 : true) if (!dc[c.dcTable]) fail('missing DC Huffman table');
    if ((!frame.progressive || ss > 0) && !ac[c.acTable]) fail('missing AC Huffman table');
  }
  let eobrun = 0;
  const p1 = 1 << al;
  const m1 = -1 << al;

  const block = (c: Component, at: number): void => {
    const coef = c.coef;
    if (!frame.progressive) {
      const s = bits.decode(dc[c.dcTable]!);
      c.pred += bits.receiveExtend(s);
      coef[at] = c.pred;
      const table = ac[c.acTable]!;
      for (let k = 1; k < 64; k++) {
        const rs = bits.decode(table);
        const r = rs >> 4;
        const size = rs & 15;
        if (size) {
          k += r;
          coef[at + ZIGZAG[k]!] = bits.receiveExtend(size);
        } else {
          if (r !== 15) break;
          k += 15;
        }
      }
      return;
    }
    if (ss === 0) {
      if (ah === 0) {
        c.pred += bits.receiveExtend(bits.decode(dc[c.dcTable]!));
        coef[at] = c.pred * (1 << al);
      } else if (bits.bit()) coef[at] = coef[at]! | p1;
      return;
    }
    const table = ac[c.acTable]!;
    if (ah === 0) {
      if (eobrun > 0) {
        eobrun--;
        return;
      }
      for (let k = ss; k <= se; k++) {
        const rs = bits.decode(table);
        const r = rs >> 4;
        const size = rs & 15;
        if (size) {
          k += r;
          coef[at + ZIGZAG[k]!] = bits.receiveExtend(size) * (1 << al);
        } else if (r === 15) k += 15;
        else {
          eobrun = (1 << r) - 1;
          if (r) eobrun += bits.bits(r);
          break;
        }
      }
      return;
    }
    // AC refinement (jdphuff.c, decode_mcu_AC_refine).
    let k = ss;
    if (eobrun === 0) {
      for (; k <= se; k++) {
        const rs = bits.decode(table);
        let r = rs >> 4;
        let s = rs & 15;
        if (s) s = bits.bit() ? p1 : m1;
        else if (r !== 15) {
          eobrun = 1 << r;
          if (r) eobrun += bits.bits(r);
          break;
        }
        do {
          const i = at + ZIGZAG[k]!;
          if (coef[i] !== 0) {
            if (bits.bit() && (coef[i]! & p1) === 0) coef[i] = coef[i]! + (coef[i]! >= 0 ? p1 : m1);
          } else if (--r < 0) break;
          k++;
        } while (k <= se);
        if (s) coef[at + ZIGZAG[k]!] = s;
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k++) {
        const i = at + ZIGZAG[k]!;
        if (coef[i] !== 0 && bits.bit() && (coef[i]! & p1) === 0) coef[i] = coef[i]! + (coef[i]! >= 0 ? p1 : m1);
      }
      eobrun--;
    }
  };

  let rst = 0;
  for (let u = 0; u < units; u++) {
    if (restartInterval && u > 0 && u % restartInterval === 0) {
      bits.restart(rst);
      rst = (rst + 1) & 7;
      eobrun = 0;
      for (const c of components) c.pred = 0;
    }
    if (single) {
      const c = components[0]!;
      const bx = u % c.bw;
      const by = (u / c.bw) | 0;
      block(c, (by * c.pw + bx) * 64);
    } else {
      const mx = u % frame.mcusX;
      const my = (u / frame.mcusX) | 0;
      for (const c of components)
        for (let y = 0; y < c.v; y++) for (let x = 0; x < c.h; x++) block(c, ((my * c.v + y) * c.pw + mx * c.h + x) * 64);
    }
  }
  // Past the scan: the next marker (bytes before it are skipped, as libjpeg does with a warning).
  let pos = bits.pos;
  for (;;) {
    if (pos + 1 >= data.length) fail('truncated file');
    if (data[pos] === 0xff && data[pos + 1] !== 0 && data[pos + 1] !== 0xff && !(data[pos + 1]! >= 0xd0 && data[pos + 1]! <= 0xd7)) return pos;
    pos++;
  }
}

// ---------------------------------------------------------------------------------------------------
// Upsampling to full resolution (jdsample.c) and colour conversion (jdcolor.c).

/** A component's samples at full resolution (`width` × `height`), libjpeg's way. */
function upsample(c: Component, plane: Uint8Array, frame: Frame): Uint8Array {
  const { width, height, hmax, vmax } = frame;
  const stride = c.pw * 8;
  const rows = c.ph * 8;
  const out = new Uint8Array(width * height);
  const sw = c.sw;
  const sh = c.sh;
  /** Row `y` of the component, the rows past its last real one replaced by it (jdmainct.c). */
  const row = (y: number) => Math.min(Math.max(y, 0), sh - 1) * stride;
  if (c.h === hmax && c.v === vmax) {
    for (let y = 0; y < height; y++) out.set(plane.subarray(y * stride, y * stride + width), y * width);
    return out;
  }
  const line = new Uint8Array(Math.max(stride, sw) * 2 + 16);
  if (c.h * 2 === hmax && c.v === vmax && sw > 2) {
    for (let y = 0; y < height; y++) {
      const i = y * stride;
      let o = 0;
      let v = plane[i]!;
      line[o++] = v;
      line[o++] = (v * 3 + plane[i + 1]! + 2) >> 2;
      let p = i + 1;
      for (let n = sw - 2; n > 0; n--, p++) {
        v = plane[p]! * 3;
        line[o++] = (v + plane[p - 1]! + 1) >> 2;
        line[o++] = (v + plane[p + 1]! + 2) >> 2;
      }
      v = plane[p]!;
      line[o++] = (v * 3 + plane[p - 1]! + 1) >> 2;
      line[o++] = v;
      out.set(line.subarray(0, width), y * width);
    }
    return out;
  }
  if (c.h === hmax && c.v * 2 === vmax) {
    for (let y = 0; y < height; y++) {
      const i0 = row(y >> 1);
      const i1 = row(y & 1 ? (y >> 1) + 1 : (y >> 1) - 1);
      const bias = y & 1 ? 2 : 1;
      for (let x = 0; x < width; x++) out[y * width + x] = (plane[i0 + x]! * 3 + plane[i1 + x]! + bias) >> 2;
    }
    return out;
  }
  if (c.h * 2 === hmax && c.v * 2 === vmax && sw > 2) {
    for (let y = 0; y < height; y++) {
      const i0 = row(y >> 1);
      const i1 = row(y & 1 ? (y >> 1) + 1 : (y >> 1) - 1);
      let o = 0;
      let p = 0;
      let thiscol = plane[i0 + p]! * 3 + plane[i1 + p]!;
      p++;
      let nextcol = plane[i0 + p]! * 3 + plane[i1 + p]!;
      p++;
      line[o++] = (thiscol * 4 + 8) >> 4;
      line[o++] = (thiscol * 3 + nextcol + 7) >> 4;
      let lastcol = thiscol;
      thiscol = nextcol;
      for (let n = sw - 2; n > 0; n--, p++) {
        nextcol = plane[i0 + p]! * 3 + plane[i1 + p]!;
        line[o++] = (thiscol * 3 + lastcol + 8) >> 4;
        line[o++] = (thiscol * 3 + nextcol + 7) >> 4;
        lastcol = thiscol;
        thiscol = nextcol;
      }
      line[o++] = (thiscol * 3 + lastcol + 8) >> 4;
      line[o++] = (thiscol * 4 + 7) >> 4;
      out.set(line.subarray(0, width), y * width);
    }
    return out;
  }
  // Any other ratio (or a component two samples wide or less): replication.
  const fx = hmax / c.h;
  const fy = vmax / c.v;
  if (!Number.isInteger(fx) || !Number.isInteger(fy)) fail('unsupported sampling factors');
  for (let y = 0; y < height; y++) {
    const i = Math.min(Math.floor(y / fy), rows - 1) * stride;
    for (let x = 0; x < width; x++) out[y * width + x] = plane[i + Math.floor(x / fx)]!;
  }
  return out;
}

const SCALEBITS = 16;
const ONE_HALF = 1 << (SCALEBITS - 1);
const FIX = (x: number) => Math.floor(x * (1 << SCALEBITS) + 0.5);
const CR_R = new Int32Array(256);
const CB_B = new Int32Array(256);
const CR_G = new Int32Array(256);
const CB_G = new Int32Array(256);
for (let i = 0, x = -128; i < 256; i++, x++) {
  CR_R[i] = (FIX(1.402) * x + ONE_HALF) >> SCALEBITS;
  CB_B[i] = (FIX(1.772) * x + ONE_HALF) >> SCALEBITS;
  CR_G[i] = -FIX(0.71414) * x;
  CB_G[i] = -FIX(0.34414) * x + ONE_HALF;
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------------------------------------------

const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;

/**
 * Decodes a JPEG file to 8-bit RGBA (alpha 255). YCbCr, grey and RGB files decode as libjpeg-turbo
 * decodes them, bit for bit. CMYK and YCCK files are converted with the naive formula
 * R = (255 − C)(255 − K) / 255 (and so on): without colour management (their ICC profile is returned
 * as `icc`) that is an approximation. Rejects with a `CodecError` for what it cannot decode.
 */
export async function decodeJpeg(input: Uint8Array, options: DecodeOptions = {}): Promise<DecodedImage> {
  const bytes = plain(input);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('not a JPEG file (no SOI marker)');
  const quant: (Uint16Array | undefined)[] = [];
  const dc: (Huffman | undefined)[] = [];
  const ac: (Huffman | undefined)[] = [];
  let frame: Frame | undefined;
  let restartInterval = 0;
  let adobe: number | undefined;
  let jfif = false;
  const icc: Uint8Array[] = [];
  let iccCount = 0;
  let scans = 0;

  let pos = 2;
  for (;;) {
    // Markers may be preceded by fill bytes (0xFF).
    while (bytes[pos] === 0xff && bytes[pos + 1] === 0xff) pos++;
    if (pos + 1 >= bytes.length) fail('truncated file: no EOI marker');
    if (bytes[pos] !== 0xff) fail(`expected a marker at byte ${pos}`);
    const marker = bytes[pos + 1]!;
    pos += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) fail(`unexpected marker 0x${marker.toString(16)}`);
    if (pos + 2 > bytes.length) fail('truncated file');
    const length = u16(bytes, pos);
    if (length < 2 || pos + length > bytes.length) fail(`truncated segment 0x${marker.toString(16)}`);
    const seg = bytes.subarray(pos + 2, pos + length);
    pos += length;

    switch (marker) {
      case 0xdb: {
        // DQT: one or more tables, 8- or 16-bit entries in zigzag order.
        for (let i = 0; i < seg.length; ) {
          const pq = seg[i]! >> 4;
          const tq = seg[i]! & 15;
          if (pq > 1 || tq > 3) fail('bad quantisation table');
          const size = pq ? 128 : 64;
          if (i + 1 + size > seg.length) fail('truncated quantisation table');
          const t = new Uint16Array(64);
          for (let k = 0; k < 64; k++) t[ZIGZAG[k]!] = pq ? u16(seg, i + 1 + 2 * k) : seg[i + 1 + k]!;
          quant[tq] = t;
          i += 1 + size;
        }
        break;
      }
      case 0xc4: {
        // DHT: one or more tables.
        for (let i = 0; i < seg.length; ) {
          if (i + 17 > seg.length) fail('truncated Huffman table');
          const tc = seg[i]! >> 4;
          const th = seg[i]! & 15;
          if (tc > 1 || th > 3) fail('bad Huffman table');
          const counts = seg.subarray(i + 1, i + 17);
          const total = counts.reduce((a, b) => a + b, 0);
          if (total > 256 || i + 17 + total > seg.length) fail('bad Huffman table');
          (tc ? ac : dc)[th] = buildHuffman(counts, seg.subarray(i + 17, i + 17 + total));
          i += 17 + total;
        }
        break;
      }
      case 0xdd:
        if (seg.length < 2) fail('bad DRI segment');
        restartInterval = u16(seg, 0);
        break;
      case 0xc0:
      case 0xc1:
      case 0xc2: {
        if (frame) fail('more than one frame');
        if (seg.length < 6) fail('bad SOF segment');
        if (seg[0] !== 8) fail(`${seg[0]}-bit samples are not supported (only 8)`);
        const height = u16(seg, 1);
        const width = u16(seg, 3);
        const n = seg[5]!;
        if (height === 0) fail('images whose height comes in a DNL marker are not supported');
        if (width === 0) fail('zero width');
        if (n !== 1 && n !== 3 && n !== 4) fail(`${n} components are not supported`);
        if (seg.length < 6 + 3 * n) fail('bad SOF segment');
        if (width * height > maxPixels) fail(`${width}×${height} is larger than maxPixels (${maxPixels})`);
        const specs = Array.from({ length: n }, (_, i) => ({ id: seg[6 + 3 * i]!, h: seg[7 + 3 * i]! >> 4, v: seg[7 + 3 * i]! & 15, tq: seg[8 + 3 * i]! }));
        if (specs.some((s) => s.h < 1 || s.h > 4 || s.v < 1 || s.v > 4 || s.tq > 3)) fail('bad sampling factors or quantisation table');
        if (new Set(specs.map((s) => s.id)).size !== n) fail('two components with the same id');
        const hmax = Math.max(...specs.map((s) => s.h));
        const vmax = Math.max(...specs.map((s) => s.v));
        const mcusX = Math.ceil(width / (8 * hmax));
        const mcusY = Math.ceil(height / (8 * vmax));
        const components = specs.map((s): Component => {
          const sw = Math.ceil((width * s.h) / hmax);
          const sh = Math.ceil((height * s.v) / vmax);
          const pw = mcusX * s.h;
          const ph = mcusY * s.v;
          return { ...s, sw, sh, bw: Math.ceil(sw / 8), bh: Math.ceil(sh / 8), pw, ph, coef: new Int16Array(pw * ph * 64), dcTable: 0, acTable: 0, pred: 0 };
        });
        frame = { progressive: marker === 0xc2, width, height, components, hmax, vmax, mcusX, mcusY };
        break;
      }
      case 0xc3:
      case 0xc5:
      case 0xc6:
      case 0xc7:
        fail('lossless and hierarchical JPEG are not supported');
        break;
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        fail('arithmetic-coded JPEG is not supported');
        break;
      case 0xda: {
        if (!frame) fail('SOS before the frame header');
        const f = frame!;
        const n = seg[0]!;
        if (n < 1 || n > 4 || seg.length < 1 + 2 * n + 3) fail('bad SOS segment');
        const components = Array.from({ length: n }, (_, i) => {
          const c = f.components.find((c) => c.id === seg[1 + 2 * i]);
          if (!c) fail(`SOS names an unknown component ${seg[1 + 2 * i]}`);
          c!.dcTable = seg[2 + 2 * i]! >> 4;
          c!.acTable = seg[2 + 2 * i]! & 15;
          if (c!.dcTable > 3 || c!.acTable > 3) fail('bad Huffman table selector');
          return c!;
        });
        const ss = seg[1 + 2 * n]!;
        const se = seg[2 + 2 * n]!;
        const ah = seg[3 + 2 * n]! >> 4;
        const al = seg[3 + 2 * n]! & 15;
        if (f.progressive) {
          if (ss > se || se > 63 || (ss === 0 && se !== 0) || (ss > 0 && n !== 1) || al > 13 || (ah && ah !== al + 1)) fail('bad progressive scan parameters');
        } else if (ss !== 0 || se !== 63 || ah !== 0 || al !== 0) fail('bad sequential scan parameters');
        if (n > 1 && components.reduce((s, c) => s + c.h * c.v, 0) > 10) fail('too many blocks in an MCU');
        pos = decodeScan(bytes, pos, f, { components, ss, se, ah, al }, dc, ac, restartInterval);
        scans++;
        break;
      }
      case 0xe0:
        if (seg.length >= 5 && String.fromCharCode(...seg.subarray(0, 5)) === 'JFIF\0') jfif = true;
        break;
      case 0xe2:
        if (seg.length >= 14 && String.fromCharCode(...seg.subarray(0, 12)) === 'ICC_PROFILE\0') {
          const seq = seg[12]!;
          const count = seg[13]!;
          if (seq < 1 || seq > count || (iccCount && count !== iccCount) || icc[seq - 1]) fail('bad ICC profile chunks');
          iccCount = count;
          icc[seq - 1] = seg.subarray(14);
        }
        break;
      case 0xee:
        if (seg.length >= 12 && String.fromCharCode(...seg.subarray(0, 5)) === 'Adobe') adobe = seg[11];
        break;
      default:
        // APPn, COM and other segments with a length: skipped. Unknown SOFs and JPG / DAC: refused.
        if ((marker >= 0xc0 && marker <= 0xcf) || marker < 0xc0) fail(`unsupported marker 0x${marker.toString(16)}`);
    }
  }

  if (!frame) fail('no frame header');
  if (scans === 0) fail('no scan');
  const f = frame!;
  for (const c of f.components) if (!quant[c.tq]) fail(`missing quantisation table ${c.tq}`);

  // Samples per component (padded to whole MCUs), then full resolution.
  const planes = f.components.map((c) => {
    const stride = c.pw * 8;
    const plane = new Uint8Array(stride * c.ph * 8);
    const q = quant[c.tq]!;
    for (let by = 0; by < c.ph; by++) for (let bx = 0; bx < c.pw; bx++) idct(c.coef, (by * c.pw + bx) * 64, q, plane, by * 8 * stride + bx * 8, stride);
    return upsample(c, plane, f);
  });

  const n = f.width * f.height;
  const out = new Uint8Array(n * 4);
  const ids = f.components.map((c) => c.id);
  if (planes.length === 1) {
    const g = planes[0]!;
    for (let i = 0; i < n; i++) {
      out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = g[i]!;
      out[4 * i + 3] = 255;
    }
  } else if (planes.length === 3) {
    const [a, b, c] = planes as [Uint8Array, Uint8Array, Uint8Array];
    // libjpeg's default_decompress_parms: JFIF or Adobe transform 1 = YCbCr; Adobe 0 or ids 'R' 'G' 'B' = RGB.
    const rgb = !jfif && (adobe === 0 || (adobe === undefined && ids[0] === 82 && ids[1] === 71 && ids[2] === 66));
    for (let i = 0; i < n; i++) {
      if (rgb) {
        out[4 * i] = a[i]!;
        out[4 * i + 1] = b[i]!;
        out[4 * i + 2] = c[i]!;
      } else {
        const y = a[i]!;
        const cb = b[i]!;
        const cr = c[i]!;
        out[4 * i] = clamp(y + CR_R[cr]!);
        out[4 * i + 1] = clamp(y + ((CB_G[cb]! + CR_G[cr]!) >> SCALEBITS));
        out[4 * i + 2] = clamp(y + CB_B[cb]!);
      }
      out[4 * i + 3] = 255;
    }
  } else {
    const [a, b, c, k] = planes as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    // libjpeg: with an Adobe marker, transform 0 is CMYK and any other is YCCK; without one, CMYK.
    const ycck = adobe !== undefined && adobe !== 0;
    // Adobe (Photoshop) CMYK is stored inverted: 255 is no ink.
    const inverted = adobe !== undefined;
    for (let i = 0; i < n; i++) {
      let c0 = a[i]!;
      let c1 = b[i]!;
      let c2 = c[i]!;
      if (ycck) {
        const y = c0;
        const cb = c1;
        const cr = c2;
        c0 = 255 - clamp(y + CR_R[cr]!);
        c1 = 255 - clamp(y + ((CB_G[cb]! + CR_G[cr]!) >> SCALEBITS));
        c2 = 255 - clamp(y + CB_B[cb]!);
      }
      // Ink amounts 0..255 (0 = none).
      const ink = (v: number) => (inverted ? 255 - v : v);
      const kk = 255 - ink(k[i]!);
      out[4 * i] = Math.round(((255 - ink(c0)) * kk) / 255);
      out[4 * i + 1] = Math.round(((255 - ink(c1)) * kk) / 255);
      out[4 * i + 2] = Math.round(((255 - ink(c2)) * kk) / 255);
      out[4 * i + 3] = 255;
    }
  }

  let profile: Uint8Array | undefined;
  if (iccCount) {
    if (icc.length !== iccCount || icc.some((x) => !x)) fail('incomplete ICC profile');
    profile = new Uint8Array(icc.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of icc) {
      profile.set(x, o);
      o += x.length;
    }
  }
  const image = { width: f.width, height: f.height, bitDepth: 8 as const, data: out };
  return profile ? { ...image, icc: profile } : image;
}
