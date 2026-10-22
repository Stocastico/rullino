import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGpuContext, WebGpuUnavailableError } from './gpu/context';
import { createImage } from './image';

afterEach(() => vi.unstubAllGlobals());

describe('createGpuContext without WebGPU', () => {
  it('throws WebGpuUnavailableError when navigator.gpu is missing or has no adapter', async () => {
    vi.stubGlobal('navigator', {});
    await expect(createGpuContext()).rejects.toBeInstanceOf(WebGpuUnavailableError);
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
    await expect(createGpuContext()).rejects.toThrow(/no WebGPU adapter/);
  });
});

describe('createImage', () => {
  it('checks the data length', () => {
    expect(() => createImage(2, 2, new Float32Array(15))).toThrow(/16 floats/);
    expect(createImage(2, 1).data).toHaveLength(8);
  });
});
