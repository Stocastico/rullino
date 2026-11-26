import { describe, expect, it } from 'vitest';
import { CodecError, decodeJpeg, encodeJpeg, readMetadata, readUltraHdr, writeMetadata, writeUltraHdr, type GainMapMetadata } from './index';
import { encodeIsoGainMap, parseIsoGainMap, parseXmpGainMap } from './gainmap';

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

describe('the metadata in the XMP, when there is no ISO block', () => {
  const header = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">';
  const footer = '</rdf:RDF></x:xmpmeta>';
  const NS = 'xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"';

  it('reads the attributes, with the specification\'s defaults for what is missing', () => {
    const m = parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:Version="1.0" hdrgm:GainMapMax="3" hdrgm:HDRCapacityMax="3"/>${footer}`)!;
    expect(m.gainMapMax).toEqual([3, 3, 3]);
    expect(m.gainMapMin).toEqual([0, 0, 0]);
    expect(m.gamma).toEqual([1, 1, 1]);
    expect(m.baseOffset).toEqual([1 / 64, 1 / 64, 1 / 64]);
    expect(m.alternateHdrHeadroom).toBe(3);
    expect(parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:GainMapMax="2.5"/>${footer}`)!.alternateHdrHeadroom).toBe(2.5); // defaults to the largest gain
  });

  it('reads sequences of three numbers, per channel', () => {
    const seq = (name: string, v: number[]) => `<hdrgm:${name}><rdf:Seq>${v.map((x) => `<rdf:li>${x}</rdf:li>`).join('')}</rdf:Seq></hdrgm:${name}>`;
    const m = parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:Version="1.0">${seq('GainMapMin', [0, -1, 0.5])}${seq('GainMapMax', [1, 2, 3])}${seq('Gamma', [1, 1.5, 2])}</rdf:Description>${footer}`)!;
    expect(m.gainMapMin).toEqual([0, -1, 0.5]);
    expect(m.gainMapMax).toEqual([1, 2, 3]);
    expect(m.gamma).toEqual([1, 1.5, 2]);
  });

  it('is not a gain map without a maximum, and refuses nonsense and an HDR base image', () => {
    expect(parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:Version="1.0"/>${footer}`)).toBeUndefined();
    expect(parseXmpGainMap('not xml at all')).toBeUndefined();
    expect(() => parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:GainMapMax="abc"/>${footer}`)).toThrow(CodecError);
    expect(() => parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:GainMapMin="2" hdrgm:GainMapMax="1"/>${footer}`)).toThrow(/invalid/);
    expect(() => parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:GainMapMax="1" hdrgm:Gamma="0"/>${footer}`)).toThrow(/invalid/);
    expect(() => parseXmpGainMap(`${header}<rdf:Description ${NS} hdrgm:GainMapMax="1" hdrgm:BaseRenditionIsHDR="True"/>${footer}`)).toThrow(/direction/);
  });
});

describe('where the gain map is found', () => {
  /** The file with segments removed from its primary image (`pick` says which). */
  const without = (bytes: Uint8Array, pick: (marker: number, body: string) => boolean) => {
    const out: number[] = [0xff, 0xd8];
    let i = 2;
    for (; bytes[i] === 0xff && bytes[i + 1] !== 0xda; ) {
      const end = i + 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
      const body = new TextDecoder('latin1').decode(bytes.subarray(i + 4, i + 20));
      if (!pick(bytes[i + 1]!, body)) out.push(...bytes.subarray(i, end));
      i = end;
    }
    return Uint8Array.from([...out, ...bytes.subarray(i)]);
  };
  const file = () => writeUltraHdr({ primary: primary(), gainMap: map(), metadata: meta });

  it('by the Container directory\'s length when the file has no MPF index (the offsets were never needed)', () => {
    const noMpf = without(file(), (m, b) => m === 0xe2 && b.startsWith('MPF'));
    const got = readUltraHdr(noMpf)!;
    expect(got.metadata).toEqual(meta);
    expect(got.gainMap.length).toBe(readUltraHdr(file())!.gainMap.length);
  });

  /** `bytes` with the first occurrence of `from` (after `after`) overwritten by `to` (same length). */
  const patched = (bytes: Uint8Array, from: string, to: string, after = 0) => {
    const at = new TextDecoder('latin1').decode(bytes).indexOf(from, after);
    expect(at).toBeGreaterThan(-1);
    const out = bytes.slice();
    out.set(Array.from(to, (c) => c.charCodeAt(0)), at);
    return out;
  };

  it('from the gain map\'s XMP when its ISO block is not there', () => {
    const f = file();
    const second = new TextDecoder('latin1').decode(f).lastIndexOf('\xff\xd8\xff');
    const noIso = patched(f, 'urn:iso:std', 'urn:xxx:std', second);
    const got = readUltraHdr(noIso)!;
    expect(got.metadata.gainMapMax[0]).toBeCloseTo(2.5, 5);
    expect(got.metadata.alternateHdrHeadroom).toBeCloseTo(2.5, 5);
  });

  it('is not Ultra HDR when the second picture carries no gain map metadata', () => {
    const f = file();
    const second = new TextDecoder('latin1').decode(f).lastIndexOf('\xff\xd8\xff');
    const none = patched(patched(f, 'urn:iso:std', 'urn:xxx:std', second), 'hdrgm:GainMapMax', 'hdrgm:GainMapMxx', second);
    expect(readUltraHdr(none)).toBeUndefined();
  });

  it('refuses an index that points outside the file', () => {
    const f = file();
    const bad = f.slice();
    const at = new TextDecoder('latin1').decode(bad).indexOf('MPF\0') + 4;
    new DataView(bad.buffer).setUint32(at + 8 + 2 + 3 * 12 + 4 + 16 + 8, 0x7fffffff);
    expect(() => readUltraHdr(bad)).toThrow(CodecError);
  });

  it('reads an MPF index written little endian as well', () => {
    const f = file();
    const text = new TextDecoder('latin1').decode(f);
    const at = text.indexOf('MPF\0') + 4;
    // Rewrite the index in little endian: the same entries, bytes reversed in every field.
    const le = f.slice();
    const be = new DataView(f.buffer, f.byteOffset);
    const w = new DataView(le.buffer);
    le.set([0x49, 0x49, 0x2a, 0x00], at);
    w.setUint32(at + 4, be.getUint32(at + 4), true);
    w.setUint16(at + 8, be.getUint16(at + 8), true);
    for (let k = 0; k < 3; k++) {
      const e = at + 10 + 12 * k;
      w.setUint16(e, be.getUint16(e), true);
      w.setUint16(e + 2, be.getUint16(e + 2), true);
      w.setUint32(e + 4, be.getUint32(e + 4), true);
      if (k !== 0) w.setUint32(e + 8, be.getUint32(e + 8), true);
    }
    const entries = at + 8 + 2 + 3 * 12 + 4;
    for (let k = 0; k < 2; k++) for (const o of [0, 4, 8]) w.setUint32(entries + 16 * k + o, be.getUint32(entries + 16 * k + o), true);
    expect(readUltraHdr(le)!.metadata).toEqual(meta);
  });
});

describe('readUltraHdr on damaged files', () => {
  it('every byte of the container, set to 0, 255 or one more, gives a gain map, no gain map or a CodecError: never another error', () => {
    const f = writeUltraHdr({ primary: primary(), gainMap: map(), metadata: meta });
    const head = new TextDecoder('latin1').decode(f).indexOf('MPF\0') + 120;
    for (let i = 0; i < Math.min(f.length, head + 200); i++)
      for (const v of [0, 255, (f[i]! + 1) & 255]) {
        const g = f.slice();
        g[i] = v;
        try {
          readUltraHdr(g);
        } catch (e) {
          expect(e, `byte ${i} = ${v}`).toBeInstanceOf(CodecError);
        }
      }
  });

  it('a file of any other kind is no Ultra HDR file', () => {
    expect(readUltraHdr(new Uint8Array(0))).toBeUndefined();
    expect(readUltraHdr(Uint8Array.of(0xff, 0xd8, 0xff))).toBeUndefined();
    expect(readUltraHdr(Uint8Array.of(0xff, 0xd8, 0x12, 0x34, 0x56, 0x78))).toBeUndefined();
  });
});

describe('the ISO block, the remaining cases', () => {
  it('reads a common denominator, and refuses a zero one', () => {
    const be = (v: number) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
    // version 0 / 0, flags: common denominator (8), denominator 4, then headrooms and one channel as numerators
    const block = Uint8Array.from([0, 0, 0, 0, 0x08, ...be(4), ...be(0), ...be(10), ...be(0), ...be(8), ...be(4), ...be(0), ...be(0)]);
    // layout after the denominator: base, alternate, then min, max, gamma, base offset, alternate offset
    const m = parseIsoGainMap(Uint8Array.from([0, 0, 0, 0, 0x08, ...be(4), ...be(0), ...be(10), ...be(0), ...be(8), ...be(4), ...be(0), ...be(0)]));
    expect(m.alternateHdrHeadroom).toBe(2.5);
    expect(m.gainMapMax[0]).toBe(2);
    expect(m.gamma[0]).toBe(1);
    expect(() => parseIsoGainMap(Uint8Array.from([0, 0, 0, 0, 0x08, ...be(0), ...block.subarray(9)]))).toThrow(/common denominator/);
    expect(() => parseIsoGainMap(Uint8Array.from([0, 0, 0, 0, 0x08]))).toThrow(CodecError);
  });

  it('refuses a gamma that is zero, and a field too large to write', () => {
    const good = encodeIsoGainMap(meta);
    // gamma's numerator (one channel: after the two headroom pairs, min and max) is at 5 + 16 + 16
    const zeroGamma = good.slice();
    new DataView(zeroGamma.buffer).setUint32(5 + 16 + 16, 0);
    expect(() => parseIsoGainMap(zeroGamma)).toThrow(/gamma/);
    expect(() => encodeIsoGainMap({ ...meta, gainMapMax: [5000, 5000, 5000] })).toThrow(/does not fit/);
    expect(() => encodeIsoGainMap({ ...meta, alternateHdrHeadroom: -1 })).toThrow(/does not fit/);
  });
});

describe('writeUltraHdr, the remaining cases', () => {
  it('takes a primary that is only a header, and refuses a metadata block that does not fit a JPEG segment', async () => {
    const bare = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
    expect(writeUltraHdr({ primary: bare, gainMap: map(), metadata: meta }).length).toBeGreaterThan(bare.length);
    // An XMP packet nearly as large as a segment can be: adding the container directory no longer fits.
    const pad = ' '.repeat(64000);
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${pad}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const big = (await writeMetadata(primary(), { xmp: xmp + ' '.repeat(65500 - 29 - xmp.length - 500) })).bytes;
    expect(() => writeUltraHdr({ primary: big, gainMap: map(), metadata: meta })).toThrow(/too large/);
  });

  it('reads a file whose MPF lists one picture only by the Container directory, and takes a cut index for no Ultra HDR file', () => {
    const f = writeUltraHdr({ primary: primary(), gainMap: map(), metadata: meta });
    const at = new TextDecoder('latin1').decode(f).indexOf('MPF\0') + 4;
    const one = f.slice();
    new DataView(one.buffer).setUint32(at + 38, 16); // the MPEntry table: 16 bytes, one entry
    expect(readUltraHdr(one)?.metadata).toEqual(meta);
    expect(readUltraHdr(f.slice(0, at + 6))).toBeUndefined();
  });
});
