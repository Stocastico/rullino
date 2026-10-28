// Data that libraries without curves or 3D LUTs of rullino's kind get pre-computed, by rullino, in
// the harness: an 8-bit curve table and pixi-filters' colour map (the curve then the look's LUT).
import { applyLutCpu, sampleCurve } from '@rullino/core';
import { lookLut } from '@rullino/presets';
import { CURVE } from './chains';
import { LOOK } from './rullino-chains';

export interface Tables {
  /** The S-curve on 8-bit sRGB values. */
  readonly curve256: Uint8Array;
  /** RGBA8, (size × size) × size: x = red + blue · size, y = green. */
  readonly colorMap: Uint8Array;
  readonly colorMapSize: number;
}

export function benchTables(size = 32): Tables {
  const curve256 = Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * sampleCurve(CURVE, i / 255)));
  const lut = lookLut(LOOK);
  const colorMap = new Uint8Array(size * size * size * 4);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const c = [r, g, b].map((v) => sampleCurve(CURVE, v / (size - 1))) as [number, number, number];
        const o = applyLutCpu(lut, ...c);
        colorMap.set([Math.round(o[0] * 255), Math.round(o[1] * 255), Math.round(o[2] * 255), 255], (g * size * size + b * size + r) * 4);
      }
  return { curve256, colorMap, colorMapSize: size };
}
