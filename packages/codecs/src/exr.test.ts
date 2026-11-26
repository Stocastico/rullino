import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, decode, decodeExr, detectFormat } from './index';

// Fixtures: test/hdr/, made by make-hdr-fixtures.py with imagecodecs (OpenEXR 3). The compressions
// OpenEXR writes losslessly (none, RLE, ZIPS, ZIP, PIZ) must decode to the array that was written,
// bit for bit (colour divided by alpha: EXR stores it premultiplied); PXR24 (float is lossy), B44 and
// DWA are refused by name.

const dir = fileURLToPath(new URL('../test/hdr/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
type Entry = { width: number; height: number; reference: string; format: string; compression?: number; lossless?: boolean };
const manifest: Record<string, Entry> = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
const exrs = Object.keys(manifest).filter((n) => manifest[n]!.format === 'exr');
const reference = (name: string) => {
  const b = read(manifest[name]!.reference);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};

describe('decodeExr', () => {
  it.each(exrs.filter((n) => manifest[n]!.lossless))('%s decodes to the reference, bit for bit', async (name) => {
    const m = manifest[name]!;
    const img = await decodeExr(read(name));
    expect([img.width, img.height, img.bitDepth]).toEqual([m.width, m.height, 32]);
    const got = img.data as Float32Array;
    const want = reference(name);
    const wrong = Array.from(got).findIndex((v, i) => !Object.is(v, want[i]));
    expect(wrong, `sample ${wrong}: ${got[wrong]} against ${want[wrong]}`).toBe(-1);
    expect(img.linear).toBe(true);
  });

  it.each(exrs.filter((n) => !manifest[n]!.lossless))('%s: a compression it does not read is refused by name', async (name) => {
    await expect(decodeExr(read(name))).rejects.toThrow(/compression/);
  });

  it('is found by detectFormat and decode', async () => {
    expect(detectFormat(read('one-none-half.exr'))).toBe('exr');
    expect((await decode(read('block-zip-half.exr'))).format).toBe('exr');
  });

  it('refuses what it cannot read with a CodecError, never a wrong image', async () => {
    const good = read('rgba-zip-float32.exr');
    const cases: [string, Uint8Array][] = [
      ['empty', new Uint8Array(0)],
      ['not EXR', new TextEncoder().encode('hello world, this is not an image')],
      ['bad version', Uint8Array.from(good, (v, i) => (i === 4 ? 9 : v))],
      ['tiled', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x02 : v))],
      ['deep', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x08 : v))],
      ['multipart', Uint8Array.from(good, (v, i) => (i === 5 ? v | 0x10 : v))],
      ['header only', good.subarray(0, 60)],
      ['no pixel data', good.subarray(0, good.length - 40)],
      ['truncated offset table', good.subarray(0, 600)],
    ];
    for (const [name, bytes] of cases) await expect(decodeExr(bytes), name).rejects.toThrow(CodecError);
  });

  it('checks the size against maxPixels before reading pixels', async () => {
    await expect(decodeExr(read('rgba-none-float16.exr'), { maxPixels: 100 })).rejects.toThrow(/larger than maxPixels/);
  });

  it('reads the chromaticities the file names, when it names some', async () => {
    const img = await decodeExr(read('rgba-none-float16.exr'));
    // imagecodecs writes none: absent means Rec. 709
    expect(img.primaries).toBeUndefined();
  });
});

// ---- Crafted files: the header and block checks -------------------------------------------------

const enc = new TextEncoder();
const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const cstr = (s: string) => [...enc.encode(s), 0];
const attr = (name: string, type: string, payload: number[]) => [...cstr(name), ...cstr(type), ...u32(payload.length), ...payload];
const chlist = (channels: [string, number][]) => attr('channels', 'chlist', [...channels.flatMap(([n, t]) => [...cstr(n), ...u32(t), 0, 0, 0, 0, ...u32(1), ...u32(1)]), 0]);
const f32 = (v: number) => [...new Uint8Array(Float32Array.of(v).buffer)];
interface Craft {
  channels?: [string, number][];
  compression?: number;
  window?: [number, number, number, number];
  extra?: number[];
  /** chunks: [y, data]; the offset table lists them in this order */
  blocks?: [number, number[]][];
  version?: number[];
  header?: number[];
}
/** An OpenEXR file from its parts, for the cases the writers of real files never produce. */
function craft(c: Craft = {}): Uint8Array {
  const window = c.window ?? [0, 0, 1, 1];
  const header = c.header ?? [
    ...chlist(c.channels ?? [['B', 2], ['G', 2], ['R', 2]]),
    ...attr('compression', 'compression', [c.compression ?? 0]),
    ...attr('dataWindow', 'box2i', window.flatMap(u32)),
    ...(c.extra ?? []),
    0,
  ];
  const blocks = c.blocks ?? [[0, new Array(2 * 12).fill(0)], [1, new Array(2 * 12).fill(0)]];
  const start = 8 + header.length + 8 * blocks.length;
  let at = start;
  const table = blocks.flatMap(([, d]) => {
    const o = [...u32(at), 0, 0, 0, 0];
    at += 8 + d.length;
    return o;
  });
  return Uint8Array.from([0x76, 0x2f, 0x31, 0x01, ...(c.version ?? [2, 0, 0, 0]), ...header, ...table, ...blocks.flatMap(([y, d]) => [...u32(y), ...u32(d.length), ...d])]);
}

