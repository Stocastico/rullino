// Tiled GPU rendering (#176): a chain on an image larger than a texture, or than the memory the
// caller allows, cut into tiles (`planTiles`) with a halo of the chain's reach. Each tile is uploaded
// from CPU memory, run through a Pipeline that knows its frame, and the pixels it owns are read back
// into the result, which lives in CPU memory as half floats (what the textures hold, so nothing is
// rounded on the way). Tiles therefore give the whole-image result bit for bit.
import type { Rgba8Image } from '../image';
import type { MultipassFilter } from '../filter';
import { activeSteps, effectiveParams, type Step } from '../pipeline/chain';
import { planSegments, type Segment } from '../pipeline/bands';
import { Pipeline } from '../pipeline/pipeline';
import { planTiles, type TilePlan } from '../pipeline/tiles';
import type { GpuContext } from './context';
import { uploadSrgb8Rect } from './io';
import { blendMask } from './mask';
import { createPhaseBuffers, runMultipass } from './multipass';
import { releaseTexture } from './pool';
import { readTextureBytes } from './readback';
import { createWorkingTexture } from './texture';

/** A working image in CPU memory: linear, premultiplied RGBA as float16 bit patterns. */
export interface HalfImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint16Array;
}

export interface TiledOptions {
  /** Resolution relative to the full image, for pixel-unit params (see `ChainOptions`). */
  readonly scale?: number;
  /** The largest texture side to use, halo included. */
  readonly side: number;
  /** Added to every segment's halo: tests use -1 to show that the declared reach is needed. */
  readonly extraHalo?: number;
}

const isHalf = (img: HalfImage | Rgba8Image): img is HalfImage => img.data instanceof Uint16Array;

/** The rectangle `from` – `to` of a tile as a working texture. */
function upload(ctx: GpuContext, src: HalfImage | Rgba8Image, t: TilePlan): GPUTexture {
  const [w, h] = [t.toX - t.fromX, t.toY - t.fromY];
  if (!isHalf(src)) return uploadSrgb8Rect(ctx, src.data, src.width, t.fromX, t.fromY, w, h);
  return uploadHalves(ctx, src, t.fromX, t.fromY, w, h);
}

/** The rectangle at (`x`, `y`) of a half-float image (default: all of it) as a working texture. */
export function uploadHalves(ctx: GpuContext, src: HalfImage, x = 0, y = 0, w = src.width, h = src.height): GPUTexture {
  const tex = createWorkingTexture(ctx, w, h);
  ctx.device.queue.writeTexture({ texture: tex }, src.data as Uint16Array<ArrayBuffer>, { offset: (y * src.width + x) * 8, bytesPerRow: src.width * 8, rowsPerImage: h }, { width: w, height: h });
  return tex;
}

/** Copies the pixels the tile owns from its result texture (the tile's `from` – `to` rectangle) into `out`. */
async function readOwned(ctx: GpuContext, tex: GPUTexture, t: TilePlan, out: HalfImage): Promise<void> {
  const halves = new Uint16Array(await readTextureBytes(ctx, tex, 8));
  const [ox, oy, w] = [t.x0 - t.fromX, t.y0 - t.fromY, t.x1 - t.x0];
  for (let y = t.y0; y < t.y1; y++) {
    const row = (y - t.y0 + oy) * tex.width + ox;
    out.data.set(halves.subarray(row * 4, (row + w) * 4), (y * out.width + t.x0) * 4);
  }
}

/** A two-phase step whose statistic is complete: the next segment starts by mapping through it. */
interface Carried {
  readonly step: Step;
  readonly filter: MultipassFilter<any>;
  readonly buffers: Map<string, GPUBuffer>;
}

const gpuPhased = (step: Step): step is Step & { filter: MultipassFilter<any> } => step.filter.kind === 'multipass' && step.filter.twoPhase?.gpu !== undefined;

/** The pixels a tile owns, cut out of its result (which covers the tile's `from` – `to` rectangle). */
function owned(ctx: GpuContext, tex: GPUTexture, t: TilePlan): GPUTexture {
  const out = createWorkingTexture(ctx, t.x1 - t.x0, t.y1 - t.y0);
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToTexture({ texture: tex, origin: { x: t.x0 - t.fromX, y: t.y0 - t.fromY } }, { texture: out }, [out.width, out.height]);
  ctx.device.queue.submit([enc.finish()]);
  return out;
}

/**
 * One segment over the whole image, tile by tile. `carried`: the segment starts with that step's
 * mapping. `seg.statFor`: every tile adds the statistic of that step over the pixels it owns, and
 * the step is returned with its finished statistic, for the next segment.
 */
