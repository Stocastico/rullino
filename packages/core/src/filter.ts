import type { Tolerance } from './compare';
import type { LinearImage } from './image';

// Minimal filter contract for M0. M1 replaces it with defineFilter() and the full
// parameter type system (int, bool, enum, color, curve, ...).

export interface FloatParam {
  readonly type: 'float';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly label?: string;
}

export type ParamSchema = Readonly<Record<string, FloatParam>>;
export type ParamValues<S extends ParamSchema> = { readonly [K in keyof S]: number };

export interface PointwiseFilter<S extends ParamSchema = ParamSchema> {
  readonly id: string;
  readonly kind: 'pointwise';
  readonly params: S;
  /**
   * WGSL source defining `fn apply(c: vec4f, p: Params) -> vec4f`.
   * `c` is linear, premultiplied RGBA. `Params` is generated from `params`
   * (one f32 field per key, in declaration order) and must not be declared here.
   * Write it as a pure function of its inputs so it can later be fused with neighbours.
   */
  readonly wgsl: string;
  /** Reference implementation: obvious, not fast. Must not mutate its input. */
  readonly cpu: (src: LinearImage, p: ParamValues<S>) => LinearImage;
  /** Allowed GPU <-> CPU difference, on top of rgba16float quantisation of the input. */
  readonly tolerance: Tolerance;
}
