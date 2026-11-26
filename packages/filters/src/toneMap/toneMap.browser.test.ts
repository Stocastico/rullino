import { compareImages, createGpuContext, createImage, fromFloat16Array, readImage, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { toneMap } from './index';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// The registry parity test changes one param at a time, and `white`, `blackEv`, `whiteEv` and
// `contrast` only act for one method each, which is not the default: here every method runs with its
// own params at their extremes, on an HDR ramp (values from 1e-4 to 1e4, semi-transparent pixels,
// colours outside sRGB).
const data = new Float32Array(61 * 7 * 4);
for (let i = 0, n = 0; i < data.length; i += 4, n++) {
  const x = n % 61;
  const t = 10 ** (-4 + (8 * x) / 60);
  const a = n % 7 === 6 ? 0.5 : 1;
  data.set([t * a, t * (0.3 + 0.2 * (n % 3)) * a, (n % 11 === 0 ? -0.2 : 1) * t * 0.5 * a, a], i);
}
const src = createImage(61, 7, fromFloat16Array(toFloat16Array(data)));

const cases: Record<string, Record<string, unknown>>[] = [];
for (const white of [1, 4, 64]) cases.push({ [`reinhard white ${white}`]: { method: 'reinhard', white, ev: 1 } });
for (const [blackEv, whiteEv, contrast] of [[-16, 12, 0.25], [-4, 2, 3], [-10, 6.5, 1], [-12, 3, 2], [-6, 9, 0.5]] as const)
  cases.push({ [`log ${blackEv} ${whiteEv} ×${contrast}`]: { method: 'log', blackEv, whiteEv, contrast, ev: -1 } });
for (const ev of [-5, 5]) cases.push({ [`filmic ev ${ev}`]: { method: 'filmic', ev } });

describe('toneMap GPU <-> CPU with every method\'s own params', () => {
  it.each(cases.flatMap((c) => Object.entries(c)))('%s', async (_, params) => {
    const full = { ...Object.fromEntries(Object.entries(toneMap.params).map(([k, v]) => [k, (v as { default: unknown }).default])), ...params } as never;
    const out = await readImage(ctx, runFilter(ctx, toneMap, uploadImage(ctx, src), full));
    const res = compareImages(out, toneMap.cpu(src, full), toneMap.tolerance);
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  });
});
