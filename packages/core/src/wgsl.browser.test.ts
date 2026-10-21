import { afterAll, describe, expect, it } from 'vitest';
import { linearToSrgb, srgbToLinear } from './color';
import { compareImages } from './compare';
import { defineFilter } from './define';
import type { Rgba } from './filter';
import { createGpuContext } from './gpu/context';
import { runPointwise } from './gpu/pointwise';
import { readImage, uploadImage } from './gpu/texture';
import { fromFloat16Array, toFloat16Array } from './half';
import { createImage } from './image';
import { linearToOklab, luminance, oklabToLinear } from './oklab';

// Each probe exposes one rl_* helper as a filter so it can be compared with its CPU twin.
const probe = (id: string, wgslExpr: string, cpu: (c: Rgba) => Rgba, alpha: 'premultiplied' | 'straight' = 'premultiplied') =>
  defineFilter({
    id,
    label: id,
    category: 'adjust',
    kind: 'pointwise',
    alpha,
    params: {},
    wgsl: `fn apply(c: vec4f, p: Params) -> vec4f { return ${wgslExpr}; }`,
    pixel: cpu,
    tolerance: { abs: 2e-4, rel: 2e-3 },
  });

const probes = [
  probe('oklab', 'vec4f(rl_linear_to_oklab(c.rgb), c.a)', ([r, g, b, a]) => [...linearToOklab(r, g, b), a]),
  probe('oklabRoundTrip', 'vec4f(rl_oklab_to_linear(rl_linear_to_oklab(c.rgb)), c.a)', ([r, g, b, a]) => [
    ...oklabToLinear(...linearToOklab(r, g, b)),
    a,
  ]),
  probe('toSrgb', 'vec4f(rl_linear_to_srgb(c.rgb), c.a)', ([r, g, b, a]) => [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b), a]),
  probe('fromSrgb', 'vec4f(rl_srgb_to_linear(c.rgb), c.a)', ([r, g, b, a]) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a]),
  probe('luma', 'vec4f(vec3f(rl_luminance(c.rgb)), c.a)', ([r, g, b, a]) => {
    const y = luminance(r, g, b);
    return [y, y, y, a];
  }),
  // Straight-alpha plumbing: squaring is non-linear, so premultiplication order matters.
  probe('square', 'vec4f(c.rgb * c.rgb, c.a)', ([r, g, b, a]) => [r * r, g * g, b * b, a], 'straight'),
];

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

function testImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = i % 40 === 0 ? 0 : rand(); // include fully transparent pixels
    data[i] = (rand() * 1.4 - 0.1) * a; // slightly negative and > 1 values too
    data[i + 1] = rand() * a;
    data[i + 2] = rand() * 1.2 * a;
    data[i + 3] = a;
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

describe('WGSL colour library matches the CPU functions', () => {
  const src = testImage(33, 17);
  it.each(probes.map((p) => [p.id, p] as const))('%s', async (_, f) => {
    const out = await readImage(ctx, runPointwise(ctx, f, uploadImage(ctx, src)));
    const result = compareImages(out, f.cpu(src), f.tolerance);
    expect(result.worst ?? null, JSON.stringify(result.worst)).toBeNull();
  });
});
