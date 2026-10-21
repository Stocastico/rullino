import type { PointwiseFilter } from '../filter';
import { createImage, type LinearImage } from '../image';

/** One step of a filter chain. Params missing from `params` take their defaults. */
export interface Step {
  readonly filter: PointwiseFilter<any>;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Defaults to true. Disabled steps are skipped entirely. */
  readonly enabled?: boolean;
}

export const activeSteps = (steps: readonly Step[]) => steps.filter((s) => s.enabled !== false);

/** CPU reference for a chain: each enabled step applied in order. Never returns `src` itself. */
export function runChainCpu(steps: readonly Step[], src: LinearImage): LinearImage {
  let img = createImage(src.width, src.height, src.data.slice());
  for (const s of activeSteps(steps)) img = s.filter.cpu(img, s.params as never);
  return img;
}
