// The benchmark chains as rullino steps (see chains.ts for the parameters).
import type { Step } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookLut, looks } from '@rullino/presets';
import { chainParams, CURVE, LOOK_ID, type ChainId, type Variant } from './chains';

export const LOOK = looks.find((l) => l.id === LOOK_ID)!;

const byId = (id: string) => filters.find((f) => f.id === id)!;

export function rullinoSteps(chain: ChainId, variant: Variant): Step[] {
  const p = chainParams(chain, variant);
  switch (chain) {
    case 'exposure-curves-lut':
      return [
        { filter: byId('exposure'), params: { ev: p.ev } },
        { filter: byId('curves'), params: { rgb: CURVE } },
        { filter: byId('applyLut'), params: { look: lookLut(LOOK) } },
      ];
    case 'blur-unsharp':
      return [
        { filter: byId('gaussianBlur'), params: { sigma: p.sigma } },
        { filter: byId('unsharpMask'), params: { amount: p.amount, sigma: p.sharpenSigma } },
      ];
    case 'levels-vignette-grain':
      return [
        { filter: byId('levels'), params: { inBlack: p.inBlack } },
        { filter: byId('vignette'), params: { amount: p.vignette } },
        { filter: byId('grain'), params: { amount: p.grain } },
      ];
  }
}
