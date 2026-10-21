import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { createImage } from './image';

const halve = () =>
  defineFilter({
    id: 'halve',
    label: 'Halve',
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'straight',
    params: { k: { type: 'float', min: 0, max: 1, step: 0.1, default: 0.5 } },
    wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return vec4f(c.rgb * p.k, c.a); }',
    pixel: ([r, g, b, a], p) => [r * p.k, g * p.k, b * p.k, a],
    tolerance: { abs: 0, rel: 0 },
  });

describe('defineFilter', () => {
  it('derives a CPU implementation from pixel(), filling in defaults', () => {
    const f = halve();
    const out = f.cpu(createImage(1, 1, new Float32Array([0.4, 0.2, 0.1, 1])));
    expect(Array.from(out.data)).toEqual(Array.from(new Float32Array([0.2, 0.1, 0.05, 1])));
  });

  it('hands straight-alpha filters un-premultiplied colour and re-premultiplies the result', () => {
    const seen: number[][] = [];
    const f = defineFilter({
      ...halve(),
      id: 'spy',
      pixel: (c) => (seen.push([...c]), [0.5, 0.5, 0.5, c[3]]),
    });
    const out = f.cpu(createImage(2, 1, new Float32Array([0.1, 0.2, 0.3, 0.5, 0.3, 0.3, 0.3, 0])));
    expect(seen[0]![0]).toBeCloseTo(0.2, 6);
    expect(seen[0]![2]).toBeCloseTo(0.6, 6);
    expect(seen[1]).toEqual([0, 0, 0, 0]); // fully transparent: colour is defined as 0
    expect(Array.from(out.data)).toEqual([0.25, 0.25, 0.25, 0.5, 0, 0, 0, 0]);
  });

  it('passes premultiplied colour through untouched when alpha is "premultiplied"', () => {
    const f = defineFilter({ ...halve(), id: 'pm', alpha: 'premultiplied' });
    expect(Array.from(f.cpu(createImage(1, 1, new Float32Array([0.4, 0.4, 0.4, 0.5])), { k: 1 }).data)).toEqual(
      Array.from(new Float32Array([0.4, 0.4, 0.4, 0.5])),
    );
  });

  it('does not mutate its input', () => {
    const src = createImage(1, 1, new Float32Array([0.4, 0.2, 0.1, 1]));
    halve().cpu(src);
    expect(Array.from(src.data)).toEqual(Array.from(new Float32Array([0.4, 0.2, 0.1, 1])));
  });

  it('rejects invalid definitions up front', () => {
    expect(() => defineFilter({ ...halve(), id: 'Bad Id' })).toThrow(/id/);
    expect(() =>
      defineFilter({ ...halve(), params: { k: { type: 'float', min: 0, max: 1, step: 0.1, default: 3 } } } as never),
    ).toThrow(/default/);
    expect(() => defineFilter({ ...halve(), wgsl: 'fn nope() {}' })).toThrow(/apply/);
    expect(() => defineFilter({ ...halve(), wgsl: halve().wgsl + '\nstruct Params { k: f32 }' })).toThrow(/Params/);
  });
});
