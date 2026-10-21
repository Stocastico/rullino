import { encodeSrgb16, encodeSrgb8, srgbToLinear } from './color';
import { createImage, type LinearImage } from './image';
import { encodePng } from './png';

export interface ExportOptions {
  /** Default 'png'. */
  readonly format?: 'png' | 'jpeg' | 'webp';
  /** JPEG / WebP quality in [0, 1] (browser default if omitted). */
  readonly quality?: number;
  /** PNG only: 16 keeps the precision of the float16 pipeline. Default 8. */
  readonly bitDepth?: 8 | 16;
  /**
   * sRGB-encoded colour to flatten transparency onto (composited in linear light). JPEG has no alpha,
   * so it defaults to white there; other formats keep alpha unless a background is given.
   */
  readonly background?: readonly [number, number, number];
}

/** The background an export flattens onto, if any. */
export const exportBackground = (o: ExportOptions) => o.background ?? (o.format === 'jpeg' ? ([1, 1, 1] as const) : undefined);

/** Whether an export needs more than the 8-bit straight sRGB readback. */
export const needsFloat = (o: ExportOptions) => exportBackground(o) !== undefined || (o.format ?? 'png') === 'png' && o.bitDepth === 16;

/** Composites a premultiplied linear image over an opaque colour. */
function flatten(img: LinearImage, background: readonly [number, number, number]): LinearImage {
  const bg = background.map(srgbToLinear);
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = Math.min(1, Math.max(0, img.data[i + 3]!));
    for (let c = 0; c < 3; c++) out.data[i + c] = img.data[i + c]! + bg[c]! * (1 - a);
    out.data[i + 3] = 1;
  }
  return out;
}

/**
 * Encodes straight-alpha sRGB samples. PNG goes through rullino's own encoder (lossless, 8 or 16
 * bits, exact alpha, works in Node); JPEG and WebP through the browser's canvas encoder, which
 * stores pixels premultiplied at 8 bits, so semi-transparent WebP pixels lose a little precision.
 */
export async function encodeSamples(samples: Uint8ClampedArray | Uint16Array, width: number, height: number, options: ExportOptions = {}): Promise<Blob> {
  const format = options.format ?? 'png';
  if (format === 'png') return new Blob([await encodePng(width, height, samples)], { type: 'image/png' });
  if (samples instanceof Uint16Array) throw new TypeError(`${format} takes 8-bit samples`);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(samples as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const type = `image/${format}`;
  const blob = await canvas.convertToBlob(options.quality === undefined ? { type } : { type, quality: options.quality });
  // Browsers silently fall back to PNG for types they cannot encode.
  if (blob.type !== type) throw new Error(`this browser cannot encode ${type}`);
  return blob;
}

/** Encodes a linear premultiplied image as PNG / JPEG / WebP (the CPU path of `exportImage`). */
export function encodeImage(img: LinearImage, options: ExportOptions = {}): Promise<Blob> {
  const background = exportBackground(options);
  const flat = background ? flatten(img, background) : img;
  const wide = (options.format ?? 'png') === 'png' && options.bitDepth === 16;
  return encodeSamples(wide ? encodeSrgb16(flat) : encodeSrgb8(flat), img.width, img.height, options);
}
