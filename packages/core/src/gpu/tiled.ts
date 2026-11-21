// Tiled GPU rendering (#176): a chain on an image larger than a texture, or than the memory the
// caller allows, cut into tiles (`planTiles`) with a halo of the chain's reach. Each tile is uploaded
// from CPU memory, run through a Pipeline that knows its frame, and the pixels it owns are read back
// into the result, which lives in CPU memory as half floats (what the textures hold, so nothing is
// rounded on the way). Tiles therefore give the whole-image result bit for bit.
import type { Rgba8Image } from '../image';
import type { MultipassFilter } from '../filter';
import { geometryFrame, isIdentityGeometry, type Geometry } from '../geometry';
import type { EditGraph } from '../graph';
import { checkMixSizes, mixMask, resizeSize, walkGraph, type GraphValue } from '../graph-cpu';
import type { Mask } from '../mask';
import { activeSteps, effectiveParams, type Step } from '../pipeline/chain';
import { planSegments, type Segment } from '../pipeline/bands';
import { Pipeline } from '../pipeline/pipeline';
import { planTiles, type TilePlan } from '../pipeline/tiles';
import type { GpuContext } from './context';
import { applyGeometry } from './geometry';
import { readSrgb8, uploadSrgb8Rect } from './io';
import { downscale } from './resize';
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

// Geometry, resize and mix (#176, graphs): each output tile reads a source rectangle that depends on
// the mapping. Tiles whose source rectangle would not fit `side` are split until it does.

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Output tiles of a `width` × `height` image, each with the source rectangle it reads (`need`), both at most `side` a side. */
export function planMapped(width: number, height: number, side: number, need: (r: Rect) => Rect): { out: Rect; src: Rect }[] {
  const plans: { out: Rect; src: Rect }[] = [];
  const visit = (out: Rect) => {
    const src = need(out);
    const [ow, oh] = [out.x1 - out.x0, out.y1 - out.y0];
    if ((src.x1 - src.x0 <= side && src.y1 - src.y0 <= side) || (ow === 1 && oh === 1)) return void plans.push({ out, src });
    if (ow >= oh) {
      const mid = out.x0 + Math.floor(ow / 2);
      visit({ ...out, x1: mid });
      visit({ ...out, x0: mid });
    } else {
      const mid = out.y0 + Math.floor(oh / 2);
      visit({ ...out, y1: mid });
      visit({ ...out, y0: mid });
    }
  };
  for (const t of planTiles(width, height, side, 0)) visit(t);
  return plans;
}

/** A rectangle clamped to a `w` × `h` image, at least one pixel (a tile that reads nothing still binds a texture). */
function clampRect(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Rect {
  const cx0 = Math.min(w - 1, Math.max(0, x0));
  const cy0 = Math.min(h - 1, Math.max(0, y0));
  return { x0: cx0, y0: cy0, x1: Math.max(cx0 + 1, Math.min(w, x1)), y1: Math.max(cy0 + 1, Math.min(h, y1)) };
}

const tileOf = (r: Rect): TilePlan => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, fromX: r.x0, fromY: r.y0, toX: r.x1, toY: r.y1 });

/** Runs `render` on every output tile with its source rectangle uploaded, assembling a `width` × `height` result. */
async function mapTiles(ctx: GpuContext, src: HalfImage | Rgba8Image, width: number, height: number, side: number, need: (r: Rect) => Rect, render: (input: GPUTexture, out: Rect, from: Rect) => GPUTexture): Promise<HalfImage> {
  const result: HalfImage = { width, height, data: new Uint16Array(width * height * 4) };
  for (const { out, src: from } of planMapped(width, height, side, need)) {
    const input = upload(ctx, src, tileOf(from));
    const tex = render(input, out, from);
    await readOwned(ctx, tex, tileOf(out), result);
    releaseTexture(ctx, tex);
    releaseTexture(ctx, input);
  }
  return result;
}

