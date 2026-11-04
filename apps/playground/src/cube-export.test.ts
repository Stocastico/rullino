import type { Step } from '@rullino/core';
import { applyLut, exposure, gaussianBlur, invert, vignette } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { cubeSteps } from './cube-export';

const mask = { kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.2], feather: 0.1 } as const;

describe('.cube export of the chain', () => {
  it('keeps the enabled colour steps in order and names the ones a LUT cannot hold', () => {
    const steps: Step[] = [
      { filter: exposure, params: { ev: 1 } },
      { filter: gaussianBlur },
      { filter: applyLut },
      { filter: invert, mask },
      { filter: vignette },
      { filter: invert, enabled: false },
      { filter: invert },
    ];
    const { bake, skipped } = cubeSteps(steps);
    expect(bake).toEqual([steps[0], steps[2], steps[6]]);
    expect(skipped).toEqual(['Gaussian blur', 'Invert (masked)', 'Vignette']);
  });
});
