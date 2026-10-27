import { applyGeometryCpu, isIdentityGeometry } from './geometry';
import type { GpuContext } from './gpu/context';
import { applyGeometry } from './gpu/geometry';
import { downscale } from './gpu/resize';
import { releaseTexture } from './gpu/pool';
import { readImage, uploadImage } from './gpu/texture';
import type { LinearImage } from './image';
import { runChainCpu } from './pipeline/chain';
import { Pipeline } from './pipeline/pipeline';
import { downscaleCpu, fitWithin } from './resize';
import { parseChain, type ParseOptions } from './serialize';

export interface ApplyEditOptions extends ParseOptions {
  /** Render on this GPU context; without one the CPU reference renders. */
  readonly gpu?: GpuContext | undefined;
  /**
   * Resolution of `source` relative to the original the edit was made on (e.g. 0.25 for a preview
   * copy). Pixel-unit params are multiplied by it. Default 1.
   */
  readonly scale?: number | undefined;
}

/**
 * Renders an edit document on an image: its geometry, then its steps, then the `output.longSide`
 * shrink (in linear light; never enlarges). Version 1 documents are migrated. Encode the result with
 * `encodeImage(result, doc.output)`. The source is not changed.
 */
export async function applyEdit(source: LinearImage, edit: unknown, options: ApplyEditOptions): Promise<LinearImage> {
  const { steps, geometry, output } = parseChain(edit, options);
  const scale = options.scale ?? 1;
  const longSide = output?.longSide;
  const ctx = options.gpu;

  if (!ctx) {
    const framed = geometry && !isIdentityGeometry(geometry) ? applyGeometryCpu(source, geometry) : source;
    const out = runChainCpu(steps, framed, { scale });
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return w === out.width && h === out.height ? out : downscaleCpu(out, w, h);
  }

  // GPU: every texture made here is released before returning; the Pipeline owns its stages.
  const owned = new Set<GPUTexture>();
  const own = (t: GPUTexture) => (owned.add(t), t);
  const pipeline = new Pipeline(ctx);
  try {
    const input = own(uploadImage(ctx, source));
    const framed = geometry && !isIdentityGeometry(geometry) ? own(applyGeometry(ctx, input, geometry)) : input;
    pipeline.setSource(framed, { scale });
    const out = pipeline.run(steps);
    const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
    return await readImage(ctx, w === out.width && h === out.height ? out : own(downscale(ctx, out, w, h)));
  } finally {
    pipeline.destroy();
    for (const t of owned) releaseTexture(ctx, t);
  }
}
