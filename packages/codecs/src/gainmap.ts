// Gain maps in JPEG (#182): "Ultra HDR" (Google) and the ISO 21496-1 metadata it carries. The file is
// an SDR JPEG (the primary image) with a second JPEG, the gain map, appended after it and indexed by
// an MPF (CIPA DC-007, multi-picture) APP2 segment; the gain map's parameters are in its XMP
// (`hdrgm:`, the Adobe gain map namespace) and in an ISO 21496-1 binary block in an APP2 segment
// ("urn:iso:std:iso:ts:21496:-1"); the primary image's XMP names the two images in a Container
// directory. The layouts follow Google's libultrahdr (Apache-2.0) as it writes them, which is what
// Android and Chrome read. This module only moves bytes and metadata: decoding the two JPEGs and
// applying the gain are the callers' (the maths is in `@rullino/core`).
//
// How a gain map is used (Adobe's gain map specification): with the SDR picture S (linear, sRGB
// primaries, 1 = SDR white) and the map value g in [0, 1] (8 bits, gamma encoded, per channel or one
// for all):   G = min + (max − min) · g^(1 / gamma)   (log2 of the gain),
//   H = (S + baseOffset) · 2^(G · w) − alternateOffset,  w = 1 for the full HDR rendition
// (w in [0, 1] scales it for a display with less headroom than `alternateHdrHeadroom`).

import { addXmpDescription, parseXmp, type XmlElement } from './xmp';
import { CodecError, plain } from './types';

const fail = (message: string): never => {
  throw new CodecError('gainmap', message);
};

/** The gain map's parameters, per channel (R, G, B; one value repeated when the map has one channel). All gains and headrooms are log2. */
export interface GainMapMetadata {
  /** log2 of the gain at map value 0. */
  readonly gainMapMin: readonly [number, number, number];
  /** log2 of the gain at map value 1. */
  readonly gainMapMax: readonly [number, number, number];
  readonly gamma: readonly [number, number, number];
  /** Added to the SDR value before the gain is applied. */
  readonly baseOffset: readonly [number, number, number];
  /** Subtracted from the result: the HDR value's offset. */
  readonly alternateOffset: readonly [number, number, number];
  /** log2 of the headroom the base (SDR) image has: 0. */
  readonly baseHdrHeadroom: number;
  /** log2 of the headroom of the HDR rendition: the display headroom at which the full gain applies. */
  readonly alternateHdrHeadroom: number;
}

/** An Ultra HDR file taken apart: the two JPEG files (complete, ready for a JPEG decoder) and the gain map's parameters. */
export interface UltraHdr {
  readonly primary: Uint8Array;
  readonly gainMap: Uint8Array;
  readonly metadata: GainMapMetadata;
}

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
const ISO_NS = 'urn:iso:std:iso:ts:21496:-1\0';
const HDRGM = 'http://ns.adobe.com/hdr-gain-map/1.0/';
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, s: string, at = 0) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;

// ---- ISO 21496-1 ----------------------------------------------------------------------------

const MULTICHANNEL = 0x80;
const USE_BASE_COLOUR_SPACE = 0x40;
const BACKWARD = 0x04;
const COMMON_DENOMINATOR = 0x08;
const DENOMINATOR = 1 << 20;

/** The ISO 21496-1 block (without the namespace string) for `meta`: version 0, rational numbers over 2^20. */
export function encodeIsoGainMap(meta: GainMapMetadata): Uint8Array {
  const channels = (['gainMapMin', 'gainMapMax', 'gamma', 'baseOffset', 'alternateOffset'] as const).every((k) => meta[k][0] === meta[k][1] && meta[k][0] === meta[k][2]) ? 1 : 3;
  const out: number[] = [0, 0, 0, 0, (channels === 3 ? MULTICHANNEL : 0) | USE_BASE_COLOUR_SPACE];
  const u32 = (v: number) => out.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const unsigned = (x: number) => {
    const n = Math.round(x * DENOMINATOR);
    if (!(n >= 0 && n <= 0xffffffff)) fail(`${x} does not fit a gain map field`);
    u32(n);
    u32(DENOMINATOR);
  };
  const signed = (x: number) => {
    const n = Math.round(x * DENOMINATOR);
    if (!(n >= -0x80000000 && n <= 0x7fffffff)) fail(`${x} does not fit a gain map field`);
    u32(n >>> 0);
    u32(DENOMINATOR);
  };
  unsigned(meta.baseHdrHeadroom);
  unsigned(meta.alternateHdrHeadroom);
  for (let c = 0; c < channels; c++) {
    signed(meta.gainMapMin[c]!);
    signed(meta.gainMapMax[c]!);
    unsigned(meta.gamma[c]!);
    signed(meta.baseOffset[c]!);
    signed(meta.alternateOffset[c]!);
  }
  return Uint8Array.from(out);
}

