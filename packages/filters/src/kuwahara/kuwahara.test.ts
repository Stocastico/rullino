import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { boxBlur } from '../boxBlur';
import { kuwahara } from './index';

describe('kuwahara', () => {
  it('leaves a flat image alone', () => {
    const flat = imageOf(9, 9, () => [0.3, 0.5, 0.2]);
    kuwahara.cpu(flat, {}).data.forEach((v, i) => expect(v).toBeCloseTo(flat.data[i]!, 6));
  });

  it('keeps step edges sharp where a blur would smear them', () => {
    const step = imageOf(15, 7, (x) => (x >= 7 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));
    const out = kuwahara.cpu(step, { radius: 3 });
    const blurred = boxBlur.cpu(step, { radius: 3 });
    // Next to the edge each side keeps its own value (the flat quadrant wins).
    expect(at(out, 6, 3)).toBeCloseTo(0.1, 2);
    expect(at(out, 7, 3)).toBeCloseTo(0.9, 2);
    expect(Math.abs(at(blurred, 6, 3) - 0.1)).toBeGreaterThan(0.1);
  });

  it('smooths noise inside flat regions', () => {
    const noisy = imageOf(21, 21, (x, y) => {
      const n = ((x * 7 + y * 13) % 5) / 5 - 0.4;
      return [0.5 + 0.1 * n, 0.5 + 0.1 * n, 0.5 + 0.1 * n];
    });
    const out = kuwahara.cpu(noisy, { radius: 3 });
    const spread = (img: { width: number; data: Float32Array }) => {
      const v: number[] = [];
      for (let y = 5; y < 16; y++) for (let x = 5; x < 16; x++) v.push(at(img, x, y));
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    };
    expect(spread(out)).toBeLessThan(0.5 * spread(noisy));
  });

  it('radius is in px; alpha is averaged with the colour (premultiplied)', () => {
    expect(kuwahara.params.radius.unit).toBe('px');
    const img = imageOf(7, 7, () => [0.2, 0.2, 0.2]);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0.5;
    expect(at(kuwahara.cpu(img, {}), 3, 3, 3)).toBeCloseTo(0.5, 6);
  });
});
