import type { Lut } from '../lut';
import type { GpuContext } from './context';

const cache = new WeakMap<GPUDevice, WeakMap<Lut, GPUTexture>>();

/**
 * The LUT as an N³ rgba32float 3D texture, uploaded once per Lut object and device. LUTs are
 * treated as immutable: changing `data` in place after first use is not picked up.
 */
export function lutTexture(ctx: GpuContext, lut: Lut): GPUTexture {
  let perDevice = cache.get(ctx.device);
  if (!perDevice) cache.set(ctx.device, (perDevice = new WeakMap()));
  let tex = perDevice.get(lut);
  if (tex) return tex;
  const n = lut.size;
  const rgba = new Float32Array(n ** 3 * 4);
  for (let i = 0; i < n ** 3; i++) rgba.set(lut.data.subarray(i * 3, i * 3 + 3), i * 4);
  tex = ctx.device.createTexture({
    label: `rullino.lut${lut.title ? `:${lut.title}` : ''}`,
    size: [n, n, n],
    dimension: '3d',
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  ctx.device.queue.writeTexture({ texture: tex }, rgba, { bytesPerRow: n * 16, rowsPerImage: n }, [n, n, n]);
  perDevice.set(lut, tex);
  return tex;
}
