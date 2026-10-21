import { describe, expect, it } from 'vitest';
import { encodePng } from './png';

/** Splits a PNG into chunks, checking the signature. */
function chunks(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crc: number }[] = [];
  for (let p = 8; p < png.length; ) {
    const len = view.getUint32(p);
    out.push({ type: String.fromCharCode(...png.subarray(p + 4, p + 8)), data: png.subarray(p + 8, p + 8 + len), crc: view.getUint32(p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('encodePng', () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);

  it('writes IHDR, IDAT and IEND with valid CRCs', async () => {
    const c = chunks(await encodePng(3, 2, pixels));
    expect(c.map((x) => x.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(c[0]!.data.buffer, c[0]!.data.byteOffset, 13);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), ihdr.getUint8(8), ihdr.getUint8(9)]).toEqual([3, 2, 8, 6]); // 8-bit RGBA
    expect(c[2]!.crc).toBe(0xae426082); // the well-known CRC of an empty IEND
    expect(c[0]!.crc).toBe(crcOf('IHDR', c[0]!.data));
  });

  it('stores rows with filter 0 after a zlib stream that inflates back exactly', async () => {
    const raw = await inflate(chunks(await encodePng(3, 2, pixels)).find((x) => x.type === 'IDAT')!.data);
    expect([...raw]).toEqual([0, ...pixels.subarray(0, 12), 0, ...pixels.subarray(12)]);
  });

  it('writes 16-bit samples big-endian', async () => {
    const c = chunks(await encodePng(1, 1, new Uint16Array([0x1234, 0xffff, 0, 0xabcd])));
    expect(c[0]!.data[8]).toBe(16);
    expect([...(await inflate(c[1]!.data))]).toEqual([0, 0x12, 0x34, 0xff, 0xff, 0, 0, 0xab, 0xcd]);
  });

  it('rejects data of the wrong length', async () => {
    await expect(encodePng(2, 2, new Uint8Array(15))).rejects.toThrow(/16/);
  });
});

/** Reference CRC-32 (bitwise, no table) over type + data. */
function crcOf(type: string, data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of [...type].map((ch) => ch.charCodeAt(0)).concat([...data])) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