/** Reads an ISO 21496-1 block (without the namespace string). */
export function parseIsoGainMap(input: Uint8Array): GainMapMetadata {
  const b = plain(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (at + n > b.length) fail('the ISO 21496-1 block is truncated');
  };
  need(5);
  if (v.getUint16(0) !== 0) fail(`ISO 21496-1 minimum version ${v.getUint16(0)} is not supported (0 is)`);
  const flags = b[4]!;
  at = 5;
  if (flags & BACKWARD) fail('a gain map applied in the backward direction (HDR base image) is not supported');
  const channels = flags & MULTICHANNEL ? 3 : 1;
  const common = flags & COMMON_DENOMINATOR ? (need(4), v.getUint32(at)) : undefined;
  if (common !== undefined) {
    if (common === 0) fail('the ISO 21496-1 common denominator is 0');
    at += 4;
  }
  const readU = (): number => {
    if (common !== undefined) {
      need(4);
      const n = v.getUint32(at);
      at += 4;
      return n / common;
    }
    need(8);
    const n = v.getUint32(at);
    const d = v.getUint32(at + 4);
    at += 8;
    if (d === 0) fail('a denominator in the ISO 21496-1 block is 0');
    return n / d;
  };
  const readS = (): number => {
    if (common !== undefined) {
      need(4);
      const n = v.getInt32(at);
      at += 4;
      return n / common;
    }
    need(8);
    const n = v.getInt32(at);
    const d = v.getUint32(at + 4);
    at += 8;
    if (d === 0) fail('a denominator in the ISO 21496-1 block is 0');
    return n / d;
  };
  const base = readU();
  const alternate = readU();
  const min: number[] = [];
  const max: number[] = [];
  const gamma: number[] = [];
  const baseOffset: number[] = [];
  const alternateOffset: number[] = [];
  for (let c = 0; c < channels; c++) {
    min.push(readS());
    max.push(readS());
    gamma.push(readU());
    baseOffset.push(readS());
    alternateOffset.push(readS());
    if (max[c]! < min[c]!) fail('the gain map maximum is less than its minimum');
    if (!(gamma[c]! > 0)) fail('the gain map gamma must be positive');
  }
  const three = (a: number[]) => [a[0]!, a[channels === 3 ? 1 : 0]!, a[channels === 3 ? 2 : 0]!] as const;
  return { gainMapMin: three(min), gainMapMax: three(max), gamma: three(gamma), baseOffset: three(baseOffset), alternateOffset: three(alternateOffset), baseHdrHeadroom: base, alternateHdrHeadroom: alternate };
}

// ---- XMP ------------------------------------------------------------------------------------

