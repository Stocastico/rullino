import { describe, expect, it, vi } from 'vitest';
import { createRenderer } from './renderer';

// Without the optional sharp package: RGBA in and PNG out still work; files and JPEG / WebP say
// what to install.
vi.mock('sharp', () => {
  throw new Error("Cannot find package 'sharp'");
});

describe('without sharp', () => {
  const rgba = { data: new Uint8Array(2 * 2 * 4).fill(128), width: 2, height: 2 };

  it('still renders RGBA to PNG', async () => {
    const r = await createRenderer({ backend: 'cpu' });
    expect((await r.render(rgba, { version: 2, steps: [] })).format).toBe('png');
  });

  it('says to install sharp for files and for JPEG / WebP', async () => {
    const r = await createRenderer({ backend: 'cpu' });
    await expect(r.render(new Uint8Array([0xff, 0xd8, 0xff]), { version: 2, steps: [] })).rejects.toThrow(/npm install sharp/);
    await expect(r.render(rgba, { version: 2, steps: [], output: { format: 'jpeg' } })).rejects.toThrow(/npm install sharp/);
  });
});
