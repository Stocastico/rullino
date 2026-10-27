import { applyEdit, createImage, fromFloat16Array, toFloat16Array, WebGpuUnavailableError, type LinearImage } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks, resolveLookLut } from '@rullino/presets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, type Renderer } from './index';

// A smooth chart with partial alpha, f16-quantised like everything that comes off a GPU texture.
function chart(w: number, h: number): LinearImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = x < 4 ? 0.5 : 1;
      img.data.set([((x / w) ** 2) * a, (y / h) * a, 0.3 * (1 + Math.sin(x * 0.3)) * a, a], (y * w + x) * 4);
    }
  return createImage(w, h, fromFloat16Array(toFloat16Array(img.data)));
}

/** An edit with a look (LUT by name), a blur, curves and a radial mask: GPU and CPU must agree. */
const edit = {
  version: 2,
  steps: [
    ...lookEdit(looks[1]!, { intensity: 0.8 }).steps,
    { filter: 'gaussianBlur', params: { sigma: 1.5 } },
    { filter: 'curves', params: { rgb: [[0, 0], [0.4, 0.3], [1, 1]] }, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.3], feather: 0.5 } },
  ],
};

/** Same bound as the browser vs Node check: |Δ| ≤ 4e-3 + 4e-3·|v| per channel. */
function expectClose(a: LinearImage, b: LinearImage) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let bad = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i]! - b.data[i]!) > 4e-3 + 4e-3 * Math.abs(b.data[i]!)) bad++;
  expect(bad).toBe(0);
}

const renderers: Renderer[] = [];
const make = async (...args: Parameters<typeof createRenderer>) => {
  const r = await createRenderer(...args);
  renderers.push(r);
  return r;
};
afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  vi.restoreAllMocks();
});

/** A WebGPU entry point without adapters, as on a machine whose GPU is blocklisted. */
const noAdapter = { requestAdapter: async () => null } as unknown as GPU;

describe('createRenderer (browser)', () => {
  it("'auto' picks WebGPU when it is there", async () => {
    const r = await make();
    expect(r.backend).toBe('gpu');
    expect(r.reason).toBeUndefined();
  });

  it("'auto' falls back to the CPU and says why", async () => {
    const r = await make({ gpu: noAdapter });
    expect(r.backend).toBe('cpu');
    expect(r.reason).toMatch(/adapter/);
  });

  it("'gpu' throws WebGpuUnavailableError instead of falling back", async () => {
    await expect(createRenderer({ backend: 'gpu', gpu: noAdapter })).rejects.toBeInstanceOf(WebGpuUnavailableError);
  });

  it('the CPU backend renders in a Web Worker, within tolerance of the GPU', async () => {
    const spawn = vi.spyOn(globalThis, 'Worker');
    const src = chart(53, 37);
    const gpu = await (await make()).apply(src, edit);
    const cpu = await make({ backend: 'cpu' });
    expect(cpu.backend).toBe('cpu');
    const out = await cpu.apply(src, edit);
    expect(spawn).toHaveBeenCalledTimes(1);
    expectClose(out, gpu);
    // Not the same implementation by accident: the two differ somewhere.
    expect(out.data.some((v, i) => v !== gpu.data[i])).toBe(true);
    expect(Array.from(src.data)).toEqual(Array.from(chart(53, 37).data)); // the input is untouched
  });

  it('runs several renders in one worker and keeps them apart', async () => {
    const spawn = vi.spyOn(globalThis, 'Worker');
    const cpu = await make({ backend: 'cpu' });
    const a = chart(20, 10);
    const b = chart(31, 7);
    const [ra, rb] = await Promise.all([cpu.apply(a, edit), cpu.apply(b, edit, { scale: 0.5 })]);
    expect(spawn).toHaveBeenCalledTimes(1);
    // The same code as applyEdit on this thread: the same numbers, scale and LUTs included.
    const here = (img: LinearImage, scale?: number) => applyEdit(img, edit, { filters, resolveLut: resolveLookLut, ...(scale && { scale }) });
    expect(Array.from(ra.data)).toEqual(Array.from((await here(a)).data));
    expect(Array.from(rb.data)).toEqual(Array.from((await here(b, 0.5)).data));
    expect(Array.from(rb.data)).not.toEqual(Array.from((await here(b)).data)); // scale mattered
  });

  it('reports a bad document before reaching the worker, and errors from the worker', async () => {
    const cpu = await make({ backend: 'cpu' });
    await expect(cpu.apply(chart(4, 4), { version: 2, steps: [{ filter: 'nope', params: {} }] })).rejects.toThrow(/nope/);
    // A mask-aware filter without a mask fails inside the worker.
    await expect(cpu.apply(chart(4, 4), { version: 2, steps: [{ filter: 'inpaint', params: {} }] })).rejects.toThrow(/mask/);
  });

  it('with custom filters the CPU backend runs on the main thread', async () => {
    const spawn = vi.spyOn(globalThis, 'Worker');
    const cpu = await make({ backend: 'cpu', filters });
    const out = await cpu.apply(chart(9, 5), edit);
    expect(out.width).toBe(9);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('render() takes ImageData or an encoded file and encodes as the document says', async () => {
    for (const backend of ['gpu', 'cpu'] as const) {
      const r = await make({ backend });
      const pixels = new ImageData(new Uint8ClampedArray(16 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 13) % 256)), 16, 8);
      const doc = { version: 2, steps: [{ filter: 'exposure', params: { ev: 1 } }], output: { format: 'png', longSide: 8 } };
      const png = await r.render(pixels, doc);
      expect(png.type).toBe('image/png');
      const decoded = await createImageBitmap(png);
      expect([decoded.width, decoded.height]).toEqual([8, 4]);
      const again = await r.render(png, { version: 2, steps: [], output: { format: 'jpeg' } });
      expect(again.type).toBe('image/jpeg');
    }
  });
});
