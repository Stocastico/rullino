import {
  compareImages,
  createGpuContext,
  createImage,
  defaultParams,
  fromFloat16Array,
  readImage,
  runPointwise,
  toFloat16Array,
  uploadImage,
  type ParamSchema,
  type PointwiseFilter,
} from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { filters } from './index';

// Every registered filter is checked GPU <-> CPU at its defaults and at the extremes of each
// parameter (every option for enums, both values for bools). New filters get this for free.

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
  }
  return out;
}

// Non-multiple-of-8 size exercises the workgroup bounds check.
const src = testImage(67, 45);

describe.each(filters.map((f) => [f.id, f as PointwiseFilter] as const))('%s GPU <-> CPU parity', (_, f) => {
  it.each(cases(f.params))('%s', async (_, params) => {
    const full = { ...defaultParams(f.params), ...params } as never;
    const out = await readImage(ctx, runPointwise(ctx, f, uploadImage(ctx, src), full));
    const result = compareImages(out, f.cpu(src, full), f.tolerance);
    expect(result.worst ?? null, JSON.stringify(result.worst)).toBeNull();
  });
});
