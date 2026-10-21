import { afterAll, describe, expect, it } from 'vitest';
import { createGpuContext } from './context';
import { poolStats, releaseTexture } from './pool';
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
});
