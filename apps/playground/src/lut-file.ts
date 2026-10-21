import { parseCube, parseHald, type Lut } from '@rullino/core';

/** Reads a .cube file or a HaldCLUT image (PNG, ...) into a LUT. */
export async function readLutFile(file: File): Promise<Lut> {
  const name = file.name.replace(/\.[^.]+$/, '');
  if (/\.cube$/i.test(file.name)) {
    const lut = parseCube(await file.text());
    return lut.title ? lut : { ...lut, title: name };
  }
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const lut = parseHald(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data, ctx.canvas.width, ctx.canvas.height);
  return { ...lut, title: name };
}

export const describeLut = (lut: Lut) => `${lut.title ?? 'Untitled'} · ${lut.size}³`;
