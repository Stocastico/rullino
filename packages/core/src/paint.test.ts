import { describe, expect, it } from 'vitest';
import { createRasterMask } from './mask';
import { paintStroke } from './paint';

const at = (r: { width: number; data: Float32Array }, x: number, y: number) => r.data[y * r.width + x]!;

describe('paintStroke', () => {
  const blank = createRasterMask(40, 20);

  it('paints a dab: full inside the hard core, fading to 0 at the radius', () => {
    // Centre (20, 10) px; radius 0.25 of the longer side = 10 px; hardness 0.5 -> solid within 5 px.
    const r = paintStroke(blank, [[20.5 / 40, 10.5 / 20]], { radius: 0.25, hardness: 0.5 });
    expect(at(r, 20, 10)).toBe(1);
    expect(at(r, 24, 10)).toBe(1);
    expect(at(r, 27, 10)).toBeGreaterThan(0);
    expect(at(r, 27, 10)).toBeLessThan(1);
    expect(at(r, 31, 10)).toBe(0);
    expect(at(r, 20, 0)).toBe(0); // 10 px away: on the edge
  });

  it('measures the radius in units of the longer side (round dabs on non-square rasters)', () => {
    const r = paintStroke(blank, [[0.5, 0.5]], { radius: 0.1, hardness: 0.9 });
    expect(at(r, 20 + 3, 10)).toBeCloseTo(at(r, 20, 10 + 3), 6);
  });

  it('covers the whole segment between points, without gaps', () => {
    const r = paintStroke(blank, [[0.1, 0.5], [0.9, 0.5]], { radius: 0.05, hardness: 0.8 });
    for (let x = 5; x <= 35; x++) expect(at(r, x, 10)).toBe(1);
    expect(at(r, 20, 0)).toBe(0);
  });

  it('never exceeds the strength when strokes overlap, and erases', () => {
    const once = paintStroke(blank, [[0.5, 0.5]], { radius: 0.2, hardness: 0.5, strength: 0.6 });
    const twice = paintStroke(once, [[0.5, 0.5]], { radius: 0.2, hardness: 0.5, strength: 0.6 });
    expect(Math.max(...twice.data)).toBeCloseTo(0.6, 6);
    const full = paintStroke(blank, [[0.5, 0.5]], { radius: 0.4, hardness: 1 });
    const erased = paintStroke(full, [[0.5, 0.5]], { radius: 0.1, hardness: 1, erase: true });
    expect(at(erased, 20, 10)).toBe(0);
    expect(at(erased, 8, 10)).toBe(1); // inside the 16 px dab, outside the 4 px eraser
  });

  it('returns a new raster and leaves the input untouched', () => {
    const r = paintStroke(blank, [[0.5, 0.5]], { radius: 0.2 });
    expect(r).not.toBe(blank);
    expect(r.data).not.toBe(blank.data);
    expect(blank.data.every((v) => v === 0)).toBe(true);
  });

  it('erasing with the same dab removes a soft dab completely', () => {
    const dab = { radius: 0.2, hardness: 0.3 };
    const painted = paintStroke(blank, [[0.5, 0.5]], dab);
    expect([...painted.data].some((v) => v > 0 && v < 1)).toBe(true);
    expect(Math.max(...paintStroke(painted, [[0.5, 0.5]], { ...dab, erase: true }).data)).toBe(0);
  });
});
