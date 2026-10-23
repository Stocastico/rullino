import { createImage, createRasterMask, type LinearImage } from '@rullino/core';
import type { SamPoint, SamSegmenter } from '@rullino/ml';
import { describe, expect, it, vi } from 'vitest';
import { chooseBackend, createObjectSelector, isSoftwareAdapter } from './object-select';

function setup(gpu: { software: boolean } | undefined = { software: false }) {
  const calls = { encode: 0, segment: [] as SamPoint[][], models: [] as string[], providers: [] as unknown[], loadOrt: 0 };
  const statuses: string[] = [];
  const images = new Map<string, LinearImage>();
  const segmenter: SamSegmenter = {
    async encode() {
      calls.encode++;
      return { frame: { width: 1024, height: 512 }, tensors: {} };
    },
    async segment(_, points, w, h) {
      calls.segment.push([...points]);
      // Selects the left half.
      const data = new Float32Array(w * h);
      for (let i = 0; i < data.length; i++) data[i] = i % w < w / 2 ? 1 : 0;
      return { mask: createRasterMask(w, h, data), score: 0.9 };
    },
    async release() {},
  };
  const selector = createObjectSelector({
    loadOrt: async () => {
      calls.loadOrt++;
      return {} as never;
    },
    gpu: async () => gpu,
    image: async (w, h) => {
      const key = `${w}x${h}`;
      if (!images.has(key)) images.set(key, createImage(w, h));
      return images.get(key)!;
    },
    status: (m) => statuses.push(m),
    fetchModel: async (f, o) => {
      calls.models.push((typeof f === 'string' ? f : f.url).split('/').at(-1)!);
      o?.onProgress?.(10, 0);
      return new Uint8Array(1);
    },
    createSegmenter: async (_ort, _files, options) => {
      calls.providers.push(options?.sessionOptions?.executionProviders);
      return segmenter;
    },
  });
  return { selector, calls, statuses };
}

describe('chooseBackend / isSoftwareAdapter', () => {
  it('real GPUs get the fp32 model on WebGPU; software GPUs and no WebGPU get the quantized model on WASM', () => {
    expect(chooseBackend({ software: false })).toMatchObject({ variant: 'fp32', providers: ['webgpu', 'wasm'] });
    expect(chooseBackend({ software: true })).toMatchObject({ variant: 'quantized', providers: ['wasm'] });
    expect(chooseBackend(undefined)).toMatchObject({ variant: 'quantized', providers: ['wasm'] });
  });

  it('recognises software adapters', () => {
    const adapter = (info: object, isFallbackAdapter = false) => ({ info, isFallbackAdapter }) as unknown as GPUAdapter;
    expect(isSoftwareAdapter(null)).toBe(true);
    expect(isSoftwareAdapter(adapter({ vendor: 'google', architecture: 'swiftshader' }))).toBe(true);
    expect(isSoftwareAdapter(adapter({ vendor: 'nvidia', architecture: 'ampere' }, true))).toBe(true);
    expect(isSoftwareAdapter(adapter({ vendor: 'apple', architecture: 'metal-3' }))).toBe(false);
  });
});

describe('createObjectSelector', () => {
  it('loads the model on first use (with progress), encodes each image once, and keeps the base mask', async () => {
    const { selector, calls, statuses } = setup({ software: true });
    const base = createRasterMask(4, 2, new Float32Array([0, 0, 0, 0.7, 0, 0, 0, 0]));
    const out = await selector.select(base, [{ x: 0.2, y: 0.5, positive: true }]);
    expect(calls.models).toEqual(['vision_encoder_quantized.onnx', 'prompt_encoder_mask_decoder_quantized.onnx']);
    expect(calls.providers).toEqual([['wasm']]);
    expect(statuses[0]).toMatch(/Downloading the selection model \(14 MB/);
    expect(statuses.some((s) => /Analysing the image/.test(s))).toBe(true);
    // Left half from the selection, the base's 0.7 kept on the right.
    expect(Array.from(out.data)).toEqual([1, 1, 0, Math.fround(0.7), 1, 1, 0, 0]);
    await selector.select(base, [{ x: 0.2, y: 0.5, positive: true }, { x: 0.8, y: 0.5, positive: false }]);
    expect([calls.encode, calls.loadOrt, calls.models.length]).toEqual([1, 1, 2]);
    expect(calls.segment[1]).toHaveLength(2);
    // Another raster size is another image: encoded again.
    await selector.select(createRasterMask(8, 4), [{ x: 0.5, y: 0.5, positive: true }]);
    expect(calls.encode).toBe(2);
  });

  it('uses the fp32 model on WebGPU with a real GPU, and retries after a failed load', async () => {
    const { selector, calls } = setup({ software: false });
    await selector.select(createRasterMask(2, 2), [{ x: 0.5, y: 0.5, positive: true }]);
    expect(calls.models).toEqual(['vision_encoder.onnx', 'prompt_encoder_mask_decoder.onnx']);
    expect(calls.providers).toEqual([['webgpu', 'wasm']]);

    let fail = true;
    const flaky = createObjectSelector({
      loadOrt: async () => ({}) as never,
      gpu: async () => undefined,
      image: async (w, h) => createImage(w, h),
      status: () => {},
      fetchModel: vi.fn(async () => {
        if (fail) throw new Error('offline');
        return new Uint8Array(1);
      }),
      createSegmenter: async () => ({ encode: async () => ({ frame: { width: 1, height: 1 }, tensors: {} }), segment: async (_, __, w, h) => ({ mask: createRasterMask(w, h), score: 1 }), release: async () => {} }),
    });
    await expect(flaky.select(createRasterMask(2, 2), [{ x: 0.5, y: 0.5, positive: true }])).rejects.toThrow('offline');
    fail = false;
    await expect(flaky.select(createRasterMask(2, 2), [{ x: 0.5, y: 0.5, positive: true }])).resolves.toBeDefined();
  });
});
