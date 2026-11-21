import { afterAll, describe, expect, it } from 'vitest';
import { createGpuContext } from './context';
import { poolStats, releaseTexture, setPoolLimit } from './pool';
import { createWorkingTexture } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

describe('texture pool', () => {
  it('reuses released textures of the same size', () => {
    const a = createWorkingTexture(ctx, 13, 7);
    releaseTexture(ctx, a);
    expect(createWorkingTexture(ctx, 13, 7)).toBe(a);
  });

  it('does not hand out a texture of another size, or one still in use', () => {
    const a = createWorkingTexture(ctx, 13, 7);
    const b = createWorkingTexture(ctx, 13, 7);
    expect(b).not.toBe(a);
    releaseTexture(ctx, a);
    expect(createWorkingTexture(ctx, 14, 7)).not.toBe(a);
  });

  it('caps what it keeps and destroys the rest', () => {
    const many = Array.from({ length: 40 }, () => createWorkingTexture(ctx, 5, 5));
    for (const t of many) releaseTexture(ctx, t);
    expect(poolStats(ctx).free).toBeLessThanOrEqual(16);
  });

  it('keeps no more bytes than its limit (a memory budget), trimming at once when it is set', () => {
    for (const t of Array.from({ length: 6 }, () => createWorkingTexture(ctx, 9, 9))) releaseTexture(ctx, t);
    setPoolLimit(ctx, 3 * 10 * 10 * 8); // three 10×10 rgba16float textures
    expect(poolStats(ctx).bytes).toBeLessThanOrEqual(2400);
    for (const t of Array.from({ length: 5 }, () => createWorkingTexture(ctx, 10, 10))) releaseTexture(ctx, t);
    expect(poolStats(ctx).bytes).toBeLessThanOrEqual(2400);
    expect(poolStats(ctx).free).toBeGreaterThan(0);
    setPoolLimit(ctx, undefined);
    for (const t of Array.from({ length: 5 }, () => createWorkingTexture(ctx, 10, 10))) releaseTexture(ctx, t);
    expect(poolStats(ctx).bytes).toBeGreaterThan(2400);
  });
});
