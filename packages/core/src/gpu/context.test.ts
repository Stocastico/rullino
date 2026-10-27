import { describe, expect, it } from 'vitest';
import { createGpuContext, WebGpuUnavailableError } from './context';

// The WebGPU entry point can be passed in (Node: Dawn's `create()` from the `webgpu` package)
// instead of being read from `navigator.gpu`.
function fakeGpu(adapter: unknown) {
  return { requestAdapter: async () => adapter } as unknown as GPU;
}

describe('createGpuContext({ gpu })', () => {
  it('uses the given entry point instead of navigator.gpu', async () => {
    const limits = { maxTextureDimension2D: 16384, maxBufferSize: 2 ** 32, maxStorageBufferBindingSize: 2 ** 31 };
    let required: unknown;
    const device = { limits, lost: new Promise(() => {}), addEventListener() {} };
    const adapter = { limits, requestDevice: async (d: { requiredLimits: unknown }) => ((required = d.requiredLimits), device) };
    const ctx = await createGpuContext({ gpu: fakeGpu(adapter) });
    expect(ctx.device).toBe(device);
    expect(required).toEqual(limits);
  });

  it('reports a missing adapter on the given entry point', async () => {
    await expect(createGpuContext({ gpu: fakeGpu(null) })).rejects.toThrow(WebGpuUnavailableError);
  });
});
