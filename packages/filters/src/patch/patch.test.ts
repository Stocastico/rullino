import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { patch } from './index';

describe('patch', () => {
  const src = imageOf(4, 2, (x, y) => [0.1 * x, 0.2 * y, 0.5]);

  it('is the identity with its default (empty) image', () => {
    expect(patch.cpu(src, {})).toEqual(src);
  });

  it('puts an opaque image of the same size in place of the input', () => {
    const other = imageOf(4, 2, (x, y) => [0.9, 0.05 * x, 0.3 + 0.1 * y]);
    const out = patch.cpu(src, { patch: other });
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(other.data[i]!, 6);
  });

  it('is stretched over the input: a 2 x 1 image on a 4 x 2 input, interpolated between centres', () => {
    const small = createImage(2, 1, Float32Array.from([0, 0, 0, 1, 1, 1, 1, 1]));
    const out = patch.cpu(src, { patch: small });
    expect(at(out, 0, 0, 0)).toBeCloseTo(0, 6); // left of the first centre: clamped
    expect(at(out, 1, 0, 0)).toBeCloseTo(0.25, 6); // u = 0.375: a quarter of the way between centres
    expect(at(out, 2, 1, 0)).toBeCloseTo(0.75, 6);
    expect(at(out, 3, 1, 0)).toBeCloseTo(1, 6);
    expect(at(out, 3, 1, 3)).toBeCloseTo(1, 6);
  });

  it('lets the input show through where the image is transparent (premultiplied "over")', () => {
    const half = createImage(1, 1, Float32Array.from([0.4, 0, 0, 0.5])); // premultiplied: red 0.8 at 50 %
    const out = patch.cpu(src, { patch: half });
    expect(at(out, 2, 1, 0)).toBeCloseTo(0.4 + 0.2 * 0.5, 6);
    expect(at(out, 2, 1, 1)).toBeCloseTo(0.2 * 0.5, 6);
    expect(at(out, 2, 1, 3)).toBeCloseTo(0.5 + 1 * 0.5, 6);
  });

  it('does not modify its input', () => {
    const copy = new Float32Array(src.data);
    patch.cpu(src, { patch: imageOf(2, 2, () => [1, 0, 0]) });
    expect(src.data).toEqual(copy);
  });
});
