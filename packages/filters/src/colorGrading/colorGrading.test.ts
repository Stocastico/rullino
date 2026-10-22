import { linearToOklab, oklabToLinear, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { colorGrading } from './index';

type Rgba = [number, number, number, number];
const labOf = ([r, g, b]: number[]) => linearToOklab(r!, g!, b!);
const atL = (L: number): Rgba => [...oklabToLinear(L, 0, 0), 1];
const hueOf = (c: number[]) => {
  const [, A, B] = labOf(c);
  return (Math.atan2(B, A) * 180) / Math.PI;
};
const close = (a: number[], b: number[], d = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));
const ORANGE = [1, 0.5, 0] as const;
const TEAL = [0, 0.5, 0.5] as const;

describe('colour grading', () => {
  it('is the identity at the defaults', () => {
    for (const L of [0.05, 0.3, 0.5, 0.8, 0.98]) close(px(colorGrading, atL(L)), atL(L));
  });

  it('tints shadows towards the shadow colour and highlights towards the highlight colour (split toning)', () => {
    const p = { shadows: TEAL, shadowsStrength: 1, highlights: ORANGE, highlightsStrength: 1 };
    const dark = px(colorGrading, atL(0.1), p);
    const light = px(colorGrading, atL(0.9), p);
    expect(Math.abs(hueOf(dark) - hueOf(TEAL.map(srgbToLinear)))).toBeLessThan(3);
    expect(Math.abs(hueOf(light) - hueOf(ORANGE.map(srgbToLinear)))).toBeLessThan(3);
    // Lightness is kept.
    expect(labOf(dark)[0]).toBeCloseTo(0.1, 5);
    expect(labOf(light)[0]).toBeCloseTo(0.9, 5);
  });

  it('tint strength 1 adds OKLab chroma 0.1 where its range has full weight', () => {
    const [, A, B] = labOf(px(colorGrading, atL(0), { shadows: TEAL, shadowsStrength: 1 }));
    expect(Math.hypot(A, B)).toBeCloseTo(0.1, 4);
  });

  it('midtones peak at the balance point; balance moves it', () => {
    const p = { midtones: ORANGE, midtonesStrength: 1 };
    const C = (c: number[]) => Math.hypot(labOf(c)[1], labOf(c)[2]);
    expect(C(px(colorGrading, atL(0.5), p))).toBeCloseTo(0.1, 4);
    expect(C(px(colorGrading, atL(0.5), { ...p, balance: 1 }))).toBeLessThan(0.08);
    expect(C(px(colorGrading, atL(0.2), { ...p, balance: 1 }))).toBeCloseTo(0.1, 4);
  });

  it('a grey picked colour or zero strength has no effect; alpha is kept', () => {
    close(px(colorGrading, grey(0.4, 0.5), { shadows: [0.5, 0.5, 0.5], shadowsStrength: 1, highlights: ORANGE }), grey(0.4, 0.5));
  });
});
