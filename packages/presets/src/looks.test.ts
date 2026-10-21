import { createImage, linearToSrgb, resolveParams, runChainCpu, srgbToLinear, type LinearImage } from '@rullino/core';
import { filters } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { lookLut, looks, lookSteps } from './looks';

/** A 4x3 chart: greys, primaries, skin, sky, foliage... straight sRGB-encoded, alpha 1. */
const CHART = [
  [0, 0, 0], [0.2, 0.2, 0.2], [0.5, 0.5, 0.5], [0.85, 0.85, 0.85],
  [0.8, 0.2, 0.2], [0.2, 0.7, 0.25], [0.2, 0.3, 0.8], [0.9, 0.8, 0.2],
  [0.85, 0.65, 0.55], [0.45, 0.65, 0.9], [0.3, 0.45, 0.2], [1, 1, 1],
] as const;
const chart = () => {
  const img = createImage(4, 3);
  CHART.forEach((c, i) => img.data.set([...c.map(srgbToLinear), 1], i * 4));
  return img;
};
const encoded = (img: LinearImage) => CHART.map((_, i) => [0, 1, 2].map((k) => linearToSrgb(img.data[i * 4 + k]!)));
/** A look's colour grade only (no vignette or grain), on the chart. */
const graded = (id: string) => encoded(runChainCpu(lookSteps(looks.find((l) => l.id === id)!, { vignette: false, grain: false }), chart()));

describe('looks', () => {
  it('has ten looks with unique ids, labels and descriptions', () => {
    expect(looks).toHaveLength(10);
    expect(new Set(looks.map((l) => l.id)).size).toBe(10);
    for (const l of looks) {
      expect(l.id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(l.label).toBeTruthy();
      expect(l.description).toBeTruthy();
    }
  });

  it.each(looks.map((l) => [l.id, l] as const))('%s only uses registered filters with valid params', (_, l) => {
    for (const s of [...l.grade, ...lookSteps(l)]) {
      expect(filters).toContain(s.filter);
      expect(() => resolveParams(s.filter.params, (s.params ?? {}) as never)).not.toThrow();
    }
  });

  it.each(looks.map((l) => [l.id, l] as const))('%s visibly changes the image', (_, l) => {
    const before = encoded(chart()).flat();
    const after = encoded(runChainCpu(lookSteps(l), chart())).flat();
    const diff = before.reduce((s, v, i) => s + Math.abs(v - after[i]!), 0) / before.length;
    expect(diff).toBeGreaterThan(0.02);
  });

  it('bakes each LUT once (the same object every time, so GPU textures are reused)', () => {
    expect(lookLut(looks[0]!)).toBe(lookLut(looks[0]!));
    expect(lookLut(looks[0]!).title).toBe(looks[0]!.label);
  });

  it('is the identity at intensity 0', () => {
    for (const l of looks) {
      const out = runChainCpu(lookSteps(l, { intensity: 0 }), chart()).data;
      chart().data.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 4));
    }
  });

  it('noir is black and white, sepia is warm-toned monochrome', () => {
    for (const [r, g, b] of graded('noir')) expect(Math.max(Math.abs(r! - g!), Math.abs(g! - b!))).toBeLessThan(0.01);
    const [r, g, b] = graded('sepia')[2]!;
    expect(r).toBeGreaterThan(g! + 0.02);
    expect(g).toBeGreaterThan(b! + 0.02);
  });

  it('warm and cool shift mid grey the expected way', () => {
    const [wr, , wb] = graded('warm')[2]!;
    const [cr, , cb] = graded('cool')[2]!;
    expect(wr! - wb!).toBeGreaterThan(0.03);
    expect(cb! - cr!).toBeGreaterThan(0.03);
  });

  it('fade lifts the blacks', () => {
    expect(Math.min(...graded('fade')[0]!)).toBeGreaterThan(0.05);
  });

  it.each(looks.map((l) => [l.id, l] as const))('%s matches its golden chart', (_, l) => {
    const out = encoded(runChainCpu(lookSteps(l), chart())).map((c) => c.map((v) => Math.round(v * 1000) / 1000));
    expect(out).toMatchSnapshot();
  });
});
