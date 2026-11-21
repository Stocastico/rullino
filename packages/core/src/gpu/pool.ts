// Recycles working textures. Allocating a texture is not free: WebGPU zero-fills it lazily on
// first use, and a long multipass filter or chain creates one per pass. Reusing one is safe
// because the queue executes in submission order and every pass overwrites every pixel.

import type { GpuContext } from './context';

/** Free textures kept per device, across all sizes. The rest are destroyed on release. */
const MAX_FREE = 16;

interface Pool {
  readonly free: Map<string, GPUTexture[]>;
  count: number;
  bytes: number;
  /** At most this many bytes of free textures (a render's memory budget), if set. */
  limit: number | undefined;
}

const pools = new WeakMap<GPUDevice, Pool>();

function poolOf(ctx: GpuContext): Pool {
  let p = pools.get(ctx.device);
  if (!p) pools.set(ctx.device, (p = { free: new Map(), count: 0, bytes: 0, limit: undefined }));
  return p;
}

const keyOf = (w: number, h: number, format: GPUTextureFormat) => `${w}x${h}:${format}`;
const bytesOf = (t: GPUTexture) => t.width * t.height * (t.format === 'rgba16float' ? 8 : t.format === 'rgba32float' ? 16 : 4);

/** Destroys free textures, the longest unused first, until the pool holds no more than `bytes`. */
function trim(pool: Pool, bytes: number): void {
  for (const [key, list] of pool.free) {
    while (list.length && pool.bytes > bytes) {
      const t = list.shift()!;
      pool.bytes -= bytesOf(t);
      pool.count--;
      t.destroy();
    }
    if (!list.length) pool.free.delete(key);
    if (pool.bytes <= bytes) return;
  }
}

/**
 * Caps the bytes of free textures the pool keeps on this device (`undefined`: no cap but the count).
 * Renders with a memory budget set it, so idle textures do not hold memory the budget counts on.
 */
export function setPoolLimit(ctx: GpuContext, bytes: number | undefined): void {
  const pool = poolOf(ctx);
  pool.limit = bytes;
  if (bytes !== undefined) trim(pool, bytes);
}

/** A free texture of this size and format, if the pool has one. */
export function acquireTexture(ctx: GpuContext, width: number, height: number, format: GPUTextureFormat): GPUTexture | undefined {
  const pool = poolOf(ctx);
  const t = pool.free.get(keyOf(width, height, format))?.pop();
  if (t) {
    pool.count--;
    pool.bytes -= bytesOf(t);
  }
  return t;
}

/**
 * Gives a working texture back for reuse instead of destroying it. Like destroy(), the caller
 * must not use it afterwards; GPU work already submitted that reads it is unaffected.
 */
export function releaseTexture(ctx: GpuContext, texture: GPUTexture): void {
  const pool = poolOf(ctx);
  const size = bytesOf(texture);
  if (pool.limit !== undefined && size > pool.limit) {
    texture.destroy();
    return;
  }
  if (pool.limit !== undefined) trim(pool, pool.limit - size);
  if (pool.count >= MAX_FREE) {
    texture.destroy();
    return;
  }
  const key = keyOf(texture.width, texture.height, texture.format);
  let list = pool.free.get(key);
  if (!list) pool.free.set(key, (list = []));
  list.push(texture);
  pool.count++;
  pool.bytes += size;
}

export function poolStats(ctx: GpuContext): { free: number; bytes: number } {
  const p = poolOf(ctx);
  return { free: p.count, bytes: p.bytes };
}
