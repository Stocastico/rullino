import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { morphology } from './index';

const N = 11;
/** Grey background `bg` with the given pixels set to `v`. */
const dots = (bg: number, v: number, pts: [number, number][]) =>
  imageOf(N, N, (x, y) => (pts.some(([px, py]) => px === x && py === y) ? [v, v, v] : [bg, bg, bg]));
/** The red channel as rows of '#' (== hi) and '.' */
const shape = (img: { width: number; data: Float32Array }, hi: number) =>
  Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (Math.abs(at(img, x, y) - hi) < 1e-6 ? '#' : '.')).join(''));

describe('morphology', () => {
  it('dilates with the chosen structuring element', () => {
    const one = dots(0.1, 0.9, [[5, 5]]);
    const square = shape(morphology.cpu(one, { operation: 'dilate', shape: 'square', radius: 1 }), 0.9);
    expect(square.slice(3, 8)).toEqual(['...........', '....###....', '....###....', '....###....', '...........']);
    const cross = shape(morphology.cpu(one, { operation: 'dilate', shape: 'cross', radius: 2 }), 0.9);
    expect(cross.slice(2, 9)).toEqual(['...........', '.....#.....', '.....#.....', '...#####...', '.....#.....', '.....#.....', '...........']);
    const disk = shape(morphology.cpu(one, { operation: 'dilate', shape: 'disk', radius: 2 }), 0.9);
    expect(disk.slice(3, 8)).toEqual(['....###....', '...#####...', '...#####...', '...#####...', '....###....']);
    expect(disk[2]).toBe('...........'); // dx² + dy² ≤ (r + 0.5)²
  });

  it('erodes (a dark pixel grows)', () => {
    const out = morphology.cpu(dots(0.9, 0.1, [[5, 5]]), { operation: 'erode', shape: 'square', radius: 1 });
    expect(shape(out, 0.1).slice(4, 7)).toEqual(['....###....', '....###....', '....###....']);
  });

  it('opening removes small bright specks, closing fills small dark holes', () => {
    const speck = dots(0.1, 0.9, [[5, 5]]);
    expect(Math.max(...morphology.cpu(speck, { operation: 'open', shape: 'square', radius: 1 }).data.filter((_, i) => i % 4 === 0))).toBeCloseTo(0.1, 6);
    const hole = dots(0.9, 0.1, [[5, 5]]);
    expect(Math.min(...morphology.cpu(hole, { operation: 'close', shape: 'square', radius: 1 }).data.filter((_, i) => i % 4 === 0))).toBeCloseTo(0.9, 6);
    // A block larger than the element survives opening unchanged.
    const block = imageOf(N, N, (x, y) => (x >= 3 && x <= 7 && y >= 3 && y <= 7 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    expect([...morphology.cpu(block, { operation: 'open', shape: 'square', radius: 1 }).data]).toEqual([...block.data]);
  });

  it('gradient outlines edges; top-hat keeps small bright details; black-hat small dark ones', () => {
    const block = imageOf(N, N, (x, y) => (x >= 3 && x <= 7 && y >= 3 && y <= 7 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    const g = morphology.cpu(block, { operation: 'gradient', shape: 'square', radius: 1 });
    expect(at(g, 5, 5)).toBeCloseTo(0, 6); // flat inside
    expect(at(g, 0, 0)).toBeCloseTo(0, 6); // flat outside
    expect(at(g, 3, 5)).toBeCloseTo(0.8, 6); // on the edge
    expect(at(g, 2, 5)).toBeCloseTo(0.8, 6);
    expect(at(g, 5, 5, 3)).toBe(1); // alpha kept
    const top = morphology.cpu(dots(0.1, 0.9, [[5, 5]]), { operation: 'tophat', shape: 'square', radius: 1 });
    expect(at(top, 5, 5)).toBeCloseTo(0.8, 6);
    expect(at(top, 0, 0)).toBeCloseTo(0, 6);
    const black = morphology.cpu(dots(0.9, 0.1, [[5, 5]]), { operation: 'blackhat', shape: 'square', radius: 1 });
    expect(at(black, 5, 5)).toBeCloseTo(0.8, 6);
    expect(at(black, 0, 0)).toBeCloseTo(0, 6);
  });

  it('does not mutate its input', () => {
    const src = dots(0.1, 0.9, [[5, 5]]);
    const copy = src.data.slice();
    morphology.cpu(src, { operation: 'gradient', shape: 'disk', radius: 2 });
    expect(src.data).toEqual(copy);
  });
});
