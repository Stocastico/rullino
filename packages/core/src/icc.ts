// ICC profiles (RFC #181): matrix/TRC (v2 and v4) and grey profiles, converted into rullino's working
// space, extended linear sRGB: linear values on sRGB's primaries and D65 white, out of [0, 1] where
// a colour is outside sRGB. Relative colorimetric, as littleCMS computes a matrix-shaper profile in
// floating point (unbounded, no black point compensation). LUT-based profiles (A2B / B2A), CMYK and
// Lab profiles are reported as `unsupported` with a reason: never thrown, a decoder's caller decides.

import { createImage, type LinearImage } from './image';
import type { Mat3 } from './geometry';

/** A tone reproduction curve: device value in [0, 1] to linear. */
export type IccCurve =
  | { readonly type: 'gamma'; readonly gamma: number }
  | { readonly type: 'table'; readonly table: Float64Array }
  | { readonly type: 'para'; readonly kind: 0 | 1 | 2 | 3 | 4; readonly params: readonly number[] };

export interface IccProfile {
  /** What rullino can do with it: convert colours (`matrix-trc`, `gray`) or nothing (`unsupported`). */
  readonly kind: 'matrix-trc' | 'gray' | 'unsupported';
  /** Why a profile is `unsupported`. */
  readonly reason?: string;
  /** Major.minor, e.g. `'4.3'`. */
  readonly version?: string;
  /** Header fields, trailing spaces removed: `'mntr'`, `'RGB'`, `'XYZ'`… */
  readonly deviceClass?: string;
  readonly colorSpace?: string;
  readonly pcs?: string;
  readonly description?: string | undefined;
  /** Linear device RGB to XYZ (D50): the colorants as columns (`matrix-trc` only). Row-major. */
  readonly matrix?: Mat3;
  /** One curve per channel (three for RGB, one for grey). */
  readonly curves?: readonly IccCurve[];
}

/** The ICC's D50 (the profile connection space's white). */
const D50 = [0.9642, 1, 0.8249] as const;
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] = out[i * 3 + j]! + a[i * 3 + k]! * b[k * 3 + j]!;
  return out;
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

const apply3 = (m: Mat3, v: readonly number[]) => [0, 1, 2].map((i) => m[i * 3]! * v[0]! + m[i * 3 + 1]! * v[1]! + m[i * 3 + 2]! * v[2]!);
const xyz = (x: number, y: number) => [x / y, 1, (1 - x - y) / y];

/** Primaries and white (CIE xy) of an RGB colour space. */
export interface Primaries {
  readonly red: readonly [number, number];
  readonly green: readonly [number, number];
  readonly blue: readonly [number, number];
  readonly white: readonly [number, number];
}

/** Linear RGB on these primaries to XYZ (D50), adapted with Bradford as ICC profiles are. */
export function rgbToXyzD50(p: Primaries): Mat3 {
  const cols = [xyz(...p.red), xyz(...p.green), xyz(...p.blue)];
  const P: Mat3 = [cols[0]![0]!, cols[1]![0]!, cols[2]![0]!, cols[0]![1]!, cols[1]![1]!, cols[2]![1]!, cols[0]![2]!, cols[1]![2]!, cols[2]![2]!];
  const w = xyz(...p.white);
  const s = apply3(inv3(P), w);
  const M = P.map((v, i) => v * s[i % 3]!) as Mat3;
  const src = apply3(BRADFORD, w);
  const dst = apply3(BRADFORD, D50);
  const adapt = mul3(inv3(BRADFORD), mul3([dst[0]! / src[0]!, 0, 0, 0, dst[1]! / src[1]!, 0, 0, 0, dst[2]! / src[2]!], BRADFORD));
  return mul3(adapt, M);
}

export const SRGB_PRIMARIES: Primaries = { red: [0.64, 0.33], green: [0.3, 0.6], blue: [0.15, 0.06], white: [0.3127, 0.329] };
const LINEAR_SRGB_TO_XYZ_D50 = rgbToXyzD50(SRGB_PRIMARIES);
/** XYZ (D50) to extended linear sRGB. Row-major. */
export const XYZ_D50_TO_LINEAR_SRGB: Mat3 = inv3(LINEAR_SRGB_TO_XYZ_D50);

