import { afterAll, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage } from '../image';
import { blendMasked, createRasterMask, type Mask } from '../mask';
import { createGpuContext } from './context';
import { blendMask, rasterTextureCount } from './mask';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

function noise(w: number, h: number, seed: number) {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const a = r();
    data.set([r() * a, r() * a, r() * 1.5 * a, a], i);
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

// Odd, non-square sizes: exercises bounds checks and the longer-side normalisation.
const [w, h] = [53, 31];
const input = noise(w, h, 7);
const filtered = noise(w, h, 11);
const raster = createRasterMask(5, 3, new Float32Array([0, 0.2, 0.9, 1, 0.3, 1, 0, 0.5, 0.25, 0.75, 0.1, 0.6, 0.4, 0.8, 1]));

it.each<[string, Mask]>([
  ['linear, diagonal', { kind: 'linear', from: [0.2, 0.1], to: [0.7, 0.8] }],
  ['linear, inverted at half opacity', { kind: 'linear', from: [0.9, 0.5], to: [0.1, 0.4], invert: true, opacity: 0.5 }],
  ['radial ellipse, feathered', { kind: 'radial', center: [0.4, 0.6], radius: [0.3, 0.15], feather: 0.6 }],
  ['radial, off-centre, full feather', { kind: 'radial', center: [0, 1], radius: [0.8, 0.8], feather: 1 }],
  ['raster, upsampled', { kind: 'raster', raster }],
  ['raster at the image size', { kind: 'raster', raster: createRasterMask(w, h, Float32Array.from({ length: w * h }, (_, i) => (i * 37 % 101) / 100)) }],
])('GPU mask blend matches the CPU: %s', async (_, mask) => {
  const out = await readImage(ctx, blendMask(ctx, uploadImage(ctx, input), uploadImage(ctx, filtered), mask));
  const res = compareImages(out, blendMasked(input, filtered, mask), { abs: 2e-4, rel: 2 ** -10 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});

it('keeps only a few raster textures alive and re-uploads an evicted one', async () => {
  const rasters = Array.from({ length: 12 }, (_, k) => createRasterMask(7, 5, Float32Array.from({ length: 35 }, (_, i) => ((i + k) % 7) / 6)));
  for (const raster of rasters) blendMask(ctx, uploadImage(ctx, input), uploadImage(ctx, filtered), { kind: 'raster', raster }).destroy();
  expect(rasterTextureCount(ctx)).toBeLessThanOrEqual(4);
  const mask: Mask = { kind: 'raster', raster: rasters[0]! };
  const out = await readImage(ctx, blendMask(ctx, uploadImage(ctx, input), uploadImage(ctx, filtered), mask));
  const res = compareImages(out, blendMasked(input, filtered, mask), { abs: 2e-4, rel: 2 ** -10 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
