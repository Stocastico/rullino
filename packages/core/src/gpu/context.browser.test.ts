import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedPipeline } from './readback';
import { createGpuContext, type GpuContext } from './context';
import { GpuError, ShaderCompileError } from './errors';

const contexts: GpuContext[] = [];
afterEach(() => {
  for (const c of contexts.splice(0)) c.device.destroy();
});
const make = async (options: Parameters<typeof createGpuContext>[0] = {}) => {
  const ctx = await createGpuContext(options);
  contexts.push(ctx);
  return ctx;
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('createGpuContext', () => {
  it('asks for the adapter\'s own texture and buffer limits, and exposes them', async () => {
    const adapter = (await navigator.gpu.requestAdapter())!;
    const ctx = await make();
    expect(ctx.limits.maxTextureDimension2D).toBe(adapter.limits.maxTextureDimension2D);
    expect(ctx.limits.maxBufferSize).toBe(adapter.limits.maxBufferSize);
    expect(ctx.limits.maxStorageBufferBindingSize).toBe(adapter.limits.maxStorageBufferBindingSize);
  });

  it('`lost` resolves when the device is destroyed', async () => {
    const ctx = await make();
    ctx.device.destroy();
    expect((await ctx.lost).reason).toBe('destroyed');
  });
});

describe('GPU errors', () => {
  it('a shader that does not compile reaches onError as a ShaderCompileError naming the shader and the line', async () => {
    const errors: Error[] = [];
    const ctx = await make({ onError: (e) => errors.push(e) });
    const code = ['@compute @workgroup_size(1)', 'fn main() {', '  let a = undefined_name;', '}'].join('\n');
    const pipeline = cachedPipeline(ctx, 'test:broken-shader', () => code);
    expect(pipeline).toBeDefined(); // no exception: the error is reported, the caller keeps going
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    const e = errors[0]!;
    expect(e).toBeInstanceOf(ShaderCompileError);
    expect((e as ShaderCompileError).label).toBe('test:broken-shader');
    expect(e.message).toContain('3:');
    expect(e.message).toContain('undefined_name');
  });

  it('other GPU errors reach onError as a GpuError', async () => {
    const errors: Error[] = [];
    const ctx = await make({ onError: (e) => errors.push(e) });
    ctx.device.createTexture({ size: [0, 0], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }); // a zero size is a validation error
    // Headless Chromium delivers the event only after a round trip to the GPU process.
    await ctx.device.queue.onSubmittedWorkDone();
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(errors[0]).toBeInstanceOf(GpuError);
    expect((errors[0] as GpuError).kind).toBe('validation');
  });

  it('without onError a shader error is logged to the console (not swallowed)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = await make();
      cachedPipeline(ctx, 'test:broken-shader-2', () => 'this is not wgsl');
      await settle();
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(String(log.mock.calls[0]![0])).toContain('test:broken-shader-2');
    } finally {
      log.mockRestore();
    }
  });

  it('a good shader reports nothing', async () => {
    const errors: Error[] = [];
    const ctx = await make({ onError: (e) => errors.push(e) });
    cachedPipeline(ctx, 'test:good-shader', () => '@compute @workgroup_size(1) fn main() {}');
    await settle();
    expect(errors).toEqual([]);
  });
});
