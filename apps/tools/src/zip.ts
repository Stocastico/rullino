// A ZIP writer for files that are already compressed (JPEG, WebP, PNG): every entry is stored, not
// deflated, so the archive is the files plus a few headers. Names are UTF-8 (general-purpose flag
// bit 11). No ZIP64: the tools refuse archives that would pass 4 GB before writing them.

let table: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3), as ZIP and PNG use it. */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** A store-only ZIP archive of the given files, in order. Throws on duplicate names or past 4 GB. */
export function zipStore(files: readonly ZipEntry[]): Uint8Array {
  const seen = new Set<string>();
  const enc = new TextEncoder();
  const entries = files.map((f) => {
    if (seen.has(f.name)) throw new Error(`zipStore: two files are named ${f.name}`);
    seen.add(f.name);
    return { name: enc.encode(f.name), data: f.data, crc: crc32(f.data) };
  });
  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error('zipStore: the archive would be larger than 4 GB');
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const offsets: number[] = [];
  let p = 0;
  for (const e of entries) {
    offsets.push(p);
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, 20, true); // version needed
    v.setUint16(p + 6, 0x0800, true); // UTF-8 names
    v.setUint16(p + 8, 0, true); // stored
    v.setUint16(p + 10, 0, true); // time
    v.setUint16(p + 12, 0x21, true); // date: 1980-01-01
    v.setUint32(p + 14, e.crc, true);
    v.setUint32(p + 18, e.data.length, true);
    v.setUint32(p + 22, e.data.length, true);
    v.setUint16(p + 26, e.name.length, true);
    v.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30);
    out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }
  const central = p;
  entries.forEach((e, i) => {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 20, true); // made by
    v.setUint16(p + 6, 20, true); // version needed
    v.setUint16(p + 8, 0x0800, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, 0, true);
    v.setUint16(p + 14, 0x21, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.data.length, true);
    v.setUint32(p + 24, e.data.length, true);
    v.setUint16(p + 28, e.name.length, true);
    // extra, comment, disk, internal and external attributes stay 0
    v.setUint32(p + 42, offsets[i]!, true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  });
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, p - central, true);
  v.setUint32(p + 16, central, true);
  return out;
}
