// Minimal PNG encoder: RGBA, 8 or 16 bits per sample, filter 0, one IDAT. Compression is the
// platform's zlib (`CompressionStream('deflate')`, in browsers and Node), so there is no dependency.
// Unlike canvas.toBlob it is lossless for semi-transparent pixels and can write 16 bits.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encodes straight-alpha RGBA as PNG. `Uint8Array`-like data gives 8 bits per sample,
 * `Uint16Array` 16 bits. Samples are written as given (sRGB-encoded by convention).
 */
export async function encodePng(width: number, height: number, data: Uint8Array | Uint8ClampedArray | Uint16Array): Promise<Uint8Array<ArrayBuffer>> {
  if (data.length !== width * height * 4) throw new RangeError(`expected ${width * height * 4} samples for ${width}x${height} RGBA, got ${data.length}`);
  const depth = data instanceof Uint16Array ? 16 : 8;
  const rowBytes = width * 4 * (depth / 8);
  const raw = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + rowBytes); // raw[o] = 0: filter type None
    if (depth === 8) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), o + 1);
    else for (let i = 0; i < width * 4; i++) {
      const v = data[y * width * 4 + i]!;
      raw[o + 1 + 2 * i] = v >>> 8; // big-endian
      raw[o + 2 + 2 * i] = v & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([depth, 6, 0, 0, 0], 8); // colour type 6 = RGBA; deflate; adaptive filtering; no interlace
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) out.set(part, (p += part.length) - part.length);
  return out;
}
