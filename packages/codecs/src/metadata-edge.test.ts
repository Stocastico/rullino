import { describe, expect, it } from 'vitest';
import { CodecError, editExif, editXmp, encodeJpeg, readExif, readIptc, readMetadata, readXmpEdit, writeIptc, writeMetadata } from './index';
import { iptcFromIrb, irbFromIptc } from './iptc';
import { png, zlib, ihdr } from './test-utils';
import { parseXmp } from './xmp';

// The edges of the metadata code: field types, broken structures, the container variants other
// writers produce (raw profiles, compressed XMP, fill bytes, prefixes), and the XML forms XMP allows.

/** A little-endian EXIF blob: IFD0 with the given entries (tag, type, count, 4-byte value or out-of-line data). */
function exif(entries: [number, number, number, number[] | Uint8Array][], next = 0): Uint8Array {
  const ifd = 8;
  const dataAt = ifd + 2 + 12 * entries.length + 4;
  const data: number[] = [];
  const out: number[] = [0x49, 0x49, 42, 0, 8, 0, 0, 0, entries.length & 255, entries.length >> 8];
  for (const [tag, type, count, value] of entries) {
    out.push(tag & 255, tag >> 8, type & 255, type >> 8, count & 255, (count >> 8) & 255, (count >> 16) & 255, count >>> 24);
    const bytes = Array.from(value);
    if (bytes.length <= 4) out.push(...bytes, ...new Array(4 - bytes.length).fill(0));
    else {
      const at = dataAt + data.length;
      out.push(at & 255, (at >> 8) & 255, (at >> 16) & 255, at >>> 24);
      data.push(...bytes, ...(bytes.length & 1 ? [0] : []));
    }
  }
  out.push(next & 255, (next >> 8) & 255, (next >> 16) & 255, next >>> 24);
  return Uint8Array.from([...out, ...data]);
}
const le = (v: number, n: number) => Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 255);

