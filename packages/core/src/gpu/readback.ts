import type { GpuContext } from './context';

/**
 * Copies a whole 2D texture into CPU memory, tightly packed.
 * copyTextureToBuffer needs bytesPerRow to be a multiple of 256, so rows are padded and then un-padded.
 */
export async function readTextureBytes(ctx: GpuContext, tex: GPUTexture, bytesPerPixel: number): Promise<ArrayBuffer> {
  const { width, height } = tex;
  const rowBytes = width * bytesPerPixel;
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const buffer = ctx.device.createBuffer({
    size: paddedRowBytes * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: paddedRowBytes }, { width, height });
  ctx.device.queue.submit([enc.finish()]);

  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    out.set(padded.subarray(y * paddedRowBytes, y * paddedRowBytes + rowBytes), y * rowBytes);
  }
  buffer.unmap();
  buffer.destroy();
  return out.buffer;
}

const pipelines = new WeakMap<GPUDevice, Map<string, GPUComputePipeline>>();

/** Compiles a compute pipeline once per device and key. */
export function cachedPipeline(ctx: GpuContext, key: string, code: () => string): GPUComputePipeline {
  let cache = pipelines.get(ctx.device);
  if (!cache) pipelines.set(ctx.device, (cache = new Map()));
  let pipeline = cache.get(key);
  if (!pipeline) {
    const module = ctx.device.createShaderModule({ label: key, code: code() });
    pipeline = ctx.device.createComputePipeline({ label: key, layout: 'auto', compute: { module } });
    cache.set(key, pipeline);
  }
  return pipeline;
}
