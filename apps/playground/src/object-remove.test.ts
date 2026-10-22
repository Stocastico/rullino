import { createImage, createRasterMask, type LinearImage } from '@rullino/core';
import type { Inpainter } from '@rullino/ml';
import { describe, expect, it } from 'vitest';
import { createObjectRemover } from './object-remove';

function setup(gpu: { software: boolean } | undefined = { software: false }, failFirstLoad = false) {
  const calls = { fill: [] as LinearImage[], models: [] as string[], providers: [] as unknown[], loadOrt: 0, created: 0 };
  const statuses: string[] = [];
  const inpainter: Inpainter = {
    async inpaint(image) {
      calls.fill.push(image);
      const out = createImage(image.width, image.height);
      out.data.fill(0.5);
      return out;
    },
    async release() {},
  };
  const remover = createObjectRemover({
    loadOrt: async () => {
      calls.loadOrt++;
      return {} as never;
    },
    gpu: async () => gpu,
    status: (m) => statuses.push(m),
    fetchModel: async (url, o) => {
      calls.models.push(url.split('/').at(-1)!);
      o?.onProgress?.(14_039_590, 28_079_181);
      return new Uint8Array(1);
    },
    createInpainter: async (_ort, _model, options) => {
      calls.created++;
      if (failFirstLoad && calls.created === 1) throw new Error('offline');
      calls.providers.push(options?.sessionOptions?.executionProviders);
      return inpainter;
    },
  });
  return { remover, calls, statuses };
}

describe('createObjectRemover', () => {
  it('loads the model on first use with progress, picks the provider by GPU kind, and reuses the session', async () => {
    const { remover, calls, statuses } = setup({ software: true });
    const image = createImage(4, 2);
    const out = await remover.fill(image, createRasterMask(4, 2));
    expect(calls.models).toEqual(['migan_pipeline_v2.onnx']);
    expect(calls.providers).toEqual([['wasm']]);
    expect(statuses[0]).toMatch(/Downloading the removal model \(28 MB, first use only\)… 50%/);
    expect(statuses.some((s) => /Filling the area/.test(s))).toBe(true);
    expect([out.width, out.height, out.data[0]]).toEqual([4, 2, 0.5]);
    await remover.fill(image, createRasterMask(4, 2));
    expect([calls.loadOrt, calls.models.length, calls.created, calls.fill.length]).toEqual([1, 1, 1, 2]);
  });

  it('uses WebGPU first on a real GPU', async () => {
    const { remover, calls } = setup({ software: false });
    await remover.fill(createImage(2, 2), createRasterMask(2, 2));
    expect(calls.providers).toEqual([['webgpu', 'wasm']]);
  });

  it('retries loading after a failure', async () => {
    const { remover, calls } = setup(undefined, true);
    await expect(remover.fill(createImage(2, 2), createRasterMask(2, 2))).rejects.toThrow('offline');
    await remover.fill(createImage(2, 2), createRasterMask(2, 2));
    expect(calls.created).toBe(2);
  });
});
