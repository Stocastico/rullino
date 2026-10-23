import { toGpuError, type GpuError } from './errors';

export interface GpuContext {
  readonly device: GPUDevice;
  /** The device's limits: the adapter's own (the WebGPU defaults are far lower, e.g. 8192 px textures). */
  readonly limits: GPUSupportedLimits;
  /** Resolves when the device is lost (driver reset, GPU switch, `device.destroy()`): recreate the context and re-upload your images. */
  readonly lost: Promise<GPUDeviceLostInfo>;
}

export class WebGpuUnavailableError extends Error {
  override name = 'WebGpuUnavailableError';
}

export interface GpuContextOptions extends GPURequestAdapterOptions {
  /**
   * Called with GPU errors the library can attribute: a shader that does not compile
   * (`ShaderCompileError`, naming the shader and the lines), validation and out-of-memory errors.
   * They arrive asynchronously, after the call that caused them. Without it they go to `console.error`.
   */
  readonly onError?: (error: GpuError) => void;
}

const reporters = new WeakMap<GPUDevice, (error: GpuError) => void>();

/** Reports an error through the context's `onError` (or `console.error`). Plumbing: exported by `@rullino/core/internal`. */
export function reportGpuError(ctx: Pick<GpuContext, 'device'>, error: GpuError): void {
  (reporters.get(ctx.device) ?? ((e) => console.error(e)))(error);
}

/** The limits worth raising to the adapter's own: they decide how large an image can be. */
const RAISED_LIMITS = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize'] as const;

export async function createGpuContext(options: GpuContextOptions = {}): Promise<GpuContext> {
  const { onError, ...adapterOptions } = options;
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new WebGpuUnavailableError('WebGPU is not available in this environment');
  }
  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  if (!adapter) throw new WebGpuUnavailableError('no WebGPU adapter found');
  const device = await adapter.requestDevice({ requiredLimits: Object.fromEntries(RAISED_LIMITS.map((k) => [k, adapter.limits[k]])) });
  if (onError) {
    reporters.set(device, onError);
    // Errors outside an error scope: tell the callback instead of the browser console.
    device.addEventListener('uncapturederror', (event) => {
      event.preventDefault();
      onError(toGpuError(event.error));
    });
  }
  return { device, limits: device.limits, lost: device.lost };
}
