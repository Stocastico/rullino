// Metadata in image files (#180): where JPEG, PNG, WebP and TIFF keep EXIF, XMP, IPTC and ICC, read into
// one format-independent `ImageMetadata` (and, in the next step, written back). The blocks are kept as
// they are; their contents are read and edited by exif.ts, xmp.ts and iptc.ts.

import { detectFormat } from './decode';
import { walkExif } from './exif';
import { iptcFromIrb, irbFromIptc } from './iptc';
import { crc32 } from './png';
import { CodecError } from './types';
import { deflate, inflate } from './zlib';

export interface ImageMetadata {
  /** EXIF as a TIFF structure (what follows "Exif\0\0" in JPEG's APP1; PNG's eXIf; WebP's EXIF). */
  readonly exif?: Uint8Array;
  /** The XMP packet. */
  readonly xmp?: string;
  /** IPTC-IIM datasets, bare (see `readIptc`). */
  readonly iptc?: Uint8Array;
  /** The ICC profile. */
  readonly icc?: Uint8Array;
  /** PNG's other text chunks (tEXt, zTXt, iTXt), by keyword, in file order. */
  readonly text?: readonly { readonly keyword: string; readonly text: string }[];
}

const MAX_BLOCK = 16 * 1024 * 1024;
const latin1 = (b: Uint8Array) => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);
const startsWith = (b: Uint8Array, s: string, at = 0) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** An ImageMagick-style raw profile ("\n<type> profile\n <length>\n<hex lines>"), decoded. */
function rawProfile(text: string): Uint8Array | undefined {
  const m = /^\s*\S[^\n]*\n\s*(\d+)\s*\n([\s0-9a-fA-F]*)$/.exec(text);
  if (!m) return undefined;
  const hex = m[2]!.replace(/\s+/g, '');
  const length = Number(m[1]);
  if (hex.length < 2 * length) return undefined;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const withoutExifHeader = (b: Uint8Array) => (startsWith(b, 'Exif\0\0') ? b.subarray(6) : b);
const iptcOf = (b: Uint8Array) => (b[0] === 0x1c ? b : iptcFromIrb(b));

function readJpeg(b: Uint8Array): ImageMetadata {
  const out: { -readonly [K in keyof ImageMetadata]: ImageMetadata[K] } = {};
  const icc: Uint8Array[] = [];
  let iccCount = 0;
  for (let i = 2; i + 4 <= b.length && b[i] === 0xff; ) {
    const marker = b[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff) {
      i++;
      continue;
    }
    const length = u16(b, i + 2);
    const seg = b.subarray(i + 4, Math.min(b.length, i + 2 + length));
    if (marker === 0xe1 && startsWith(seg, 'Exif\0\0') && !out.exif) out.exif = seg.slice(6);
    else if (marker === 0xe1 && startsWith(seg, 'http://ns.adobe.com/xap/1.0/\0') && out.xmp === undefined) out.xmp = utf8(seg.subarray(29));
    else if (marker === 0xed && startsWith(seg, 'Photoshop 3.0\0')) {
      const iptc = iptcFromIrb(seg.subarray(14));
      if (iptc && !out.iptc) out.iptc = iptc;
    } else if (marker === 0xe2 && startsWith(seg, 'ICC_PROFILE\0') && seg.length >= 14) {
      iccCount ||= seg[13]!;
      const seq = seg[12]!;
      if (seq >= 1 && seq <= iccCount && seg[13] === iccCount) icc[seq - 1] = seg.slice(14);
    }
    i += 2 + length;
  }
  // Every chunk the profile was split into, or none (a sparse array would hide a missing one).
  if (iccCount && Array.from({ length: iccCount }, (_, k) => icc[k]).every(Boolean)) {
    const all = new Uint8Array(icc.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of icc) {
      all.set(x, o);
      o += x.length;
    }
    out.icc = all;
  }
  return out;
}

/** A compressed PNG block, or undefined when it does not inflate (the block is left out). */
const inflated = (data: Uint8Array, what: string) => inflate(data, 'png', what, { limit: MAX_BLOCK }).catch(() => undefined);

async function readPng(b: Uint8Array): Promise<ImageMetadata> {
  const out: { -readonly [K in keyof ImageMetadata]: ImageMetadata[K] } = {};
  const text: { keyword: string; text: string }[] = [];
  for (let i = 8; i + 12 <= b.length; ) {
    const length = u32(b, i);
    const type = latin1(b.subarray(i + 4, i + 8));
    const data = b.subarray(i + 8, Math.min(b.length, i + 8 + length));
    i += 12 + length;
    if (type === 'IDAT' || type === 'IEND') break; // metadata after the image data is rare and ignored
    const zero = data.indexOf(0);
    if (type === 'eXIf') out.exif = withoutExifHeader(data).slice();
    else if (type === 'iCCP' && zero > 0) {
      const icc = await inflated(data.subarray(zero + 2), 'ICC profile');
      if (icc) out.icc = icc;
    }
    else if ((type === 'tEXt' || type === 'zTXt' || type === 'iTXt') && zero > 0) {
      const keyword = latin1(data.subarray(0, zero));
      let value: string;
      if (type === 'tEXt') value = latin1(data.subarray(zero + 1));
      else if (type === 'zTXt') {
        const body = await inflated(data.subarray(zero + 2), `${keyword} text`);
        if (!body) continue;
        value = latin1(body);
      } else {
        // iTXt: keyword \0 compressed? method \0 language \0 translated keyword \0 text (UTF-8)
        const compressed = data[zero + 1] === 1;
        const lang = data.indexOf(0, zero + 3);
        const translated = data.indexOf(0, lang + 1);
        if (lang < 0 || translated < 0) continue;
        const body = compressed ? await inflated(data.subarray(translated + 1), `${keyword} text`) : data.subarray(translated + 1);
        if (!body) continue;
        value = utf8(body);
      }
      const raw = keyword.startsWith('Raw profile type ') ? rawProfile(value) : undefined;
      if (keyword === 'XML:com.adobe.xmp') out.xmp = value;
      else if (raw && /^Raw profile type (exif|APP1)$/i.test(keyword)) out.exif ??= withoutExifHeader(raw).slice();
      else if (raw && /^Raw profile type iptc$/i.test(keyword)) {
        const iptc = iptcOf(raw);
        if (iptc && !out.iptc) out.iptc = iptc;
      }
      else if (raw && /^Raw profile type (icc|icm)$/i.test(keyword)) out.icc ??= raw;
      else if (raw && /^Raw profile type xmp$/i.test(keyword)) out.xmp ??= utf8(raw);
      else text.push({ keyword, text: value });
    }
  }
  if (text.length) out.text = text;
  return out;
}

function readWebp(b: Uint8Array): ImageMetadata {
  const out: { -readonly [K in keyof ImageMetadata]: ImageMetadata[K] } = {};
  for (let i = 12; i + 8 <= b.length; ) {
    const type = latin1(b.subarray(i, i + 4));
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    const data = b.subarray(i + 8, Math.min(b.length, i + 8 + size));
    if (type === 'EXIF') out.exif = withoutExifHeader(data).slice();
    else if (type === 'XMP ') out.xmp = utf8(data);
    else if (type === 'ICCP') out.icc = data.slice();
    i += 8 + size + (size & 1);
  }
  return out;
}

function readTiff(b: Uint8Array): ImageMetadata {
  const out: { -readonly [K in keyof ImageMetadata]: ImageMetadata[K] } = {};
  const ifd0 = walkExif(b).ifds.find((d) => d.name === 'ifd0')!;
  for (const e of ifd0.entries) {
    const bytes = b.subarray(e.at, e.at + e.size);
    if (e.tag === 700) out.xmp = utf8(bytes);
    else if (e.tag === 33723) {
      const iptc = iptcOf(bytes.slice());
      if (iptc) out.iptc = iptc;
    }
    else if (e.tag === 34675) out.icc = bytes.slice();
  }
  return out;
}

/**
 * The metadata of a JPEG, PNG, WebP or TIFF file: EXIF, XMP, IPTC, ICC and PNG's text chunks. A block
 * that is broken is left out (the image is still usable); an unknown format is a `CodecError`.
 * TIFF's own EXIF (in its image directory) is not read yet.
 */
export async function readMetadata(bytes: Uint8Array): Promise<ImageMetadata> {
  const format = detectFormat(bytes);
  if (format === 'jpeg') return readJpeg(bytes);
  if (format === 'png') return readPng(bytes);
  if (format === 'webp') return readWebp(bytes);
  if (format === 'tiff') return readTiff(bytes);
  throw new CodecError(format ?? 'image', format ? `reading metadata from ${format} is not supported` : 'unknown format');
}

// ---------------------------------------------------------------------------------------------------
// Writing: the file's metadata becomes `meta` (blocks `meta` leaves out are removed).

export type MetadataBlock = 'exif' | 'xmp' | 'iptc' | 'icc' | 'text';

const concat = (parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8Bytes = (s: string) => new TextEncoder().encode(s);

function writeJpeg(b: Uint8Array, meta: ImageMetadata, dropped: MetadataBlock[]): Uint8Array {
  const keep: Uint8Array[] = [];
  let jfif: Uint8Array | undefined;
  let i = 2;
  for (; i + 4 <= b.length && b[i] === 0xff; ) {
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const end = i + 2 + u16(b, i + 2);
    const seg = b.subarray(i, end);
    const body = seg.subarray(4);
    const ours =
      (marker === 0xe1 && (startsWith(body, 'Exif\0\0') || startsWith(body, 'http://ns.adobe.com/xap/1.0/\0') || startsWith(body, 'http://ns.adobe.com/xmp/extension/\0'))) ||
      (marker === 0xed && startsWith(body, 'Photoshop 3.0\0')) ||
      (marker === 0xe2 && startsWith(body, 'ICC_PROFILE\0'));
    if (marker === 0xe0 && startsWith(body, 'JFIF\0') && keep.length === 0 && !jfif) jfif = seg;
    else if (!ours) keep.push(seg);
    i = end;
  }
  const segment = (marker: number, body: Uint8Array, block: MetadataBlock): Uint8Array[] => {
    if (body.length + 2 > 0xffff) {
      dropped.push(block);
      return [];
    }
    return [Uint8Array.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body];
  };
  const added: Uint8Array[] = [];
  if (meta.exif) added.push(...segment(0xe1, concat([ascii('Exif\0\0'), meta.exif]), 'exif'));
  if (meta.xmp !== undefined) added.push(...segment(0xe1, concat([ascii('http://ns.adobe.com/xap/1.0/\0'), utf8Bytes(meta.xmp)]), 'xmp'));
  if (meta.iptc) added.push(...segment(0xed, concat([ascii('Photoshop 3.0\0'), irbFromIptc(meta.iptc)]), 'iptc'));
  if (meta.icc) {
    const MAX = 65519;
    const count = Math.ceil(meta.icc.length / MAX);
    if (count > 255) dropped.push('icc');
    else for (let k = 0; k < count; k++) added.push(...segment(0xe2, concat([ascii('ICC_PROFILE\0'), [k + 1, count], meta.icc.subarray(k * MAX, (k + 1) * MAX)]), 'icc'));
  }
  return concat([[0xff, 0xd8], ...(jfif ? [jfif] : []), ...added, ...keep, b.subarray(i)]);
}

const be32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([ascii(type), data]);
  return concat([be32(data.length), body, be32(crc32(body))]);
}

async function writePng(b: Uint8Array, meta: ImageMetadata): Promise<Uint8Array> {
  if (b.length < 33) throw new CodecError('png', 'truncated file');
  const ihdrEnd = 8 + 12 + u32(b, 8);
  const keep: Uint8Array[] = [];
  for (let i = ihdrEnd; i + 12 <= b.length; ) {
    const length = u32(b, i);
    const type = latin1(b.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    const ours = type === 'eXIf' || type === 'iCCP' || type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || (type === 'sRGB' && !!meta.icc);
    if (!ours) keep.push(b.subarray(i, end));
    i = end;
  }
  const added: Uint8Array[] = [];
  if (meta.icc) added.push(pngChunk('iCCP', concat([ascii('icc\0\0'), await deflate(meta.icc)])));
  if (meta.exif) added.push(pngChunk('eXIf', meta.exif));
  if (meta.xmp !== undefined) added.push(pngChunk('iTXt', concat([ascii('XML:com.adobe.xmp\0\0\0\0\0'), utf8Bytes(meta.xmp)])));
  if (meta.iptc) {
    // ImageMagick's raw profile: hex of the Photoshop resource block, 72 digits per line.
    const irb = irbFromIptc(meta.iptc);
    const hex = Array.from(irb, (v) => v.toString(16).padStart(2, '0')).join('');
    const text = `\nIPTC profile\n${String(irb.length).padStart(8)}\n${hex.replace(/.{1,72}/g, '$&\n')}`;
    added.push(pngChunk('zTXt', concat([ascii('Raw profile type iptc\0\0'), await deflate(ascii(text))])));
  }
  for (const t of meta.text ?? []) {
    if (!/^[\x20-\x7e\xa1-\xff]{1,79}$/.test(t.keyword)) continue; // not a valid PNG keyword
    const latin = /^[\x00-\xff]*$/.test(t.text);
    added.push(latin ? pngChunk('tEXt', concat([ascii(t.keyword), [0], ascii(t.text)])) : pngChunk('iTXt', concat([ascii(t.keyword), [0, 0, 0, 0, 0], utf8Bytes(t.text)])));
  }
  return concat([b.subarray(0, ihdrEnd), ...added, ...keep]);
}

function writeWebp(b: Uint8Array, meta: ImageMetadata): Uint8Array {
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let i = 12; i + 8 <= b.length; ) {
    const type = latin1(b.subarray(i, i + 4));
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    chunks.push({ type, data: b.subarray(i + 8, Math.min(b.length, i + 8 + size)) });
    i += 8 + size + (size & 1);
  }
  const old = chunks.find((c) => c.type === 'VP8X');
  const image = chunks.filter((c) => c.type !== 'VP8X' && c.type !== 'ICCP' && c.type !== 'EXIF' && c.type !== 'XMP ');
  let width: number;
  let height: number;
  let flags = old ? old.data[0]! & 0x12 : 0; // keep animation and alpha
  if (old && old.data.length >= 10) {
    width = 1 + (old.data[4]! | (old.data[5]! << 8) | (old.data[6]! << 16));
    height = 1 + (old.data[7]! | (old.data[8]! << 8) | (old.data[9]! << 16));
  } else {
    const vp8l = chunks.find((c) => c.type === 'VP8L');
    const vp8 = chunks.find((c) => c.type === 'VP8 ');
    if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
      const bits = (vp8l.data[1]! | (vp8l.data[2]! << 8) | (vp8l.data[3]! << 16) | (vp8l.data[4]! << 24)) >>> 0;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      if ((bits >>> 28) & 1) flags |= 0x10;
    } else if (vp8 && vp8.data.length >= 10 && vp8.data[3] === 0x9d && vp8.data[4] === 0x01 && vp8.data[5] === 0x2a) {
      width = (vp8.data[6]! | (vp8.data[7]! << 8)) & 0x3fff;
      height = (vp8.data[8]! | (vp8.data[9]! << 8)) & 0x3fff;
    } else throw new CodecError('webp', 'no image chunk to read the size from');
  }
  if (chunks.some((c) => c.type === 'ALPH')) flags |= 0x10;
  if (meta.icc) flags |= 0x20;
  if (meta.exif) flags |= 0x08;
  if (meta.xmp !== undefined) flags |= 0x04;
  const out: { type: string; data: Uint8Array }[] = [];
  if (flags || old) {
    const w = width - 1;
    const h = height - 1;
    out.push({ type: 'VP8X', data: Uint8Array.from([flags, 0, 0, 0, w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255]) });
  }
  if (meta.icc) out.push({ type: 'ICCP', data: meta.icc });
  out.push(...image);
  if (meta.exif) out.push({ type: 'EXIF', data: meta.exif });
  if (meta.xmp !== undefined) out.push({ type: 'XMP ', data: utf8Bytes(meta.xmp) });
  const body = out.flatMap((c) => [ascii(c.type), Uint8Array.from([c.data.length & 255, (c.data.length >> 8) & 255, (c.data.length >> 16) & 255, c.data.length >>> 24]), c.data, ...(c.data.length & 1 ? [Uint8Array.of(0)] : [])]);
  const size = 4 + body.reduce((n, p) => n + p.length, 0);
  return concat([ascii('RIFF'), [size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24], ascii('WEBP'), ...body]);
}

/**
 * The file with its metadata replaced by `meta` (JPEG, PNG or WebP): blocks `meta` has are written in
 * their place in the container, those it lacks are removed; the image data is not touched. A block
 * that does not fit its container (EXIF or XMP over 64 KB in JPEG) is left out and named in `dropped`,
 * never truncated. WebP has no place for IPTC or text; PNG's text chunks are only written to PNG.
 */
export async function writeMetadata(bytes: Uint8Array, meta: ImageMetadata): Promise<{ bytes: Uint8Array; dropped: MetadataBlock[] }> {
  const format = detectFormat(bytes);
  const dropped: MetadataBlock[] = [];
  if (format === 'jpeg') return { bytes: writeJpeg(bytes, meta, dropped), dropped };
  if (format === 'png') return { bytes: await writePng(bytes, meta), dropped };
  if (format === 'webp') return { bytes: writeWebp(bytes, meta), dropped };
  throw new CodecError(format ?? 'image', `writing metadata into ${format ?? 'this format'} is not supported (JPEG, PNG, WebP)`);
}
