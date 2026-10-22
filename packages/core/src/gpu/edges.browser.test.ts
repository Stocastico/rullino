import { afterAll, describe, expect, it } from 'vitest';
import { createGpuContext } from './context';
import { importImage } from './io';
import { downscale } from './resize';
import { readImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Copies from <canvas>, <img> and VideoFrame sources lose the device on SwiftShader (like
// configuring a WebGPU canvas), so importImage's size lookup for them is not tested here.

describe('GPU input / output edges', () => {
  it('refuses to read back a texture in another format, and to "downscale" up', async () => {
    const other = ctx.device.createTexture({ size: { width: 1, height: 1 }, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    await expect(readImage(ctx, other)).rejects.toThrow(/rgba16float/);
    const tex = importImage(ctx, await createImageBitmap(new ImageData(3, 2)));
    expect([tex.width, tex.height]).toEqual([3, 2]);
    expect(() => downscale(ctx, tex, 4, 2)).toThrow(RangeError);
    expect(() => downscale(ctx, tex, 0, 1)).toThrow(RangeError);
  });
});
