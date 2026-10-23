import { createImage, type LinearImage } from '@rullino/core';
import type { DepthEstimator } from '@rullino/ml';
import { describe, expect, it } from 'vitest';
import { createDepthMapper } from './depth-estimate';

function setup(failFirstLoad = false) {
  const calls = { estimate: [] as LinearImage[], models: [] as string[], providers: [] as unknown[], loadOrt: 0, created: 0 };
  const statuses: string[] = [];
  const estimator: DepthEstimator = {
    async estimate(image) {
      calls.estimate.push(image);
      return createImage(14, 14);
    },
    async release() {},
  };
  const mapper = createDepthMapper({
    loadOrt: async () => {
      calls.loadOrt++;
      return {} as never;
    },
    status: (m) => statuses.push(m),
    fetchModel: async (url, o) => {
      calls.models.push(url.split('/').at(-1)!);
      o?.onProgress?.(13_629_400, 27_258_801);
      return new Uint8Array(1);
    },
    createEstimator: async (_ort, _model, options) => {
      calls.created++;
      if (failFirstLoad && calls.created === 1) throw new Error('offline');
      calls.providers.push(options?.sessionOptions?.executionProviders);
      return estimator;
    },
  });
  return { mapper, calls, statuses };
}

describe('createDepthMapper', () => {
  it('loads the model on first use with progress, always on WASM, and reuses the session', async () => {
    const { mapper, calls, statuses } = setup();
    const image = createImage(4, 2);
    const map = await mapper.estimate(image);
    expect(calls.models).toEqual(['model_int8.onnx']);
    expect(calls.providers).toEqual([['wasm']]);
    expect(statuses[0]).toMatch(/Downloading the depth model \(27 MB, first use only\)… 50%/);
    expect(statuses.some((s) => /Estimating depth/.test(s))).toBe(true);
    expect([map.width, map.height]).toEqual([14, 14]);
    await mapper.estimate(image);
    expect([calls.loadOrt, calls.models.length, calls.created, calls.estimate.length]).toEqual([1, 1, 1, 2]);
  });

  it('retries loading after a failure', async () => {
    const { mapper, calls } = setup(true);
    await expect(mapper.estimate(createImage(2, 2))).rejects.toThrow('offline');
    await mapper.estimate(createImage(2, 2));
    expect(calls.created).toBe(2);
  });
});
