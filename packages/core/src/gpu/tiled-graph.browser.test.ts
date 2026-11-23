import { afterAll, describe, expect, it } from 'vitest';
import { IDENTITY_GEOMETRY, type Geometry } from '../geometry';
import { parseEdit } from '../graph';
import { toFloat16Array } from '../half';
import { createImage } from '../image';
import { createGpuContext } from './context';
import { applyGeometry } from './geometry';
import { readTextureBytes } from './readback';
import { downscale } from './resize';
import { applyGeometryTiled, downscaleTiled, runGraphTiled, uploadHalves, type HalfImage } from './tiled';
import { runGraphGpu } from '../graph-gpu';

// Geometry and resize read a source rectangle that depends on the mapping; mix reads two images.
// In tiles they must still give the whole-image result bit for bit.

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

function image(w: number, h: number, seed = 1): HalfImage {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = 0.3 + 0.7 * (((i * 13 + seed) % 7) / 6);
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = a * (((i * (c + 5) + seed) % 23) / 22);
    img.data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data: toFloat16Array(img.data) };
}

const read = async (tex: GPUTexture) => new Uint16Array(await readTextureBytes(ctx, tex, 8));
const same = (a: Uint16Array, b: Uint16Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const geometries: [string, Geometry][] = [
  ['straighten and crop', { ...IDENTITY_GEOMETRY, straighten: 17, crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.85 } }],
  ['turn and flip', { ...IDENTITY_GEOMETRY, rotate: 90, flipH: true }],
  ['perspective', { ...IDENTITY_GEOMETRY, perspective: [[0.1, 0.05], [0.95, 0], [1, 1], [0, 0.9]] }],
];

describe('tiled geometry, resize and mix', () => {
  const src = image(61, 43);
  for (const [name, g] of geometries)
    it(`geometry (${name}) in tiles equals the whole`, async () => {
      const whole = await read(applyGeometry(ctx, uploadHalves(ctx, src), g));
      for (const side of [9, 16, 40]) expect(same((await applyGeometryTiled(ctx, src, g, side)).data, whole), `side ${side}`).toBe(true);
    });

  it('a downscale by a fractional ratio in tiles equals the whole', async () => {
    for (const [w, h] of [[29, 20], [61, 1], [7, 43]] as const) {
      const whole = await read(downscale(ctx, uploadHalves(ctx, src), w, h));
      for (const side of [5, 12]) expect(same((await downscaleTiled(ctx, src, w, h, side)).data, whole), `${w}x${h} side ${side}`).toBe(true);
    }
  });

  it('a graph (chain with geometry, resize, masked mix) in tiles equals runGraphGpu', async () => {
    const doc = {
      version: 3,
      inputs: { a: {}, b: {} },
      nodes: [
        { id: 'framed', from: 'a', geometry: geometries[0]![1], steps: [{ filter: 'shift', params: {} }] },
        { id: 'small', kind: 'resize', from: 'framed', scale: 0.6 },
        { id: 'other', kind: 'resize', from: 'b', scale: 0.6 },
        { id: 'out', kind: 'mix', from: ['small', 'other'], amount: 0.7, mask: { kind: 'radial', center: [0.4, 0.5], radius: [0.3, 0.2], feather: 0.5 } },
      ],
    };
    const { defineFilter } = await import('../define');
    const shift = defineFilter({
      id: 'shift',
      label: 'Shift',
      category: 'classic',
      kind: 'multipass',
      params: {},
      passes: [{ name: 'out', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy + vec2i(2, -1)) * (0.5 + f32(xy.x) / f32(size().x)); }' }],
      reach: () => 2,
      cpu: (s) => s,
      tolerance: { abs: 0, rel: 0 },
    });
    const graph = parseEdit(doc, { filters: [shift] });
    // Two inputs of different sizes that the resizes and the geometry bring to one size.
    const a = src;
    const geo = (await applyGeometryTiled(ctx, a, geometries[0]![1], 64));
    const b = image(geo.width, geo.height, 5);
    const r = await runGraphGpu(ctx, graph, new Map([['a', { texture: uploadHalves(ctx, a), scale: 1 }], ['b', { texture: uploadHalves(ctx, b), scale: 1 }]]));
    const whole = await read(r.texture);
    r.dispose();
    const inputs = new Map([['a', { image: a, scale: 1 }], ['b', { image: b, scale: 1 }]]);
    for (const side of [11, 24]) expect(same((await runGraphTiled(ctx, graph, inputs, { side })).data, whole), `side ${side}`).toBe(true);
  });
});
