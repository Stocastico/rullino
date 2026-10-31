import type { Filter } from '../filter';
import { createImage, type LinearImage } from '../image';
import { blendMasked, maskImage, validateMask, type Mask, type RowRegion } from '../mask';
import { resolveParams, scaleParams } from '../params';

/** One step of a filter chain. Params missing from `params` take their defaults. */
export interface Step {
  readonly filter: Filter<any>;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Defaults to true. Disabled steps are skipped entirely. */
  readonly enabled?: boolean;
  /** Restricts the step to part of the image: out = mix(in, step(in), mask). */
  readonly mask?: Mask;
}

export interface ChainOptions {
  /**
   * Resolution of the image relative to the full-resolution original (e.g. 0.25 for a preview).
   * Pixel-unit params ('px') are multiplied by it so a preview looks like the full image.
   */
  readonly scale?: number;
  /** Use each filter's `fast` implementation where it has one (the reference otherwise). */
  readonly fast?: boolean;
}

export const activeSteps = (steps: readonly Step[]) => steps.filter((s) => s.enabled !== false);

/** A step's params with defaults filled in and pixel units scaled. */
export function effectiveParams(step: Step, scale = 1): Record<string, unknown> {
  const { params } = step.filter;
  return scaleParams(params, resolveParams(params, (step.params ?? {}) as never), scale);
}

/**
 * One step on the CPU: the filter (its fast implementation with `options.fast`, where it has one)
 * and then the blend with the step's mask. `region` says that `img` is a band of a taller image
 * (see {@link RowRegion}): masks are then evaluated where the band sits in the full image.
 */
export function runStepCpu(step: Step, img: LinearImage, options: ChainOptions = {}, region?: RowRegion): LinearImage {
  if (step.mask) validateMask(step.mask);
  const params = effectiveParams(step, options.scale) as never;
  const run: (src: LinearImage, p: never, mask?: Float32Array) => LinearImage = (options.fast && step.filter.fast) || step.filter.cpu;
  let out: LinearImage;
  if (step.filter.kind === 'multipass' && step.filter.usesMask) {
    if (!step.mask) throw new Error(`filter "${step.filter.id}" needs a mask`);
    out = run(img, params, maskImage(step.mask, img.width, img.height, region));
  } else {
    out = run(img, params);
  }
  return step.mask ? blendMasked(img, out, step.mask, region) : out;
}

/**
 * CPU reference for a chain: each enabled step applied in order (with `fast`, through the filters'
 * fast implementations). Never returns `src` itself.
 */
export function runChainCpu(steps: readonly Step[], src: LinearImage, options: ChainOptions = {}): LinearImage {
  // No copy up front (192 MB at 12 MP): steps never mutate their input, so only a chain that
  // ends on `src` itself needs one.
  let img = src;
  for (const s of activeSteps(steps)) img = runStepCpu(s, img, options);
  return img === src ? createImage(src.width, src.height, src.data.slice()) : img;
}
