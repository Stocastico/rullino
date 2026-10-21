export interface GpuContext {
  readonly device: GPUDevice;
}

export class WebGpuUnavailableError extends Error {
  override name = 'WebGpuUnavailableError';
}

export async function createGpuContext(options: GPURequestAdapterOptions = {}): Promise<GpuContext> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new WebGpuUnavailableError('WebGPU is not available in this environment');
  }
  const adapter = await navigator.gpu.requestAdapter(options);
  if (!adapter) throw new WebGpuUnavailableError('no WebGPU adapter found');
  const device = await adapter.requestDevice();
  return { device };
}
