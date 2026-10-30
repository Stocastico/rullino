import { compareImages, createImage, defaultParams, maskImage, type Filter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityImages, parityMask } from './test-utils';

// Every filter's fast CPU path is checked against its reference on the GPU parity cases, within
// the same tolerance: the fast path may compute differently, but never further from the reference
// than the GPU is allowed to be.

const fast = filters.filter((f) => f.fast);

/**
 * Special values the random images never hit: exact greys (zero chroma), black, white, primaries,
 * HDR, and the same colours at partial alpha (premultiplied), on a 13 x 7 grid.
 */
function specialImage() {
  const colours = [[0, 0, 0], [1, 1, 1], [0.18, 0.18, 0.18], [0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 0.5, 0.1], [0.001, 0.001, 0.001]];
  const img = createImage(13, 7);
  for (let i = 0; i < 13 * 7; i++) {
    const [r, g, b] = colours[i % colours.length]!;
    const a = [1, 0.5, 0.25][Math.floor(i / colours.length) % 3]!;
    img.data.set([r! * a, g! * a, b! * a, a], i * 4);
  }
  return img;
}
const images = { ...parityImages, special: specialImage() };

it('some filters have a fast path', () => {
  expect(fast.map((f) => f.id)).not.toEqual([]);
});

describe.each(fast.map((f) => [f.id, f as Filter] as const))('%s fast <-> reference', (_, f) => {
  const all = Object.entries(images).flatMap(([img, src]) => parityCases(f.params).map(([name, p]) => [`${img}: ${name}`, src, p] as const));
  it.each(all)('%s', (_, src, params) => {
    const full = { ...defaultParams(f.params), ...params } as never;
    const mask = f.kind === 'multipass' && f.usesMask ? maskImage(parityMask, src.width, src.height) : undefined;
    const before = src.data.slice();
    const out = f.fast!(src, full, mask);
    expect(src.data, 'fast must not mutate its input').toEqual(before);
    const result = compareImages(out, f.cpu(src, full, mask), f.tolerance);
    expect(result.pass, `${result.outliers} channels out of tolerance, worst ${JSON.stringify(result.worst)}`).toBe(true);
  }, 30_000); // the references of the slow filters (bilateral at sigma 20: 4 s) run here too
});
