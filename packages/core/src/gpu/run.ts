import type { Filter } from '../filter';
import type { ParamSchema, ParamValues } from '../params';
import { runFused } from '../pipeline/fuse';
import type { GpuContext } from './context';
import { runMultipass } from './multipass';

/** Runs any filter on a working texture and returns a new working texture. Missing params take defaults. */
export function runFilter<S extends ParamSchema>(
  ctx: GpuContext,
  filter: Filter<S>,
  input: GPUTexture,
  params?: Partial<ParamValues<S>>,
): GPUTexture {
  return filter.kind === 'pointwise'
    ? runFused(ctx, [filter], [params ?? {}], input).output
    : runMultipass(ctx, filter, input, params ?? {}).output;
}
