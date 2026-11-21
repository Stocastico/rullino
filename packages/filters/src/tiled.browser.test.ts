import { createGpuContext, createImage, defaultParams, Pipeline, toFloat16Array, type Filter, type LinearImage, type Mask, type Step } from '@rullino/core';
import { readTextureBytes, runChainTiled, stepReach, uploadHalves, uploadSrgb8Rect, type HalfImage } from '@rullino/core/internal';
import { afterAll, describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityImages, parityMask, specialImage } from './test-utils';

// Tiled GPU rendering (#176) must give the whole-image result bit for bit: each tile runs the same
// shaders on the same values, sees whole-image positions through its frame, and its halo covers the
// reach of the steps. Strict equality on the half-float bits, as in bands.test.ts for the CPU.

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

const toHalves = (img: LinearImage): HalfImage => ({ width: img.width, height: img.height, data: toFloat16Array(img.data) });

const images: Record<string, LinearImage> = { ...parityImages, special: specialImage() };
const stepOf = (f: Filter, params: Record<string, unknown>, mask?: Mask): Step => ({ filter: f, params: { ...defaultParams(f.params), ...params }, ...(mask && { mask }) });
const needsMask = (f: Filter) => f.kind === 'multipass' && f.usesMask === true;
const haloOf = (steps: Step[]) => steps.reduce((sum, s) => sum + (stepReach(s) === 'global' ? 0 : (stepReach(s) as number)), 0);

async function whole(steps: Step[], src: HalfImage): Promise<Uint16Array> {
  const tex = uploadHalves(ctx, src);
  const p = new Pipeline(ctx);
  p.setSource(tex);
  const out = new Uint16Array(await readTextureBytes(ctx, p.run(steps), 8));
  p.destroy();
  tex.destroy();
  return out;
}

function firstDifference(a: Uint16Array, b: Uint16Array, w: number): string | undefined {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `pixel (${(i >> 2) % w}, ${Math.floor((i >> 2) / w)}) channel ${i & 3}: ${a[i]} against ${b[i]}`;
  return undefined;
}

/** A tile side that leaves an interior of about a third of the image: several tiles in each direction. */
const sideFor = (src: HalfImage, halo: number) => 2 * halo + Math.max(1, Math.floor(Math.min(src.width, src.height) / 3));

const local = filters.filter((f) => !(f.kind === 'multipass' && (f.reach === undefined || f.reach === 'global')));

describe('every filter, tiled, equals the whole image', () => {
  it.each(local.map((f) => [f.id, f as Filter] as const))('%s', async (id, f) => {
    for (const [name, img] of Object.entries(images)) {
      const src = toHalves(img);
      for (const [c, params] of parityCases(f.params)) {
        const steps = [stepOf(f, params, needsMask(f) ? parityMask : undefined)];
        const side = sideFor(src, haloOf(steps));
        const tiled = await runChainTiled(ctx, steps, src, { side });
        const diff = firstDifference(tiled.data, await whole(steps, src), src.width);
        expect(diff, `${id} ${c} on ${name} (side ${side}): ${diff}`).toBeUndefined();
      }
    }
  }, 120_000);
});

// One pixel of halo less must show for filters that read neighbours (the reach is what makes tiles
// exact). bands.test.ts checks the reach is tight in rows; this checks the tiles use it.
describe('a halo one pixel short changes the result', () => {
  it.each(['gaussianBlur', 'unsharpMask', 'median', 'bilateral', 'pixelate'].map((id) => [id] as const))('%s', async (id) => {
    const f = filters.find((x) => x.id === id)! as Filter;
    const src = toHalves(images.rings!);
    const steps = [stepOf(f, {})];
    const side = sideFor(src, haloOf(steps));
    const short = await runChainTiled(ctx, steps, src, { side, extraHalo: -1 });
    expect(firstDifference(short.data, await whole(steps, src), src.width)).toBeDefined();
  });
});

describe('runChainTiled', () => {
  it('runs chains of several steps, masks and 8-bit sources, and a chain that is empty', async () => {
    const byId = (id: string) => filters.find((x) => x.id === id)! as Filter;
    const steps = [stepOf(byId('exposure'), { ev: 0.5 }), stepOf(byId('gaussianBlur'), { sigma: 2 }, parityMask), stepOf(byId('vignette'), {}), stepOf(byId('saturation'), { amount: 0.4 })];
    const src = toHalves(images.rings!);
    const tiled = await runChainTiled(ctx, steps, src, { side: sideFor(src, haloOf(steps)) });
    expect(firstDifference(tiled.data, await whole(steps, src), src.width)).toBeUndefined();

    const rgba = { width: 23, height: 17, data: Uint8Array.from({ length: 23 * 17 * 4 }, (_, i) => (i * 37) % 256) };
    const tex = uploadSrgb8Rect(ctx, rgba.data, 23, 0, 0, 23, 17);
    const expected = new Uint16Array(await readTextureBytes(ctx, tex, 8));
    expect(firstDifference((await runChainTiled(ctx, [], rgba, { side: 8 })).data, expected, 23)).toBeUndefined();
    expect((await runChainTiled(ctx, [], src, { side: 16 })).data).toEqual(src.data);
  });

  it('refuses a global step without GPU phases that does not fit, naming it', async () => {
    const src = toHalves(createImage(40, 30));
    const eq = filters.find((x) => x.id === 'equalize')! as Filter & { kind: 'multipass' };
    const plain = { ...eq, twoPhase: undefined } as unknown as Filter;
    await expect(runChainTiled(ctx, [stepOf(plain, {})], src, { side: 16 })).rejects.toThrow(/"equalize" needs the whole image at once, and 40×30 does not fit in 16 px/);
  });
});

// Global filters (equalize, clahe, otsu) run in two phases: their statistic passes on every tile's
// own pixels, adding into buffers kept for the render (integer counts, so exact in any order), their
// finishing passes once, the mapping on every tile.
describe('global filters, tiled, equal the whole image', () => {
  const globals = filters.filter((f) => f.kind === 'multipass' && f.reach === 'global');
  it('there are some, and they all declare their GPU phases', () => {
    expect(globals.map((f) => f.id).sort()).toEqual(['clahe', 'equalize', 'otsu']);
    for (const f of globals) {
      const gpu = f.kind === 'multipass' ? f.twoPhase?.gpu : undefined;
      expect(gpu, f.id).toBeTruthy();
      const names = f.kind === 'multipass' ? f.passes.map((p) => p.name) : [];
      for (const n of [...gpu!.stat, ...gpu!.finish]) expect(names, `${f.id}: phase pass "${n}"`).toContain(n);
    }
  });

  it.each(globals.map((f) => [f.id, f as Filter] as const))('%s, alone and between other steps, masked', async (id, f) => {
    const byId = (x: string) => filters.find((g) => g.id === x)! as Filter;
    for (const [name, img] of Object.entries(images)) {
      const src = toHalves(img);
      for (const [c, params] of parityCases(f.params)) {
        for (const steps of [
          [stepOf(f, params)],
          [stepOf(byId('gaussianBlur'), { sigma: 1.5 }), stepOf(f, params, parityMask), stepOf(byId('vignette'), {}), stepOf(f, params)],
        ]) {
          const side = Math.max(16, sideFor(src, haloOf(steps)));
          const tiled = await runChainTiled(ctx, steps, src, { side });
          const diff = firstDifference(tiled.data, await whole(steps, src), src.width);
          expect(diff, `${id} ${c} on ${name}, ${steps.length} steps (side ${side}): ${diff}`).toBeUndefined();
        }
      }
    }
  }, 120_000);
});
