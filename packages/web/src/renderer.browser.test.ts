import { applyEdit, createImage, encodeSrgb8, fromFloat16Array, toFloat16Array, WebGpuUnavailableError, type LinearImage } from '@rullino/core';
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

  it('pixels() returns 8-bit ImageData: what apply() gives, encoded (on the GPU, or in the worker)', async () => {
    const src = chart(37, 21);
    for (const backend of ['gpu', 'cpu'] as const) {
      const spawn = vi.spyOn(globalThis, 'Worker');
      const r = await make({ backend });
      const px = await r.pixels(src, edit, { scale: 0.5 });
      expect(px).toBeInstanceOf(ImageData);
      expect([px.width, px.height]).toEqual([37, 21]);
      const expected = encodeSrgb8(await r.apply(src, edit, { scale: 0.5 }));
      let worst = 0;
      for (let i = 0; i < expected.length; i++) worst = Math.max(worst, Math.abs(px.data[i]! - expected[i]!));
      expect(worst, backend).toBeLessThanOrEqual(1);
      expect(spawn).toHaveBeenCalledTimes(backend === 'cpu' ? 1 : 0);
      spawn.mockRestore();
    }
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

// Threads: the same bytes as one thread, whichever way the bands travel.
const FORCE = { createAtPixels: 0, useAtPixels: 0, forceBands: true } as const;
const sameBytes = (a: LinearImage, b: LinearImage) => {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let i = 0;
  while (i < a.data.length && Object.is(a.data[i], b.data[i])) i++;
  expect(i, `first difference at channel ${i}: ${a.data[i]} against ${b.data[i]}`).toBe(a.data.length);
};

describe('createRenderer({ threads }) (browser)', () => {
  const documents: Record<string, unknown> = {
    'look, blur, curves and a mask': edit,
    'pointwise only': { version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }, { filter: 'vignette', params: {} }] },
    'positional and neighbourhood': { version: 2, steps: [{ filter: 'gaussianBlur', params: { sigma: 3 } }, { filter: 'grain', params: {} }, { filter: 'unsharpMask', params: {} }] },
    'a global step in the middle': { version: 2, steps: [{ filter: 'gaussianBlur', params: { sigma: 2 } }, { filter: 'equalize', params: {} }, { filter: 'sharpen', params: {} }] },
    'geometry and long side': { version: 2, geometry: { rotate: 0, flipH: false, flipV: false, straighten: 5, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }, steps: [{ filter: 'gaussianBlur', params: { sigma: 2 } }], output: { format: 'png', longSide: 40 } },
  };
  const src = chart(53, 61);

  for (const shared of [false, true]) {
    describe(shared ? 'shared memory' : 'copied bands', () => {
      it.each(Object.entries(documents))('%s: the result is bit-identical to one thread', async (_, doc) => {
        const seen: { bands: number; shared: boolean }[] = [];
        const one = await make({ backend: 'cpu' });
        const many = await make({ backend: 'cpu', threads: 3, pool: { ...FORCE, shared, onRender: (i) => seen.push(i) } });
        sameBytes(await many.apply(src, doc), await one.apply(src, doc));
        expect(seen).toHaveLength(1);
        expect(seen[0]!.shared).toBe(shared);
        expect(seen[0]!.bands, 'the render was split into bands').toBeGreaterThan(1);
      });
    });
  }

  it('pixels() and 8-bit input give the same bytes too', async () => {
    const bytes = new ImageData(new Uint8ClampedArray(31 * 23 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)), 31, 23);
    const one = await make({ backend: 'cpu' });
    const many = await make({ backend: 'cpu', threads: 2, pool: FORCE });
    expect(Array.from((await many.pixels(bytes as never, edit)).data)).toEqual(Array.from((await one.pixels(bytes as never, edit)).data));
    sameBytes(await many.apply(bytes as never, edit), await one.apply(bytes as never, edit));
  });

  it('does not touch the caller\'s image', async () => {
    const many = await make({ backend: 'cpu', threads: 2, pool: FORCE });
    await many.apply(src, edit);
    expect(Array.from(src.data)).toEqual(Array.from(chart(53, 61).data));
  });

  it('small images stay in the render worker (below the thresholds), a larger one starts the pool', async () => {
    const seen: number[] = [];
    const r = await make({ backend: 'cpu', threads: 2, pool: { createAtPixels: 2000, useAtPixels: 1000, onRender: (i) => seen.push(i.bands) } });
    const doc = { version: 2, steps: [{ filter: 'gaussianBlur', params: { sigma: 1 } }] };
    await r.apply(chart(20, 20), doc); // 400 px
    await r.apply(chart(60, 60), doc); // 3600 px
    await r.apply(chart(40, 30), doc); // 1200 px: above useAtPixels, the pool exists now
    expect(seen.map((n) => n > 0)).toEqual([false, true, true]);
  });

  it('threads 1 never starts band workers', async () => {
    const seen: number[] = [];
    const r = await make({ backend: 'cpu', threads: 1, pool: { ...FORCE, onRender: (i) => seen.push(i.bands) } });
    await r.apply(src, edit);
    expect(seen).toEqual([0]);
  });

  it('validates the option, and accepts auto', async () => {
    await expect(createRenderer({ backend: 'cpu', threads: 0 })).rejects.toThrow(/threads/);
    await expect(createRenderer({ backend: 'cpu', threads: 1.5 })).rejects.toThrow(/threads/);
    const r = await make({ backend: 'cpu', threads: 'auto' });
    expect(r.backend).toBe('cpu');
  });

  it('keeps renders apart: overlapping ones, and different documents one after the other on the same workers', async () => {
    const one = await make({ backend: 'cpu' });
    const many = await make({ backend: 'cpu', threads: 3, pool: FORCE });
    const jobs = [
      [chart(40, 33), documents['look, blur, curves and a mask']],
      [chart(25, 50), documents['positional and neighbourhood']],
      [chart(61, 17), documents['a global step in the middle']],
      [chart(33, 33), documents['pointwise only']],
    ] as const;
    const results = await Promise.all(jobs.map(([img, doc]) => many.apply(img, doc)));
    for (const [i, [img, doc]] of jobs.entries()) sameBytes(results[i]!, await one.apply(img, doc));
    for (const [img, doc] of [...jobs].reverse()) sameBytes(await many.apply(img, doc), await one.apply(img, doc));
  });

  it('a band worker that cannot start fails the render with a message, and the renderer recovers', async () => {
    const r = await make({ backend: 'cpu', threads: 2, pool: { ...FORCE, workerUrl: new URL('./does-not-exist.js', import.meta.url) } });
    await expect(r.apply(src, edit)).rejects.toThrow(/could not start the band workers/);
    await expect(r.apply(src, edit)).rejects.toThrow(/could not start the band workers/); // tries again
  });

  it('errors raised in a band surface, and the next render works', async () => {
    const r = await make({ backend: 'cpu', threads: 2, pool: FORCE });
    await expect(r.apply(src, { version: 2, steps: [{ filter: 'inpaint', params: {} }] })).rejects.toThrow(/mask/);
    const one = await make({ backend: 'cpu' });
    sameBytes(await r.apply(src, edit), await one.apply(src, edit));
  });

  it('destroy() during a render rejects it', async () => {
    const r = await make({ backend: 'cpu', threads: 2, pool: FORCE });
    const pending = r.apply(chart(400, 300), { version: 2, steps: [{ filter: 'kuwahara', params: {} }] });
    setTimeout(() => r.destroy(), 20);
    await expect(pending).rejects.toThrow(/destroyed|failed/);
  });
});

