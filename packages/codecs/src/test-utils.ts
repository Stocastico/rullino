// PNG building blocks for the codec tests (not part of the package).
import { crc32 } from './png';

const be32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** A PNG file from chunks, CRCs computed. */
export function png(chunks: readonly (readonly [string, ArrayLike<number>])[]): Uint8Array {
  const parts: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  for (const [type, data] of chunks) {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(Array.from(data));
    parts.push(...be32(data.length), ...body, ...be32(crc32(Uint8Array.from(body))));
  }
  return Uint8Array.from(parts);
}

/** IHDR data: size, bit depth, colour type, interlace. */
export const ihdr = (w: number, h: number, depth: number, colour: number, interlace = 0) => [...be32(w), ...be32(h), depth, colour, 0, 0, interlace];

const pipe = async (bytes: ArrayLike<number>, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(stream)).arrayBuffer());
export const zlib = (bytes: ArrayLike<number>) => pipe(bytes, new CompressionStream('deflate'));
export const unzlib = (bytes: ArrayLike<number>) => pipe(bytes, new DecompressionStream('deflate'));

/** The chunks of a well-formed PNG, in order. */
export function chunks(b: Uint8Array): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (let at = 8; at + 12 <= b.length; ) {
    const length = ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
    out.push([String.fromCharCode(...b.subarray(at + 4, at + 8)), b.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  return out;
}

/** A little-endian TIFF with one image: `tags` (tag → SHORT or LONG values; arrays of numbers) and its chunks, whose offsets and byte counts are filled in. */
export function tiff(tags: Record<number, number[]>, chunks: Uint8Array[], { tiled = false } = {}): Uint8Array {
  const all = { ...tags, [tiled ? 324 : 273]: chunks.map(() => 0), [tiled ? 325 : 279]: chunks.map((c) => c.length) };
  const ids = Object.keys(all).map(Number).sort((a, b) => a - b);
  const ifdSize = 2 + 12 * ids.length + 4;
  let at = 8 + ifdSize;
  const extra: number[] = [];
  const entries: number[][] = [];
  const dataStart = () => 8 + ifdSize + extra.length;
  const offsetsTag = tiled ? 324 : 273;
  // Values longer than 4 bytes go after the IFD, then the chunks.
  const values = new Map<number, number>();
  for (const id of ids) {
    const v = all[id]!;
    const long = id === offsetsTag || id === (tiled ? 325 : 279) || v.some((x) => x > 65535);
    const size = (long ? 4 : 2) * v.length;
    if (size > 4) {
      values.set(id, dataStart());
      for (const x of v) extra.push(...(long ? [x & 255, (x >> 8) & 255, (x >> 16) & 255, x >>> 24] : [x & 255, x >> 8]));
    }
    entries.push([id, long ? 4 : 3, v.length]);
  }
  at = dataStart();
  const chunkOffsets = chunks.map((c) => {
    const o = at;
    at += c.length;
    return o;
  });
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  dv.setUint16(8, ids.length, true);
  ids.forEach((id, i) => {
    const e = 10 + 12 * i;
    const [, type, count] = entries[i]!;
    const v = id === offsetsTag ? chunkOffsets : all[id]!;
    dv.setUint16(e, id, true);
    dv.setUint16(e + 2, type!, true);
    dv.setUint32(e + 4, count!, true);
    const size = (type === 4 ? 4 : 2) * count!;
    if (size <= 4) v.forEach((x, j) => (type === 4 ? dv.setUint32(e + 8 + 4 * j, x, true) : dv.setUint16(e + 8 + 2 * j, x, true)));
    else dv.setUint32(e + 8, values.get(id)!, true);
  });
  out.set(extra, 8 + ifdSize);
  // Fix the offsets array written after the IFD.
  if (values.has(offsetsTag)) chunkOffsets.forEach((o, j) => dv.setUint32(values.get(offsetsTag)! + 4 * j, o, true));
  let o = 8 + ifdSize + extra.length;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
