import { reportGpuError, type GpuContext } from './context';
import { ShaderCompileError, toGpuError } from './errors';

// One idle staging buffer per device, reused when the next read has the same size: a 12 MP readback
// allocated (and zero-filled) 48 MB per frame. Reads in flight take their own buffer.
const idleBuffers = new WeakMap<GPUDevice, GPUBuffer>();

/**
 * Copies a whole 2D texture into CPU memory, tightly packed.
 * copyTextureToBuffer needs bytesPerRow to be a multiple of 256, so rows are padded and then un-padded.
 */
export async function readTextureBytes(ctx: GpuContext, tex: GPUTexture, bytesPerPixel: number): Promise<ArrayBuffer> {
  const { width, height } = tex;
  const rowBytes = width * bytesPerPixel;
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const size = paddedRowBytes * height;
  let buffer = idleBuffers.get(ctx.device);
  if (buffer && buffer.size === size) idleBuffers.delete(ctx.device);
  else buffer = ctx.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: paddedRowBytes }, { width, height });
  ctx.device.queue.submit([enc.finish()]);

  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(rowBytes * height);
  if (paddedRowBytes === rowBytes) out.set(padded);
  else for (let y = 0; y < height; y++) out.set(padded.subarray(y * paddedRowBytes, y * paddedRowBytes + rowBytes), y * rowBytes);
  buffer.unmap();
  const previous = idleBuffers.get(ctx.device);
  if (previous) previous.destroy();
  idleBuffers.set(ctx.device, buffer);
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
    const source = code();
    // A shader that does not compile gives an invalid pipeline and, later, an all-zero image. The
    // error scope catches it here and reports it with the shader's name and the compiler's lines.
    ctx.device.pushErrorScope('validation');
    const module = ctx.device.createShaderModule({ label: key, code: source });
    const explicit = layout
      ? ctx.device.createPipelineLayout({ bindGroupLayouts: [ctx.device.createBindGroupLayout({ label: key, entries: layout() })] })
      : 'auto';
    pipeline = ctx.device.createComputePipeline({ label: key, layout: explicit, compute: { module } });
    void ctx.device
      .popErrorScope()
      .then(async (error) => {
        if (!error) return;
        const info = await module.getCompilationInfo();
        const messages = info.messages.map((m) => ({ type: m.type, line: m.lineNum, column: m.linePos, message: m.message }));
        reportGpuError(ctx, messages.some((m) => m.type === 'error') ? new ShaderCompileError(key, messages, source) : toGpuError(error));
      })
      .catch(() => {}); // the device was lost: `ctx.lost` tells
    cache.set(key, pipeline);
  }
  return pipeline;
}
