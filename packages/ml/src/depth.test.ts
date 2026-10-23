import { createImage, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { createDepthEstimator, depth } from './depth';
import type { OrtModule, OrtTensor } from './segmenter';

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array | Uint8Array,
    readonly dims: readonly number[],
  ) {}
}

describe('depth input', () => {
  it('scales the long side to `side`, in multiples of 14, as normalised straight sRGB (NCHW)', () => {
    const grey = srgbToLinear(0.485);
    const img = createImage(1024, 683);
    for (let i = 0; i < 1024 * 683; i++) img.data.set([grey, srgbToLinear(0.456), srgbToLinear(0.406), 1], i * 4);
    const input = depth.input(img, 518);
    expect([input.width, input.height]).toEqual([518, 350]);
    expect(input.pixels).toHaveLength(3 * 518 * 350);
    // The ImageNet mean maps to 0 in every channel.
    for (const v of [input.pixels[0]!, input.pixels[518 * 350]!, input.pixels[2 * 518 * 350 + 1000]!]) expect(Math.abs(v)).toBeLessThan(2e-3);
  });

  it('keeps tiny images valid (at least one 14 px block) and enlarges small ones', () => {
    const small = depth.input(createImage(20, 10), 140);
    expect([small.width, small.height]).toEqual([140, 70]);
    const thin = depth.input(createImage(100, 1), 28);
    expect([thin.width, thin.height]).toEqual([28, 14]);
  });

  it('puts the channels in separate planes', () => {
    const img = createImage(14, 14);
    for (let i = 0; i < 14 * 14; i++) img.data.set([1, 0, 0, 1], i * 4);
    const { pixels } = depth.input(img, 14);
    const plane = 14 * 14;
    expect(pixels[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(pixels[plane]).toBeCloseTo((0 - 0.456) / 0.224, 4);
    expect(pixels[2 * plane]).toBeCloseTo((0 - 0.406) / 0.225, 4);
  });
});

describe('depth output', () => {
  it('normalises to [0, 1] between the 1st and 99th percentile, near = 1, as a grey image', () => {
    const raw = Float32Array.from({ length: 1000 }, (_, i) => 10 + i * 0.1); // 10 .. 109.9
    const img = depth.output(raw, 50, 20);
    expect([img.width, img.height]).toEqual([50, 20]);
    expect(img.data[0]).toBeCloseTo(0, 2); // smallest raw value: far
    expect(img.data[999 * 4]).toBe(1); // largest: near (clipped above the 99th percentile)
    const mid = img.data[500 * 4]!;
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
    expect([img.data[500 * 4 + 1], img.data[500 * 4 + 2], img.data[500 * 4 + 3]]).toEqual([mid, mid, 1]);
  });

  it('a flat map becomes mid-grey instead of dividing by zero', () => {
    const img = depth.output(new Float32Array(16).fill(3), 4, 4);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([0.5, 0.5, 0.5, 1]);
  });
});

describe('createDepthEstimator', () => {
  it('runs the model on the prepared input and returns the normalised depth at the model resolution', async () => {
    const calls: Record<string, OrtTensor>[] = [];
    const created: unknown[] = [];
    let released = 0;
    const ort: OrtModule = {
      Tensor: FakeTensor as never,
      InferenceSession: {
        async create(_model, options) {
          created.push(options);
          return {
            async run(feeds) {
              calls.push(feeds);
              const [, , h, w] = feeds.pixel_values!.dims;
              // A ramp from the left (far) to the right (near).
              return { predicted_depth: new FakeTensor('float32', Float32Array.from({ length: h! * w! }, (_, i) => i % w!), [1, h!, w!]) };
            },
            async release() {
              released++;
            },
          };
        },
      },
    };
    const estimator = await createDepthEstimator(ort, new Uint8Array(), { side: 56, sessionOptions: { executionProviders: ['wasm'] } });
    expect(created).toEqual([{ executionProviders: ['wasm'] }]);
    const out = await estimator.estimate(createImage(80, 40));
    expect(calls[0]!.pixel_values!.dims).toEqual([1, 3, 28, 56]);
    expect([out.width, out.height]).toEqual([56, 28]);
    expect(out.data[0]).toBeLessThan(0.05);
    expect(out.data[55 * 4]).toBeGreaterThan(0.95);
    await estimator.release();
    expect(released).toBe(1);
  });
});
