import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { pixelate } from './index';

describe('pixelate', () => {
  it('replaces every cell by its mean, cells anchored at the top-left corner', () => {
    const img = imageOf(4, 2, (x, y) => [x + 4 * y, 0, 0]);
    const out = pixelate.cpu(img, { size: 2 });
    // Cell (0..1, 0..1): values 0, 1, 4, 5.
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) expect(at(out, x, y)).toBeCloseTo(2.5, 6);
    for (const [x, y] of [[2, 0], [3, 1]] as const) expect(at(out, x, y)).toBeCloseTo(4.5, 6);
  });

  it('averages only the pixels inside the image for partial cells at the edges', () => {
    const img = imageOf(5, 1, (x) => [x, 0, 0]);
    const out = pixelate.cpu(img, { size: 2 });
    expect(at(out, 4, 0)).toBe(4);
    expect(at(out, 2, 0)).toBeCloseTo(2.5, 6);
  });

  it('averages premultiplied values (alpha included) and is the identity at size 1; size is in px', () => {
    const img = imageOf(3, 3, (x, y) => [x / 3, y / 3, 0.5]);
    expect(pixelate.cpu(img, { size: 1 }).data).toEqual(img.data);
    expect(pixelate.params.size.unit).toBe('px');
  });
});
