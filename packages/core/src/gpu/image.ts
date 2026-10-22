import type { LinearImage } from '../image';
import type { GpuContext } from './context';

const cache = new WeakMap<GPUDevice, WeakMap<LinearImage, GPUTexture>>();

/**
 * An image param as an rgba32float texture (premultiplied linear), uploaded once per image object
 * and device. Images are treated as immutable: changing `data` in place after first use is not
 * picked up.
 */
export function imageTexture(ctx: GpuContext, image: LinearImage): GPUTexture {
  let perDevice = cache.get(ctx.device);
  if (!perDevice) cache.set(ctx.device, (perDevice = new WeakMap()));
  let tex = perDevice.get(image);
  if (tex) return tex;
  tex = ctx.device.createTexture({
    label: 'rullino.image',
    size: [image.width, image.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  ctx.device.queue.writeTexture({ texture: tex }, image.data, { bytesPerRow: image.width * 16 }, [image.width, image.height]);
  perDevice.set(image, tex);
  return tex;
}
