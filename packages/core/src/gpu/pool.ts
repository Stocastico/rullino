// Recycles working textures. Allocating a texture is not free: WebGPU zero-fills it lazily on
// first use, and a long multipass filter or chain creates one per pass. Reusing one is safe
// because the queue executes in submission order and every pass overwrites every pixel.

import type { GpuContext } from './context';

/** Free textures kept per device, across all sizes. The rest are destroyed on release. */
const MAX_FREE = 16;

interface Pool {
  readonly free: Map<string, GPUTexture[]>;
  count: number;
}

const pools = new WeakMap<GPUDevice, Pool>();

function poolOf(ctx: GpuContext): Pool {
  let p = pools.get(ctx.device);
  if (!p) pools.set(ctx.device, (p = { free: new Map(), count: 0 }));
  return p;
}

const keyOf = (w: number, h: number, format: GPUTextureFormat) => `${w}x${h}:${format}`;

/** A free texture of this size and format, if the pool has one. */
export function acquireTexture(ctx: GpuContext, width: number, height: number, format: GPUTextureFormat): GPUTexture | undefined {
  const pool = poolOf(ctx);
  const t = pool.free.get(keyOf(width, height, format))?.pop();
  if (t) pool.count--;
  return t;
}

/**
 * Gives a working texture back for reuse instead of destroying it. Like destroy(), the caller
 * must not use it afterwards; GPU work already submitted that reads it is unaffected.
 */
export function releaseTexture(ctx: GpuContext, texture: GPUTexture): void {
  const pool = poolOf(ctx);
  if (pool.count >= MAX_FREE) {
    texture.destroy();
    return;
  }
  const key = keyOf(texture.width, texture.height, texture.format);
  let list = pool.free.get(key);
  if (!list) pool.free.set(key, (list = []));
  list.push(texture);
  pool.count++;
}

export function poolStats(ctx: GpuContext): { free: number } {
  return { free: poolOf(ctx).count };
}
