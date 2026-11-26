// Colours outside sRGB (RFC #181): rullino's working space is extended linear sRGB, so a filter gets
// negative channels for colours outside the sRGB triangle. Every filter must stay finite on them,
// in its reference and in its fast path, at every parity case. (GPU <-> CPU on the same image is in
// parity.browser.test.ts.)
import { resolveParams, runChainCpu, type Filter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityMask, wideImage } from './test-utils';

const src = wideImage();

const nonFinite = (data: Float32Array) => {
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i]!)) return i;
  return -1;
};

describe('the wide-gamut test image', () => {
  it('has colours outside sRGB: negative channels and channels above 1', () => {
    let negative = 0;
    let above = 0;
    for (let i = 0; i < src.data.length; i++) if (i % 4 !== 3) (src.data[i]! < -1e-3 ? negative++ : src.data[i]! > 1 ? above++ : 0);
    expect(negative).toBeGreaterThan(150);
    expect(above).toBeGreaterThan(50);
  });
});

describe.each(filters.map((f) => [f.id, f as Filter] as const))('%s on colours outside sRGB', (_, f) => {
  it.each(parityCases(f.params))('%s: finite, reference and fast path', (_, params) => {
    const steps = [{ filter: f, params: resolveParams(f.params, params as never), ...('usesMask' in f && f.usesMask ? { mask: parityMask } : {}) }];
    const ref = runChainCpu(steps as never, src);
    expect(nonFinite(ref.data)).toBe(-1);
    const fast = runChainCpu(steps as never, src, { fast: true });
    expect(nonFinite(fast.data)).toBe(-1);
  }, 120_000);
});