async function runSegment(ctx: GpuContext, seg: Segment, src: HalfImage | Rgba8Image, options: TiledOptions, carried?: Carried): Promise<{ image: HalfImage; next?: Carried }> {
  const { width, height } = src;
  if (seg.halo === 'global' && (width > options.side || height > options.side))
    throw new RangeError(`tiled rendering: "${seg.steps[0]!.filter.id}" needs the whole image at once, and ${width}×${height} does not fit in ${options.side} px`);
  const halo = seg.halo === 'global' ? 0 : Math.max(0, seg.halo + (options.extraHalo ?? 0));
  const scale = options.scale ?? 1;
  const fullFrame = { x: 0, y: 0, fullWidth: width, fullHeight: height };
  if (carried && seg.steps[0] !== carried.step) throw new Error('runChainTiled: a statistic was made for a step that does not come next');
  const steps = carried ? seg.steps.slice(1) : seg.steps;
  const statFor = seg.statFor as (Step & { filter: MultipassFilter<any> }) | undefined;
  const next = statFor && { step: statFor, filter: statFor.filter, buffers: createPhaseBuffers(ctx, statFor.filter) };
  const out: HalfImage = { width, height, data: new Uint16Array(width * height * 4) };
  const pipeline = new Pipeline(ctx);
  try {
    for (const t of planTiles(width, height, options.side, halo)) {
      const frame = { ...fullFrame, x: t.fromX, y: t.fromY };
      const input = upload(ctx, src, t);
      let source = input;
      if (carried) {
        // The mapping of the step whose statistic the previous segment made, then its mask, as Pipeline does.
        const params = effectiveParams(carried.step, scale);
        source = runMultipass(ctx, carried.filter, input, params, undefined, frame, { run: 'apply', buffers: carried.buffers }).output;
        if (carried.step.mask) {
          const mapped = source;
          source = blendMask(ctx, input, mapped, carried.step.mask, frame);
          releaseTexture(ctx, mapped);
        }
      }
      pipeline.setSource(source, { scale, frame });
      const result = pipeline.run(steps);
      await readOwned(ctx, result, t, out);
      if (next) {
        const mine = owned(ctx, result, t);
        runMultipass(ctx, next.filter, mine, effectiveParams(next.step, scale), undefined, { ...fullFrame, x: t.x0, y: t.y0 }, { run: 'stat', buffers: next.buffers });
        releaseTexture(ctx, mine);
      }
      pipeline.destroy();
      if (source !== input) releaseTexture(ctx, source);
      releaseTexture(ctx, input);
    }
    if (next) {
      // Finishing passes read only the buffers; they run once, on a texture of the image's position (0, 0)
      // that has at least as many pixels per axis as any per-tile invocation they use (CLAHE: ≤ 16 tiles).
      const scratch = createWorkingTexture(ctx, Math.min(width, 16), Math.min(height, 16));
      runMultipass(ctx, next.filter, scratch, effectiveParams(next.step, scale), undefined, fullFrame, { run: 'finish', buffers: next.buffers });
      releaseTexture(ctx, scratch);
    }
  } catch (e) {
    for (const b of next?.buffers.values() ?? []) b.destroy();
    throw e;
  } finally {
    pipeline.destroy();
  }
  return { image: out, ...(next && { next }) };
}

/**
 * Renders `steps` on `src` in tiles no larger than `options.side`, giving what one Pipeline run on
 * the whole image would give, read back as half floats. An 8-bit source is decoded on the GPU like
 * `uploadSrgb8`. Global filters with GPU phases (`TwoPhase.gpu`) run in two phases across the tiles;
 * a global step without them fails if the image does not fit one tile.
 */
export async function runChainTiled(ctx: GpuContext, steps: readonly Step[], src: HalfImage | Rgba8Image, options: TiledOptions): Promise<HalfImage> {
  const active = activeSteps(steps);
  // Two phases only when every two-phase step can run them on the GPU; otherwise they stand alone.
  const twoPhase = active.every((s) => s.filter.kind !== 'multipass' || !s.filter.twoPhase || gpuPhased(s));
  const segments = active.length ? planSegments(active, options.scale, { twoPhase }) : [{ steps: [], halo: 0 } as Segment];
  let img: HalfImage | Rgba8Image = src;
  let carried: Carried | undefined;
  for (const seg of segments) {
    const r = await runSegment(ctx, seg, img, options, carried);
    for (const b of carried?.buffers.values() ?? []) b.destroy();
    img = r.image;
    carried = r.next;
  }
  for (const b of carried?.buffers.values() ?? []) b.destroy();
  return img as HalfImage;
}
