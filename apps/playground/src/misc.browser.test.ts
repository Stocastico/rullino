import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeLut, readLutFile } from './lut-file';
import { samples } from './samples';

afterEach(() => vi.restoreAllMocks());

describe('readLutFile', () => {
  it('reads a .cube file, naming it after the file when it has no title', async () => {
    const cube = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    const lut = await readLutFile(new File([cube], 'identity.cube'));
    expect([lut.size, lut.title, describeLut(lut)]).toEqual([2, 'identity', 'identity · 2³']);
    const titled = await readLutFile(new File([`TITLE "Mine"\n${cube}`], 'x.CUBE'));
    expect(titled.title).toBe('Mine');
    expect(describeLut({ ...lut, title: undefined } as never)).toBe('Untitled · 2³');
  });

  it('reads a HaldCLUT image', async () => {
    // Level 2: a 8x8 image holding a 4³ identity LUT.
    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(8, 8);
    for (let i = 0; i < 64; i++) img.data.set([(i % 4) * 85, (Math.floor(i / 4) % 4) * 85, Math.floor(i / 16) * 85, 255], i * 4);
    ctx.putImageData(img, 0, 0);
    const lut = await readLutFile(new File([await canvas.convertToBlob({ type: 'image/png' })], 'hald.png'));
    expect([lut.size, lut.title]).toEqual([4, 'hald']);
  });
});

describe('samples', () => {
  it('generated test images have their sizes; photos fetch next to the page', async () => {
    for (const s of samples.filter((s) => s.group === 'Test images')) {
      const img = (await s.make()) as ImageData;
      expect(img.width * img.height).toBeGreaterThan(1000);
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x']), { status: 200 }));
    const photo = samples.find((s) => s.group === 'Photos')!;
    expect(await photo.make()).toBeInstanceOf(Blob);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/samples\/river\.jpg$/);
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(photo.make()).rejects.toThrow(/404/);
  });
});
