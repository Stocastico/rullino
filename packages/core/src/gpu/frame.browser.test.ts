import { afterAll, describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage, type LinearImage } from '../image';
import type { Mask } from '../mask';
import { createGpuContext } from './context';
import type { TileFrame } from './frame';
import { blendMask, renderMask } from './mask';
import { runMultipass } from './multipass';
import { readImage, uploadImage } from './texture';

// A tile is a rectangle of the image with a halo, run on its own texture. Given its frame (where it
// sits in the whole image), every pass must see whole-image coordinates and size, so the tile's
// interior comes out bit for bit as the same rectangle of the whole run.

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

const W = 37;
const H = 29;
const src = (() => {
  const img = createImage(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = 0.25 + 0.75 * (((i * 7) % 11) / 10);
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = a * (((i * (c + 3)) % 17) / 16);
    img.data[i * 4 + 3] = a;
  }
  return createImage(W, H, fromFloat16Array(toFloat16Array(img.data)));
})();

/** The rectangle [x0, x1) × [y0, y1) of an image. */
function crop(img: LinearImage, x0: number, y0: number, x1: number, y1: number): LinearImage {
  const out = createImage(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) out.data.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x1) * 4), (y - y0) * out.width * 4);
  return out;
}

// A blur that reads 3 pixels each way plus a position-dependent gain: both must follow the frame.
const blurVignette = defineFilter({
  id: 'blurVignette',
  label: 'Blur and vignette',
  category: 'classic',
  kind: 'multipass',
  params: {},
  passes: [
    {
      name: 'h',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec4f(0.0);
  for (var k = -3; k <= 3; k++) { acc += load_input(xy + vec2i(k, 0)); }
  return acc / 7.0;
}`,
    },
    {
      name: 'out',
      inputs: ['h'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec4f(0.0);
  for (var k = -3; k <= 3; k++) { acc += load_h(xy + vec2i(0, k)); }
  let q = (vec2f(xy) + 0.5) / vec2f(size());
  return acc / 7.0 * (1.0 - 0.5 * length(q - 0.5));
}`,
    },
  ],
  reach: () => 3,
  cpu: (s) => s,
  tolerance: { abs: 0, rel: 0 },
});

/** The tiles of a 3 × 2 grid with a halo, clamped to the image. */
const tiles = (halo: number) =>
  [0, 1, 2].flatMap((i) =>
    [0, 1].map((j) => {
      const [x0, x1] = [Math.floor((i * W) / 3), Math.floor(((i + 1) * W) / 3)];
      const [y0, y1] = [Math.floor((j * H) / 2), Math.floor(((j + 1) * H) / 2)];
      const [fx, fy] = [Math.max(0, x0 - halo), Math.max(0, y0 - halo)];
      return { x0, y0, x1, y1, fx, fy, tx: Math.min(W, x1 + halo), ty: Math.min(H, y1 + halo) };
    }),
  );

async function tiled(halo: number, render: (tex: GPUTexture, frame: TileFrame) => GPUTexture): Promise<LinearImage> {
  const out = createImage(W, H);
  for (const t of tiles(halo)) {
    const input = uploadImage(ctx, crop(src, t.fx, t.fy, t.tx, t.ty));
    const result = await readImage(ctx, render(input, { x: t.fx, y: t.fy, fullWidth: W, fullHeight: H }));
    const inner = crop(result, t.x0 - t.fx, t.y0 - t.fy, t.x1 - t.fx, t.y1 - t.fy);
    for (let y = t.y0; y < t.y1; y++) out.data.set(inner.data.subarray((y - t.y0) * inner.width * 4, (y - t.y0 + 1) * inner.width * 4), (y * W + t.x0) * 4);
  }
  return out;
}

const differing = (a: LinearImage, b: LinearImage) => a.data.reduce((n, v, i) => n + (v !== b.data[i] ? 1 : 0), 0);

describe('frames', () => {
  it('a multipass filter on tiles with a halo of its reach equals the whole run, bit for bit', async () => {
    const whole = await readImage(ctx, runMultipass(ctx, blurVignette, uploadImage(ctx, src), {}).output);
    const t = await tiled(3, (tex, frame) => runMultipass(ctx, blurVignette, tex, {}, undefined, frame).output);
    expect(differing(t, whole)).toBe(0);
    // One pixel of halo less, or no frame, and it no longer does: the test can fail.
    const short = await tiled(2, (tex, frame) => runMultipass(ctx, blurVignette, tex, {}, undefined, frame).output);
    expect(differing(short, whole)).toBeGreaterThan(0);
    const unframed = await tiled(3, (tex) => runMultipass(ctx, blurVignette, tex, {}).output);
    expect(differing(unframed, whole)).toBeGreaterThan(0);
  });

  const masks: Mask[] = [
    { kind: 'linear', from: [0.2, 0.1], to: [0.8, 0.9] },
    { kind: 'radial', center: [0.4, 0.6], radius: [0.3, 0.2], feather: 0.5, invert: true, opacity: 0.8 },
    { kind: 'raster', raster: { width: 5, height: 4, data: Float32Array.from({ length: 20 }, (_, i) => (i % 7) / 6) } },
  ];
  for (const mask of masks)
    it(`a ${mask.kind} mask follows the frame (render and blend)`, async () => {
      const whole = await readImage(ctx, renderMask(ctx, mask, W, H));
      const t = await tiled(0, (tex, frame) => renderMask(ctx, mask, tex.width, tex.height, frame));
      expect(differing(t, whole)).toBe(0);
      expect(differing(await tiled(0, (tex) => renderMask(ctx, mask, tex.width, tex.height)), whole)).toBeGreaterThan(0);

      const black = (w: number, h: number) => uploadImage(ctx, createImage(w, h));
      const blended = await readImage(ctx, blendMask(ctx, uploadImage(ctx, src), black(W, H), mask));
      const tb = await tiled(0, (tex, frame) => blendMask(ctx, tex, black(tex.width, tex.height), mask, frame));
      expect(differing(tb, blended)).toBe(0);
    });
});
