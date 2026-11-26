import { decodeSrgb8, encodeSrgb8 } from './color';
import { applyGeometryCpu, isIdentityGeometry } from './geometry';
import type { GpuContext } from './gpu/context';
import { readSrgb8, uploadSrgb8 } from './gpu/io';
import { downscale } from './gpu/resize';
import { releaseTexture } from './gpu/pool';
import { readImage, uploadImage } from './gpu/texture';
import { createImage, type LinearImage, type Rgba8Image } from './image';
import { parseEdit } from './graph';
import { checkMixSizes, mixMask, resizeSize, walkGraph, type GraphValue } from './graph-cpu';
import { runGraphGpu } from './graph-gpu';
import { blendMasked } from './mask';
import { activeSteps, runChainCpu, type Step } from './pipeline/chain';
import { stepReach } from './pipeline/bands';
import { tileSideFor } from './pipeline/tiles';
import { downscaleTiled, readSrgb8Tiled, runGraphTiled, type HalfImage } from './gpu/tiled';
import { fromFloat16Array, toFloat16Array } from './half';
import { downscaleCpu, fitWithin } from './resize';
import type { ParseOptions } from './serialize';

export interface ApplyEditOptions extends ParseOptions {
  /** Render on this GPU context; without one the CPU renders (filters' fast paths where they have one). */
  readonly gpu?: GpuContext | undefined;
  /**
   * Resolution of the source relative to the original the edit was made on (e.g. 0.25 for a preview
   * copy). Pixel-unit params are multiplied by it. Default 1. For a document with several inputs,
   * one number for all of them or one per input name.
   */
  readonly scale?: number | Readonly<Record<string, number>> | undefined;
  /**
   * Runs a chain on the CPU instead of the calling thread: receives the parsed steps, the framed
   * image and the scale, returns the result (it must equal `runChainCpu(steps, image, { scale, fast:
   * true })`). Called once per chain node of a version 3 document, with the node's id (`chainDocument` in `./internal` gives its steps as a document a worker can parse). For executors that spread the
   * work over threads, see `@rullino/node`. Ignored on the GPU.
   */
  /**
   * Bytes of GPU memory the render may use (roughly: it counts the working textures a render holds).
   * A larger image is rendered in tiles that fit it, with the same result. Without it, only an image
   * larger than the device's largest texture is tiled. Ignored on the CPU.
   */
  readonly memoryBudget?: number | undefined;
  /** Called when a render is tiled, with the tile side (texture pixels, halo included). */
  readonly onTiling?: ((info: { readonly side: number }) => void) | undefined;
  readonly cpu?: ((steps: readonly Step[], image: LinearImage, options: { readonly scale: number; readonly node: string }) => LinearImage | Promise<LinearImage>) | undefined;
}

/** One image for a document with one input, or the images by input name (version 3). */
export type EditSources = LinearImage | Rgba8Image | Readonly<Record<string, LinearImage | Rgba8Image>>;

/**
 * Renders an edit document on an image: its geometry, then its steps, then the `output.longSide`
 * shrink (in linear light; never enlarges). Version 1 documents are migrated. A version 3 document
 * (a graph) renders its output node from the inputs it names: pass one image for a one-input
 * document, or a record by input name. Encode the result with `encodeImage(result, doc.output)`.
 * The sources are not changed. They can be 8-bit RGBA pixels as a decoder produces them: on the GPU
 * they are decoded there (much faster than `decodeSrgb8` first).
 */
export async function applyEdit(source: EditSources, edit: unknown, options: ApplyEditOptions): Promise<LinearImage> {
  return renderEdit(source, edit, options, readImage, async (_ctx, half) => createImage(half.width, half.height, fromFloat16Array(half.data)), (img) => img);
}

/**
 * {@link applyEdit} returning 8-bit straight-alpha sRGB pixels (ImageData layout): on the GPU the
 * result is encoded there (`readSrgb8`), which is what an interactive preview needs.
 */
export async function applyEditPixels(source: EditSources, edit: unknown, options: ApplyEditOptions): Promise<Rgba8Image> {
  const out = await renderEdit(source, edit, options, async (ctx, tex) => ({ data: await readSrgb8(ctx, tex), width: tex.width, height: tex.height }), readSrgb8Tiled, (img) => ({
    data: encodeSrgb8(img),
    width: img.width,
    height: img.height,
  }));
  return out;
}

/** Textures a tile holds besides one per stage: its input, a mask, a pass's intermediates (ping-pong). */
const TILE_TEXTURES = 6;

/** The halo a chain needs in tiles: the sum of its steps' reaches at full resolution (global steps add none). */
const chainHalo = (steps: readonly Step[]) => activeSteps(steps).reduce((sum, s) => sum + (stepReach(s) === 'global' ? 0 : (stepReach(s) as number)), 0);

const isLinear = (img: LinearImage | Rgba8Image): img is LinearImage => img.data instanceof Float32Array;
const isOneImage = (x: EditSources): x is LinearImage | Rgba8Image => ArrayBuffer.isView((x as { data?: unknown }).data) && typeof (x as { width?: unknown }).width === 'number';

