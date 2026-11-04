// "Export look (.cube)": the chain's colour steps baked into a 3D LUT, usable in video and photo
// apps that read .cube files. A LUT maps a colour to a colour, so steps that read neighbours or
// depend on where a pixel is (blurs, vignette, grain, masked steps) cannot be part of it.
import type { Step } from '@rullino/core';

/** The enabled steps a LUT can hold, in order, and the labels of the enabled ones it cannot. */
export function cubeSteps(steps: readonly Step[]): { bake: Step[]; skipped: string[] } {
  const bake: Step[] = [];
  const skipped: string[] = [];
  for (const s of steps) {
    if (s.enabled === false) continue;
    const colourOnly = s.filter.kind === 'pointwise' || s.filter.perPixel === true;
    if (colourOnly && !s.mask) bake.push(s);
    else skipped.push(s.mask && colourOnly ? `${s.filter.label} (masked)` : s.filter.label);
  }
  return { bake, skipped };
}
