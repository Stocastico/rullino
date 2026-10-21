import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { createImage } from './image';
import { identityLut } from './lut';

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

  it('validates multipass definitions', () => {
    const base = {
      id: 'mp',
      label: 'MP',
      category: 'classic',
      kind: 'multipass',
      params: {},
      passes: [
        { name: 'a', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' },
        { name: 'b', inputs: ['a', 'input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_a(xy) - load_input(xy); }' },
      ],
      cpu: (src: ReturnType<typeof createImage>) => src,
      tolerance: { abs: 0, rel: 0 },
    } as const;
    expect(() => defineFilter(base)).not.toThrow();
    expect(() => defineFilter({ ...base, passes: [] })).toThrow(/at least one pass/);
    expect(() => defineFilter({ ...base, passes: [{ ...base.passes[1] }, { ...base.passes[0] }] })).toThrow(/unknown input "a"/);
    expect(() => defineFilter({ ...base, passes: [{ ...base.passes[0], wgsl: 'fn nope() {}' }] })).toThrow(/fn run/);
    expect(() => defineFilter({ ...base, passes: [{ ...base.passes[0], name: 'bad-name' }] })).toThrow(/identifier/);
    expect(() => defineFilter({ ...base, passes: [base.passes[0], { ...base.passes[0] }] })).toThrow(/duplicate/);
    expect(() => defineFilter({ ...base, passes: [{ ...base.passes[0], repeat: 'nope' }] })).toThrow(/repeat/);
  });

  it('fills multipass CPU params with defaults', () => {
    const seen: unknown[] = [];
    const f = defineFilter({
      id: 'mp2',
      label: 'MP2',
      category: 'classic',
      kind: 'multipass',
      params: { r: { type: 'int', min: 0, max: 4, default: 2, label: 'R' } },
      passes: [{ name: 'a', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' }],
      cpu: (src, p) => (seen.push(p), src),
      tolerance: { abs: 0, rel: 0 },
    });
    f.cpu(createImage(1, 1));
    expect(seen).toEqual([{ r: 2 }]);
  });

  it('validates buffers and compute passes', () => {
    const tex = { name: 'out', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' };
    const comp = { kind: 'compute', name: 'c', inputs: ['input'], buffers: ['b'], dispatch: 'pixels', wgsl: 'fn run(xy: vec2i, p: Params) { }' } as const;
    const base = {
      id: 'bf',
      label: 'BF',
      category: 'classic',
      kind: 'multipass',
      params: {},
      buffers: { b: 4 },
      passes: [comp, tex],
      cpu: (src: ReturnType<typeof createImage>) => src,
      tolerance: { abs: 0, rel: 0 },
    } as const;
    expect(() => defineFilter(base)).not.toThrow();
    expect(() => defineFilter({ ...base, buffers: {} })).toThrow(/unknown buffer "b"/);
    expect(() => defineFilter({ ...base, passes: [comp] })).toThrow(/last pass/);
    expect(() => defineFilter({ ...base, passes: [comp, { ...tex, inputs: ['c'] }] })).toThrow(/compute pass "c"/);
    expect(() => defineFilter({ ...base, buffers: { b: 0 } })).toThrow(/size/);
  });

  it('only allows lut params in multipass filters (they need a texture binding)', () => {
    expect(() =>
      defineFilter({ ...halve(), id: 'lutPw', params: { look: { type: 'lut', default: identityLut(2), label: 'Look' } } } as never),
    ).toThrow(/lut/);
  });
});

