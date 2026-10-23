import { createImage, createRasterMask, linearToSrgb, srgbToLinear } from '@rullino/core';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { createMiganInpainter, MIGAN, type OrtModule } from '../src';

// The real MI-GAN pipeline model on ONNX Runtime's WASM backend (Node), downloaded by
// scripts/fetch-models.mjs (`pnpm test:ml`).

const bytes = new Uint8Array(readFileSync(new URL(`../../../.cache/models/${MIGAN.model.url.split('/').at(-1)}`, import.meta.url)));

/** A smooth sRGB background (blue sky above, green below) with a red disk of radius 0.12 w at (0.5, 0.5). */
const background = (x: number, y: number, w: number, h: number) => (y < h / 2 ? [0.3, 0.5 + 0.2 * (y / h), 0.9] : [0.3, 0.7, 0.3 + 0.1 * (y / h)]);
const disk = (x: number, y: number, w: number, h: number) => Math.hypot(x - 0.5 * w, y - 0.5 * h) < 0.12 * w;

describe('MI-GAN on ONNX Runtime (WASM)', () => {
  it('removes a disk: the hole takes the surrounding colours, the rest is untouched', { timeout: 120_000 }, async () => {
    ort.env.wasm.numThreads = 1;
    const inpainter = await createMiganInpainter(ort as unknown as OrtModule, bytes);
    const [w, h] = [384, 256]; // not square, not 512
    const img = createImage(w, h);
    const holeMask = createRasterMask(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const e = disk(x, y, w, h) ? [0.9, 0.1, 0.1] : background(x, y, w, h);
        img.data.set([...e.map(srgbToLinear), 1], (y * w + x) * 4);
        holeMask.data[y * w + x] = disk(x, y, w, h) ? 1 : 0;
      }
    const out = await inpainter.inpaint(img, holeMask, { grow: 2 });
    expect([out.width, out.height]).toEqual([w, h]);

    const srgb = (i: number, c: number) => linearToSrgb(out.data[i * 4 + c]!);
    // The hole centre is no longer red: its red channel is far from 0.9 (the surroundings have 0.3).
    const centre = (h / 2) * w + w / 2;
    expect(srgb(centre, 0)).toBeLessThan(0.55);
    expect(srgb(centre, 2)).toBeGreaterThan(0.2);
    // Far from the hole the image is as it was.
    let worst = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (Math.hypot(x - 0.5 * w, y - 0.5 * h) < 0.12 * w + 6) continue;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(srgb(y * w + x, c) - linearToSrgb(img.data[(y * w + x) * 4 + c]!)));
      }
    expect(worst).toBeLessThan(2 / 255);
    await inpainter.release();
  });
});
