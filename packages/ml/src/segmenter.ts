import { createRasterMask, type LinearImage, type RasterMaskData } from '@rullino/core';
import { SAM_INPUT, SAM_MASK, samInput, samMask } from './sam';

// Click-to-select with a SAM-style model (SlimSAM's ONNX export: a vision encoder and a prompt
// encoder + mask decoder). ONNX Runtime is passed in, not imported: the package keeps no runtime
// dependency, apps choose the runtime build (WebGPU, WASM) and tests use a fake.

/** The parts of an ONNX Runtime tensor used here. */
export interface OrtTensor {
  readonly data: Float32Array | BigInt64Array;
  readonly dims: readonly number[];
}

export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}

/** The parts of the `onnxruntime-web` module used here (pass the module itself). */
export interface OrtModule {
  readonly InferenceSession: { create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSession> };
  readonly Tensor: new (type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: readonly number[]) => OrtTensor;
}

/** The model's two ONNX files, as bytes (see `fetchModel`). */
export interface SamModelFiles {
  readonly encoder: Uint8Array;
  readonly decoder: Uint8Array;
}

/** A prompt point, normalised to the image ([0, 1] across width and height). */
export interface SamPoint {
  readonly x: number;
  readonly y: number;
  /** true: part of the object; false: not part of it. */
  readonly positive: boolean;
}

/** An encoded image: reuse it for every click on the same image. */
export interface SamEmbedding {
  readonly frame: { readonly width: number; readonly height: number };
  readonly tensors: Readonly<Record<string, OrtTensor>>;
}

export interface SamSegmenter {
  /** Runs the (slow) image encoder. */
  encode(image: LinearImage): Promise<SamEmbedding>;
  /** Runs the (fast) decoder for prompt points; the mask is `width` x `height`, soft (0..1). */
  segment(embedding: SamEmbedding, points: readonly SamPoint[], width: number, height: number): Promise<{ mask: RasterMaskData; score: number }>;
  release(): Promise<void>;
}

export interface SegmenterOptions {
  /** Passed to `InferenceSession.create`, e.g. `{ executionProviders: ['webgpu', 'wasm'] }`. */
  readonly sessionOptions?: Record<string, unknown>;
}

export async function createSamSegmenter(ort: OrtModule, files: SamModelFiles, options: SegmenterOptions = {}): Promise<SamSegmenter> {
  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(files.encoder, options.sessionOptions),
    ort.InferenceSession.create(files.decoder, options.sessionOptions),
  ]);
  return {
    async encode(image) {
      const input = samInput(image);
      const out = await encoder.run({ pixel_values: new ort.Tensor('float32', input.pixels, [1, 3, SAM_INPUT, SAM_INPUT]) });
      return {
        frame: { width: input.width, height: input.height },
        tensors: { image_embeddings: out.image_embeddings!, image_positional_embeddings: out.image_positional_embeddings! },
      };
    },
    async segment(embedding, points, width, height) {
      if (points.length === 0) throw new Error('segment needs at least one point');
      const { frame } = embedding;
      const coords = Float32Array.from(points.flatMap((p) => [p.x * frame.width, p.y * frame.height]));
      const labels = BigInt64Array.from(points.map((p) => (p.positive ? 1n : 0n)));
      const out = await decoder.run({
        input_points: new ort.Tensor('float32', coords, [1, 1, points.length, 2]),
        input_labels: new ort.Tensor('int64', labels, [1, 1, points.length]),
        ...embedding.tensors,
      });
      // Several candidate masks (whole object, part, sub-part): keep the best-scored one.
      const scores = Array.from(out.iou_scores!.data as Float32Array);
      const best = scores.reduce((b, s, i) => (s > scores[b]! ? i : b), 0);
      const plane = SAM_MASK * SAM_MASK;
      const logits = (out.pred_masks!.data as Float32Array).subarray(best * plane, (best + 1) * plane);
      return { mask: createRasterMask(width, height, samMask(logits, frame, width, height)), score: scores[best]! };
    },
    async release() {
      await Promise.all([encoder.release?.(), decoder.release?.()]);
    },
  };
}
