import { describe, expect, it } from 'vitest';
import { createImage, type LinearImage } from './image';
import { createRasterMask } from './mask';
import { magicWand } from './wand';

/** An image from a character map: R red, B blue, G mid grey, . transparent. */
function img(rows: string[]): LinearImage {
  const colours: Record<string, number[]> = { R: [0.8, 0.05, 0.05, 1], B: [0.05, 0.05, 0.8, 1], G: [0.2, 0.2, 0.2, 1], '.': [0, 0, 0, 0] };
  const out = createImage(rows[0]!.length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => out.data.set(colours[ch]!, (y * out.width + x) * 4)));
  return out;
}
const seedAt = (im: LinearImage, x: number, y: number) => [(x + 0.5) / im.width, (y + 0.5) / im.height] as const;
const show = (m: { width: number; data: Float32Array }) => [...m.data].map((v) => (v === 1 ? '1' : v === 0 ? '0' : '~')).join('').match(new RegExp(`.{${m.width}}`, 'g'));

describe('magicWand', () => {
  const rows = ['RRBBRR', 'RRBBRR', 'BBBBBB', 'RBBBBR'];

  it('selects the connected region of similar colour (4-connected)', () => {
    const im = img(rows);
    expect(show(magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1 }))).toEqual(['110000', '110000', '000000', '000000']);
  });

  it('selects every similar pixel when not contiguous', () => {
    const im = img(rows);
    expect(show(magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1, contiguous: false }))).toEqual(['110011', '110011', '000000', '100001']);
  });

  it('does not leak through diagonal contacts', () => {
    const im = img(['RB', 'BR']);
    expect(show(magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1 }))).toEqual(['10', '00']);
  });

  it('grows with the tolerance, measured in OKLab', () => {
    // A ramp of greys: the further from the seed, the larger the OKLab distance.
    const im = createImage(10, 1);
    for (let x = 0; x < 10; x++) im.data.set([0.05 + 0.08 * x, 0.05 + 0.08 * x, 0.05 + 0.08 * x, 1], x * 4);
    const count = (t: number) => magicWand(im, seedAt(im, 0, 0), { tolerance: t }).data.filter((v) => v > 0).length;
    expect(count(0.001)).toBe(1);
    expect(count(0.15)).toBeGreaterThan(1);
    expect(count(0.15)).toBeLessThan(count(0.4));
    expect(count(2)).toBe(10);
  });

  it('softens the edge of the selection with softness', () => {
    const im = createImage(10, 1);
    for (let x = 0; x < 10; x++) im.data.set([0.05 + 0.08 * x, 0.05 + 0.08 * x, 0.05 + 0.08 * x, 1], x * 4);
    const m = magicWand(im, seedAt(im, 0, 0), { tolerance: 0.4, softness: 0.8 }).data;
    expect(m[0]).toBe(1);
    expect([...m].some((v) => v > 0 && v < 1)).toBe(true);
    for (let x = 1; x < 10; x++) expect(m[x]).toBeLessThanOrEqual(m[x - 1]!);
  });

  it('treats transparency as a colour (selecting a transparent background)', () => {
    const im = img(['..R', '.RR', '...']);
    expect(show(magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1 }))).toEqual(['110', '100', '111']); // the bottom row connects through (0, 1)
  });

  it('adds to or subtracts from an existing mask of the same size', () => {
    const im = img(rows);
    const base = createRasterMask(6, 4, new Float32Array(24).fill(0).map((_, i) => (i === 23 ? 1 : 0)));
    const added = magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1, into: base });
    expect(show(added)).toEqual(['110000', '110000', '000000', '000001']);
    const removed = magicWand(im, seedAt(im, 5, 3), { tolerance: 0.1, contiguous: false, into: added, subtract: true });
    expect(show(removed)).toEqual(['000000', '000000', '000000', '000000']);
    expect(() => magicWand(im, seedAt(im, 0, 0), { tolerance: 0.1, into: createRasterMask(3, 2) })).toThrow(/6x4/);
    expect(base.data[0]).toBe(0); // inputs untouched
  });

  it('undoes a soft selection exactly when the same click subtracts it', () => {
    const im = createImage(10, 1);
    for (let x = 0; x < 10; x++) im.data.set([0.05 + 0.08 * x, 0.05 + 0.08 * x, 0.05 + 0.08 * x, 1], x * 4);
    const opts = { tolerance: 0.4, softness: 0.8 };
    const added = magicWand(im, seedAt(im, 0, 0), opts);
    expect([...added.data].some((v) => v > 0 && v < 1)).toBe(true);
    expect([...magicWand(im, seedAt(im, 0, 0), { ...opts, into: added, subtract: true }).data]).toEqual(new Array(10).fill(0));
  });

  it('at tolerance 0 selects exactly the seed colour (not nothing)', () => {
    const im = img(rows);
    expect(show(magicWand(im, seedAt(im, 0, 0), { tolerance: 0 }))).toEqual(['110000', '110000', '000000', '000000']);
  });
});
