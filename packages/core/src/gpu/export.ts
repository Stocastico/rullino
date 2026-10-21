import { encodeImage, encodeSamples, needsFloat, type ExportOptions } from '../encode';
import type { GpuContext } from './context';
import { readSrgb8 } from './io';
import { readImage } from './texture';

/**
 * Encodes a working texture as PNG / JPEG / WebP (see {@link encodeImage}). Plain 8-bit exports
 * encode to sRGB on the GPU; flattening and 16-bit PNG read the float data back instead.
 */
export async function exportImage(ctx: GpuContext, tex: GPUTexture, options: ExportOptions = {}): Promise<Blob> {
  if (needsFloat(options)) return encodeImage(await readImage(ctx, tex), options);
  return encodeSamples(await readSrgb8(ctx, tex), tex.width, tex.height, options);
}
