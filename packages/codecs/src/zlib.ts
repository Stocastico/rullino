// zlib streams through the runtime's DecompressionStream / CompressionStream (browsers, Node, Deno,
// Bun): no inflate code of our own. Inflating is bounded, so a small stream cannot make a decoder
// allocate more than the image it describes.

import { CodecError } from './types';

/**
 * Inflates zlib data: exactly `size` bytes (more is ignored, fewer is an error), or up to `limit`
 * bytes when the size is not known. Errors are CodecErrors of `format` naming `what`.
 */
export async function inflate(data: Uint8Array, format: string, what: string, size: number | { limit: number }): Promise<Uint8Array> {
  const fail = (message: string, cause?: unknown): never => {
    throw new CodecError(format, message, cause === undefined ? undefined : { cause });
  };
  const known = typeof size === 'number';
  const cap = known ? size : size.limit;
  let out = new Uint8Array(known ? size : Math.min(cap, Math.max(1024, data.length * 4)));
  let n = 0;
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!known && n + value.length > out.length) {
        if (n + value.length > cap) fail(`${what} inflates to more than ${cap} bytes`);
        const grown = new Uint8Array(Math.min(cap, Math.max(out.length * 2, n + value.length)));
        grown.set(out.subarray(0, n));
        out = grown;
      }
      const take = Math.min(value.length, out.length - n);
      out.set(value.subarray(0, take), n);
      n += take;
      if (known && n === size) {
        reader.cancel().catch(() => {});
        return out;
      }
    }
  } catch (e) {
    if (e instanceof CodecError) throw e;
    fail(`corrupt ${what} (${(e as Error).message})`, e);
  }
  if (known) fail(`truncated ${what}: ${n} of ${size} bytes`);
  return out.subarray(0, n);
}

/** Deflates `data` into a zlib stream. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}