describe('readExif field types and broken structures', () => {
  it('decodes every numeric type, and skips entries of an unknown type', () => {
    const f32 = new Uint8Array(new Float32Array([1.5]).buffer);
    const f64 = new Uint8Array(new Float64Array([-2.25]).buffer);
    const e = readExif(
      exif([
        [1, 6, 1, [0xff]], // SBYTE -1
        [2, 8, 1, le(0xfffe, 2)], // SSHORT -2
        [3, 9, 1, le(0xfffffffd, 4)], // SLONG -3
        [4, 10, 1, [...le(0xfffffffc, 4), ...le(2, 4)]], // SRATIONAL -4/2
        [5, 11, 1, f32],
        [6, 12, 1, f64],
        [7, 1, 2, [7, 8]], // BYTE ×2
        [8, 99, 1, [1, 2, 3, 4]], // unknown type
        [9, 7, 3, [1, 2, 3]], // UNDEFINED
      ]),
    );
    expect(e.map((x) => [x.tag, x.value])).toEqual([[1, -1], [2, -2], [3, -3], [4, -2], [5, 1.5], [6, -2.25], [7, [7, 8]], [9, Uint8Array.from([1, 2, 3])]]);
  });

  it('refuses a broken structure with a CodecError', () => {
    expect(() => readExif(new Uint8Array(4))).toThrow(/too short/);
    expect(() => readExif(Uint8Array.from([0x41, 0x41, 42, 0, 8, 0, 0, 0]))).toThrow(/byte order/);
    expect(() => readExif(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0]))).toThrow(/magic/);
    expect(() => readExif(Uint8Array.from([0x49, 0x49, 42, 0, 200, 0, 0, 0]))).toThrow(CodecError);
    expect(() => readExif(exif([[1, 2, 40, new Uint8Array(4)]]).subarray(0, 30))).toThrow(CodecError);
    // IFD0 whose next pointer leads back to itself.
    expect(() => readExif(exif([[1, 3, 1, [1, 0]]], 8))).toThrow(/offset/);
  });

  it('editExif: a LONG value is set, a field with several values is left alone, strips of a thumbnail are zeroed', () => {
    const blob = exif([
      [0x0112, 3, 2, [6, 0, 6, 0]], // Orientation with two values: not touched
      [0x8769, 4, 1, le(0, 4)], // patched below to point at the Exif IFD
    ]);
    // An Exif IFD with LONG pixel dimensions, and IFD1 with strips (an uncompressed thumbnail).
    const exifIfdAt = blob.length;
    const exifIfd = [2, 0, ...[0x02, 0xa0, 4, 0, 1, 0, 0, 0, ...le(10, 4)], ...[0x03, 0xa0, 4, 0, 1, 0, 0, 0, ...le(20, 4)], 0, 0, 0, 0];
    const ifd1At = exifIfdAt + exifIfd.length;
    const stripAt = ifd1At + 2 + 24 + 4;
    const ifd1 = [2, 0, ...[0x11, 0x01, 4, 0, 1, 0, 0, 0, ...le(stripAt, 4)], ...[0x17, 0x01, 4, 0, 1, 0, 0, 0, ...le(6, 4)], 0, 0, 0, 0, 9, 9, 9, 9, 9, 9];
    const full = Uint8Array.from([...blob, ...exifIfd, ...ifd1]);
    new DataView(full.buffer).setUint32(8 + 2 + 12 + 8, exifIfdAt, true);
    new DataView(full.buffer).setUint32(8 + 2 + 24, ifd1At, true);
    const out = editExif(full, { orientation: 1, size: { width: 300, height: 200 }, dropThumbnail: true });
    const e = readExif(out);
    expect(e.find((x) => x.tag === 0x0112)!.value).toEqual([6, 6]);
    expect([e.find((x) => x.tag === 0xa002)!.value, e.find((x) => x.tag === 0xa003)!.value]).toEqual([300, 200]);
    expect(Array.from(out.subarray(stripAt, stripAt + 6))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('IPTC', () => {
  it('extended lengths, padding, and refusals', () => {
    const long = new Uint8Array(40_000).fill(65);
    const data = writeIptc([{ record: 2, dataset: 120, data: long }, { record: 2, dataset: 5, data: Uint8Array.of(66) }]);
    const back = readIptc(Uint8Array.from([...data, 0, 0, 0]));
    expect(back.map((d) => [d.dataset, d.data.length])).toEqual([[120, 40_000], [5, 1]]);
    expect(() => readIptc(Uint8Array.of(7, 7))).toThrow(/marker/);
    expect(() => readIptc(Uint8Array.of(0x1c, 2))).toThrow(/truncated/);
    expect(() => readIptc(Uint8Array.of(0x1c, 2, 5, 0x80, 9, 1))).toThrow(/extended/);
    expect(() => readIptc(Uint8Array.of(0x1c, 2, 5, 0, 9, 1))).toThrow(/past the end/);
  });

  it('Photoshop resource blocks: named resources, other resources first, broken blocks', () => {
    const iptc = writeIptc([{ record: 2, dataset: 80, data: new TextEncoder().encode('Me') }]);
    expect(Array.from(iptcFromIrb(irbFromIptc(iptc))!)).toEqual(Array.from(iptc));
    // A resource 0x03ed named "ab" (length byte + 2 = 3 bytes, padded to 4), 3 bytes of data padded to 4, then the IPTC one.
    const other = [0x38, 0x42, 0x49, 0x4d, 0x03, 0xed, 2, 0x61, 0x62, 0, 0, 0, 0, 3, 1, 2, 3, 0];
    expect(Array.from(iptcFromIrb(Uint8Array.from([...other, ...irbFromIptc(iptc)]))!)).toEqual(Array.from(iptc));
    expect(iptcFromIrb(Uint8Array.from(other))).toBeUndefined();
    expect(iptcFromIrb(new TextEncoder().encode('not a resource block'))).toBeUndefined();
    expect(iptcFromIrb(Uint8Array.from([0x38, 0x42, 0x49, 0x4d, 4, 4, 0, 0, 0, 0, 0, 99, 1]))).toBeUndefined();
  });
});

describe('containers other writers produce', () => {
  it('PNG: ImageMagick raw profiles (exif, icc, xmp), compressed iTXt XMP, and blocks that do not inflate', async () => {
    const tiny = exif([[0x0112, 3, 1, [1, 0]]]);
    const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
    const raw = (name: string, b: Uint8Array) => new TextEncoder().encode(`\n${name} profile\n${String(b.length).padStart(8)}\n${hex(b)}\n`);
    const icc = Uint8Array.from({ length: 40 }, (_, i) => i);
    const file = png([
      ['IHDR', ihdr(1, 1, 8, 0)],
      ['tEXt', [...new TextEncoder().encode('Raw profile type exif\0'), ...raw('exif', Uint8Array.from([...new TextEncoder().encode('Exif\0\0'), ...tiny]))]],
      ['zTXt', [...new TextEncoder().encode('Raw profile type icc\0\0'), ...(await zlib(raw('icc', icc)))]],
      ['iTXt', [...new TextEncoder().encode('XML:com.adobe.xmp\0\x01\0\0\0'), ...(await zlib(new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')))]],
      ['zTXt', [...new TextEncoder().encode('Broken\0\0'), 1, 2, 3]],
      ['iTXt', [...new TextEncoder().encode('Comment\0\x01\0\0\0'), 9, 9]],
      ['iTXt', [...new TextEncoder().encode('Bad\0\0\0')]], // no language / translated keyword terminators
      ['IDAT', await zlib([0, 0])],
      ['IEND', []],
    ]);
    const meta = await readMetadata(file);
    expect(Array.from(meta.exif!)).toEqual(Array.from(tiny));
    expect(Array.from(meta.icc!)).toEqual(Array.from(icc));
    expect(meta.xmp).toBe('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>');
    expect(meta.text).toBeUndefined();
  });

  it('JPEG: fill bytes between segments; WebP: an EXIF chunk with an "Exif" prefix', async () => {
    const jpeg = encodeJpeg({ width: 2, height: 2, data: new Uint8Array(16) });
    const { bytes } = await writeMetadata(jpeg, { exif: exif([[0x0112, 3, 1, [3, 0]]]) });
    const filled = Uint8Array.from([...bytes.subarray(0, 2), 0xff, 0xff, ...bytes.subarray(2)]);
    expect(readExif((await readMetadata(filled)).exif!)[0]!.value).toBe(3);
    const riff = (chunks: [string, number[]][]) => {
      const body = chunks.flatMap(([t, d]) => [...new TextEncoder().encode(t), ...le(d.length, 4), ...d, ...(d.length & 1 ? [0] : [])]);
      return Uint8Array.from([...new TextEncoder().encode('RIFF'), ...le(body.length + 4, 4), ...new TextEncoder().encode('WEBP'), ...body]);
    };
    const tiny = Array.from(exif([[0x0112, 3, 1, [8, 0]]]));
    const webp = riff([['VP8L', [0x2f, 0, 0, 0, 0]], ['EXIF', [...new TextEncoder().encode('Exif\0\0'), ...tiny]]]);
    expect(readExif((await readMetadata(webp)).exif!)[0]!.value).toBe(8);
    await expect(writeMetadata(riff([['ALPH', [1, 2]]]), {})).rejects.toThrow(/no image chunk/);
    await expect(writeMetadata(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), {})).rejects.toThrow(/truncated/);
  });

  it('PNG text: a keyword PNG does not allow is skipped; Latin-1 goes in tEXt, the rest in iTXt', async () => {
    const plain = png([['IHDR', ihdr(1, 1, 8, 0)], ['IDAT', await zlib([0, 0])], ['IEND', []]]);
    const { bytes } = await writeMetadata(plain, { text: [{ keyword: ' bad keyword\n', text: 'x' }, { keyword: 'Title', text: 'Café' }, { keyword: 'Note', text: '東京' }] });
    expect((await readMetadata(bytes)).text).toEqual([{ keyword: 'Title', text: 'Café' }, { keyword: 'Note', text: '東京' }]);
  });
});

describe('XMP forms', () => {
  const wrap = (body: string, ns = '') => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""${ns}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`;

  it('comments, CDATA, single quotes, the default namespace and numeric entities', () => {
    const x = wrap(`<!-- note --><foo:a><![CDATA[<raw>]]></foo:a><GPSLatitude xmlns="http://ns.adobe.com/exif/1.0/">1N</GPSLatitude><foo:b q='&#65;&#x42;'/>`, " xmlns:foo='urn:foo'");
    expect(() => parseXmp(x)).not.toThrow();
    const out = editXmp(x, { remove: { gps: true } });
    expect(out).not.toContain('1N');
    expect(out).toContain('<![CDATA[<raw>]]>');
    expect(parseXmp(x)[0]!.children[0]!.children[0]!.children.at(-1)!.attrs[0]!.value).toBe('AB');
  });

  it('refuses malformed markup', () => {
    for (const bad of ['<a', '<a><?pi', '<a><!-- no end', '<a><![CDATA[ no end', '<a></b>', '<a b=1/>', '<a b="1/>', '<a b/>', '<p:a/>', '<a></a junk>', '<a></a', '<a>', '<1a/>', '<a b="1"c="2"/>'])
      expect(() => parseXmp(bad), bad).toThrow(CodecError);
    expect(() => editXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>', { edit: '{}' })).toThrow(/rdf:RDF/);
    expect(editXmp(undefined, {})).toBe('');
    expect(readXmpEdit(wrap('<foo:x/>', ' xmlns:foo="urn:foo"'))).toBeUndefined();
  });
});