/** `applyGeometry` in tiles of at most `side`: the same pixels, bit for bit. */
export function applyGeometryTiled(ctx: GpuContext, src: HalfImage | Rgba8Image, geometry: Geometry, side: number): Promise<HalfImage> {
  const frame = geometryFrame(geometry, src.width, src.height);
  const m = frame.matrix;
  const at = (x: number, y: number) => {
    const z = m[6]! * x + m[7]! * y + m[8]!;
    return [(m[0]! * x + m[1]! * y + m[2]!) / z - 0.5, (m[3]! * x + m[4]! * y + m[5]!) / z - 0.5] as const;
  };
  // The bilinear taps of the corners' pixel centres, with a margin for f32 against f64.
  const need = (r: Rect): Rect => {
    const pts = [at(r.x0 + 0.5, r.y0 + 0.5), at(r.x1 - 0.5, r.y0 + 0.5), at(r.x0 + 0.5, r.y1 - 0.5), at(r.x1 - 0.5, r.y1 - 0.5)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return clampRect(Math.floor(Math.min(...xs)) - 2, Math.floor(Math.min(...ys)) - 2, Math.floor(Math.max(...xs)) + 3, Math.floor(Math.max(...ys)) + 3, src.width, src.height);
  };
  return mapTiles(ctx, src, frame.width, frame.height, side, need, (input, out, from) =>
    applyGeometry(ctx, input, geometry, { x: out.x0, y: out.y0, width: out.x1 - out.x0, height: out.y1 - out.y0, srcX: from.x0, srcY: from.y0, srcWidth: src.width, srcHeight: src.height }),
  );
}

/** `downscale` to `width` × `height` in tiles of at most `side`: the same pixels, bit for bit. */
export function downscaleTiled(ctx: GpuContext, src: HalfImage | Rgba8Image, width: number, height: number, side: number): Promise<HalfImage> {
  const [sx, sy] = [src.width / width, src.height / height];
  const need = (r: Rect) => clampRect(Math.floor(r.x0 * sx) - 1, Math.floor(r.y0 * sy) - 1, Math.ceil(r.x1 * sx) + 1, Math.ceil(r.y1 * sy) + 1, src.width, src.height);
  return mapTiles(ctx, src, width, height, side, need, (input, out, from) =>
    downscale(ctx, input, out.x1 - out.x0, out.y1 - out.y0, { x: out.x0, y: out.y0, width: out.x1 - out.x0, height: out.y1 - out.y0, srcX: from.x0, srcY: from.y0, srcWidth: src.width, srcHeight: src.height, fullWidth: width, fullHeight: height }),
  );
}

/** `blendMask(a, b, mask)` in tiles of at most `side` (the images have one size). */
async function blendTiled(ctx: GpuContext, a: HalfImage | Rgba8Image, b: HalfImage | Rgba8Image, mask: Mask, side: number): Promise<HalfImage> {
  const out: HalfImage = { width: a.width, height: a.height, data: new Uint16Array(a.width * a.height * 4) };
  for (const t of planTiles(a.width, a.height, side, 0)) {
    const [ta, tb] = [upload(ctx, a, t), upload(ctx, b, t)];
    const tex = blendMask(ctx, ta, tb, mask, { x: t.x0, y: t.y0, fullWidth: a.width, fullHeight: a.height });
    await readOwned(ctx, tex, t, out);
    for (const x of [tex, ta, tb]) releaseTexture(ctx, x);
  }
  return out;
}

/**
 * `runGraphGpu` in tiles of at most `options.side`, the inputs and every node's result in CPU
 * memory: the output node (before `output.longSide`), bit for bit as `runGraphGpu` renders it.
 */
export async function runGraphTiled(ctx: GpuContext, graph: EditGraph, inputs: ReadonlyMap<string, { readonly image: HalfImage | Rgba8Image; readonly scale: number }>, options: TiledOptions): Promise<HalfImage> {
  const values = new Map<string, GraphValue<HalfImage | Rgba8Image>>([...inputs].map(([name, v]) => [name, { value: v.image, scale: v.scale }]));
  const out = await walkGraph<HalfImage | Rgba8Image>(graph, values, async (node, ins) => {
    const [a, b] = ins as [GraphValue<HalfImage | Rgba8Image>, GraphValue<HalfImage | Rgba8Image> | undefined];
    switch (node.kind) {
      case 'chain': {
        const framed = node.geometry && !isIdentityGeometry(node.geometry) ? await applyGeometryTiled(ctx, a.value, node.geometry, options.side) : a.value;
        return { value: await runChainTiled(ctx, node.steps, framed, { ...options, scale: a.scale }), scale: a.scale };
      }
      case 'resize': {
        const [w, h] = resizeSize(node, a.value.width, a.value.height, a.scale);
        if (w === a.value.width && h === a.value.height) return { value: a.value, scale: a.scale };
        return { value: await downscaleTiled(ctx, a.value, w, h, options.side), scale: a.scale };
      }
      case 'mix':
        checkMixSizes(node, a.value, b!.value);
        return { value: await blendTiled(ctx, a.value, b!.value, mixMask(node), options.side), scale: a.scale };
    }
  });
  // Never hand back an input itself (an empty graph path passes it through): decode or copy it.
  const value = out.value;
  return [...inputs.values()].some((v) => v.image === value) || !isHalf(value) ? runChainTiled(ctx, [], value, options) : value;
}

/** A half-float image as 8-bit straight-alpha sRGB pixels, encoded on the GPU tile by tile like `readSrgb8`. */
export async function readSrgb8Tiled(ctx: GpuContext, src: HalfImage, side: number): Promise<Rgba8Image & { data: Uint8ClampedArray<ArrayBuffer> }> {
  const data = new Uint8ClampedArray(src.width * src.height * 4);
  for (const t of planTiles(src.width, src.height, side, 0)) {
    const tex = upload(ctx, src, t);
    const px = await readSrgb8(ctx, tex);
    releaseTexture(ctx, tex);
    const w = t.x1 - t.x0;
    for (let y = t.y0; y < t.y1; y++) data.set(px.subarray((y - t.y0) * w * 4, (y - t.y0 + 1) * w * 4), (y * src.width + t.x0) * 4);
  }
  return { width: src.width, height: src.height, data };
}
