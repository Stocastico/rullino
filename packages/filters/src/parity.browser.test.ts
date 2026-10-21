import {
  compareImages,
  createGpuContext,
  createImage,
  defaultParams,
  fromFloat16Array,
  readImage,
  runFilter,
  toFloat16Array,
  uploadImage,
  type ParamSchema,
  type Filter,
} from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { filters } from './index';

// Every registered filter is checked GPU <-> CPU at its defaults and at the extremes of each
// parameter (every option for enums, both values for bools, an asymmetric kernel). New filters get
// this for free.

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

function testImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = i % 52 === 0 ? 0 : 0.2 + 0.8 * rand(); // some fully transparent pixels
    data[i] = rand() * a;
    data[i + 1] = rand() * a;
    data[i + 2] = rand() * 1.5 * a; // some HDR headroom
    data[i + 3] = a;
  }
  // Quantise up front so CPU and GPU see exactly the same input.
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

function cases(schema: ParamSchema): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = [['defaults', {}]];
  for (const [k, p] of Object.entries(schema)) {
    if (p.type === 'float' || p.type === 'int') out.push([`${k}=${p.min}`, { [k]: p.min }], [`${k}=${p.max}`, { [k]: p.max }]);
    if (p.type === 'bool') out.push([`${k}=${!p.default}`, { [k]: !p.default }]);
    if (p.type === 'enum') for (const o of Object.keys(p.options)) if (o !== p.default) out.push([`${k}=${o}`, { [k]: o }]);
    if (p.type === 'kernel') {
      // A non-symmetric kernel catches transposed or mirrored indexing.
      const n = p.size * p.size;
      out.push([`${k}=ramp`, { [k]: Array.from({ length: n }, (_, i) => (i % 3) - 1 + (i === (n - 1) / 2 ? 2 : 0) + i / n) }]);
    }
  }
  return out;
}

/**
 * Concentric rings whose contrast fades from left to right: strong edges that continue as weak
 * ones, smooth gradients in every direction. Random noise alone never exercises things like
 * hysteresis or gradient directions properly.
 */
function structuredImage(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - w * 0.45, y - h * 0.55);
      const fade = 1 - 0.85 * (x / (w - 1));
      const v = 0.5 + 0.5 * fade * Math.sin(r * 0.7);
      const i = (y * w + x) * 4;
      data.set([v * v, v * 0.9, v * (1 - 0.3 * (y / h)), 1], i);
    }
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

// Non-multiple-of-8 sizes exercise the workgroup bounds check.
const images = { noise: testImage(67, 45), rings: structuredImage(71, 53) };

describe.each(filters.map((f) => [f.id, f as Filter] as const))('%s GPU <-> CPU parity', (_, f) => {
  const all = Object.entries(images).flatMap(([img, src]) => cases(f.params).map(([name, p]) => [`${img}: ${name}`, src, p] as const));
  it.each(all)('%s', async (_, src, params) => {
    const full = { ...defaultParams(f.params), ...params } as never;
    const out = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), full));
    const result = compareImages(out, f.cpu(src, full), f.tolerance);
    expect(result.pass, `${result.outliers} channels out of tolerance, worst ${JSON.stringify(result.worst)}`).toBe(true);
  });
});
