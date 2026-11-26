import { describe, expect, it } from 'vitest';
import { CodecError, decodeJpeg, encodeJpeg, readMetadata, readUltraHdr, writeMetadata, writeUltraHdr, type GainMapMetadata } from './index';
import { encodeIsoGainMap, parseIsoGainMap } from './gainmap';

// Ultra HDR / ISO 21496-1 (#182): an SDR JPEG as the primary image, a gain map JPEG appended and
// pointed at by an MPF index, the gain map's parameters in XMP (hdrgm) and in the ISO 21496-1 binary
// block. The byte layout of the ISO block follows libultrahdr's writer (Apache-2.0); the container is
// also read back by Pillow (MPO) and exiftool in the checks done by hand when this was written.

const meta: GainMapMetadata = {
  gainMapMin: [0, 0, 0],
  gainMapMax: [2.5, 2.5, 2.5],
  gamma: [1, 1, 1],
  baseOffset: [0.015625, 0.015625, 0.015625],
  alternateOffset: [0.015625, 0.015625, 0.015625],
  baseHdrHeadroom: 0,
  alternateHdrHeadroom: 2.5,
};

const grey = (w: number, h: number, f: (x: number, y: number) => number) => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([f(x, y), f(x, y), f(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
};
const colour = (w: number, h: number) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([(i * 7) & 255, (i * 3) & 255, 200 - (i & 63), 255], i * 4);
  return { width: w, height: h, data };
};
const primary = () => encodeJpeg(colour(40, 30), { quality: 0.9 });
const map = () => encodeJpeg(grey(10, 8, (x, y) => (x * 20 + y * 5) & 255), { quality: 0.95, grey: true });

describe('the ISO 21496-1 block', () => {
  it('is written as libultrahdr writes it: versions, flags, headroom fractions, then each channel as fractions', () => {
    const bytes = encodeIsoGainMap(meta);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([dv.getUint16(0), dv.getUint16(2), bytes[4]]).toEqual([0, 0, 0x40]); // min / writer version 0, "use base colour space", one channel
    // 1 + 4 + 1 + 4 + ... : headroom pairs (base, alternate), then min, max, gamma, base offset, alternate offset
    expect(bytes.length).toBe(2 + 2 + 1 + 4 * 4 + 10 * 4);
    const frac = (at: number) => dv.getInt32(at) / dv.getUint32(at + 4);
    expect([frac(5), frac(13)].map((v) => +v.toFixed(6))).toEqual([0, 2.5]);
    expect([21, 29, 37, 45, 53].map(frac).map((v) => +v.toFixed(6))).toEqual([0, 2.5, 1, 0.015625, 0.015625]);
  });

  it('round-trips, with three channels when they differ', () => {
    expect(parseIsoGainMap(encodeIsoGainMap(meta))).toEqual(meta);
    const rgb: GainMapMetadata = { ...meta, gainMapMin: [-1, 0, 0.5], gainMapMax: [1, 2, 3.25], gamma: [1, 1.5, 0.75], baseOffset: [0, 0.01, 0.02], alternateOffset: [0.03, 0.04, 0] };
    const bytes = encodeIsoGainMap(rgb);
    expect(bytes[4]! & 0x80).toBe(0x80);
    const back = parseIsoGainMap(bytes);
    for (const key of ['gainMapMin', 'gainMapMax', 'gamma', 'baseOffset', 'alternateOffset'] as const) back[key].forEach((v, i) => expect(v).toBeCloseTo(rgb[key][i]!, 5));
  });

  it('refuses what is not version 0, backward direction, a zero denominator or a truncated block', () => {
    const good = encodeIsoGainMap(meta);
    expect(() => parseIsoGainMap(Uint8Array.from(good, (v, i) => (i === 1 ? 1 : v)))).toThrow(/version/);
    expect(() => parseIsoGainMap(Uint8Array.from(good, (v, i) => (i === 4 ? v | 4 : v)))).toThrow(/direction/);
    expect(() => parseIsoGainMap(Uint8Array.from(good, (v, i) => (i >= 9 && i < 13 ? 0 : v)))).toThrow(/denominator/);
    expect(() => parseIsoGainMap(good.subarray(0, 30))).toThrow(CodecError);
    expect(() => parseIsoGainMap(Uint8Array.from(good, (v, i) => (i >= 21 && i < 25 ? (i === 24 ? 5 : 0) : i >= 29 && i < 33 ? (i === 32 ? 1 : 0) : v)))).toThrow(/maximum/);
  });
});

describe('writeUltraHdr and readUltraHdr', () => {
  const file = () => writeUltraHdr({ primary: primary(), gainMap: map(), metadata: meta });

  it('writes a JPEG that every decoder reads as the SDR picture', async () => {
    const out = file();
    const direct = await decodeJpeg(primary());
    const read = await decodeJpeg(out);
    expect([read.width, read.height]).toEqual([40, 30]);
    expect(Array.from(read.data as Uint8Array)).toEqual(Array.from((direct as { data: Uint8Array }).data));
    const sharp = (await import('sharp')).default;
    const info = await sharp(out).metadata();
    expect([info.width, info.height]).toEqual([40, 30]);
  });

  it('reads back the two images and the metadata', async () => {
    const got = readUltraHdr(file())!;
    expect(got).toBeDefined();
    expect(got.metadata).toEqual(meta);
    expect(Array.from((await decodeJpeg(got.primary)).data as Uint8Array)).toEqual(Array.from((await decodeJpeg(primary())).data as Uint8Array));
    const g = await decodeJpeg(got.gainMap);
    expect([g.width, g.height]).toEqual([10, 8]);
    expect(Array.from(g.data as Uint8Array)).toEqual(Array.from((await decodeJpeg(map())).data as Uint8Array));
  });

  it('puts an MPF index with the two images, offsets that start at an SOI and a primary size that ends at the gain map', () => {
    const out = file();
    const parts = readUltraHdr(out)!;
    expect(out.length).toBe(parts.primary.length + parts.gainMap.length);
    expect([parts.primary[0], parts.primary[1], parts.gainMap[0], parts.gainMap[1]]).toEqual([0xff, 0xd8, 0xff, 0xd8]);
    // The MPF APP2 segment comes before the first non-APP segment of the primary image.
    const text = new TextDecoder('latin1').decode(out.subarray(0, 2500));
    expect(text).toContain('MPF\0');
    expect(text).toContain('urn:iso:std:iso:ts:21496:-1\0');
    expect(text).toContain('http://ns.google.com/photos/1.0/container/');
    expect(text).toContain(`Item:Length="${parts.gainMap.length}"`);
  });

  it('keeps the primary image\'s own metadata (EXIF, ICC, the rullino edit in XMP) and adds the container to the same XMP packet', async () => {
    const withMeta = (await writeMetadata(primary(), { icc: Uint8Array.of(1, 2, 3, 4), xmp: '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" dc:format="image/jpeg"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>' })).bytes;
    const out = writeUltraHdr({ primary: withMeta, gainMap: map(), metadata: meta });
    const m = await readMetadata(out);
    expect(Array.from(m.icc!)).toEqual([1, 2, 3, 4]);
    expect(m.xmp).toContain('dc:format="image/jpeg"');
    expect(m.xmp).toContain('Container:Directory');
    expect(m.xmp).toContain('hdrgm:Version="1.0"');
    expect((m.xmp!.match(/<rdf:RDF/g) ?? []).length).toBe(1);
    expect(readUltraHdr(out)!.metadata).toEqual(meta);
  });

  it('is not Ultra HDR when there is no gain map, and refuses a truncated or broken one', () => {
    expect(readUltraHdr(primary())).toBeUndefined();
    expect(readUltraHdr(new TextEncoder().encode('not a jpeg'))).toBeUndefined();
    const out = file();
    expect(() => readUltraHdr(out.subarray(0, out.length - 30))).toThrow(CodecError);
  });

  it('refuses inputs that are not JPEGs', () => {
    expect(() => writeUltraHdr({ primary: new Uint8Array(10), gainMap: map(), metadata: meta })).toThrow(CodecError);
    expect(() => writeUltraHdr({ primary: primary(), gainMap: new Uint8Array(10), metadata: meta })).toThrow(CodecError);
  });
});
