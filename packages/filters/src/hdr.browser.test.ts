import { applyEdit, createGpuContext, createImage, fromFloat16Array, toFloat16Array } from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { filters } from './index';

// HDR through the whole pipeline (#182): light far above 1 survives every stage as it should (the
// GPU keeps halves, whose largest finite value is 65504), tone mapping brings it into [0, 1], and
// light beyond the largest half saturates instead of becoming infinity (which turns into NaN at the
// next filter).
const errors: string[] = [];
const gpu = await createGpuContext({ onError: (e) => errors.push(e.message) });
afterAll(() => gpu.device.destroy());

/** Scene-referred light: a ramp over seven decades, up to 40 000, a bright spot, and colours outside sRGB. */
function hdr(w: number, h: number, peak = 40000) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = peak * 10 ** (-7 * (1 - x / (w - 1)));
      data.set([t, t * (0.5 + 0.4 * (y / h)), (y % 5 === 0 ? -0.1 : 0.7) * t, 1], (y * w + x) * 4);
    }
  data.set([peak, peak, peak, 1], (2 * w + 3) * 4);
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

const chain = (steps: unknown[]) => ({ version: 2, steps });
const tone = { filter: 'toneMap', params: {} };

describe('HDR through the pipeline', () => {
  it('a 40 000 highlight goes through exposure, saturation, a blur and tone mapping on the GPU as on the CPU', async () => {
    const doc = chain([{ filter: 'exposure', params: { ev: -2 } }, { filter: 'saturation', params: { amount: 0.3 } }, { filter: 'gaussianBlur', params: { sigma: 1.5 } }, tone]);
    const src = hdr(61, 23);
    const [onGpu, onCpu] = await Promise.all([applyEdit(src, doc, { filters, gpu }), applyEdit(src, doc, { filters })]);
    let worst = 0;
    for (let i = 0; i < onCpu.data.length; i++) {
      expect(Number.isFinite(onGpu.data[i]!)).toBe(true);
      expect(onGpu.data[i]!).toBeGreaterThanOrEqual(0);
      expect(onGpu.data[i]!).toBeLessThanOrEqual(1);
      worst = Math.max(worst, Math.abs(onGpu.data[i]! - onCpu.data[i]!));
    }
    expect(worst).toBeLessThan(5e-3);
    // The highlight really was far above 1 before the curve: it comes out bright, not black.
    expect(onGpu.data[(2 * 61 + 3) * 4]!).toBeGreaterThan(0.9);
    await gpu.device.queue.onSubmittedWorkDone();
    expect(errors).toEqual([]);
  });

  it('light beyond the largest half saturates: a 1e6 pixel is white after tone mapping, not NaN', async () => {
    const src = createImage(3, 1, Float32Array.of(1e6, 1e6, 1e6, 1, 3e5, 0, 0, 1, -1e6, 2, 0.1, 1));
    const out = await applyEdit(src, chain([tone]), { filters, gpu });
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(out.data.slice(0, 4))).toEqual([1, 1, 1, 1]);
    expect(out.data[4]).toBe(1);
    expect(out.data[5]).toBeLessThan(0.01);
    expect(out.data[8]).toBe(0); // negative channel: black in that channel
  });
});
