import { compareImages, defaultParams, maskImage, type Filter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityImages, parityMask, specialImage } from './test-utils';

// Every filter's fast CPU path is checked against its reference on the GPU parity cases, within
// the same tolerance: the fast path may compute differently, but never further from the reference
// than the GPU is allowed to be.

const fast = filters.filter((f) => f.fast);

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
