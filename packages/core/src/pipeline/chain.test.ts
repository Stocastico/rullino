import { describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { createImage } from '../image';
import { runChainCpu } from './chain';

const scale = defineFilter({
  id: 'scale',
  label: 'Scale',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: { k: { type: 'float', min: 0, max: 4, step: 0.1, default: 2, label: 'k' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * p.k, c.a); }',
  pixel: ([r, g, b, a], { k }) => [r * k, g * k, b * k, a],
  tolerance: { abs: 0, rel: 2 ** -10 },
});

const img = () => createImage(1, 1, new Float32Array([0.1, 0.2, 0.3, 1]));

describe('runChainCpu', () => {
  it('applies enabled steps in order, with defaults for missing params', () => {
    const out = runChainCpu([{ filter: scale }, { filter: scale, params: { k: 0.5 } }, { filter: scale, params: { k: 3 } }], img());
    expect(out.data[0]).toBeCloseTo(0.3, 6);
  });

  it('skips disabled steps and returns a copy for an empty chain', () => {
    expect(runChainCpu([{ filter: scale, enabled: false }], img()).data[0]).toBeCloseTo(0.1, 6);
    const src = img();
    const out = runChainCpu([], src);
    expect(out).not.toBe(src);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });
});
