import type { Tolerance } from './compare';
import type { LinearImage } from './image';
import type { ParamSchema, ParamValues } from './params';

export type Rgba = [r: number, g: number, b: number, a: number];

export type FilterCategory = 'adjust' | 'look' | 'classic' | 'stylize';

export interface PointwiseFilterDef<S extends ParamSchema = ParamSchema> {
  /** camelCase; also used as a WGSL name prefix when filters are fused. */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly category: FilterCategory;
  readonly kind: 'pointwise';
  /**
   * Which colour `apply()` / `pixel()` receive. The working space is premultiplied;
   * with 'straight' the runner un-premultiplies before and re-premultiplies after
   * (colour of a fully transparent pixel is 0). Use 'straight' for anything non-linear in colour.
   */
  readonly alpha: 'premultiplied' | 'straight';
  readonly params: S;
  /**
   * WGSL defining `fn apply(c: vec4f, p: Params) -> vec4f`, with `c` linear RGBA.
   * A pure function: no bindings, no globals. `Params` is generated from `params` and must
   * not be declared here. The `rl_*` helpers from the core WGSL library are in scope.
   */
  readonly wgsl: string;
  /** CPU reference for `apply()`: obvious, not fast. Same alpha convention. */
  readonly pixel: (c: Rgba, p: ParamValues<S>) => Rgba;
  /** Allowed GPU <-> CPU difference, on top of rgba16float quantisation of the input. */
  readonly tolerance: Tolerance;
}

export interface PointwiseFilter<S extends ParamSchema = ParamSchema> extends PointwiseFilterDef<S> {
  /** Whole-image CPU reference. Missing params take their defaults. Never mutates `src`. */
  cpu(src: LinearImage, params?: Partial<ParamValues<S>>): LinearImage;
}

export type Filter = PointwiseFilter;
