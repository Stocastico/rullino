import { createImage, createRasterMask, linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { createMiganInpainter, growMask, migan } from './migan';
import type { OrtModule, OrtTensor } from './segmenter';

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array | Uint8Array,
    readonly dims: readonly number[],
  ) {}
}

/** A fake MI-GAN: returns the input image with every hole pixel (mask 0) painted (10, 20, 30). */
function fakeOrt() {
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
            const image = feeds.image!.data as Uint8Array;
            const mask = feeds.mask!.data as Uint8Array;
            const out = new Uint8Array(image);
            const plane = mask.length;
            mask.forEach((m, i) => {
              if (m === 0) [10, 20, 30].forEach((v, c) => (out[c * plane + i] = v));
            });
            return { result: new FakeTensor('uint8', out, feeds.image!.dims) };
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

/** 4 x 3 image, straight colour (0.5, 0.25, 0.75) in sRGB, alpha 1. */
function image() {
  const img = createImage(4, 3);
  for (let i = 0; i < 12; i++) img.data.set([0.5, 0.25, 0.75].map(srgbToLinear).concat(1), i * 4);
  return img;
}
const hole = (...on: number[]) => createRasterMask(4, 3, Float32Array.from({ length: 12 }, (_, i) => (on.includes(i) ? 1 : 0)));

describe('migan input', () => {
  it('is NCHW uint8 straight sRGB, with the mask 255 where the image is known and 0 in the hole', () => {
    const input = migan.input(image(), hole(5));
    expect(input.width).toBe(4);
    expect(input.height).toBe(3);
    expect(input.image.length).toBe(3 * 12);
    expect([input.image[0], input.image[12], input.image[24]]).toEqual([128, 64, 191]); // pixel 0: planes R, G, B
    expect(Array.from(input.mask)).toEqual([255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255]);
  });

  it('treats a mask value above the threshold as hole, and grows the hole by `grow` pixels', () => {
    const soft = createRasterMask(4, 3, Float32Array.from({ length: 12 }, (_, i) => (i === 5 ? 0.6 : i === 6 ? 0.2 : 0)));
    expect(Array.from(migan.input(image(), soft).mask).filter((m) => m === 0)).toEqual([0]);
    const grown = migan.input(image(), hole(5), 1).mask;
    expect(Array.from(grown).flatMap((m, i) => (m === 0 ? [i] : []))).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
  });

  it('resamples a mask of another size to the image size', () => {
    const half = createRasterMask(2, 1, new Float32Array([0, 1]));
    const mask = migan.input(image(), half).mask;
    expect(mask[0]).toBe(255);
    expect(mask[3]).toBe(0);
  });
});

describe('growMask', () => {
  it('spreads the maximum over a (2r + 1) square, soft values included, without touching the input', () => {
    const m = createRasterMask(5, 3, Float32Array.from({ length: 15 }, (_, i) => (i === 7 ? 0.6 : i === 8 ? 0.2 : 0)));
    const before = new Float32Array(m.data);
    const g = growMask(m, 1);
    expect(Array.from(g.data)).toEqual([0, 0.6, 0.6, 0.6, 0.2, 0, 0.6, 0.6, 0.6, 0.2, 0, 0.6, 0.6, 0.6, 0.2].map(Math.fround));
    expect(m.data).toEqual(before);
    expect(growMask(m, 0)).toBe(m);
  });
});

describe('migan output', () => {
  it('is linear premultiplied again, with the source alpha', () => {
    const src = createImage(1, 1);
    src.data.set([0, 0, 0, 0.5]);
    const out = migan.output(new Uint8Array([255, 0, 128]), src);
    expect(out.data[0]).toBeCloseTo(srgbToLinear(1) * 0.5, 6);
    expect(out.data[1]).toBeCloseTo(0, 6);
    expect(out.data[2]).toBeCloseTo(srgbToLinear(128 / 255) * 0.5, 6);
    expect(out.data[3]).toBe(0.5);
  });
});

describe('createMiganInpainter', () => {
  it('runs the pipeline model once per call and returns the repainted image', async () => {
    const fake = fakeOrt();
    const inpainter = await createMiganInpainter(fake.ort, new Uint8Array(), { sessionOptions: { executionProviders: ['wasm'] } });
    expect(fake.created).toEqual([{ executionProviders: ['wasm'] }]);
    const out = await inpainter.inpaint(image(), hole(5));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.image!.dims).toEqual([1, 3, 3, 4]);
    expect(fake.calls[0]!.mask!.dims).toEqual([1, 1, 3, 4]);
    const px = (i: number) => [0, 1, 2].map((c) => Math.round(linearToSrgb(out.data[i * 4 + c]!) * 255));
    expect(px(5)).toEqual([10, 20, 30]);
    expect(px(4)).toEqual([128, 64, 191]);
    expect(out.data[5 * 4 + 3]).toBe(1);
    await inpainter.release();
    expect(fake.released()).toBe(1);
  });
});
