import { createImage, type LinearImage } from './image';

/** sRGB electro-optical transfer function. Mirrored for negatives, unbounded above 1. */
export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  const l = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return Math.sign(v) * l;
}

/** Inverse of {@link srgbToLinear}. */
export function linearToSrgb(v: number): number {
  const a = Math.abs(v);
  const e = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055;
  return Math.sign(v) * e;
}

/** Like {@link encodeSrgb8} at 16 bits per sample (e.g. for 16-bit PNG): straight sRGB, clamped. */
export function encodeSrgb16(img: LinearImage): Uint16Array {
  const src = img.data;
  const out = new Uint16Array(src.length);
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 65535);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]!;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = q(linearToSrgb(src[i + c]! / a));
    out[i + 3] = q(a);
  }
  return out;
}

/** Decodes 8-bit sRGB, straight-alpha RGBA (as in ImageData) into a linear premultiplied image. */
export function decodeSrgb8(src: Uint8ClampedArray, width: number, height: number): LinearImage {
  if (src.length !== width * height * 4) {
    throw new RangeError(`expected ${width * height * 4} bytes for ${width}x${height}, got ${src.length}`);
  }
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);

  const img = createImage(width, height);
  const out = img.data;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]! / 255;
    out[i] = lut[src[i]!]! * a;
    out[i + 1] = lut[src[i + 1]!]! * a;
    out[i + 2] = lut[src[i + 2]!]! * a;
    out[i + 3] = a;
  }
  return img;
}

/** Encodes a linear premultiplied image to 8-bit sRGB, straight-alpha RGBA. Out-of-range values are clamped. */
export function encodeSrgb8(img: LinearImage): Uint8ClampedArray {
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]!;
    if (a <= 0) continue;
    out[i] = linearToSrgb(src[i]! / a) * 255;
    out[i + 1] = linearToSrgb(src[i + 1]! / a) * 255;
    out[i + 2] = linearToSrgb(src[i + 2]! / a) * 255;
    out[i + 3] = a * 255;
  }
  return out;
}
