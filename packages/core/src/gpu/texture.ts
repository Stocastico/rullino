import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage, type LinearImage } from '../image';
import type { GpuContext } from './context';

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
  const { width, height } = tex;
  const rowBytes = width * BYTES_PER_PIXEL;
  // copyTextureToBuffer requires bytesPerRow to be a multiple of 256.
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const buffer = ctx.device.createBuffer({
    size: paddedRowBytes * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: paddedRowBytes }, { width, height });
  ctx.device.queue.submit([enc.finish()]);

  await buffer.mapAsync(GPUMapMode.READ);
  const padded = new Uint16Array(buffer.getMappedRange());
  const halves = new Uint16Array(width * height * 4);
  const rowHalves = rowBytes / 2;
  const paddedRowHalves = paddedRowBytes / 2;
  for (let y = 0; y < height; y++) {
    halves.set(padded.subarray(y * paddedRowHalves, y * paddedRowHalves + rowHalves), y * rowHalves);
  }
  buffer.unmap();
  buffer.destroy();
  return createImage(width, height, fromFloat16Array(halves));
}