/** A curve's value at device value `x` (clamped to [0, 1]), as the ICC specification defines it. */
export function evalCurve(c: IccCurve, x: number): number {
  x = Math.min(1, Math.max(0, x));
  if (c.type === 'gamma') return c.gamma === 1 ? x : x ** c.gamma;
  if (c.type === 'table') {
    const t = c.table;
    if (t.length === 1) return t[0]!;
    const f = x * (t.length - 1);
    const i = Math.min(t.length - 2, Math.floor(f));
    return t[i]! + (t[i + 1]! - t[i]!) * (f - i);
  }
  const [g = 1, a = 1, b = 0, cc = 0, d = 0, e = 0, f = 0] = c.params;
  const pow = (base: number) => (base > 0 ? base ** g : 0);
  switch (c.kind) {
    case 0:
      return x ** g;
    case 1:
      return x >= -b / a ? pow(a * x + b) : 0;
    case 2:
      return x >= -b / a ? pow(a * x + b) + cc : cc;
    case 3:
      return x >= d ? pow(a * x + b) : cc * x;
    case 4:
      return x >= d ? pow(a * x + b) + e : cc * x + f;
  }
}

const tag4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const PARA_COUNT = [1, 3, 4, 5, 7] as const;

class Unsupported extends Error {}
const no = (reason: string): never => {
  throw new Unsupported(reason);
};

/** Reads an ICC profile. Never throws: what cannot be used comes back as `kind: 'unsupported'` with a `reason`. */
export function parseIcc(input: Uint8Array): IccProfile {
  let header: { version?: string; deviceClass?: string; colorSpace?: string; pcs?: string; description?: string | undefined } = {};
  try {
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (bytes.length < 132) no('profile too short');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (tag4(bytes, 36) !== 'acsp') no("no 'acsp' signature");
    const size = Math.min(view.getUint32(0), bytes.length);
    header = {
      version: `${bytes[8]}.${bytes[9]! >> 4}`,
      deviceClass: tag4(bytes, 12).trimEnd(),
      colorSpace: tag4(bytes, 16).trimEnd(),
      pcs: tag4(bytes, 20).trimEnd(),
    };
    const count = view.getUint32(128);
    if (132 + 12 * count > size) no('tag table runs past the end');
    const tags = new Map<string, { at: number; length: number }>();
    for (let i = 0; i < count; i++) {
      const e = 132 + 12 * i;
      const at = view.getUint32(e + 4);
      const length = view.getUint32(e + 8);
      if (at + length > size || length < 8) continue; // a broken tag is skipped; if it is needed, its absence says so
      tags.set(tag4(bytes, e), { at, length });
    }
    const s15 = (at: number) => view.getInt32(at) / 65536;
    const xyzTag = (name: string) => {
      const t = tags.get(name) ?? no(`no ${name} tag`);
      if (tag4(bytes, t.at) !== 'XYZ ' || t.length < 20) no(`${name} is not an XYZ tag`);
      return [s15(t.at + 8), s15(t.at + 12), s15(t.at + 16)];
    };
    const curve = (name: string): IccCurve => {
      const t = tags.get(name) ?? no(`no ${name} tag`);
      const type = tag4(bytes, t.at);
      if (type === 'curv') {
        const n = view.getUint32(t.at + 8);
        if (12 + 2 * n > t.length) no(`${name} runs past its tag`);
        if (n === 0) return { type: 'gamma', gamma: 1 };
        if (n === 1) return { type: 'gamma', gamma: view.getUint16(t.at + 12) / 256 };
        const table = new Float64Array(n);
        for (let i = 0; i < n; i++) table[i] = view.getUint16(t.at + 12 + 2 * i) / 65535;
        return { type: 'table', table };
      }
      if (type === 'para') {
        const kind = view.getUint16(t.at + 8);
        if (kind > 4) no(`${name}: unknown parametric curve type ${kind}`);
        const n = PARA_COUNT[kind as 0]!;
        if (12 + 4 * n > t.length) no(`${name} runs past its tag`);
        return { type: 'para', kind: kind as 0, params: Array.from({ length: n }, (_, i) => s15(t.at + 12 + 4 * i)) };
      }
      return no(`${name} is a '${type}' tag`);
    };
    header.description = description(bytes, view, tags.get('desc'));
    if (header.pcs !== 'XYZ' && header.pcs !== 'Lab') no(`unknown connection space ${header.pcs}`);
    if (header.colorSpace === 'GRAY') return { kind: 'gray', ...header, curves: [curve('kTRC')] };
    if (header.colorSpace !== 'RGB') no(`${header.colorSpace} profiles are not supported`);
    if (header.pcs !== 'XYZ') no('an RGB profile with a Lab connection space needs its LUTs (A2B0), which are not supported');
    const [r, g, b] = [xyzTag('rXYZ'), xyzTag('gXYZ'), xyzTag('bXYZ')] as [number[], number[], number[]];
    return { kind: 'matrix-trc', ...header, matrix: [r[0]!, g[0]!, b[0]!, r[1]!, g[1]!, b[1]!, r[2]!, g[2]!, b[2]!], curves: [curve('rTRC'), curve('gTRC'), curve('bTRC')] };
  } catch (error) {
    if (error instanceof Unsupported || error instanceof RangeError) return { kind: 'unsupported', ...header, reason: error instanceof Unsupported ? error.message : 'a tag runs past the end' };
    throw error;
  }
}

