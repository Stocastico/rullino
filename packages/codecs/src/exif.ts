// EXIF (#180): a TIFF structure (byte order, IFD0 with the camera and image fields, the Exif and GPS
// sub-IFDs, an Interop IFD inside Exif, IFD1 for the thumbnail). Reading walks it with bounds checks
// and a guard against IFD loops; editing works on a copy *in place*: entries are removed by rewriting
// their IFD with fewer entries and zeroing what they pointed to, values are patched where they lie.
// Nothing moves, so offsets elsewhere (a MakerNote's, often relative to the TIFF header) stay valid.

import { CodecError } from './types';

const fail = (message: string): never => {
  throw new CodecError('exif', message);
};

export type ExifIfd = 'ifd0' | 'exif' | 'gps' | 'interop' | 'ifd1';

export interface ExifEntry {
  readonly ifd: ExifIfd;
  readonly tag: number;
  /** TIFF field type: 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED, 9 SLONG, 10 SRATIONAL… */
  readonly type: number;
  readonly count: number;
  /** ASCII as a string (trailing NULs removed); one number as a number; several as an array; UNDEFINED as bytes. */
  readonly value: string | number | number[] | Uint8Array;
}

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
/** Pointer tags: the IFD they lead to. */
export const SUB_IFD: Record<number, ExifIfd> = { 0x8769: 'exif', 0x8825: 'gps', 0xa005: 'interop' };

/** One IFD entry where it lies in the blob. */
interface Raw {
  readonly ifd: ExifIfd;
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Offset of the 12-byte entry. */
  readonly entry: number;
  /** Offset of the value bytes (inside the entry when they fit in 4 bytes). */
  readonly at: number;
  readonly size: number;
}

export interface Ifd {
  readonly name: ExifIfd;
  /** Offset of the IFD (its entry count). */
  readonly at: number;
  readonly entries: Raw[];
}

/** The blob's IFDs and their entries, bounds-checked. */
export function walkExif(exif: Uint8Array): { little: boolean; view: DataView; ifds: Ifd[] } {
  if (exif.length < 8) fail('too short');
  const order = String.fromCharCode(exif[0]!, exif[1]!);
  if (order !== 'II' && order !== 'MM') fail('bad byte order');
  const little = order === 'II';
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  if (view.getUint16(2, little) !== 42) fail('bad TIFF magic number');
  const ifds: Ifd[] = [];
  const seen = new Set<number>();
  const readIfd = (name: ExifIfd, at: number): number => {
    if (at < 8 || at + 2 > exif.length || seen.has(at)) fail(`bad ${name} offset ${at}`);
    seen.add(at);
    const n = view.getUint16(at, little);
    if (at + 2 + 12 * n + 4 > exif.length) fail(`${name} runs past the end`);
    const entries: Raw[] = [];
    for (let i = 0; i < n; i++) {
      const e = at + 2 + 12 * i;
      const tag = view.getUint16(e, little);
      const type = view.getUint16(e + 2, little);
      const count = view.getUint32(e + 4, little);
      const unit = SIZE[type];
      if (!unit) continue; // an unknown type: kept as it is, never read
      const size = unit * count;
      const valueAt = size <= 4 ? e + 8 : view.getUint32(e + 8, little);
      if (valueAt + size > exif.length) fail(`${name} tag 0x${tag.toString(16)} runs past the end`);
      entries.push({ ifd: name, tag, type, count, entry: e, at: valueAt, size });
    }
    ifds.push({ name, at, entries });
    for (const r of entries) {
      const sub = SUB_IFD[r.tag];
      if (sub && (r.type === 4 || r.type === 13) && r.count === 1) readIfd(sub, view.getUint32(r.at, little));
    }
    return view.getUint32(at + 2 + 12 * n, little);
  };
  const next = readIfd('ifd0', view.getUint32(4, little));
  if (next) readIfd('ifd1', next);
  return { little, view, ifds };
}

function decode(view: DataView, little: boolean, r: Raw): ExifEntry['value'] {
  const { type, count, at } = r;
  if (type === 2) {
    let s = '';
    for (let i = 0; i < count; i++) s += String.fromCharCode(view.getUint8(at + i));
    return s.replace(/\0+$/, '');
  }
  if (type === 7) return new Uint8Array(view.buffer, view.byteOffset + at, count).slice();
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = at + i * SIZE[type]!;
    values.push(
      type === 1 ? view.getUint8(o)
      : type === 6 ? view.getInt8(o)
      : type === 3 ? view.getUint16(o, little)
      : type === 8 ? view.getInt16(o, little)
      : type === 4 || type === 13 ? view.getUint32(o, little)
      : type === 9 ? view.getInt32(o, little)
      : type === 5 ? view.getUint32(o, little) / view.getUint32(o + 4, little)
      : type === 10 ? view.getInt32(o, little) / view.getInt32(o + 4, little)
      : type === 11 ? view.getFloat32(o, little)
      : view.getFloat64(o, little),
    );
  }
  return values.length === 1 ? values[0]! : values;
}

/** Every entry of an EXIF blob, with its decoded value. Throws a `CodecError` when the structure is broken. */
export function readExif(exif: Uint8Array): ExifEntry[] {
  const { little, view, ifds } = walkExif(exif);
  return ifds.flatMap((ifd) => ifd.entries.map((r) => ({ ifd: r.ifd, tag: r.tag, type: r.type, count: r.count, value: decode(view, little, r) })));
}
