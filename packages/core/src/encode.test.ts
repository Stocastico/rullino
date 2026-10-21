import { describe, expect, it } from 'vitest';
import { encodeImage } from './encode';
import { createImage } from './image';

async function pngPixels(blob: Blob) {
  const png = new Uint8Array(await blob.arrayBuffer());
  const len = new DataView(png.buffer).getUint32(33);
  const idat = png.subarray(41, 41 + len);
  const stream = new Blob([idat]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('encodeImage', () => {
  // One opaque mid-grey pixel, one fully transparent, one half-transparent red (premultiplied).
  const img = createImage(3, 1, new Float32Array([0.214, 0.214, 0.214, 1, 0, 0, 0, 0, 0.5, 0, 0, 0.5]));

  it('writes PNG with alpha by default', async () => {
    const blob = await encodeImage(img);
    expect(blob.type).toBe('image/png');
    expect([...(await pngPixels(blob))]).toEqual([0, 127, 127, 127, 255, 0, 0, 0, 0, 255, 0, 0, 128]);
  });

  it('flattens onto a background in linear light', async () => {
    const px = await pngPixels(await encodeImage(img, { background: [1, 1, 1] }));
    expect([...px.subarray(5, 9)]).toEqual([255, 255, 255, 255]);
    // 50% red over white: linear (1, 0.5, 0.5) -> sRGB (255, 188, 188), not the sRGB-space blend (255, 128, 128).
    expect([...px.subarray(9, 13)]).toEqual([255, 188, 188, 255]);
  });
});
