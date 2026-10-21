import type { Filter } from '../filter';
import type { Mask } from '../mask';
import type { ParamSchema, ParamValues } from '../params';
import { runFused } from '../pipeline/fuse';
import type { GpuContext } from './context';
import { renderMask } from './mask';
import { runMultipass } from './multipass';
import { releaseTexture } from './pool';

/**
 * Runs any filter on a working texture and returns a new working texture. Missing params take
 * defaults. `mask` is only used as the input of mask-aware filters: no blending happens here
 * (a chain step blends its result with its mask; see Pipeline).
 */
export function runFilter<S extends ParamSchema>(
  ctx: GpuContext,
  filter: Filter<S>,
  input: GPUTexture,
  params?: Partial<ParamValues<S>>,
  mask?: Mask,
): GPUTexture {
  if (filter.kind === 'pointwise') return runFused(ctx, [filter], [params ?? {}], input).output;
  if (!filter.usesMask) return runMultipass(ctx, filter, input, params ?? {}).output;
  if (!mask) throw new Error(`filter "${filter.id}" needs a mask`);
  const maskTex = renderMask(ctx, mask, input.width, input.height);
  const out = runMultipass(ctx, filter, input, params ?? {}, maskTex).output;
  releaseTexture(ctx, maskTex);
  return out;
}
