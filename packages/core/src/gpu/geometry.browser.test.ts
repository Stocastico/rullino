import { afterAll, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { applyGeometryCpu, IDENTITY_GEOMETRY, type Geometry } from '../geometry';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage } from '../image';
import { createGpuContext } from './context';
import { applyGeometry } from './geometry';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

let seed = 21;
const [w, h] = [37, 23];
const src = createImage(w, h, fromFloat16Array(toFloat16Array(Float32Array.from({ length: w * h * 4 }, () => (seed = (seed * 16807) % 2147483647) / 2147483647))));
const g = (patch: Partial<Geometry>): Geometry => ({ ...IDENTITY_GEOMETRY, ...patch });

it.each<[string, Geometry]>([
  ['identity', IDENTITY_GEOMETRY],
  ['quarter turn', g({ rotate: 90 })],
  ['half turn + flip', g({ rotate: 180, flipH: true })],
  ['three quarters + vertical flip', g({ rotate: 270, flipV: true })],
  ['crop', g({ crop: { x: 0.13, y: 0.2, width: 0.61, height: 0.55 } })],
  ['straighten', g({ straighten: -17.5 })],
  ['perspective', g({ perspective: [[0.1, 0.05], [0.95, 0.15], [0.85, 0.9], [0.02, 0.97]] })],
  ['everything', g({ rotate: 90, flipH: true, straighten: 8, perspective: [[0, 0.1], [1, 0], [0.9, 1], [0.1, 0.95]], crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } })],
])('GPU geometry matches the CPU: %s', async (_, geometry) => {
  const out = await readImage(ctx, applyGeometry(ctx, uploadImage(ctx, src), geometry));
  const want = applyGeometryCpu(src, geometry);
  expect([out.width, out.height]).toEqual([want.width, want.height]);
  const res = compareImages(out, want, { abs: 1e-3, rel: 2 ** -9 });
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