/** The gain map's own XMP packet (Adobe's `hdrgm:` attributes). Only for one-channel maps: more is in the ISO block. */
function xmpOfGainMap(m: GainMapMetadata): string {
  const n = (x: number) => String(+x.toPrecision(9));
  const same = (a: readonly number[]) => a[0] === a[1] && a[0] === a[2];
  const single = same(m.gainMapMin) && same(m.gainMapMax) && same(m.gamma) && same(m.baseOffset) && same(m.alternateOffset);
  const attrs = single
    ? ` hdrgm:GainMapMin="${n(m.gainMapMin[0])}" hdrgm:GainMapMax="${n(m.gainMapMax[0])}" hdrgm:Gamma="${n(m.gamma[0])}" hdrgm:OffsetSDR="${n(m.baseOffset[0])}" hdrgm:OffsetHDR="${n(m.alternateOffset[0])}" hdrgm:HDRCapacityMin="${n(m.baseHdrHeadroom)}" hdrgm:HDRCapacityMax="${n(m.alternateHdrHeadroom)}" hdrgm:BaseRenditionIsHDR="False"`
    : '';
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:hdrgm="${HDRGM}" hdrgm:Version="1.0"${attrs}/></rdf:RDF></x:xmpmeta>`;
}

/** The Container directory (a description to add to the primary image's XMP packet) naming the two images. */
const containerDescription = (gainMapLength: number) =>
  `<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="${HDRGM}" hdrgm:Version="1.0"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gainMapLength}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description>`;

function* walkElements(roots: readonly XmlElement[]): Generator<XmlElement> {
  for (const r of roots) {
    yield r;
    yield* walkElements(r.children);
  }
}

/** The numbers an `hdrgm:` property holds: an attribute, an element, or an `rdf:Seq` of three. */
function hdrgmNumbers(xmp: string, local: string): number[] | undefined {
  let roots: XmlElement[];
  try {
    roots = parseXmp(xmp);
  } catch {
    return undefined;
  }
  for (const el of walkElements(roots)) {
    const attr = el.attrs.find((a) => a.ns === HDRGM && a.local === local);
    if (attr) return [Number(attr.value)];
    if (el.ns === HDRGM && el.local === local) {
      const items = [...walkElements(el.children)].filter((c) => c.local === 'li');
      const texts = (items.length ? items : [el]).map((c) => Number(xmp.slice(c.contentStart, c.contentEnd).trim()));
      return texts;
    }
  }
  return undefined;
}

function parseXmpGainMap(xmp: string): GainMapMetadata | undefined {
  const get = (name: string) => hdrgmNumbers(xmp, name);
  const min = get('GainMapMin') ?? [0];
  const max = get('GainMapMax');
  if (!max) return undefined;
  const three = (a: number[] | undefined, fallback: number): [number, number, number] => [a?.[0] ?? fallback, a?.[a.length === 3 ? 1 : 0] ?? fallback, a?.[a.length === 3 ? 2 : 0] ?? fallback];
  const scalar = (name: string, fallback: number) => get(name)?.[0] ?? fallback;
  const out: GainMapMetadata = {
    gainMapMin: three(min, 0),
    gainMapMax: three(max, 1),
    gamma: three(get('Gamma'), 1),
    baseOffset: three(get('OffsetSDR'), 1 / 64),
    alternateOffset: three(get('OffsetHDR'), 1 / 64),
    baseHdrHeadroom: scalar('HDRCapacityMin', 0),
    alternateHdrHeadroom: scalar('HDRCapacityMax', Math.max(...three(max, 1))),
  };
  const numbers = [...out.gainMapMin, ...out.gainMapMax, ...out.gamma, ...out.baseOffset, ...out.alternateOffset, out.baseHdrHeadroom, out.alternateHdrHeadroom];
  if (numbers.some((v) => !Number.isFinite(v)) || out.gamma.some((g) => g <= 0) || out.gainMapMax.some((v, i) => v < out.gainMapMin[i]!)) fail('the gain map metadata in the XMP is invalid');
  if (/BaseRenditionIsHDR\s*=\s*"True"/i.test(xmp)) fail('a gain map applied in the backward direction (HDR base image) is not supported');
  return out;
}

// ---- JPEG segments ---------------------------------------------------------------------------

interface Segment {
  readonly marker: number;
  /** The marker's first byte (0xFF) and the byte after the segment. */
  readonly start: number;
  readonly end: number;
}

/** The marker segments of a JPEG up to its first SOS (the scan data is not walked). */
function jpegSegments(b: Uint8Array, from = 0): Segment[] {
  if (b[from] !== 0xff || b[from + 1] !== 0xd8) fail('not a JPEG file');
  const out: Segment[] = [];
  for (let i = from + 2; i + 4 <= b.length; ) {
    if (b[i] !== 0xff) fail('a JPEG marker was expected');
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      out.push({ marker, start: i, end: i + 2 });
      break;
    }
    const end = i + 2 + u16(b, i + 2);
    if (end > b.length) fail('a JPEG segment runs past the end of the file');
    out.push({ marker, start: i, end });
    i = end;
  }
  return out;
}

const segmentBody = (b: Uint8Array, s: Segment) => b.subarray(s.start + 4, s.end);
const isApp = (m: number) => m >= 0xe0 && m <= 0xef;
const isMpf = (b: Uint8Array, s: Segment) => s.marker === 0xe2 && startsWith(segmentBody(b, s), 'MPF\0');
const isIso = (b: Uint8Array, s: Segment) => s.marker === 0xe2 && startsWith(segmentBody(b, s), ISO_NS);
const isXmp = (b: Uint8Array, s: Segment) => s.marker === 0xe1 && startsWith(segmentBody(b, s), XMP_NS);

function concat(parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const segment = (marker: number, body: Uint8Array): Uint8Array => {
  if (body.length + 2 > 0xffff) fail('a metadata block is too large for a JPEG segment');
  return concat([[0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255], body]);
};

// ---- MPF -------------------------------------------------------------------------------------

/** The MPF APP2 segment for a primary image of `primarySize` bytes followed by a secondary one of `secondarySize`, `mpStart` bytes into the file (where "II*\0" / "MM\0*" lies). */
function mpfSegment(primarySize: number, secondaryOffset: number, secondarySize: number): Uint8Array {
  const out: number[] = [];
  const u16w = (v: number) => out.push((v >> 8) & 255, v & 255);
  const u32w = (v: number) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  out.push(0x4d, 0x50, 0x46, 0); // "MPF\0"
  out.push(0x4d, 0x4d, 0x00, 0x2a); // big endian
  u32w(8); // offset of the index IFD, from the endianness marker
  u16w(3); // tags: version, number of images, MP entries
  u16w(0xb000); u16w(7); u32w(4); out.push(0x30, 0x31, 0x30, 0x30); // MPFVersion "0100"
  u16w(0xb001); u16w(4); u32w(1); u32w(2); // NumberOfImages
  u16w(0xb002); u16w(7); u32w(32); u32w(8 + 2 + 3 * 12 + 4); // MPEntry: 2 × 16 bytes, after the IFD
  u32w(0); // no next IFD
  u32w(0x030000); u32w(primarySize); u32w(0); u16w(0); u16w(0); // primary: baseline MP primary image, offset 0
  u32w(0); u32w(secondarySize); u32w(secondaryOffset); u16w(0); u16w(0); // the gain map: undefined type
  return segment(0xe2, Uint8Array.from(out));
}

interface MpEntry {
  readonly size: number;
  readonly offset: number;
}

/** The MP entries of an MPF segment body (after "MPF\0"), with offsets made absolute (`mpStart` = file position of the endianness marker). */
function readMpf(body: Uint8Array, mpStart: number): MpEntry[] {
  if (body.length < 12) fail('the MPF segment is truncated');
  const little = body[0] === 0x49 && body[1] === 0x49;
  if (!little && !(body[0] === 0x4d && body[1] === 0x4d)) fail('the MPF segment has no byte order marker');
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const ifd = v.getUint32(4, little);
  if (ifd + 2 > body.length) fail('the MPF index runs past its segment');
  const count = v.getUint16(ifd, little);
  if (ifd + 2 + 12 * count > body.length) fail('the MPF index runs past its segment');
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + 12 * k;
    if (v.getUint16(e, little) !== 0xb002) continue;
    const length = v.getUint32(e + 4, little);
    const at = v.getUint32(e + 8, little);
    if (length % 16 !== 0 || at + length > body.length) fail('the MPF entry table runs past its segment');
    const entries: MpEntry[] = [];
    for (let i = 0; i < length / 16; i++) entries.push({ size: v.getUint32(at + 16 * i + 4, little), offset: v.getUint32(at + 16 * i + 8, little) + (i === 0 ? 0 : mpStart) });
    return entries;
  }
  return [];
}

// ---- reading ---------------------------------------------------------------------------------

/** The metadata block of a gain map JPEG: ISO 21496-1 when present, else the XMP. */
function metadataOf(gainMap: Uint8Array): GainMapMetadata | undefined {
  const segs = jpegSegments(gainMap);
  const iso = segs.find((s) => isIso(gainMap, s) && segmentBody(gainMap, s).length > ISO_NS.length + 4);
  if (iso) return parseIsoGainMap(segmentBody(gainMap, iso).subarray(ISO_NS.length));
  const xmp = segs.find((s) => isXmp(gainMap, s));
  return xmp ? parseXmpGainMap(new TextDecoder().decode(segmentBody(gainMap, xmp).subarray(XMP_NS.length))) : undefined;
}

/**
 * Takes an Ultra HDR file apart: the SDR JPEG, the gain map JPEG and the gain map's parameters, or
 * `undefined` when the file is not a JPEG with a gain map (a plain JPEG, or a multi-picture file
 * whose second picture is not one). Throws a `CodecError` for a file that says it has one and is broken.
 */
export function readUltraHdr(input: Uint8Array): UltraHdr | undefined {
  const b = plain(input);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let segs: Segment[];
  try {
    segs = jpegSegments(b);
  } catch (e) {
    if (e instanceof CodecError) return undefined;
    throw e;
  }
  // Where the second picture starts: the MPF index, else the length the Container directory names.
  let start: number | undefined;
  let size: number | undefined;
  const mpf = segs.find((s) => isMpf(b, s));
  if (mpf) {
    const entries = readMpf(segmentBody(b, mpf).subarray(4), mpf.start + 8);
    if (entries.length >= 2) {
      start = entries[1]!.offset;
      size = entries[1]!.size;
    }
  }
  if (start === undefined) {
    const xmp = segs.find((s) => isXmp(b, s));
    const length = xmp && /Item:Semantic="GainMap"[^>]*?Item:Length="(\d+)"/.exec(new TextDecoder().decode(segmentBody(b, xmp)));
    if (length) {
      size = Number(length[1]);
      start = b.length - size;
    }
  }
  if (start === undefined || size === undefined) return undefined;
  if (!(start > 2 && size > 4 && start + size <= b.length && b[start] === 0xff && b[start + 1] === 0xd8)) {
    // An MPF that points elsewhere (a thumbnail, a second photo): not a gain map we can use.
    return mpf && !(start + size <= b.length) ? fail('the gain map lies outside the file') : undefined;
  }
  const gainMap = b.subarray(start, start + size);
  const metadata = metadataOf(gainMap);
  if (!metadata) return undefined;
  return { primary: b.subarray(0, start), gainMap, metadata };
}

// ---- writing ---------------------------------------------------------------------------------

/**
 * An Ultra HDR file from an SDR JPEG (`primary`, with whatever EXIF, ICC and XMP it carries, kept)
 * and a gain map JPEG: the container description joins the primary's XMP packet, an ISO 21496-1
 * version block and the MPF index follow the primary's metadata segments, the gain map gets its XMP
 * and ISO metadata blocks. `metadata` describes the gain map.
 */
export function writeUltraHdr(parts: UltraHdr): Uint8Array {
  const primary = plain(parts.primary);
  const map = plain(parts.gainMap);
  const check = (b: Uint8Array, what: string) => {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) fail(`the ${what} is not a JPEG file`);
  };
  check(primary, 'primary image');
  check(map, 'gain map');

  // The gain map JPEG: JFIF first (when it has one), then our XMP and ISO blocks, then the rest of it.
  const mapSegs = jpegSegments(map);
  const mapKeep = mapSegs.filter((s) => !isXmp(map, s) && !isIso(map, s) && !isMpf(map, s));
  const firstApp0 = mapKeep.find((s) => s.marker === 0xe0 && startsWith(segmentBody(map, s), 'JFIF\0'));
  const mapRestStart = mapKeep.length > 0 ? mapKeep[0]!.start : 2;
  const gainMap = concat([
    [0xff, 0xd8],
    ...(firstApp0 ? [map.subarray(firstApp0.start, firstApp0.end)] : []),
    segment(0xe1, concat([ascii(XMP_NS), new TextEncoder().encode(xmpOfGainMap(parts.metadata))])),
    segment(0xe2, concat([ascii(ISO_NS), encodeIsoGainMap(parts.metadata)])),
    ...mapKeep.filter((s) => s !== firstApp0).flatMap((s) => (s.marker === 0xda || s.marker === 0xd9 ? [] : [map.subarray(s.start, s.end)])),
    map.subarray(mapSegs.find((s) => s.marker === 0xda)?.start ?? mapRestStart),
  ]);

  // The primary JPEG: its leading APP segments (a new XMP description or packet, the ISO version block), the MPF index, then the rest.
  const segs = jpegSegments(primary);
  let firstOther = segs.findIndex((s) => !isApp(s.marker));
  if (firstOther < 0) firstOther = segs.length;
  const leading = segs.slice(0, firstOther).filter((s) => !isMpf(primary, s) && !isIso(primary, s));
  const restStart = segs[firstOther]?.start ?? primary.length;
  const description = containerDescription(gainMap.length);
  const head: Uint8Array[] = [];
  let merged = false;
  for (const s of leading) {
    if (isXmp(primary, s) && !merged) {
      const xmp = new TextDecoder().decode(segmentBody(primary, s).subarray(XMP_NS.length));
      head.push(segment(0xe1, concat([ascii(XMP_NS), new TextEncoder().encode(addXmpDescription(xmp, description))])));
      merged = true;
    } else head.push(primary.subarray(s.start, s.end));
  }
  if (!merged) head.push(segment(0xe1, concat([ascii(XMP_NS), new TextEncoder().encode(addXmpDescription(undefined, description))])));
  head.push(segment(0xe2, concat([ascii(ISO_NS), [0, 0, 0, 0]])));
  const before = 2 + head.reduce((n, p) => n + p.length, 0);
  const mpfSize = 90; // marker + length + "MPF\0" + 82 bytes of header, index and two entries
  const rest = primary.subarray(restStart);
  const primarySize = before + mpfSize + rest.length;
  // The gain map starts right after the primary image; offsets in the index count from the byte order marker (8 bytes into the segment).
  const mpf = mpfSegment(primarySize, primarySize - (before + 8), gainMap.length);
  if (mpf.length !== mpfSize) fail('internal error: the MPF segment has an unexpected size');
  return concat([[0xff, 0xd8], ...head, mpf, rest, gainMap]);
}
