import { describe, expect, it } from 'vitest';
import { tileSideFor } from './tiles';

describe('tileSideFor', () => {
  const base = { sizes: [[4000, 3000]] as [number, number][], textures: 10, halo: 20, maxTexture: 8192 };
  it('renders whole when the image fits a texture and the budget (or there is none)', () => {
    expect(tileSideFor(base)).toBeUndefined();
    expect(tileSideFor({ ...base, budget: 4000 * 3000 * 8 * 10 })).toBeUndefined();
  });

  it('tiles when the budget is too small, with tiles that fit it', () => {
    const side = tileSideFor({ ...base, budget: 64 * 2 ** 20 })!;
    expect(side * side * 8 * 10).toBeLessThanOrEqual(64 * 2 ** 20);
    expect(side).toBeGreaterThan(800);
  });

  it('tiles an image larger than a texture at the largest side', () => {
    expect(tileSideFor({ ...base, sizes: [[9000, 100]] })).toBe(8192);
    expect(tileSideFor({ ...base, sizes: [[100, 100], [100, 8193]] })).toBe(8192);
  });

  it('never goes below what the halo needs (the budget is then exceeded rather than failing)', () => {
    expect(tileSideFor({ ...base, budget: 1000, halo: 300 })).toBe(2 * 300 + 64);
    expect(tileSideFor({ ...base, budget: 1000, halo: 0 })).toBe(64);
  });
});
