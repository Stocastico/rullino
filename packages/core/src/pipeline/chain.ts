import type { Filter } from '../filter';
import { createImage, type LinearImage } from '../image';
import { resolveParams, scaleParams } from '../params';

/** One step of a filter chain. Params missing from `params` take their defaults. */
export interface Step {
  readonly filter: Filter<any>;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Defaults to true. Disabled steps are skipped entirely. */
  readonly enabled?: boolean;
}

export interface ChainOptions {
  /**
   * Resolution of the image relative to the full-resolution original (e.g. 0.25 for a preview).
   * Pixel-unit params ('px') are multiplied by it so a preview looks like the full image.
   */
  readonly scale?: number;
}

export const activeSteps = (steps: readonly Step[]) => steps.filter((s) => s.enabled !== false);

/** A step's params with defaults filled in and pixel units scaled. */
export function effectiveParams(step: Step, scale = 1): Record<string, unknown> {
  const { params } = step.filter;
  return scaleParams(params, resolveParams(params, (step.params ?? {}) as never), scale);
}

/** CPU reference for a chain: each enabled step applied in order. Never returns `src` itself. */
export function runChainCpu(steps: readonly Step[], src: LinearImage, options: ChainOptions = {}): LinearImage {
  let img = createImage(src.width, src.height, src.data.slice());
  for (const s of activeSteps(steps)) img = s.filter.cpu(img, effectiveParams(s, options.scale) as never);
  return img;
}
