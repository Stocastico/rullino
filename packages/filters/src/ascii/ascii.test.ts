import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { ascii } from './index';

const lin = (v: number) => srgbToLinear(v);
const flat = (v: number, w = 20, h = 20) => imageOf(w, h, () => [lin(v), lin(v), lin(v)]);
const ink = [1, 1, 1] as [number, number, number];
const paper = [0, 0, 0] as [number, number, number];
const params = { cell: 10, ink, paper };
const isInk = (img: { width: number; data: Float32Array }, x: number, y: number) => linearToSrgb(at(img, x, y)) > 0.5;
const inkFraction = (img: { width: number; height: number; data: Float32Array }) => {
  let n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) n += isInk(img, x, y) ? 1 : 0;
  return n / (img.width * img.height);
};
const RAMP = 10; // glyphs, from empty to solid

describe('ascii', () => {
  it('black is empty paper and white is a solid block', () => {
    expect(inkFraction(ascii.cpu(flat(0), params))).toBe(0);
    expect(inkFraction(ascii.cpu(flat(1), params))).toBe(1);
  });

  it('denser glyphs for brighter cells: ink grows at every step of the ramp', () => {
    // 35 px cells: the 5 x 7 bitmaps scale exactly (7 x 5 px per bitmap pixel), so ink = bitmap pixels / 35
    const fractions = [...Array(RAMP)].map((_, k) => inkFraction(ascii.cpu(flat(k / (RAMP - 1), 35, 35), { ...params, cell: 35 })));
    for (let k = 1; k < RAMP; k++) expect(fractions[k]!).toBeGreaterThan(fractions[k - 1]!);
    expect(fractions.map((f) => Math.round(f * 35))).toEqual([0, 1, 2, 4, 7, 10, 15, 17, 21, 35]);
  });

  it('a mid-tone cell is a glyph: ink at the centre of the plus, paper in the corner', () => {
    const out = ascii.cpu(flat(4 / (RAMP - 1)), params); // the "+" glyph
    expect(isInk(out, 5, 5)).toBe(true);
    expect(isInk(out, 0, 0)).toBe(false);
    expect(isInk(out, 9, 9)).toBe(false);
  });

  it('every cell is chosen from its own mean tone', () => {
    const img = imageOf(20, 10, (x) => (x < 10 ? [0, 0, 0] : [1, 1, 1]));
    const out = ascii.cpu(img, params);
    expect(isInk(out, 3, 5)).toBe(false);
    expect(isInk(out, 15, 5)).toBe(true);
  });

  it('invert flips the ramp (bright cells become sparse)', () => {
    expect(inkFraction(ascii.cpu(flat(1), { ...params, invert: true }))).toBe(0);
    expect(inkFraction(ascii.cpu(flat(0), { ...params, invert: true }))).toBe(1);
  });

  it('source colour mode inks the glyphs with the cell colour; the paper stays', () => {
    const img = imageOf(10, 10, () => [lin(1), lin(0.5), lin(0.25)]);
    const out = ascii.cpu(img, { ...params, color: 'source', paper: [0, 0, 0] });
    // brightest enough for a dense glyph; find an inked pixel and compare its colour with the cell's
    let found = false;
    for (let y = 0; y < 10 && !found; y++)
      for (let x = 0; x < 10 && !found; x++) {
        const i = (y * 10 + x) * 4;
        if (out.data[i]! > 0) {
          expect(out.data[i]).toBeCloseTo(lin(1), 3);
          expect(out.data[i + 1]).toBeCloseTo(lin(0.5), 3);
          expect(out.data[i + 2]).toBeCloseTo(lin(0.25), 3);
          found = true;
        }
      }
    expect(found).toBe(true);
  });

  it('cells are in px and cut at the image edge; alpha is kept', () => {
    expect(ascii.params.cell.unit).toBe('px');
    const out = ascii.cpu(flat(1, 13, 7), params); // partial cells at the right and the bottom
    expect(out.width).toBe(13);
    expect(inkFraction(out)).toBe(1);
    const half = flat(0.5, 10, 10);
    for (let i = 3; i < half.data.length; i += 4) half.data[i] = 0.5;
    const o = ascii.cpu(half, params);
    for (let i = 3; i < o.data.length; i += 4) expect(o.data[i]).toBe(0.5);
  });
});
