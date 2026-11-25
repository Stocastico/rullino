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