describe('decodeExr on crafted files', () => {
  it('decodes a crafted file (so the failures below are about what they say)', async () => {
    const img = await decodeExr(craft());
    expect([img.width, img.height]).toEqual([2, 2]);
  });

  it('reads the chromaticities attribute, when it is there', async () => {
    const xy = [0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329];
    const img = await decodeExr(craft({ extra: attr('chromaticities', 'chromaticities', xy.flatMap(f32)) }));
    expect(img.primaries!.red[0]).toBeCloseTo(0.708, 6);
    expect(img.primaries!.white[1]).toBeCloseTo(0.329, 6);
    const nan = await decodeExr(craft({ extra: attr('chromaticities', 'chromaticities', [NaN, ...xy.slice(1)].flatMap(f32)) }));
    expect(nan.primaries).toBeUndefined(); // not finite: ignored
  });

  it.each<[string, Craft, RegExp]>([
    ['an attribute name that never ends', { header: [...new Array(400).fill(65), 0] }, /name too long/],
    ['a header without an end', { header: Array.from({ length: 1100 }, () => attr('a', 'int', [0, 0, 0, 0])).flat() }, /no end/],
    ['no channel list', { header: [...attr('compression', 'compression', [0]), ...attr('dataWindow', 'box2i', [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].map((v) => v)), 0] }, /no channel list/],
    ['an empty channel list', { header: [...attr('channels', 'chlist', [0]), ...attr('compression', 'compression', [0]), ...attr('dataWindow', 'box2i', new Array(16).fill(0)), 0] }, /no channel list/],
    ['no compression', { header: [...chlist([['R', 2], ['G', 2], ['B', 2]]), ...attr('dataWindow', 'box2i', new Array(16).fill(0)), 0] }, /no compression/],
    ['no data window', { header: [...chlist([['R', 2], ['G', 2], ['B', 2]]), ...attr('compression', 'compression', [0]), 0] }, /no data window/],
    ['an inverted data window', { window: [5, 5, 2, 2] }, /invalid data window/],
    ['an unknown compression', { compression: 42 }, /unknown compression/],
    ['a channel list that stops short', { header: [...attr('channels', 'chlist', [...cstr('R'), 1, 0, 0, 0]), 0] }, /truncated channel list/],
    ['an unknown pixel type', { channels: [['R', 9], ['G', 2], ['B', 2]] }, /pixel type/],
    ['subsampled channels', { header: [...attr('channels', 'chlist', [...cstr('R'), ...u32(1), 0, 0, 0, 0, ...u32(2), ...u32(2), 0]), ...attr('compression', 'compression', [0]), ...attr('dataWindow', 'box2i', new Array(16).fill(0)), 0] }, /subsampled/],
    ['only some of R, G, B', { channels: [['G', 2], ['R', 2]] }, /no R, G, B/],
    ['an attribute that runs past the file', { header: [...cstr('x'), ...cstr('int'), ...u32(9999)] }, /past the end/],
    ['a negative attribute size', { header: [...cstr('x'), ...cstr('int'), ...u32(0xfffffff0)] }, /past the end/],
    ['an offset table that stops short', { blocks: [[0, [0]], [1, [0]]], window: [0, 0, 1, 9] }, /offset|incomplete|truncated/],
    ['a block at a line that is no block start', { compression: 3, window: [0, 0, 1, 31], blocks: [[5, new Array(48).fill(0)], [16, new Array(48).fill(0)]] }, /block boundary/],
    ['the same block twice', { blocks: [[0, new Array(24).fill(0)], [0, new Array(24).fill(0)]] }, /twice/],
    ['a block larger than its pixels', { blocks: [[0, new Array(40).fill(0)], [1, new Array(24).fill(0)]] }, /larger than the pixels/],
    ['a short block in a file that is not compressed', { blocks: [[0, new Array(10).fill(0)], [1, new Array(24).fill(0)]] }, /not compressed/],
    ['an empty block', { blocks: [[0, []], [1, new Array(24).fill(0)]] }, /past the end|larger|empty|incomplete/],
    ['a version it does not know', { version: [3, 0, 0, 0] }, /version/],
  ])('%s is refused', async (_, c, message) => {
    await expect(decodeExr(craft(c))).rejects.toThrow(message);
  });

  it('an offset that points outside the file means an incomplete file', async () => {
    const bytes = craft();
    const tableAt = bytes.length - 2 * (8 + 24) - 2 * 8;
    const patched = bytes.slice();
    new DataView(patched.buffer).setUint32(tableAt, 0x7fffffff, true);
    await expect(decodeExr(patched)).rejects.toThrow(/incomplete/);
  });

  it('an offset table that runs past the file is a truncated table', async () => {
    const bytes = craft();
    const header = bytes.length - (2 * 8 + 2 * (8 + 24)) - 8; // where the table starts, minus the 8 header bytes
    await expect(decodeExr(bytes.subarray(0, header + 8 + 12))).rejects.toThrow(/truncated offset table/);
  });
});

