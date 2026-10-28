import { applyLutCpu, sampleCurve } from '@rullino/core';
import { lookLut } from '@rullino/presets';
import { describe, expect, it } from 'vitest';
import { CURVE } from './chains';
import { LOOK } from './rullino-chains';
import { benchTables } from './tables';

describe('benchTables', () => {
  const t = benchTables(8);

  it('curve256 is the S-curve in 8 bits: monotone, 0 -> 0, 255 -> 255', () => {
    expect(t.curve256).toHaveLength(256);
    expect([t.curve256[0], t.curve256[255]]).toEqual([0, 255]);
    for (let i = 1; i < 256; i++) expect(t.curve256[i]!).toBeGreaterThanOrEqual(t.curve256[i - 1]!);
    expect(t.curve256[77]).toBe(Math.round(255 * sampleCurve(CURVE, 77 / 255)));
  });

  it("colorMap is curve then LUT in pixi-filters' layout (size² × size, blue picks the slice)", () => {
    const n = 8;
    expect(t.colorMap).toHaveLength(n * n * n * 4);
    const [r, g, b] = [5, 2, 6];
    const c = [r, g, b].map((v) => sampleCurve(CURVE, v / (n - 1))) as [number, number, number];
    const o = applyLutCpu(lookLut(LOOK), ...c);
    const i = (g * n * n + b * n + r) * 4;
    expect(Array.from(t.colorMap.slice(i, i + 4))).toEqual([...o.map((v) => Math.round(v * 255)), 255]);
  });
});
