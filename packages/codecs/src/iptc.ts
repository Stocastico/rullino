// IPTC-IIM (#180): datasets of a record number, a dataset number and bytes. In files they travel inside
// a Photoshop image resource block (8BIM 0x0404: JPEG's APP13, PNG's "Raw profile type iptc") or bare
// (TIFF's tag 33723). `ImageMetadata.iptc` holds the bare datasets.

import { CodecError } from './types';

const fail = (message: string): never => {
  throw new CodecError('iptc', message);
};

export interface IptcDataset {
  readonly record: number;
  readonly dataset: number;
  readonly data: Uint8Array;
}

/** The datasets of bare IIM data. */
export function readIptc(iptc: Uint8Array): IptcDataset[] {
  const out: IptcDataset[] = [];
  for (let i = 0; i < iptc.length; ) {
    if (iptc[i] !== 0x1c) {
      // Padding after the last dataset is common (zeros to an even length).
      if (iptc.subarray(i).every((b) => b === 0)) break;
      fail(`no dataset marker at byte ${i}`);
    }
    if (i + 5 > iptc.length) fail('truncated dataset header');
    const record = iptc[i + 1]!;
    const dataset = iptc[i + 2]!;
    let length = (iptc[i + 3]! << 8) | iptc[i + 4]!;
    let start = i + 5;
    if (length & 0x8000) {
      // Extended length: the low 15 bits say how many bytes hold it.
      const n = length & 0x7fff;
      if (n > 4 || start + n > iptc.length) fail('bad extended dataset length');
      length = 0;
      for (let k = 0; k < n; k++) length = length * 256 + iptc[start + k]!;
      start += n;
    }
    if (start + length > iptc.length) fail('dataset runs past the end');
    out.push({ record, dataset, data: iptc.slice(start, start + length) });
    i = start + length;
  }
  return out;
}

/** Bare IIM data from datasets. */
export function writeIptc(datasets: readonly IptcDataset[]): Uint8Array {
  const parts: number[] = [];
  for (const d of datasets) {
    parts.push(0x1c, d.record, d.dataset);
    if (d.data.length < 0x8000) parts.push(d.data.length >> 8, d.data.length & 255);
    else parts.push(0x80, 4, d.data.length >>> 24, (d.data.length >> 16) & 255, (d.data.length >> 8) & 255, d.data.length & 255);
    for (const b of d.data) parts.push(b);
  }
  return Uint8Array.from(parts);
}

/** The IIM data inside a Photoshop image resource block (resource 0x0404), if there is one. */
export function iptcFromIrb(irb: Uint8Array): Uint8Array | undefined {
  for (let i = 0; i + 12 <= irb.length; ) {
    if (String.fromCharCode(irb[i]!, irb[i + 1]!, irb[i + 2]!, irb[i + 3]!) !== '8BIM') return undefined;
    const id = (irb[i + 4]! << 8) | irb[i + 5]!;
    const nameLength = irb[i + 6]!;
    let at = i + 6 + 1 + nameLength;
    if ((1 + nameLength) & 1) at++; // the Pascal name is padded to an even length
    if (at + 4 > irb.length) return undefined;
    const size = ((irb[at]! << 24) | (irb[at + 1]! << 16) | (irb[at + 2]! << 8) | irb[at + 3]!) >>> 0;
    const data = at + 4;
    if (data + size > irb.length) return undefined;
    if (id === 0x0404) return irb.slice(data, data + size);
    i = data + size + (size & 1);
  }
  return undefined;
}

/** A Photoshop image resource block holding IIM data (resource 0x0404, empty name). */
export function irbFromIptc(iptc: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + iptc.length + (iptc.length & 1));
  out.set([0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0, 0, iptc.length >>> 24, (iptc.length >> 16) & 255, (iptc.length >> 8) & 255, iptc.length & 255]);
  out.set(iptc, 12);
  return out;
}
