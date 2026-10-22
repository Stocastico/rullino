import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { SAM_MASK } from './sam';
import { createSamSegmenter, type OrtModule, type OrtTensor } from './segmenter';

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array,
    readonly dims: readonly number[],
  ) {}
}

/** A fake ONNX Runtime: records feeds; the decoder's second mask is "everything", scored best. */
function fakeOrt() {
  const calls: { model: string; feeds: Record<string, OrtTensor> }[] = [];
  const created: unknown[] = [];
  let released = 0;
  let creating = false;
  const ort: OrtModule = {
    Tensor: FakeTensor as never,
    InferenceSession: {
      async create(model, options) {
        // Like ONNX Runtime's WebGPU backend: one session creation at a time.
        if (creating) throw new Error('another WebGPU EP inference session is being created');
        creating = true;
        await new Promise((r) => setTimeout(r, 1));
        creating = false;
        const name = new TextDecoder().decode(model as Uint8Array);
        created.push([name, options]);
        return {
          async run(feeds) {
            calls.push({ model: name, feeds });
            if (name === 'encoder') {
              const e = new FakeTensor('float32', new Float32Array(256 * 64 * 64).fill(1), [1, 256, 64, 64]);
              return { image_embeddings: e, image_positional_embeddings: e };
            }
            const masks = new Float32Array(3 * SAM_MASK * SAM_MASK).fill(-10);
            masks.fill(10, SAM_MASK * SAM_MASK, 2 * SAM_MASK * SAM_MASK);
            return { iou_scores: new FakeTensor('float32', new Float32Array([0.2, 0.9, 0.5]), [1, 1, 3]), pred_masks: new FakeTensor('float32', masks, [1, 1, 3, SAM_MASK, SAM_MASK]) };
          },
          async release() {
            released++;
          },
        };
      },
    },
  };
  return { ort, calls, created, released: () => released };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('createSamSegmenter', () => {
  it('encodes once per image and decodes points in the 1024 frame, keeping the best-scored mask', async () => {
    const fake = fakeOrt();
    const sam = await createSamSegmenter(fake.ort, { encoder: bytes('encoder'), decoder: bytes('decoder') }, { sessionOptions: { executionProviders: ['wasm'] } });
    expect(fake.created).toEqual([['encoder', { executionProviders: ['wasm'] }], ['decoder', { executionProviders: ['wasm'] }]]);
    const embedding = await sam.encode(createImage(200, 100));
    expect(fake.calls[0]!.feeds.pixel_values!.dims).toEqual([1, 3, 1024, 1024]);
    const { mask, score } = await sam.segment(embedding, [{ x: 0.5, y: 0.25, positive: true }, { x: 0.1, y: 0.9, positive: false }], 40, 20);
    const feeds = fake.calls[1]!.feeds;
    // The image is 1024 x 512 in the frame.
    expect(Array.from(feeds.input_points!.data as Float32Array)).toEqual([512, 128, 102.4, 460.8].map((v) => Math.fround(v)));
    expect(feeds.input_points!.dims).toEqual([1, 1, 2, 2]);
    expect(Array.from(feeds.input_labels!.data as BigInt64Array)).toEqual([1n, 0n]);
    expect(feeds.image_embeddings!.dims).toEqual([1, 256, 64, 64]);
    expect(feeds.image_positional_embeddings!.dims).toEqual([1, 256, 64, 64]);
    expect(score).toBeCloseTo(0.9, 6);
    expect([mask.width, mask.height]).toEqual([40, 20]);
    expect(Math.min(...mask.data)).toBeGreaterThan(0.99);
    await sam.segment(embedding, [{ x: 0.5, y: 0.5, positive: true }], 10, 10);
    expect(fake.calls.filter((c) => c.model === 'encoder')).toHaveLength(1);
    await sam.release();
    expect(fake.released()).toBe(2);
  });

  it('needs at least one point', async () => {
    const sam = await createSamSegmenter(fakeOrt().ort, { encoder: bytes('encoder'), decoder: bytes('decoder') });
    await expect(sam.segment(await sam.encode(createImage(4, 4)), [], 4, 4)).rejects.toThrow(/point/);
  });
});
