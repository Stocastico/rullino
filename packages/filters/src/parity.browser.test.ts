import { compareImages, createGpuContext, defaultParams, maskImage, readImage, runFilter, uploadImage, type Filter } from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases as cases, parityImages as images, parityMask } from './test-utils';

// Every registered filter is checked GPU <-> CPU at its defaults and at the extremes of each
// parameter (every option for enums, both values for bools, an asymmetric kernel). New filters get
// this for free.

const ctx = await createGpuContext();
// Looser tolerances (where a filter declares one) only on real GPUs: CI's software adapter keeps the tight ones.
const software = (await navigator.gpu.requestAdapter())?.info.isFallbackAdapter ?? true;
afterAll(() => ctx.device.destroy());

describe.each(filters.map((f) => [f.id, f as Filter] as const))('%s GPU <-> CPU parity', (_, f) => {
  const all = Object.entries(images).flatMap(([img, src]) => cases(f.params).map(([name, p]) => [`${img}: ${name}`, src, p] as const));
  it.each(all)('%s', async (_, src, params) => {
    const full = { ...defaultParams(f.params), ...params } as never;
    const mask = f.kind === 'multipass' && f.usesMask ? parityMask : undefined;
    const out = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), full, mask));
    const result = compareImages(out, mask ? f.cpu(src, full, maskImage(mask, src.width, src.height)) : f.cpu(src, full), (!software && f.hardwareTolerance) || f.tolerance);
    expect(result.pass, `${result.outliers} channels out of tolerance, worst ${JSON.stringify(result.worst)}`).toBe(true);
  });
});
