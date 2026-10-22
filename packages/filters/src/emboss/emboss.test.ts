import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { emboss } from './index';

const enc = (img: { width: number; data: Float32Array }, x: number, y: number, c = 0) => linearToSrgb(at(img, x, y, c));
// Bright on the right half, dark on the left: a vertical step edge.
const step = imageOf(9, 5, (x) => (x >= 5 ? [1, 1, 1] : [srgbToLinear(0.2), srgbToLinear(0.2), srgbToLinear(0.2)]));

describe('emboss', () => {
  it('flat areas become mid grey in grey mode', () => {
    const out = emboss.cpu(step, {});
    expect(enc(out, 1, 2)).toBeCloseTo(0.5, 5);
    expect(enc(out, 8, 2)).toBeCloseTo(0.5, 5);
  });

  it('an edge facing the light is raised, the opposite one sunk', () => {
    // Light from the right (0°): the edge rising to the right faces it.
    expect(enc(emboss.cpu(step, { angle: 0 }), 4, 2)).toBeGreaterThan(0.6);
    expect(enc(emboss.cpu(step, { angle: 180 }), 4, 2)).toBeLessThan(0.4);
    // Light from above (90°): a vertical edge has no relief.
    expect(enc(emboss.cpu(step, { angle: 90 }), 4, 2)).toBeCloseTo(0.5, 5);
  });

  it('colour mode adds the relief to the colours', () => {
    const img = imageOf(9, 5, () => [srgbToLinear(0.3), srgbToLinear(0.6), srgbToLinear(0.9)]);
    const out = emboss.cpu(img, { mode: 'color' });
    expect([0, 1, 2].map((c) => enc(out, 4, 2, c))).toEqual([0.3, 0.6, 0.9].map((v) => expect.closeTo(v, 5)));
  });

  it('strength scales the relief; distance is in px; alpha is kept', () => {
    const weak = enc(emboss.cpu(step, { angle: 0, strength: 0.5 }), 4, 2) - 0.5;
    const strong = enc(emboss.cpu(step, { angle: 0, strength: 1 }), 4, 2) - 0.5;
    expect(strong).toBeCloseTo(2 * weak, 4);
    expect(emboss.params.distance.unit).toBe('px');
    const half = imageOf(3, 3, () => [0.2, 0.2, 0.2]);
    for (let i = 3; i < half.data.length; i += 4) half.data[i] = 0.5;
    expect(at(emboss.cpu(half, {}), 1, 1, 3)).toBe(0.5);
  });
});
