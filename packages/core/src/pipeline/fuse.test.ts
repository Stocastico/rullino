import { describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { fusedShader, namespaceWgsl } from './fuse';

describe('namespaceWgsl', () => {
  it('prefixes top-level fn / const / struct names and Params, and their uses', () => {
    const src = [
      'const K = 2.0;',
      'fn helper(x: f32) -> f32 { return x * K; }',
      'fn apply(c: vec4f, p: Params) -> vec4f {',
      '  var y: f32 = helper(c.r);',
      '  return vec4f(vec3f(y), c.a);',
      '}',
    ].join('\n');
    const out = namespaceWgsl(src, 's0_');
    expect(out).toContain('const s0_K = 2.0;');
    expect(out).toContain('fn s0_helper(x: f32) -> f32 { return x * s0_K; }');
    expect(out).toContain('fn s0_apply(c: vec4f, p: s0_Params) -> vec4f {');
    expect(out).toContain('var y: f32 = s0_helper(c.r);'); // locals untouched
  });

  it('leaves member accesses and rl_ helpers alone', () => {
    const out = namespaceWgsl('fn y() -> f32 { return 1.0; }\nfn apply(c: vec4f, p: Params) -> vec4f { let lab = rl_linear_to_oklab(c.rgb); return vec4f(lab.y, y(), 0.0, c.a); }', 's1_');
    expect(out).toContain('lab.y,');
    expect(out).toContain('s1_y()');
    expect(out).toContain('rl_linear_to_oklab(');
  });
});

const mk = (id: string, alpha: 'straight' | 'premultiplied', body: string) =>
  defineFilter({
    id,
    label: id,
    category: 'adjust',
    kind: 'pointwise',
    alpha,
    params: { k: { type: 'float', min: 0, max: 2, step: 0.1, default: 1, label: 'k' } },
    wgsl: `fn helper(c: vec3f, k: f32) -> vec3f { ${body} }\nfn apply(c: vec4f, p: Params) -> vec4f { return vec4f(helper(c.rgb, p.k), c.a); }`,
    pixel: (c) => c,
    tolerance: { abs: 0, rel: 0 },
  });

describe('fusedShader', () => {
  it('chains every filter in one entry point, with per-filter alpha handling', () => {
    const code = fusedShader([mk('a', 'premultiplied', 'return c * k;'), mk('b', 'straight', 'return c + k;'), mk('a', 'premultiplied', 'return c * k;')]);
    // Same helper name in every filter, and the same filter twice: all must stay distinct.
    expect(code).toContain('fn s0_helper');
    expect(code).toContain('fn s1_helper');
    expect(code).toContain('fn s2_helper');
    expect(code).toMatch(/c = s0_apply\(c, params\.p0\);/);
    expect(code).toMatch(/c = rl_premultiply\(s1_apply\(rl_unpremultiply\(c\), params\.p1\)\);/);
    expect(code).toMatch(/@align\(16\) p2: s2_Params,/);
  });
});
