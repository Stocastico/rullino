import { describe, expect, it } from 'vitest';
import { equalize } from '../equalize';
import { fromLightness, lab } from '../test-utils';
import { clahe } from './index';

const W = 64;
const H = 32;
const L = (img: { data: Float32Array }, x: number, y: number) => lab(img, y * W + x)[0];
/**
 * Fine low-contrast texture on a large lightness gradient: the gradient alone spreads the global
 * histogram evenly, so global equalisation barely changes anything, while each tile only sees a
 * narrow range and can stretch the texture.
 */
const scene = () => fromLightness(W, H, (x, y) => 0.15 + 0.7 * (x / W) + 0.02 * Math.sin(x * 2.1 + y * 1.7));
/** Texture contrast: deviation from the underlying gradient, around x0. */
const localContrast = (img: { data: Float32Array }, x0: number) => {
  // Mean absolute vertical difference: insensitive to the horizontal gradient.
  let s = 0;
  let n = 0;
  for (let y = 9; y < 24; y++) for (let x = x0; x < x0 + 16; x++, n++) s += Math.abs(L(img, x, y) - L(img, x, y - 1));
  return s / n;
};

describe('clahe', () => {
  it('raises local contrast where global equalisation cannot', () => {
    const src = scene();
    const local = clahe.cpu(src, { tiles: 4, clipLimit: 8 });
    const global = equalize.cpu(src);
    for (const x0 of [8, 40]) {
      expect(localContrast(global, x0)).toBeLessThan(1.5 * localContrast(src, x0));
      expect(localContrast(local, x0)).toBeGreaterThan(2 * localContrast(src, x0));
    }
  });

  it('a lower clip limit gives a smaller boost', () => {
    const src = scene();
    const low = localContrast(clahe.cpu(src, { tiles: 4, clipLimit: 1.5 }), 24);
    const high = localContrast(clahe.cpu(src, { tiles: 4, clipLimit: 8 }), 24);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(localContrast(src, 24) * 0.9);
  });

  it('with one tile and no effective clipping it is global equalisation', () => {
    const src = scene();
    const a = clahe.cpu(src, { tiles: 1, clipLimit: 256 });
    const b = equalize.cpu(src);
    for (let i = 0; i < a.data.length; i++) expect(a.data[i]).toBeCloseTo(b.data[i]!, 5);
  });

  it('blends between tiles: no seams on a smooth gradient', () => {
    const src = fromLightness(W, H, (x, y) => 0.2 + 0.5 * (x / W) + 0.1 * (y / H));
    const out = clahe.cpu(src, { tiles: 4, clipLimit: 3 });
    let worst = 0;
    for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) worst = Math.max(worst, Math.abs(L(out, x, y) - L(out, x - 1, y)));
    expect(worst).toBeLessThan(0.05);
  });

  it('works on images smaller than the tile grid', () => {
    const tiny = fromLightness(3, 2, (x) => 0.3 + 0.1 * x);
    expect(() => clahe.cpu(tiny, { tiles: 16 })).not.toThrow();
  });
});
