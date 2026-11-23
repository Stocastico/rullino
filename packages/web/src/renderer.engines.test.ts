import { applyEdit, createImage, encodeSrgb8, fromFloat16Array, toFloat16Array, type LinearImage } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks, resolveLookLut } from '@rullino/presets';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderer, type Renderer } from './index';

// @rullino/web in Firefox and WebKit (#177, `pnpm test:engines`): until now only the maintainer's
// machines ran Safari and Firefox. Playwright's Linux builds expose no WebGPU adapter, so this is the
// CPU path (render worker, band workers, encoders) and the backend choice itself: no adapter must mean
// the CPU with a reason, and an adapter (a build that has one) a working GPU render.

function chart(w: number, h: number): LinearImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = x < 4 ? 0.5 : 1;
      img.data.set([((x / w) ** 2) * a, (y / h) * a, 0.3 * (1 + Math.sin(x * 0.3)) * a, a], (y * w + x) * 4);
    }
  return createImage(w, h, fromFloat16Array(toFloat16Array(img.data)));
}

const edit = {
  version: 3,
  inputs: { main: {} },
  nodes: [
    {
      id: 'edit',
      from: 'main',
      steps: [
        ...(lookEdit(looks[1]!, { intensity: 0.8 }).nodes[0] as unknown as { steps: unknown[] }).steps,
        { filter: 'gaussianBlur', params: { sigma: 1.5 } },
        { filter: 'equalize', params: { amount: 0.5 } },
        { filter: 'curves', params: { rgb: [[0, 0], [0.4, 0.3], [1, 1]] }, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.3], feather: 0.5 } },
      ],
    },
  ],
};

const renderers: Renderer[] = [];
afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
});
const make = async (...args: Parameters<typeof createRenderer>) => {
  const r = await createRenderer(...args);
  renderers.push(r);
  return r;
};

const hasAdapter = async () => {
  try {
    return 'gpu' in navigator && (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
};

describe(`@rullino/web in ${navigator.userAgent}`, () => {
  it("'auto' picks WebGPU when there is an adapter, else the CPU and says why", async () => {
    const r = await make();
    if (await hasAdapter()) {
      expect(r.backend).toBe('gpu');
      const out = await r.apply(chart(31, 17), edit);
      expect([out.width, out.height]).toEqual([31, 17]);
    } else {
      expect(r.backend).toBe('cpu');
      expect(r.reason).toMatch(/\w/);
    }
  });

  it('the CPU worker renders what applyEdit renders on this thread, bit for bit', async () => {
    const src = chart(37, 21);
    const r = await make({ backend: 'cpu' });
    const here = await applyEdit(src, edit, { filters, resolveLut: resolveLookLut });
    expect((await r.apply(src, edit)).data).toEqual(here.data);
    expect((await r.pixels(src, edit)).data).toEqual(new Uint8ClampedArray(encodeSrgb8(here)));
  });

  it('band workers give the one-thread result, equalize included', async () => {
    const src = chart(64, 96);
    const one = await make({ backend: 'cpu', threads: 1 });
    const bands: number[] = [];
    const four = await make({ backend: 'cpu', threads: 4, pool: { createAtPixels: 0, useAtPixels: 0, forceBands: true, onRender: (i) => bands.push(i.bands) } });
    expect((await four.apply(src, edit)).data).toEqual((await one.apply(src, edit)).data);
    expect(bands.length).toBe(1);
    expect(bands[0]).toBeGreaterThan(1);
  });

  it('render() encodes PNG and JPEG (and WebP, or says the browser cannot)', async () => {
    const r = await make({ backend: 'cpu' });
    const src = new ImageData(new Uint8ClampedArray(23 * 11 * 4).fill(180), 23, 11);
    const png = await r.render(src, { ...edit, output: { format: 'png' } });
    expect(png.type).toBe('image/png');
    expect([...new Uint8Array(await png.slice(0, 4).arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const jpeg = await r.render(src, { ...edit, output: { format: 'jpeg', quality: 0.8 } });
    expect(jpeg.type).toBe('image/jpeg');
    try {
      expect((await r.render(src, { ...edit, output: { format: 'webp' } })).type).toBe('image/webp');
    } catch (e) {
      expect((e as Error).message).toMatch(/webp/i);
    }
  });
});
