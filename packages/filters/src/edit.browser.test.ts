import { applyEdit, createGpuContext, createImage, fromFloat16Array, IDENTITY_GEOMETRY, serializeChain, toFloat16Array } from '@rullino/core';
import { afterAll, describe, expect, it } from 'vitest';
import { contrast, exposure, filters, gaussianBlur, vignette } from './index';

// applyEdit renders the same document on the GPU and on the CPU; the results agree within the
// summed tolerances of the steps (the GPU keeps f32 between fused filters, the CPU f64).
const errors: string[] = [];
const gpu = await createGpuContext({ onError: (e) => errors.push(e.message) });
afterAll(() => gpu.device.destroy());

function photo(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w * 0.4, y - h * 0.6) * 0.5);
    data.set([v * v, v * 0.8, (x / w) * 0.9, 1], (y * w + x) * 4);
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

describe('applyEdit on the GPU', () => {
  it('matches the CPU: geometry, fused and multipass steps, a mask, long side', async () => {
    const doc = JSON.parse(JSON.stringify(serializeChain(
      [
        { filter: exposure, params: { ev: 0.4 } },
        { filter: contrast, params: { amount: 0.2 } },
        { filter: gaussianBlur, params: { sigma: 2 }, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.3], feather: 0.5 } },
        { filter: vignette },
      ],
      { geometry: { ...IDENTITY_GEOMETRY, rotate: 270, flipH: true, straighten: 3, crop: { x: 0.05, y: 0.1, width: 0.8, height: 0.7 } }, output: { longSide: 37 } },
    )));
    const src = photo(67, 45);
    const [onGpu, onCpu] = await Promise.all([applyEdit(src, doc, { filters, gpu }), applyEdit(src, doc, { filters })]);
    expect([onGpu.width, onGpu.height]).toEqual([onCpu.width, onCpu.height]);
    expect(Math.max(onGpu.width, onGpu.height)).toBe(37);
    let worst = 0;
    for (let i = 0; i < onCpu.data.length; i++) worst = Math.max(worst, Math.abs(onGpu.data[i]! - onCpu.data[i]!));
    expect(worst).toBeGreaterThan(0); // really two different renderers
    expect(worst).toBeLessThan(4e-3);
    await gpu.device.queue.onSubmittedWorkDone();
    expect(errors).toEqual([]);
  });

  it('an empty edit returns the image', async () => {
    const src = photo(9, 7);
    const out = await applyEdit(src, { version: 2, steps: [] }, { filters, gpu });
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });
});
