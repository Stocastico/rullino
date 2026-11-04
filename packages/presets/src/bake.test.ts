import { applyLutCpu, linearToSrgb, lutFromFunction, runChainCpu, srgbToLinear, createImage, type Step } from '@rullino/core';
import { applyLut, contrast, curves, gaussianBlur, invert, saturation, vignette } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { bakeLut } from './bake';

/** Random sRGB-encoded colours in [0, 1]. */
const colours = Array.from({ length: 200 }, (_, i) => [((i * 37) % 101) / 100, ((i * 61) % 97) / 96, ((i * 13) % 89) / 88] as const);

describe('bakeLut', () => {
  it('bakes an empty chain into the identity', () => {
    const lut = bakeLut([], { size: 9 });
    expect(lut.size).toBe(9);
    for (const [r, g, b] of colours) applyLutCpu(lut, r, g, b).forEach((v, i) => expect(v).toBeCloseTo([r, g, b][i]!, 6));
  });

  it('works in sRGB-encoded units at the grid points', () => {
    const lut = bakeLut([{ filter: invert }], { size: 5 });
    expect(applyLutCpu(lut, 0.25, 0.5, 1)).toEqual([0.75, 0.5, 0].map((v) => expect.closeTo(v, 5)));
  });

  it('approximates the chain it was baked from', () => {
    const steps: Step[] = [
      { filter: contrast, params: { amount: 0.4 } },
      { filter: saturation, params: { amount: 0.3 } },
      { filter: curves, params: { blue: [[0, 0.1], [0.5, 0.45], [1, 0.9]] } },
    ];
    const lut = bakeLut(steps, { title: 'test' });
    expect(lut.title).toBe('test');
    const src = createImage(colours.length, 1);
    colours.forEach((c, i) => src.data.set([...c.map(srgbToLinear), 1], i * 4));
    const direct = runChainCpu(steps, src).data;
    // Compared as displayed (clipped to [0, 1]), in sRGB-encoded units at the default 33³. The worst
    // cases are saturated colours at the gamut edge, where the sRGB curve bends sharply near 0 and
    // grid neighbours fall out of gamut: 0.019 at 33³, 0.007 at 65³ for this chain.
    const clip = (v: number) => Math.min(1, Math.max(0, v));
    const errors = colours.flatMap((c, i) => {
      const viaLut = applyLutCpu(lut, ...c);
      return [0, 1, 2].map((k) => Math.abs(clip(viaLut[k]!) - clip(linearToSrgb(direct[i * 4 + k]!))));
    });
    expect(errors.reduce((s, e) => s + e, 0) / errors.length).toBeLessThan(1 / 255);
    expect(Math.max(...errors)).toBeLessThan(0.025);
  });

  it('only accepts pointwise and per-pixel steps (a LUT cannot hold a neighbourhood or a position)', () => {
    expect(() => bakeLut([{ filter: gaussianBlur }])).toThrow(/per pixel/);
    expect(() => bakeLut([{ filter: vignette }])).toThrow(/per pixel/);
  });

  it('bakes per-pixel multipass steps too: a LUT step followed by invert', () => {
    const inverting = lutFromFunction(9, (r, g, b) => [1 - r, 1 - g, 1 - b]);
    const lut = bakeLut([{ filter: applyLut, params: { look: inverting } }, { filter: invert }], { size: 9 });
    for (const c of [[0.2, 0.5, 0.9], [0, 1, 0.25]] as const) applyLutCpu(lut, c[0], c[1], c[2]).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 4));
  });

  it('refuses masked steps (a mask is a position) and skips disabled ones', () => {
    expect(() => bakeLut([{ filter: invert, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.2], feather: 0.1 } }])).toThrow(/mask/);
    const lut = bakeLut([{ filter: invert, enabled: false }], { size: 2 });
    expect(Array.from(lut.data)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]);
  });
});
