import { compareImages, createGpuContext, createImage, fromFloat16Array, Pipeline, readImage, runChainCpu, toFloat16Array, uploadImage } from '@rullino/core';
import { afterAll, expect, it } from 'vitest';
import { looks, lookSteps } from './looks';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Smooth hue / lightness sweep with some transparency, float16-quantised like the parity suite.
const w = 61;
const h = 41;
const data = new Float32Array(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const a = x % 13 === 0 ? 0.5 : 1;
    const t = x / (w - 1);
    const l = y / (h - 1);
    data.set([l * (0.5 + 0.5 * Math.cos(6.28 * t)) * a, l * (0.5 + 0.5 * Math.cos(6.28 * t - 2.1)) * a, l * (0.5 + 0.5 * Math.cos(6.28 * t + 2.1)) * a, a], (y * w + x) * 4);
  }
}
const src = createImage(w, h, fromFloat16Array(toFloat16Array(data)));
const pipe = new Pipeline(ctx);
pipe.setSource(uploadImage(ctx, src));
afterAll(() => pipe.destroy());

it.each(looks.map((l) => [l.id, l] as const))('%s: GPU matches the CPU chain', async (_, look) => {
  const steps = lookSteps(look, { intensity: 0.8 });
  const out = await readImage(ctx, pipe.run(steps));
  // Summed tolerances of applyLut, vignette and grain (each multipass stage rounds to f16).
  const res = compareImages(out, runChainCpu(steps, src), { abs: 1e-3, rel: 6e-3 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