function description(bytes: Uint8Array, view: DataView, t: { at: number; length: number } | undefined): string | undefined {
  if (!t) return undefined;
  const type = tag4(bytes, t.at);
  if (type === 'desc') {
    const n = Math.min(view.getUint32(t.at + 8), t.length - 12);
    return String.fromCharCode(...bytes.subarray(t.at + 12, t.at + 12 + Math.max(0, n))).replace(/\0[\s\S]*$/, '');
  }
  if (type === 'mluc' && t.length >= 28) {
    const length = view.getUint32(t.at + 20);
    const offset = view.getUint32(t.at + 24);
    if (offset + length > t.length) return undefined;
    let s = '';
    for (let i = 0; i + 1 < length; i += 2) s += String.fromCharCode(view.getUint16(t.at + offset + i));
    return s;
  }
  return undefined;
}

/** A grey profile's curve gives Y (XYZ connection space) or L* / 100 (Lab). */
const greyY = (p: IccProfile, v: number) => {
  const y = evalCurve(p.curves![0]!, v);
  if (p.pcs !== 'Lab') return y;
  const l = y * 100;
  return l > 8 ? ((l + 16) / 116) ** 3 : l / (24389 / 27);
};

/** XYZ (D50) of a device colour (`[r, g, b]` in [0, 1], or `[grey]`). Throws on an unsupported profile. */
export function profileToXyz(p: IccProfile, v: readonly number[]): number[] {
  if (p.kind === 'gray') {
    const y = greyY(p, v[0]!);
    return D50.map((w) => w * y);
  }
  if (p.kind !== 'matrix-trc') throw new Error(`icc: unsupported profile (${p.reason})`);
  return apply3(p.matrix!, [0, 1, 2].map((k) => evalCurve(p.curves![k]!, v[k]!)));
}

const SRGB_CURVE: IccCurve = { type: 'para', kind: 3, params: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] };

/**
 * Whether a profile is sRGB for every practical purpose: colorants within 1e-3 of sRGB's and every
 * curve within half an 8-bit step of the sRGB curve (in encoded units). Images with such a profile
 * keep rullino's plain 8-bit sRGB path.
 */
export function isSrgbProfile(p: IccProfile): boolean {
  if (p.kind !== 'matrix-trc') return false;
  if (p.matrix!.some((v, i) => Math.abs(v - LINEAR_SRGB_TO_XYZ_D50[i]!) > 1e-3)) return false;
  for (const c of p.curves!)
    for (let i = 0; i <= 255; i++) {
      const want = evalCurve(SRGB_CURVE, i / 255);
      const got = evalCurve(c, i / 255);
      if (Math.abs(encode(got) - encode(want)) > 0.5 / 255) return false;
    }
  return true;
}

