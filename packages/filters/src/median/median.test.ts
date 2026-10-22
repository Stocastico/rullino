import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { median } from './index';

describe('median', () => {
  it('takes the per-channel median of the window', () => {
    // 3x3 image whose red channel is 1..9 (shuffled), green is 9..1, alpha 1.
    const reds = [7, 2, 9, 4, 1, 8, 3, 6, 5];
    const img = createImage(3, 3, Float32Array.from(reds.flatMap((r) => [r / 10, (10 - r) / 10, 0.5, 1])));
    const out = median.cpu(img, { radius: 1 });
    expect(at(out, 1, 1, 0)).toBeCloseTo(0.5, 6);
    expect(at(out, 1, 1, 1)).toBeCloseTo(0.5, 6);
    expect(at(out, 1, 1, 2)).toBeCloseTo(0.5, 6);
  });

  it('removes isolated specks (salt and pepper) without blurring', () => {
    const img = imageOf(9, 9, (x, y) => (x === 4 && y === 4 ? [1, 1, 1] : x === 2 && y === 6 ? [0, 0, 0] : [0.3, 0.3, 0.3]));
    const out = median.cpu(img, { radius: 1 });
    for (let i = 0; i < 81; i++) expect(out.data[i * 4]).toBeCloseTo(0.3, 6);
  });

  it('keeps straight edges exactly', () => {
    const img = imageOf(9, 9, (x) => (x < 4 ? [0.1, 0.1, 0.1] : [0.8, 0.8, 0.8]));
    const out = median.cpu(img, { radius: 2 });
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(at(out, x, y)).toBeCloseTo(x < 4 ? 0.1 : 0.8, 6);
  });

  it('a larger radius removes larger specks', () => {
    // A 3x3 block: at its centre it fills a 3x3 window (survives) but is 9 of 25 in a 5x5 one.
    const img = imageOf(11, 11, (x, y) => (x >= 4 && x <= 6 && y >= 4 && y <= 6 ? [1, 1, 1] : [0.3, 0.3, 0.3]));
    expect(at(median.cpu(img, { radius: 1 }), 5, 5)).toBeCloseTo(1, 6);
    expect(at(median.cpu(img, { radius: 2 }), 5, 5)).toBeCloseTo(0.3, 6);
  });
});
