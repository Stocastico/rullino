import { createImage, downscaleCpu, linearToSrgb, type LinearImage } from '@rullino/core';

// Segment Anything (SAM-style models: SlimSAM, MobileSAM, SAM) — the parts that do not need a
// runtime: turning an image into the model's input, and the model's mask logits into a mask.

/** The models' input frame: the image, long side scaled to this, padded to a square. */
export const SAM_INPUT = 1024;
/** Side of the predicted low-resolution mask logits (covering the whole input frame). */
export const SAM_MASK = 256;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

export interface SamInput {
  /** 3 x 1024 x 1024 floats, NCHW: normalised straight sRGB, zero outside the image. */
  readonly pixels: Float32Array;
  /** Size of the image inside the frame (its top-left part). */
  readonly width: number;
  readonly height: number;
}

/** Bilinear enlargement of a (premultiplied, linear) image; edges clamped. */
function enlarge(src: LinearImage, w: number, h: number): LinearImage {
  const out = createImage(w, h);
  const at = (x: number, y: number, c: number) =>
    src.data[(Math.min(src.height - 1, Math.max(0, y)) * src.width + Math.min(src.width - 1, Math.max(0, x))) * 4 + c]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) * src.width) / w - 0.5;
      const v = ((y + 0.5) * src.height) / h - 0.5;
      const [x0, y0] = [Math.floor(u), Math.floor(v)];
      const [fx, fy] = [u - x0, v - y0];
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        out.data[(y * w + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  return out;
}

/**
 * The model input for an image (linear, premultiplied): long side scaled to 1024 (shrunk in
 * linear light, enlarged bilinearly), straight sRGB with transparent pixels black, normalised
 * with the ImageNet mean / std, top-left in a zero-padded 1024² frame.
 */
export function samInput(image: LinearImage): SamInput {
  const s = SAM_INPUT / Math.max(image.width, image.height);
  const [w, h] = [Math.max(1, Math.round(image.width * s)), Math.max(1, Math.round(image.height * s))];
  const sized = s < 1 ? downscaleCpu(image, w, h) : s > 1 ? enlarge(image, w, h) : image;
  const pixels = new Float32Array(3 * SAM_INPUT * SAM_INPUT);
  const plane = SAM_INPUT * SAM_INPUT;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = sized.data[i + 3]!;
      for (let c = 0; c < 3; c++) {
        const e = a > 0 ? Math.min(1, Math.max(0, linearToSrgb(sized.data[i + c]! / a))) : 0;
        pixels[c * plane + y * SAM_INPUT + x] = (e - MEAN[c]!) / STD[c]!;
      }
    }
  return { pixels, width: w, height: h };
}

/**
 * A soft mask (0..1 per pixel, row-major) of `width` x `height` from 256² mask logits: each pixel
 * samples the logits bilinearly at its position in the image part of the 1024 frame (`frame` is
 * the image's size there), then a sigmoid turns logits into coverage.
 */
export function samMask(logits: Float32Array, frame: { width: number; height: number }, width: number, height: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(width * height);
  const k = SAM_MASK / SAM_INPUT;
  const at = (x: number, y: number) => logits[Math.min(SAM_MASK - 1, Math.max(0, y)) * SAM_MASK + Math.min(SAM_MASK - 1, Math.max(0, x))]!;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (((x + 0.5) * frame.width) / width) * k - 0.5;
      const v = (((y + 0.5) * frame.height) / height) * k - 0.5;
      const [x0, y0] = [Math.floor(u), Math.floor(v)];
      const [fx, fy] = [u - x0, v - y0];
      const l = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      out[y * width + x] = 1 / (1 + Math.exp(-l));
    }
  return out;
}
