import { describe, expect, it } from 'vitest';
import { createRasterMask } from './mask';
import { fillShape, type Shape } from './paint';

const at = (r: { width: number; data: Float32Array }, x: number, y: number) => r.data[y * r.width + x]!;
const sum = (r: { data: Float32Array }) => r.data.reduce((a, b) => a + b, 0);
// A 40 x 20 raster: normalised (u, v) = (x / 40, y / 20)
const blank = createRasterMask(40, 20);
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => ({ kind: 'rect', from: [x0 / 40, y0 / 20], to: [x1 / 40, y1 / 20] });

describe('fillShape', () => {
  it('fills a rectangle: 1 inside, 0 outside, whatever the corner order', () => {
    for (const shape of [rect(10, 5, 30, 15), rect(30, 15, 10, 5), rect(30, 5, 10, 15)]) {
      const r = fillShape(blank, shape);
      expect(at(r, 10, 5)).toBe(1);
      expect(at(r, 29, 14)).toBe(1);
      expect(at(r, 20, 10)).toBe(1);
      expect(at(r, 9, 10)).toBe(0);
      expect(at(r, 30, 10)).toBe(0);
      expect(at(r, 20, 4)).toBe(0);
      expect(at(r, 20, 15)).toBe(0);
      expect(sum(r)).toBe(20 * 10);
    }
  });

  it('antialiases edges that fall inside a pixel (coverage, not a hard step)', () => {
    const r = fillShape(blank, rect(10.5, 5, 30, 15));
    expect(at(r, 10, 10)).toBeCloseTo(0.5, 6);
    expect(at(r, 11, 10)).toBe(1);
    expect(sum(r)).toBeCloseTo(19.5 * 10, 5);
  });

  it('fills the ellipse inscribed in its bounding box', () => {
    const r = fillShape(blank, { kind: 'ellipse', from: [0.1, 0.1], to: [0.9, 0.9] }); // 32 x 16 px
    expect(at(r, 20, 10)).toBe(1);
    expect(at(r, 4, 2)).toBe(0); // the box corner
    expect(at(r, 36, 17)).toBe(0);
    expect(sum(r)).toBeGreaterThan(0.98 * Math.PI * 16 * 8);
    expect(sum(r)).toBeLessThan(1.02 * Math.PI * 16 * 8);
    expect(at(r, 5, 10)).toBeGreaterThan(0); // the left tip
  });

  it('fills a polygon, concave ones included, with the even-odd rule', () => {
    // An L: the 20 x 20 square minus its top-right 10 x 10 quarter, placed at x 5..25
    const pts: [number, number][] = [[5, 0], [15, 0], [15, 10], [25, 10], [25, 20], [5, 20]];
    const r = fillShape(blank, { kind: 'polygon', points: pts.map(([x, y]) => [x / 40, y / 20] as [number, number]) });
    expect(at(r, 8, 3)).toBe(1);
    expect(at(r, 20, 15)).toBe(1);
    expect(at(r, 20, 3)).toBe(0); // the notch
    expect(sum(r)).toBeCloseTo(300, 4);
  });

  it('a polygon with fewer than three points, or a flat box, fills nothing', () => {
    expect(sum(fillShape(blank, { kind: 'polygon', points: [[0.1, 0.1], [0.9, 0.9]] }))).toBe(0);
    expect(sum(fillShape(blank, rect(10, 5, 10, 15)))).toBe(0);
  });

  it('adding keeps what is already there when it is stronger (max), and does not touch the input', () => {
    const base = createRasterMask(40, 20, new Float32Array(40 * 20).fill(0.3));
    const r = fillShape(base, rect(10, 5, 30, 15));
    expect(at(r, 20, 10)).toBe(1);
    expect(at(r, 0, 0)).toBeCloseTo(0.3, 6);
    expect(at(base, 20, 10)).toBeCloseTo(0.3, 6);
  });

  it('subtracting removes the shape: adding then subtracting the same shape is a no-op', () => {
    for (const shape of [rect(10.3, 5.2, 30.7, 15.1), { kind: 'ellipse', from: [0.2, 0.2], to: [0.8, 0.9] } as Shape]) {
      const added = fillShape(blank, shape);
      const removed = fillShape(added, shape, { subtract: true });
      expect(sum(removed)).toBe(0);
    }
    // a smaller shape removed from a bigger one leaves the ring
    const ring = fillShape(fillShape(blank, rect(5, 2, 35, 18)), rect(10, 5, 30, 15), { subtract: true });
    expect(at(ring, 20, 10)).toBe(0);
    expect(at(ring, 7, 10)).toBe(1);
  });
});
