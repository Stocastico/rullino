import { describe, expect, it } from 'vitest';
import { planTiles } from './tiles';

describe('planTiles', () => {
  it('covers every pixel exactly once, with tiles whose texture (interior + halo) fits the side', () => {
    for (const [w, h, side, halo] of [
      [37, 29, 16, 3],
      [100, 7, 20, 0],
      [5, 5, 64, 10],
      [1000, 333, 128, 17],
      [1, 1, 3, 1],
    ] as const) {
      const tiles = planTiles(w, h, side, halo);
      const seen = new Uint8Array(w * h);
      for (const t of tiles) {
        expect(t.toX - t.fromX).toBeLessThanOrEqual(side);
        expect(t.toY - t.fromY).toBeLessThanOrEqual(side);
        expect(t.fromX).toBe(Math.max(0, t.x0 - halo));
        expect(t.fromY).toBe(Math.max(0, t.y0 - halo));
        expect(t.toX).toBe(Math.min(w, t.x1 + halo));
        expect(t.toY).toBe(Math.min(h, t.y1 + halo));
        for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) seen[y * w + x]!++;
      }
      expect(seen.every((n) => n === 1)).toBe(true);
    }
  });

  it('is one tile when the image fits, and splits evenly otherwise (row by row)', () => {
    expect(planTiles(30, 20, 30, 5)).toEqual([{ x0: 0, y0: 0, x1: 30, y1: 20, fromX: 0, fromY: 0, toX: 30, toY: 20 }]);
    const t = planTiles(30, 10, 16, 2); // interior at most 12: 3 columns of 10, one row
    expect(t.map((x) => [x.x0, x.x1])).toEqual([[0, 10], [10, 20], [20, 30]]);
    expect(t.every((x) => x.y0 === 0 && x.y1 === 10)).toBe(true);
    expect(planTiles(10, 30, 16, 2).map((x) => [x.y0, x.y1])).toEqual([[0, 10], [10, 20], [20, 30]]);
  });

  it('refuses a halo that leaves no interior', () => {
    expect(() => planTiles(100, 100, 10, 5)).toThrow(/a halo of 5 px leaves no room in tiles of 10 px/);
  });
});
