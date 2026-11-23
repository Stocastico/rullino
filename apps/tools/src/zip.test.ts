import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

const text = (s: string) => new TextEncoder().encode(s);

/** Reads back a store-only ZIP through its central directory, the way unzip tools do. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    expect(v.getUint16(p + 10, true)).toBe(0); // stored
    expect(v.getUint16(p + 8, true) & 0x0800).toBe(0x0800); // UTF-8 names
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, data: zip.subarray(dataAt, dataAt + size), crc });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value and the empty input', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStore', () => {
  it('stores the files under their names, with their CRCs, readable through the central directory', () => {
    const files = [
      { name: 'photo-1.jpg', data: text('first file') },
      { name: 'città/notte.webp', data: new Uint8Array([0, 255, 1, 254]) },
      { name: 'empty.png', data: new Uint8Array(0) },
    ];
    const back = readZip(zipStore(files));
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    back.forEach((f, i) => {
      expect([...f.data]).toEqual([...files[i]!.data]);
      expect(f.crc).toBe(crc32(files[i]!.data));
    });
  });

  it('is a valid empty archive with no files', () => {
    expect(readZip(zipStore([]))).toEqual([]);
  });

  it('refuses two files with the same name', () => {
    expect(() => zipStore([{ name: 'a.jpg', data: new Uint8Array(1) }, { name: 'a.jpg', data: new Uint8Array(1) }])).toThrow(/a\.jpg/);
  });
});
