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

const objectIds = new WeakMap<object, number>();
let nextObjectId = 0;
/**
 * A number unique to `o` for the lifetime of the page. Shader cache keys use it instead of a
 * filter's `id`, which two different filters can share (e.g. a user filter reusing a built-in id).
 */
export function objectKey(o: object): number {
  let k = objectIds.get(o);
  if (k === undefined) objectIds.set(o, (k = ++nextObjectId));
  return k;
}

/**
 * Compiles a compute pipeline once per device and key. With `layout: 'auto'` (the default)
 * WebGPU drops bindings the shader never touches, so pass explicit layout entries whenever a
 * shader may declare a binding it does not use.
 */
export function cachedPipeline(
  ctx: GpuContext,
  key: string,
  code: () => string,
  layout?: () => GPUBindGroupLayoutEntry[],
): GPUComputePipeline {
  let cache = pipelines.get(ctx.device);
  if (!cache) pipelines.set(ctx.device, (cache = new Map()));
  let pipeline = cache.get(key);
  if (!pipeline) {
    const module = ctx.device.createShaderModule({ label: key, code: code() });
    const explicit = layout
      ? ctx.device.createPipelineLayout({ bindGroupLayouts: [ctx.device.createBindGroupLayout({ label: key, entries: layout() })] })
      : 'auto';
    pipeline = ctx.device.createComputePipeline({ label: key, layout: explicit, compute: { module } });
    cache.set(key, pipeline);
  }
  return pipeline;
}
