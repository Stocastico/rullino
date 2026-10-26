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
  /** One suggestion for exploring the filter ("push X, then look at Y"); shown next to its controls. */
  readonly tryThis?: string;
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

/**
 * One compute pass of a multipass filter. `wgsl` defines `fn run(xy: vec2i, p: Params) -> vec4f`
 * returning the output pixel at `xy`. In scope: `load_<input>(xy: vec2i) -> vec4f` for each name in
 * `inputs` (clamped to the edge), `size() -> vec2i`, the generated `Params` and the rl_* library.
 */
export interface TexturePassDef {
  readonly kind?: 'texture';
  /** WGSL identifier; later passes read this pass's output as `load_<name>`. */
  readonly name: string;
  /** 'input' (the filter's input) and/or names of earlier texture passes. */
  readonly inputs: readonly string[];
  readonly wgsl: string;
  /** Filter buffers this pass can access as `buf_<name>` (array<atomic<u32>, N>). */
  readonly buffers?: readonly string[];
  /**
   * Name of an int param: run the pass that many times, ping-ponging. From the second iteration
   * on, `inputs[0]` reads the previous iteration's output. Zero iterations pass `inputs[0]` through.
   */
  readonly repeat?: string;
}

/**
 * A pass with no texture output, for reductions: `wgsl` defines `fn run(xy: vec2i, p: Params)`
 * and works through `buf_<name>` atomics. 'pixels' runs it once per pixel of the filter's input
 * (`size()` is the input size), 'single' runs it once (xy = 0), e.g. to turn a histogram into a value.
 * Compute passes cannot be read as texture inputs and cannot be the last pass.
 */
export interface ComputePassDef {
  readonly kind: 'compute';
  readonly name: string;
  readonly inputs: readonly string[];
  readonly buffers: readonly string[];
  readonly dispatch: 'pixels' | 'single';
  readonly wgsl: string;
}

export type PassDef = TexturePassDef | ComputePassDef;

interface FilterBase<S extends ParamSchema> {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** One suggestion for exploring the filter ("push X, then look at Y"); shown next to its controls. */
  readonly tryThis?: string;
  readonly category: FilterCategory;
  readonly params: S;
  readonly tolerance: Tolerance;
}

/**
 * A filter made of a fixed sequence of passes (the last one is the output), for anything that
 * reads neighbours: convolutions, edges, morphology. Works on premultiplied linear values.
 */
export interface MultipassFilterDef<S extends ParamSchema = ParamSchema> extends FilterBase<S> {
  readonly kind: 'multipass';
  /**
   * Storage buffers shared by the passes: name -> length in u32, zeroed on every run.
   * Each is `array<atomic<u32>, N>` in WGSL; store floats with bitcast.
   */
  readonly buffers?: Readonly<Record<string, number>>;
  /**
   * The filter needs the step's mask (e.g. inpainting must know which pixels to rebuild): passes
   * can then list 'mask' as an input, a texture with the mask value in every channel, and the CPU
   * reference receives it as one value per pixel. Using such a filter without a mask is an error.
   * The step's usual blend with the mask still follows.
   */
  readonly usesMask?: boolean;
  readonly passes: readonly PassDef[];
  /** Whole-image CPU reference: obvious, not fast. Must not mutate `src`. */
  readonly cpu: (src: LinearImage, p: ParamValues<S>, mask?: Float32Array) => LinearImage;
}

export interface MultipassFilter<S extends ParamSchema = ParamSchema> extends Omit<MultipassFilterDef<S>, 'cpu'> {
  /**
   * Whole-image CPU reference. Missing params take their defaults. Never mutates `src`.
   * `mask` (one value per pixel, see `maskImage`) is required by mask-aware filters.
   */
  cpu(src: LinearImage, params?: Partial<ParamValues<S>>, mask?: Float32Array): LinearImage;
}

export type Filter<S extends ParamSchema = ParamSchema> = PointwiseFilter<S> | MultipassFilter<S>;
export type FilterDef<S extends ParamSchema = ParamSchema> = PointwiseFilterDef<S> | MultipassFilterDef<S>;
