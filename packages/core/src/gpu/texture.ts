import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage, type LinearImage } from '../image';
import type { GpuContext } from './context';
import { readTextureBytes } from './readback';

/** Internal working format: linear, premultiplied, half float. */
export const WORKING_FORMAT = 'rgba16float' satisfies GPUTextureFormat;
const BYTES_PER_PIXEL = 8;

export function createWorkingTexture(ctx: GpuContext, width: number, height: number): GPUTexture {
  return ctx.device.createTexture({
    size: { width, height },
    format: WORKING_FORMAT,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}

export function uploadImage(ctx: GpuContext, img: LinearImage): GPUTexture {
  const tex = createWorkingTexture(ctx, img.width, img.height);
  ctx.device.queue.writeTexture(
    { texture: tex },
    toFloat16Array(img.data),
    { bytesPerRow: img.width * BYTES_PER_PIXEL, rowsPerImage: img.height },
    { width: img.width, height: img.height },
  );
  return tex;
}

export async function readImage(ctx: GpuContext, tex: GPUTexture): Promise<LinearImage> {
  if (tex.format !== WORKING_FORMAT) throw new TypeError(`expected ${WORKING_FORMAT}, got ${tex.format}`);
  const halves = new Uint16Array(await readTextureBytes(ctx, tex, BYTES_PER_PIXEL));
  return createImage(tex.width, tex.height, fromFloat16Array(halves));
}
