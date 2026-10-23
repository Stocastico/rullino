import { createImage, downscaleCpu, linearToSrgb, type LinearImage } from '@rullino/core';
import { enlarge } from './sam';
import type { OrtModule } from './segmenter';

// Monocular depth with Depth Anything V2 (Small, Apache-2.0, ONNX export): the model predicts
// relative inverse depth (larger = nearer) for an image of any size that is a multiple of 14.

/** Default length of the input's long side. */
export const DEPTH_SIDE = 518;
const PATCH = 14;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

const multiple = (n: number) => Math.max(PATCH, Math.round(n / PATCH) * PATCH);

/** The model input for an image (linear, premultiplied): long side `side`, both sides multiples of 14, NCHW normalised straight sRGB. */
function input(image: LinearImage, side = DEPTH_SIDE) {
  const s = side / Math.max(image.width, image.height);
  const [width, height] = [multiple(image.width * s), multiple(image.height * s)];
  const sized = width <= image.width && height <= image.height ? (width === image.width && height === image.height ? image : downscaleCpu(image, width, height)) : enlarge(image, width, height);
  const plane = width * height;
  const pixels = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const a = sized.data[i * 4 + 3]!;
    for (let c = 0; c < 3; c++) {
      const e = a > 0 ? Math.min(1, Math.max(0, linearToSrgb(sized.data[i * 4 + c]! / a))) : 0;
      pixels[c * plane + i] = (e - MEAN[c]!) / STD[c]!;
    }
  }
  return { pixels, width, height };
}

/**
 * The model's relative depth as a grey image (R = G = B = depth, alpha 1) in [0, 1], near = 1:
 * rescaled between the 1st and 99th percentile, so a few outliers do not flatten the rest.
 */
function output(raw: Float32Array, width: number, height: number): LinearImage {
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(0.01 * (sorted.length - 1))]!;
  const hi = sorted[Math.ceil(0.99 * (sorted.length - 1))]!;
  const out = createImage(width, height);
  for (let i = 0; i < raw.length; i++) {
    const v = hi > lo ? Math.min(1, Math.max(0, (raw[i]! - lo) / (hi - lo))) : 0.5;
    out.data.set([v, v, v, 1], i * 4);
  }
  return out;
}

export const depth = { input, output };

export interface DepthEstimator {
  /** The depth map of `image`, near = 1; its size is the model's (the image's proportions, multiples of 14). */
  estimate(image: LinearImage): Promise<LinearImage>;
  release(): Promise<void>;
}

export interface DepthEstimatorOptions {
  /** Length of the input's long side (default 518): larger is finer and slower. */
  readonly side?: number;
  /** Passed to `InferenceSession.create`, e.g. `{ executionProviders: ['wasm'] }`. */
  readonly sessionOptions?: Record<string, unknown>;
}

/** `model` is the bytes of the Depth Anything V2 Small ONNX file (see `DEPTH_ANYTHING_V2_SMALL`). */
export async function createDepthEstimator(ort: OrtModule, model: Uint8Array, options: DepthEstimatorOptions = {}): Promise<DepthEstimator> {
  const session = await ort.InferenceSession.create(model, options.sessionOptions);
  return {
    async estimate(image) {
      const { pixels, width, height } = input(image, options.side);
      const out = await session.run({ pixel_values: new ort.Tensor('float32', pixels, [1, 3, height, width]) });
      return output(out.predicted_depth!.data as Float32Array, width, height);
    },
    async release() {
      await session.release?.();
    },
  };
}
