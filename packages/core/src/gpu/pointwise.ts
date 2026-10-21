import type { PointwiseFilter } from '../filter';
import type { ParamSchema, ParamValues } from '../params';
import { runFused } from '../pipeline/fuse';
import type { GpuContext } from './context';

/**
 * Runs one pointwise filter on a working texture and returns a new working texture.
 * Missing params take defaults. Same code path as a fused chain of length one.
 */
export function runPointwise<S extends ParamSchema>(
  ctx: GpuContext,
  filter: PointwiseFilter<S>,
  input: GPUTexture,
  params?: Partial<ParamValues<S>>,
): GPUTexture {
  return runFused(ctx, [filter], [params ?? {}], input).output;
}
