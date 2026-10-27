import { applyEdit, createGpuContext, createImage, decodeSrgb8, IDENTITY_GEOMETRY, serializeChain, type LinearImage } from '@rullino/core';
import { clahe, curves, exposure, filters, gaussianBlur, saturation, unsharpMask, vignette } from '@rullino/filters';
import { lookEdit, lookLutRef, looks, resolveLookLut } from '@rullino/presets';
import { afterAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

// The promise of PLAN §6b: an edit previewed in the browser renders the same on the server. The
// same documents run here on Chromium's WebGPU and, through the `renderOnDawn` command
// (vitest.config.ts), in Node on Dawn with @rullino/node: two WebGPU implementations, one set of
// shaders. On a fixed image set: two sample photos and a generated chart.

const gpu = await createGpuContext();
afterAll(() => gpu.device.destroy());

async function sample(name: string, width: number): Promise<LinearImage> {
  const blob = await (await fetch(`/apps/playground/public/samples/${name}`)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  return decodeSrgb8(g.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
}

function chart(): LinearImage {
  const [w, h] = [97, 61];
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - 40, y - 30) * 0.6);
    const a = x > 85 ? 0.5 : 1;
    img.data.set([v * (x / w) * a, v * 0.7 * a, (1 - y / h) * a, a], (y * w + x) * 4);
  }
  return img;
}

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const documents: [string, unknown][] = [
  ...looks.map((look) => [`look ${look.id}`, json(lookEdit(look, { intensity: 0.85 }))] as [string, unknown]),
  ['tone + detail', json(serializeChain(
    [
      { filter: exposure, params: { ev: 0.4 } },
      { filter: curves, params: { rgb: [[0, 0.02], [0.4, 0.35], [0.75, 0.82], [1, 1]] } },
      { filter: saturation, params: { amount: 0.25 }, mask: { kind: 'radial', center: [0.4, 0.5], radius: [0.35, 0.3], feather: 0.6 } },
      { filter: unsharpMask, params: { sigma: 1.5, amount: 0.6 } },
      { filter: vignette },
    ],
    { geometry: { ...IDENTITY_GEOMETRY, rotate: 90, straighten: 2.5, crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.85 } }, output: { longSide: 80 } },
  ))],
  ['local contrast + blur', json(serializeChain([
    { filter: clahe },
    { filter: gaussianBlur, params: { sigma: 2 }, mask: { kind: 'linear', from: [0, 0], to: [0, 1] } },
  ], { lutRef: lookLutRef }))],
];

describe('browser (Chromium WebGPU) vs Node (Dawn)', async () => {
  const images: [string, LinearImage][] = [['river', await sample('river.jpg', 120)], ['still life', await sample('still-life.jpg', 120)], ['chart', chart()]];

  it.each(images)('%s: every document agrees within 4e-3 + 4e-3·|v|', async (_, image) => {
    const wire = { width: image.width, height: image.height, data: Array.from(image.data) };
    const fromNode = await commands.renderOnDawn(documents.map(([, doc]) => doc), wire);
    let differs = false;
    for (const [i, [name, doc]] of documents.entries()) {
      const here = await applyEdit(image, doc, { filters, resolveLut: resolveLookLut, gpu });
      const there = fromNode[i]!;
      expect([there.width, there.height], name).toEqual([here.width, here.height]);
      // Like every parity check, absolute plus relative: values above 1 (HDR) carry larger float16 steps,
      // and unsharp masking amplifies the intermediates' rounding (its own tolerance is 5e-3 + 5e-3·|v|).
      let worst = 0, at = -1;
      for (let k = 0; k < here.data.length; k++) {
        const excess = Math.abs(here.data[k]! - there.data[k]!) - (4e-3 + 4e-3 * Math.abs(there.data[k]!));
        if (excess > worst || at < 0) [worst, at] = [Math.max(worst, excess), k];
      }
      expect(worst, `${name}: worst pixel channel ${at}: ${here.data[at]} (browser) vs ${there.data[at]} (node)`).toBeLessThanOrEqual(0);
      differs ||= here.data.some((v, k) => v !== there.data[k]);
    }
    expect(differs, 'two different WebGPU implementations should not agree bit for bit everywhere').toBe(true);
  });
});

declare module 'vitest/browser' {
  interface BrowserCommands {
    renderOnDawn(documents: unknown[], image: { width: number; height: number; data: number[] }): Promise<{ width: number; height: number; data: number[] }[]>;
  }
}
