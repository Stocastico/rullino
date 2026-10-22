import { createImage, linearToSrgb, resampleRaster, srgbToLinear, type LinearImage, type RasterMaskData } from '@rullino/core';
import type { OrtModule } from './segmenter';

// Object removal with MI-GAN (Picsart, MIT; ONNX "pipeline" export): the model takes the image and a
// mask as 8-bit tensors of any size, resizes to 512 internally, fills the hole and puts the
// original back outside it. ONNX Runtime is passed in, as for the segmenter.

/** A mask value above this is a hole. */
const HOLE = 0.5;

/** The model's inputs for an image (linear, premultiplied) and a hole mask (any size, soft values). */
function input(image: LinearImage, hole: RasterMaskData, grow = 0) {
  const { width, height } = image;
  const mask = resampleRaster(hole, width, height);
  const plane = width * height;
  const pixels = new Uint8Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const a = image.data[i * 4 + 3]!;
    for (let c = 0; c < 3; c++) pixels[c * plane + i] = a > 0 ? Math.round(Math.min(1, Math.max(0, linearToSrgb(image.data[i * 4 + c]! / a))) * 255) : 0;
  }
  // Known = 255, hole = 0, with the hole grown by `grow` pixels (square): an object's soft edge
  // would otherwise survive as a ghost outline.
  const out = new Uint8Array(plane).fill(255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (mask.data[y * width + x]! <= HOLE) continue;
      for (let v = Math.max(0, y - grow); v <= Math.min(height - 1, y + grow); v++) for (let u = Math.max(0, x - grow); u <= Math.min(width - 1, x + grow); u++) out[v * width + u] = 0;
    }
  return { image: pixels, mask: out, width, height };
}

/** The model's 8-bit NCHW result as a linear premultiplied image, with the source's alpha. */
function output(result: Uint8Array, source: LinearImage): LinearImage {
  const out = createImage(source.width, source.height);
  const plane = source.width * source.height;
  for (let i = 0; i < plane; i++) {
    const a = source.data[i * 4 + 3]!;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = srgbToLinear(result[c * plane + i]! / 255) * a;
    out.data[i * 4 + 3] = a;
  }
  return out;
}

export const migan = { input, output };

export interface Inpainter {
  /** The image with the hole (mask above 0.5, soft values allowed) filled in; same size as `image`. */
  inpaint(image: LinearImage, hole: RasterMaskData, options?: { grow?: number }): Promise<LinearImage>;
  release(): Promise<void>;
}

export interface InpainterOptions {
  /** Passed to `InferenceSession.create`, e.g. `{ executionProviders: ['webgpu', 'wasm'] }`. */
  readonly sessionOptions?: Record<string, unknown>;
}

/** `model` is the bytes of `migan_pipeline_v2.onnx` (see `MIGAN_PIPELINE` and `fetchModel`). */
export async function createMiganInpainter(ort: OrtModule, model: Uint8Array, options: InpainterOptions = {}): Promise<Inpainter> {
  const session = await ort.InferenceSession.create(model, options.sessionOptions);
  return {
    async inpaint(image, hole, { grow = 0 } = {}) {
      const { image: pixels, mask, width, height } = input(image, hole, grow);
      const out = await session.run({
        image: new ort.Tensor('uint8', pixels, [1, 3, height, width]),
        mask: new ort.Tensor('uint8', mask, [1, 1, height, width]),
      });
      return output(out.result!.data as Uint8Array, image);
    },
    async release() {
      await session.release?.();
    },
  };
}