const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Straight RGBA samples as decoders produce them (`@rullino/codecs`' `DecodedImage` fits). */
export interface ProfiledSamples {
  readonly data: Uint8Array | Uint8ClampedArray | Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8 | 16;
}

/**
 * Converts straight RGBA samples in a profile's colour space to rullino's working space: extended
 * linear sRGB, premultiplied. A grey profile's value is read from the red channel and becomes a
 * neutral. Throws on an `unsupported` profile.
 */
export function profileImage(img: ProfiledSamples, p: IccProfile): LinearImage {
  if (p.kind === 'unsupported') throw new Error(`icc: unsupported profile (${p.reason})`);
  const max = img.bitDepth === 16 ? 65535 : 255;
  const tables = (p.kind === 'gray' ? [0] : [0, 1, 2]).map((k) => {
    const t = new Float64Array(max + 1);
    for (let i = 0; i <= max; i++) t[i] = p.kind === 'gray' ? greyY(p, i / max) : evalCurve(p.curves![k]!, i / max);
    return t;
  });
  const out = createImage(img.width, img.height);
  const src = img.data;
  const dst = out.data;
  if (p.kind === 'gray') {
    const t = tables[0]!;
    for (let i = 0; i < dst.length; i += 4) {
      const a = src[i + 3]! / max;
      const y = t[src[i]!]! * a;
      dst[i] = y;
      dst[i + 1] = y;
      dst[i + 2] = y;
      dst[i + 3] = a;
    }
    return out;
  }
  const m = mul3(XYZ_D50_TO_LINEAR_SRGB, p.matrix!);
  const [tr, tg, tb] = tables as [Float64Array, Float64Array, Float64Array];
  for (let i = 0; i < dst.length; i += 4) {
    const r = tr[src[i]!]!;
    const g = tg[src[i + 1]!]!;
    const b = tb[src[i + 2]!]!;
    const a = src[i + 3]! / max;
    dst[i] = (m[0] * r + m[1] * g + m[2] * b) * a;
    dst[i + 1] = (m[3] * r + m[4] * g + m[5] * b) * a;
    dst[i + 2] = (m[6] * r + m[7] * g + m[8] * b) * a;
    dst[i + 3] = a;
  }
  return out;
}

/**
 * Writes a matrix/TRC display profile (ICC v4.3): description, copyright, D50 white, the Bradford
 * adaptation from the primaries' white, the colorants and one parametric curve for all three
 * channels. The header's date and profile ID are fixed (zero ID: "not calculated"), so the same
 * arguments always give the same bytes.
 */
export function writeIcc(primaries: Primaries, curve: Extract<IccCurve, { type: 'para' }>, description: string): Uint8Array {
  const s15 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, Math.round(v * 65536));
    return b;
  };
  const cat = (...parts: (Uint8Array | number[] | string)[]) => {
    const bytes = parts.map((p) => (typeof p === 'string' ? Uint8Array.from(p, (c) => c.charCodeAt(0)) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
    const out = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of bytes) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  };
  const u32 = (v: number) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const mluc = (text: string) => {
    const utf16 = Array.from(text).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255]);
    return cat('mluc', [0, 0, 0, 0], u32(1), u32(12), 'enUS', u32(utf16.length), u32(28), utf16);
  };
  const xyzTag = (v: readonly number[]) => cat('XYZ ', [0, 0, 0, 0], s15(v[0]!), s15(v[1]!), s15(v[2]!));
  const m = rgbToXyzD50(primaries);
  const w = xyz(...primaries.white);
  const src = apply3(BRADFORD, w);
  const dst = apply3(BRADFORD, D50);
  const chad = mul3(inv3(BRADFORD), mul3([dst[0]! / src[0]!, 0, 0, 0, dst[1]! / src[1]!, 0, 0, 0, dst[2]! / src[2]!], BRADFORD));
  const trc = cat('para', [0, 0, 0, 0], [0, curve.kind, 0, 0], ...curve.params.map(s15));
  const tags: [string, Uint8Array][] = [
    ['desc', mluc(description)],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', xyzTag(D50)],
    ['chad', cat('sf32', [0, 0, 0, 0], ...chad.map(s15))],
    ['rXYZ', xyzTag([m[0], m[3], m[6]])],
    ['gXYZ', xyzTag([m[1], m[4], m[7]])],
    ['bXYZ', xyzTag([m[2], m[5], m[8]])],
    ['rTRC', trc],
  ];
  const all = [...tags.map(([sig]) => sig), 'gTRC', 'bTRC'];
  const table: number[] = [];
  const body: Uint8Array[] = [];
  let offset = 128 + 4 + 12 * all.length;
  const placed = new Map<string, [number, number]>();
  for (const [sig, data] of tags) {
    placed.set(sig, [offset, data.length]);
    const padded = cat(data, new Array((4 - (data.length % 4)) % 4).fill(0));
    body.push(padded);
    offset += padded.length;
  }
  placed.set('gTRC', placed.get('rTRC')!); // the three channels share one curve
  placed.set('bTRC', placed.get('rTRC')!);
  for (const sig of all) table.push(...Array.from(sig, (c) => c.charCodeAt(0)), ...u32(placed.get(sig)![0]), ...u32(placed.get(sig)![1]));
  const header = cat(u32(offset), [0, 0, 0, 0], [4, 0x30, 0, 0], 'mntr', 'RGB ', 'XYZ ', [0x07, 0xea, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], 'acsp', new Array(24).fill(0), u32(0), s15(D50[0]), s15(D50[1]), s15(D50[2]), 'rlno', new Array(16 + 28).fill(0));
  return cat(header, u32(all.length), table, ...body);
}