/** The sources by input name with their scales, checked against the inputs the graph reads. */
function bind(inputs: readonly string[], unused: readonly string[], source: EditSources, scale: ApplyEditOptions['scale']) {
  let byName: Record<string, LinearImage | Rgba8Image>;
  if (isOneImage(source)) {
    if (inputs.length !== 1) throw new Error(`the document reads ${inputs.length} inputs (${inputs.join(', ')}): pass them by name`);
    byName = { [inputs[0]!]: source };
  } else byName = { ...source };
  for (const name of Object.keys(byName)) if (!inputs.includes(name) && !unused.includes(name)) throw new Error(`input "${name}" is not one the document reads (${inputs.join(', ')})`);
  return inputs.map((name) => {
    const image = byName[name];
    if (!image) throw new Error(`input "${name}" is missing`);
    return { name, image, scale: typeof scale === 'number' ? scale : (scale?.[name] ?? 1) };
  });
}

async function renderEdit<T>(
  source: EditSources,
  edit: unknown,
  options: ApplyEditOptions,
  readGpu: (ctx: GpuContext, tex: GPUTexture) => Promise<T>,
  readTiled: (ctx: GpuContext, img: HalfImage, side: number) => Promise<T>,
  readCpu: (img: LinearImage) => T,
): Promise<T> {
  const graph = parseEdit(edit, options);
  const longSide = graph.output.longSide;
  const ctx = options.gpu;
  const sources = bind(graph.inputs, graph.unused, source, options.scale);

  if (!ctx) {
    const inputs = new Map<string, GraphValue<LinearImage>>(
      sources.map(({ name, image, scale }) => [name, { value: isLinear(image) ? image : decodeSrgb8(image.data as Uint8Array, image.width, image.height), scale }]),
    );
    const out = (
      await walkGraph<LinearImage>(graph, inputs, async (node, ins) => {
        const [a, b] = ins as [GraphValue<LinearImage>, GraphValue<LinearImage> | undefined];
        switch (node.kind) {
          case 'chain': {
            const framed = node.geometry && !isIdentityGeometry(node.geometry) ? applyGeometryCpu(a.value, node.geometry) : a.value;
            const value = options.cpu ? await options.cpu(node.steps, framed, { scale: a.scale, node: node.id }) : runChainCpu(node.steps, framed, { scale: a.scale, fast: true });
            return { value, scale: a.scale };
          }
          case 'resize': {
            const [w, h] = resizeSize(node, a.value.width, a.value.height, a.scale);
            return { value: w === a.value.width && h === a.value.height ? a.value : downscaleCpu(a.value, w, h), scale: a.scale };
          }
          case 'mix':
            checkMixSizes(node, a.value, b!.value);
            return { value: blendMasked(a.value, b!.value, mixMask(node)), scale: a.scale };
        }
      })
    ).value;
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    const shrunk = w === out.width && h === out.height ? out : downscaleCpu(out, w, h);
    // Never hand back a source itself (a resize to the same size passes it through).
    const isSource = [...inputs.values()].some((v) => v.value === shrunk);
    return readCpu(isSource ? createImage(shrunk.width, shrunk.height, shrunk.data.slice()) : shrunk);
  }

  const side = tileSideFor({
    sizes: sources.map(({ image }) => [image.width, image.height] as const),
    textures: TILE_TEXTURES + Math.max(0, ...graph.nodes.map((n) => (n.kind === 'chain' ? activeSteps(n.steps).length : 0))),
    halo: Math.max(0, ...graph.nodes.map((n) => (n.kind === 'chain' ? chainHalo(n.steps) : 0))),
    maxTexture: ctx.limits.maxTextureDimension2D,
    budget: options.memoryBudget,
  });
  if (side !== undefined) {
    // Tiled (#176): every value in CPU memory as half floats, the same pixels as below.
    options.onTiling?.({ side });
    const inputs = new Map(sources.map(({ name, image, scale }) => [name, { image: isLinear(image) ? { width: image.width, height: image.height, data: toFloat16Array(image.data, true) } : image, scale }]));
    const out = await runGraphTiled(ctx, graph, inputs, { side });
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return readTiled(ctx, w === out.width && h === out.height ? out : await downscaleTiled(ctx, out, w, h, side), side);
  }

  // GPU: every texture made here is released before returning; the graph executor owns its nodes'.
  const owned = new Set<GPUTexture>();
  const own = (t: GPUTexture) => (owned.add(t), t);
  let result: Awaited<ReturnType<typeof runGraphGpu>> | undefined;
  try {
    const inputs = new Map(
      sources.map(({ name, image, scale }) => [name, { texture: own(isLinear(image) ? uploadImage(ctx, image) : uploadSrgb8(ctx, image.data as Uint8Array, image.width, image.height)), scale }]),
    );
    result = await runGraphGpu(ctx, graph, inputs);
    const out = result.texture;
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return await readGpu(ctx, w === out.width && h === out.height ? out : own(downscale(ctx, out, w, h)));
  } finally {
    result?.dispose();
    for (const t of owned) releaseTexture(ctx, t);
  }
}
