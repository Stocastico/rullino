import { describe, expect, it } from 'vitest';
import { fromLightness, lab } from '../test-utils';
import { equalize } from './index';
const Ls = (img: { width: number; height: number; data: Float32Array }) => Array.from({ length: img.width * img.height }, (_, i) => lab(img, i)[0]);

describe('equalize', () => {
  it('stretches a low-contrast image over the whole lightness range', () => {
    const out = Ls(equalize.cpu(fromLightness(32, 8, (x) => 0.4 + 0.1 * (x / 31))));
    expect(Math.min(...out)).toBeLessThan(0.05);
    expect(Math.max(...out)).toBeGreaterThan(0.95);
  });

  it('leaves an image whose lightness is already uniformly spread about unchanged', () => {
    const src = fromLightness(256, 2, (x) => (x + 0.5) / 256);
    const out = Ls(equalize.cpu(src));
    Ls(src).forEach((v, i) => expect(out[i]).toBeCloseTo(v, 2));
  });

  it('keeps the order of lightness values, and hue and chroma', () => {
    const src = fromLightness(40, 3, (x, y) => 0.3 + 0.2 * Math.sin(x * 0.7 + y) ** 2);
    const out = equalize.cpu(src);
    const [a, b] = [Ls(src), Ls(out)];
    for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) if (a[i]! < a[j]! - 1e-6) expect(b[i]).toBeLessThanOrEqual(b[j]! + 1e-6);
    for (let i = 0; i < a.length; i++) {
      const [, A, B] = lab(out, i);
      expect(A).toBeCloseTo(0.03, 4);
      expect(B).toBeCloseTo(-0.02, 4);
    }
  });

  it('is the identity at amount 0 and ignores transparent pixels', () => {
    const src = fromLightness(16, 4, (x) => 0.4 + 0.01 * x);
    const out = equalize.cpu(src, { amount: 0 });
    for (let i = 0; i < src.data.length; i++) expect(out.data[i]).toBeCloseTo(src.data[i]!, 5);
    // Transparent pixels (black, alpha 0) neither count nor change.
    const withHoles = fromLightness(16, 4, (x) => 0.4 + 0.01 * x);
    for (let i = 0; i < 16; i++) withHoles.data.set([0, 0, 0, 0], i * 4);
    const eq = equalize.cpu(withHoles);
    expect([...eq.data.subarray(0, 64)].every((v) => v === 0)).toBe(true);
    expect(Math.min(...Ls(eq).slice(16))).toBeLessThan(0.05);
  });
});
