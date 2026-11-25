// Metadata in image files (#180): where JPEG, PNG, WebP and TIFF keep EXIF, XMP, IPTC and ICC, read into
// one format-independent `ImageMetadata` (and, in the next step, written back). The blocks are kept as
// they are; their contents are read and edited by exif.ts, xmp.ts and iptc.ts.

import { detectFormat } from './decode';
import { walkExif } from './exif';
import { iptcFromIrb } from './iptc';
import { CodecError } from './types';
import { inflate } from './zlib';

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
