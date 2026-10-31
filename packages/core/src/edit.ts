import { decodeSrgb8, encodeSrgb8 } from './color';
import { applyGeometryCpu, isIdentityGeometry } from './geometry';
import type { GpuContext } from './gpu/context';
import { applyGeometry } from './gpu/geometry';
import { readSrgb8, uploadSrgb8 } from './gpu/io';
import { downscale } from './gpu/resize';
import { releaseTexture } from './gpu/pool';
import { readImage, uploadImage } from './gpu/texture';
import type { LinearImage, Rgba8Image } from './image';
import { runChainCpu, type Step } from './pipeline/chain';
import { Pipeline } from './pipeline/pipeline';
import { downscaleCpu, fitWithin } from './resize';
import { parseChain, type ParseOptions } from './serialize';

export interface ApplyEditOptions extends ParseOptions {
  /** Render on this GPU context; without one the CPU renders (filters' fast paths where they have one). */
  readonly gpu?: GpuContext | undefined;
  /**
   * Resolution of `source` relative to the original the edit was made on (e.g. 0.25 for a preview
   * copy). Pixel-unit params are multiplied by it. Default 1.
   */
  readonly scale?: number | undefined;
  /**
   * Runs the chain on the CPU instead of the calling thread: receives the parsed steps, the framed
   * image and the scale, returns the result (it must equal `runChainCpu(steps, image, { scale, fast:
   * true })`). For executors that spread the work over threads, see `@rullino/node`. Ignored on the GPU.
   */
  readonly cpu?: ((steps: readonly Step[], image: LinearImage, options: { readonly scale: number }) => LinearImage | Promise<LinearImage>) | undefined;
}

/**
 * Renders an edit document on an image: its geometry, then its steps, then the `output.longSide`
 * shrink (in linear light; never enlarges). Version 1 documents are migrated. Encode the result with
 * `encodeImage(result, doc.output)`. The source is not changed. It can be 8-bit RGBA pixels as a
 * decoder produces them: on the GPU they are decoded there (much faster than `decodeSrgb8` first).
 */
export async function applyEdit(source: LinearImage | Rgba8Image, edit: unknown, options: ApplyEditOptions): Promise<LinearImage> {
  return renderEdit(source, edit, options, readImage, (img) => img);
}

/**
 * {@link applyEdit} returning 8-bit straight-alpha sRGB pixels (ImageData layout): on the GPU the
 * result is encoded there (`readSrgb8`), which is what an interactive preview needs.
 */
export async function applyEditPixels(source: LinearImage | Rgba8Image, edit: unknown, options: ApplyEditOptions): Promise<Rgba8Image> {
  const out = await renderEdit(source, edit, options, async (ctx, tex) => ({ data: await readSrgb8(ctx, tex), width: tex.width, height: tex.height }), (img) => ({
    data: encodeSrgb8(img),
    width: img.width,
    height: img.height,
  }));
  return out;
}

async function renderEdit<T>(
  source: LinearImage | Rgba8Image,
  edit: unknown,
  options: ApplyEditOptions,
  readGpu: (ctx: GpuContext, tex: GPUTexture) => Promise<T>,
  readCpu: (img: LinearImage) => T,
): Promise<T> {
  const { steps, geometry, output } = parseChain(edit, options);
  const scale = options.scale ?? 1;
  const longSide = output?.longSide;
  const ctx = options.gpu;

  const linear = source.data instanceof Float32Array;
  if (!ctx) {
    const image = linear ? (source as LinearImage) : decodeSrgb8(source.data as Uint8Array, source.width, source.height);
    const framed = geometry && !isIdentityGeometry(geometry) ? applyGeometryCpu(image, geometry) : image;
    const out = options.cpu ? await options.cpu(steps, framed, { scale }) : runChainCpu(steps, framed, { scale, fast: true });
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return readCpu(w === out.width && h === out.height ? out : downscaleCpu(out, w, h));
  }

  // GPU: every texture made here is released before returning; the Pipeline owns its stages.
  const owned = new Set<GPUTexture>();
  const own = (t: GPUTexture) => (owned.add(t), t);
  const pipeline = new Pipeline(ctx);
  try {
    const input = own(linear ? uploadImage(ctx, source as LinearImage) : uploadSrgb8(ctx, source.data as Uint8Array, source.width, source.height));
    const framed = geometry && !isIdentityGeometry(geometry) ? own(applyGeometry(ctx, input, geometry)) : input;
    pipeline.setSource(framed, { scale });
    const out = pipeline.run(steps);
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return await readGpu(ctx, w === out.width && h === out.height ? out : own(downscale(ctx, out, w, h)));
  } finally {
    pipeline.destroy();
    for (const t of owned) releaseTexture(ctx, t);
  }
}
