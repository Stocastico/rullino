// A very large image (200 MP by default, RULLINO_LARGE_MP to change it) through Dawn on a software
// GPU (lavapipe in CI) with a memory budget: `pnpm test:large`. It must render, and the GPU memory
// alive at any moment (every texture and buffer the device creates, counted until destroyed) must
// stay within the budget. Slow (minutes) and needs several GB of RAM for the CPU-side images, so it
// is a project of its own, outside the required check.
import { applyEditPixels } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/renderer';

const MP = Number(process.env.RULLINO_LARGE_MP ?? 200);
const BUDGET = 256 * 2 ** 20;

/** Counts the bytes of live textures and buffers of a device, and the most alive at once. */
function meter(device: GPUDevice) {
  const m = { live: 0, peak: 0 };
  const track = <T extends { destroy(): void }>(obj: T, bytes: number): T => {
    m.live += bytes;
    m.peak = Math.max(m.peak, m.live);
    const destroy = obj.destroy.bind(obj);
    let gone = false;
    obj.destroy = () => {
      if (!gone) m.live -= bytes;
      gone = true;
      destroy();
    };
    return obj;
  };
  const bpp: Record<string, number> = { rgba16float: 8, rgba32float: 16, r32float: 4 };
  const createTexture = device.createTexture.bind(device);
  device.createTexture = (d: GPUTextureDescriptor) => {
    const s = d.size as { width: number; height?: number; depthOrArrayLayers?: number };
    return track(createTexture(d), s.width * (s.height ?? 1) * (s.depthOrArrayLayers ?? 1) * (bpp[d.format] ?? 4));
  };
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (d: GPUBufferDescriptor) => track(createBuffer(d), d.size);
  return m;
}

describe(`a ${MP} MP image within a ${BUDGET / 2 ** 20} MB budget`, () => {
  it('renders, and the GPU memory alive never exceeds the budget', async () => {
    const r = await createRenderer({ backend: 'gpu', memoryBudget: BUDGET });
    try {
      const m = meter(r.gpu!.device);
      const width = Math.round(Math.sqrt((MP * 1e6 * 4) / 3));
      const height = Math.round((width * 3) / 4);
      const data = new Uint8Array(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        const p = i >> 2;
        data[i] = p % 251;
        data[i + 1] = (p >> 8) % 241;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
      const edit = {
        version: 2,
        steps: [
          { filter: 'exposure', params: { ev: 0.3 } },
          { filter: 'gaussianBlur', params: { sigma: 2 } },
          { filter: 'equalize', params: { amount: 0.5 } },
          { filter: 'vignette', params: {} },
        ],
      };
      const sides: number[] = [];
      const t0 = performance.now();
      const out = await applyEditPixels({ width, height, data }, edit, { filters, gpu: r.gpu!, memoryBudget: BUDGET, onTiling: (i) => sides.push(i.side) });
      const seconds = (performance.now() - t0) / 1000;
      console.log(`${width}×${height}: tiles of ${sides[0]} px, ${seconds.toFixed(1)} s, GPU peak ${(m.peak / 2 ** 20).toFixed(0)} MB`);
      expect([out.width, out.height]).toEqual([width, height]);
      expect(sides).toHaveLength(1);
      expect(m.peak).toBeLessThanOrEqual(BUDGET);
      // Not all one colour: the steps ran.
      expect(out.data[0]).not.toBe(out.data[(height >> 1) * width * 4 + (width >> 1) * 4]);
    } finally {
      r.destroy();
    }
  }, 3_600_000);
});