describe('decodeExr on damaged PIZ blocks', () => {
  const file = read('wide-piz-half.exr'); // 300 × 3, RGBA half: one block, really compressed (a block that does not shrink is stored raw)
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  // One block: the offset table's single entry is just before it and holds its position.
  let chunk = -1;
  for (let i = 8; i + 8 < file.length && chunk < 0; i++) if (view.getUint32(i, true) === i + 8 && view.getUint32(i + 4, true) === 0) chunk = i + 8;
  const data = chunk + 8; // after the line number and the size
  const min = view.getUint16(data, true);
  const max = view.getUint16(data + 2, true);
  const lengthAt = data + 4 + (max - min + 1);
  const huf = lengthAt + 4;
  const edit = (f: (v: DataView, bytes: Uint8Array) => void) => {
    const b = file.slice();
    f(new DataView(b.buffer), b);
    return b;
  };

  it('finds its way around the fixture', () => {
    expect(chunk).toBeGreaterThan(0);
    expect(view.getInt32(chunk + 4, true)).toBe(file.length - data); // the block's size runs to the end of the file
  });

  it.each<[string, (v: DataView, b: Uint8Array) => void, RegExp]>([
    ['a value range past the bitmap\'s size', (v) => v.setUint16(data + 2, 9000, true), /value range/],
    ['a bitmap longer than the block', (v) => v.setUint16(data + 2, Math.min(8191, min + 6000), true), /truncated/],
    ['a Huffman length beyond the block', (v) => v.setInt32(lengthAt, 0x7fffffff, true), /truncated/],
    ['a negative Huffman length', (v) => v.setInt32(lengthAt, -5, true), /truncated/],
    ['no Huffman data', (v) => v.setInt32(lengthAt, 0, true), /no Huffman data/],
    ['a Huffman header that is too short', (v) => v.setInt32(lengthAt, 10, true), /truncated/],
    ['a table range outside the alphabet', (v) => v.setUint32(huf, 70000, true), /table range/],
    ['a table that starts after it ends', (v) => v.setUint32(huf, 40000, true), /table/],
    ['more bits than there are bytes', (v) => v.setUint32(huf + 12, 0x7fffffff, true), /truncated/],
    ['a table that stops', (v) => v.setInt32(lengthAt, 21, true), /truncated|invalid|enough|past|too much/],
    ['a block of three bytes', (v) => v.setInt32(chunk + 4, 3, true), /too short/],
  ])('%s is refused', async (_, f, message) => {
    await expect(decodeExr(edit(f))).rejects.toThrow(message);
  });

  it('refuses a Huffman stream with the wrong amount of symbols, in either direction', async () => {
    // Fewer pixels in the data window than the stream holds, or more: the block's count must match exactly.
    const wider = file.slice();
    // dataWindow xMax is the 3rd int of the box: find it from the header text
    const at = new TextDecoder('latin1').decode(file).indexOf('dataWindow\0box2i\0') + 'dataWindow\0box2i\0'.length + 4;
    const w = new DataView(wider.buffer);
    w.setInt32(at + 8, 340, true); // 341 pixels wide instead of 300: the stream holds too few symbols
    await expect(decodeExr(wider)).rejects.toThrow(CodecError);
    const narrower = file.slice();
    new DataView(narrower.buffer).setInt32(at + 8, 99, true); // 100 wide: too many symbols
    await expect(decodeExr(narrower)).rejects.toThrow(CodecError);
  });
});
