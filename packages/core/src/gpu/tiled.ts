// Tiled GPU rendering (#176): a chain on an image larger than a texture, or than the memory the
// caller allows, cut into tiles (`planTiles`) with a halo of the chain's reach. Each tile is uploaded
// from CPU memory, run through a Pipeline that knows its frame, and the pixels it owns are read back
// into the result, which lives in CPU memory as half floats (what the textures hold, so nothing is
// rounded on the way). Tiles therefore give the whole-image result bit for bit.
import type { Rgba8Image } from '../image';
import { activeSteps, type Step } from '../pipeline/chain';
import { planSegments, type Segment } from '../pipeline/bands';
import { Pipeline } from '../pipeline/pipeline';
import { planTiles, type TilePlan } from '../pipeline/tiles';
import type { GpuContext } from './context';
import { uploadSrgb8Rect } from './io';
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

/** One segment over the whole image, tile by tile. */
async function runSegment(ctx: GpuContext, seg: Segment, src: HalfImage | Rgba8Image, options: TiledOptions): Promise<HalfImage> {
  const { width, height } = src;
  if (seg.halo === 'global' && (width > options.side || height > options.side))
    throw new RangeError(`tiled rendering: "${seg.steps[0]!.filter.id}" needs the whole image at once, and ${width}×${height} does not fit in ${options.side} px`);
  const halo = seg.halo === 'global' ? 0 : Math.max(0, seg.halo + (options.extraHalo ?? 0));
  const out: HalfImage = { width, height, data: new Uint16Array(width * height * 4) };
  const pipeline = new Pipeline(ctx);
  try {
    for (const t of planTiles(width, height, options.side, halo)) {
      const input = upload(ctx, src, t);
      pipeline.setSource(input, { scale: options.scale ?? 1, frame: { x: t.fromX, y: t.fromY, fullWidth: width, fullHeight: height } });
      await readOwned(ctx, pipeline.run(seg.steps), t, out);
      pipeline.destroy();
      releaseTexture(ctx, input);
    }
  } finally {
    pipeline.destroy();
  }
  return out;
}

/**
 * Renders `steps` on `src` in tiles no larger than `options.side`, giving what one Pipeline run on
 * the whole image would give, read back as half floats. An 8-bit source is decoded on the GPU like
 * `uploadSrgb8`. A step that needs the whole image at once (a global filter) fails if it does not fit.
 */
export async function runChainTiled(ctx: GpuContext, steps: readonly Step[], src: HalfImage | Rgba8Image, options: TiledOptions): Promise<HalfImage> {
  const segments = activeSteps(steps).length ? planSegments(steps, options.scale) : [{ steps: [], halo: 0 } as Segment];
  let img: HalfImage | Rgba8Image = src;
  for (const seg of segments) img = await runSegment(ctx, seg, img, options);
  return img as HalfImage;
}
