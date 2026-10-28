import { parseChain, serializeChain } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookLutRef, resolveLookLut } from '@rullino/presets';
import { describe, expect, it } from 'vitest';
import { CHAIN_IDS, chainParams } from './chains';
import { rullinoSteps } from './rullino-chains';

describe('benchmark chains', () => {
  it('are the three PLAN §6b chains, each with two variants that differ in one parameter', () => {
    expect(CHAIN_IDS).toEqual(['exposure-curves-lut', 'blur-unsharp', 'levels-vignette-grain']);
    for (const id of CHAIN_IDS) {
      const [a, b] = [chainParams(id, 0), chainParams(id, 1)];
      const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
      expect(changed).toHaveLength(1);
    }
  });

  it('as rullino steps, survive a round trip through an edit document (the LUT by name)', () => {
    for (const id of CHAIN_IDS) {
      const steps = rullinoSteps(id, 0);
      const doc = serializeChain(steps, { lutRef: lookLutRef });
      const back = parseChain(JSON.parse(JSON.stringify(doc)), { filters, resolveLut: resolveLookLut });
      expect(back.steps.map((s) => s.filter.id)).toEqual(steps.map((s) => s.filter.id));
    }
  });

  it('the variant parameter reaches the steps', () => {
    const ev = (v: 0 | 1) => rullinoSteps('exposure-curves-lut', v)[0]!.params!['ev'];
    expect(ev(0)).not.toBe(ev(1));
  });
});
