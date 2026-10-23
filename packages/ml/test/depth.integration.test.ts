import { createImage, srgbToLinear } from '@rullino/core';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { createDepthEstimator, DEPTH_ANYTHING_V2_SMALL, type OrtModule } from '../src';

// The real Depth Anything V2 Small (int8) on ONNX Runtime's WASM backend (Node), downloaded by
// scripts/fetch-models.mjs (`pnpm test:ml`).

const bytes = new Uint8Array(readFileSync(new URL(`../../../.cache/models/${DEPTH_ANYTHING_V2_SMALL.model.url.split('/').at(-1)}`, import.meta.url)));

/** Sky above a horizon, a tiled floor below it whose tiles shrink towards the horizon, and a box standing on the floor. */
function scene(w: number, h: number) {
  const img = createImage(w, h);
  const horizon = 0.4 * h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let e: number[];
      if (y < horizon) e = [0.55 + 0.2 * (y / horizon), 0.7 + 0.1 * (y / horizon), 0.95];
      else {
        const depth = (y - horizon) / (h - horizon); // 0 at the horizon, 1 at the bottom edge
        const z = 1 / Math.max(depth, 0.02); // distance
        const tile = (Math.floor(((x - w / 2) * z) / 60) + Math.floor(z * 2)) % 2 === 0;
        e = tile ? [0.62, 0.55, 0.45] : [0.42, 0.36, 0.3];
      }
      if (x > 0.62 * w && x < 0.85 * w && y > 0.62 * h && y < 0.92 * h) e = [0.8, 0.2, 0.15]; // the box, near the camera
      img.data.set([...e.map(srgbToLinear), 1], (y * w + x) * 4);
    }
  return img;
}

describe('Depth Anything V2 Small on ONNX Runtime (WASM)', () => {
  it('puts the near floor and the box in front of the horizon and the sky (near = 1)', { timeout: 120_000 }, async () => {
    ort.env.wasm.numThreads = 1;
    const estimator = await createDepthEstimator(ort as unknown as OrtModule, bytes, { side: 336 });
    const map = await estimator.estimate(scene(480, 320));
    expect([map.width % 14, map.height % 14]).toEqual([0, 0]);
    const mean = (x0: number, x1: number, y0: number, y1: number) => {
      let [sum, n] = [0, 0];
      for (let y = Math.floor(y0 * map.height); y < Math.ceil(y1 * map.height); y++)
        for (let x = Math.floor(x0 * map.width); x < Math.ceil(x1 * map.width); x++) {
          sum += map.data[(y * map.width + x) * 4]!;
          n++;
        }
      return sum / n;
    };
    const sky = mean(0, 1, 0, 0.3);
    const farFloor = mean(0, 0.55, 0.42, 0.55);
    const nearFloor = mean(0, 0.55, 0.9, 1);
    const box = mean(0.68, 0.8, 0.68, 0.86);
    expect(nearFloor).toBeGreaterThan(farFloor + 0.2);
    expect(box).toBeGreaterThan(sky + 0.3);
    expect(nearFloor).toBeGreaterThan(sky + 0.3);
    await estimator.release();
  });
});
