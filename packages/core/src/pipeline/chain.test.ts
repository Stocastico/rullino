import { describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { createImage } from '../image';
import { maskValue } from '../mask';
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
  it('with fast: true uses a filter\'s fast implementation (resolved, scaled params) and the reference otherwise', () => {
    const calls: unknown[] = [];
    const fastScale = defineFilter({
      ...scale,
      id: 'fastScale',
      fast: (src, p) => {
        calls.push(p);
        return createImage(src.width, src.height, src.data.map((v, i) => (i % 4 === 3 ? v : v * p.k * 10)));
      },
    });
    const steps = [{ filter: fastScale }, { filter: scale, params: { k: 0.5 } }];
    expect(runChainCpu(steps, img()).data[0]).toBeCloseTo(0.1, 6);
    expect(calls).toEqual([]);
    expect(runChainCpu(steps, img(), { fast: true }).data[0]).toBeCloseTo(1, 6);
    expect(calls).toEqual([{ k: 2 }]);
  });

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

  it('blends a masked step with its input: out = mix(in, step(in), mask)', () => {
    const src = createImage(5, 1, new Float32Array(20).fill(0.2).map((v, i) => (i % 4 === 3 ? 1 : v)));
    const mask = { kind: 'linear', from: [0.1, 0.5], to: [0.9, 0.5] } as const;
    const out = runChainCpu([{ filter: scale, params: { k: 3 }, mask }], src);
    for (let x = 0; x < 5; x++) {
      const m = maskValue(mask, x, 0, 5, 1);
      expect(out.data[x * 4]).toBeCloseTo(0.2 + (0.6 - 0.2) * m, 6);
      expect(out.data[x * 4 + 3]).toBe(1);
    }
    expect(out.data[0]).toBeCloseTo(0.2, 6); // fully outside
    expect(out.data[16]).toBeCloseTo(0.6, 6); // fully inside
  });

  it('blends alpha too (premultiplied lerp), and opacity 0 is the identity', () => {
    const fade = defineFilter({
      id: 'fade',
      label: 'Fade',
      category: 'adjust',
      kind: 'pointwise',
      alpha: 'premultiplied',
      params: {},
      wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(0.0); }',
      pixel: () => [0, 0, 0, 0],
      tolerance: { abs: 0, rel: 0 },
    });
    const half = { kind: 'radial', center: [0.5, 0.5], radius: [1, 1], feather: 0, opacity: 0.5 } as const;
    expect([...runChainCpu([{ filter: fade, mask: half }], img()).data]).toEqual([0.05, 0.1, 0.15, 0.5].map((v) => expect.closeTo(v, 6)));
    expect([...runChainCpu([{ filter: fade, mask: { ...half, opacity: 0 } }], img()).data]).toEqual([...img().data]);
  });

  it('rejects an invalid mask', () => {
    expect(() => runChainCpu([{ filter: scale, mask: { kind: 'linear', from: [0, 0], to: [0, 0] } }], img())).toThrow(/distinct/);
  });
});
