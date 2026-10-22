import { createImage, srgbToLinear } from '@rullino/core';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { createSamSegmenter, SLIMSAM_77, type OrtModule } from '../src';

// The real SlimSAM model on ONNX Runtime's WASM backend (Node), downloaded by
// scripts/fetch-models.mjs (`pnpm test:ml`). Encoding takes ~20 s on one CPU thread.

const file = (url: string) => new Uint8Array(readFileSync(new URL(`../../../.cache/models/${url.split('/').at(-1)}`, import.meta.url)));
const model = SLIMSAM_77.variants.quantized;

/** A dark disk (radius 0.2 of the width) on a light background with a soft gradient. */
function scene(w: number, h: number) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = Math.hypot(x - 0.35 * w, y - 0.5 * h) < 0.2 * w;
      const e = inside ? [0.15, 0.25, 0.55] : [0.85 - 0.2 * (y / h), 0.8, 0.7];
      img.data.set([...e.map(srgbToLinear), 1], (y * w + x) * 4);
    }
  return img;
}

describe('SlimSAM on ONNX Runtime (WASM)', () => {
  it('selects the disk that was clicked', { timeout: 180_000 }, async () => {
    ort.env.wasm.numThreads = 1;
    const sam = await createSamSegmenter(ort as unknown as OrtModule, { encoder: file(model.encoder), decoder: file(model.decoder) });
    const [w, h] = [320, 200];
    const embedding = await sam.encode(scene(w, h));
    const { mask, score } = await sam.segment(embedding, [{ x: 0.35, y: 0.5, positive: true }], w, h);
    expect(score).toBeGreaterThan(0.8);
    // Intersection over union with the true disk.
    let [inter, union] = [0, 0];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const truth = Math.hypot(x - 0.35 * w, y - 0.5 * h) < 0.2 * w;
        const picked = mask.data[y * w + x]! > 0.5;
        inter += truth && picked ? 1 : 0;
        union += truth || picked ? 1 : 0;
      }
    expect(inter / union).toBeGreaterThan(0.9);
    // Labels matter: with a negative point on the background it is still the disk; with the same
    // point positive, the selection grows into the background.
    const iou = (m: Float32Array) => {
      let [i, u] = [0, 0];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const truth = Math.hypot(x - 0.35 * w, y - 0.5 * h) < 0.2 * w;
          const picked = m[y * w + x]! > 0.5;
          i += truth && picked ? 1 : 0;
          u += truth || picked ? 1 : 0;
        }
      return i / u;
    };
    const withNegative = await sam.segment(embedding, [{ x: 0.35, y: 0.5, positive: true }, { x: 0.85, y: 0.5, positive: false }], w, h);
    expect(iou(withNegative.mask.data)).toBeGreaterThan(0.9);
    const bothPositive = await sam.segment(embedding, [{ x: 0.35, y: 0.5, positive: true }, { x: 0.85, y: 0.5, positive: true }], w, h);
    expect(iou(bothPositive.mask.data)).toBeLessThan(0.6);
    await sam.release();
  });
});
