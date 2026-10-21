import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { levels } from './index';

const out = (v: number, p: Parameters<typeof levels.cpu>[1]) => linearToSrgb(px(levels, grey(srgbToLinear(v)), p)[0]);

describe('levels', () => {
  it('is the identity by default', () => {
    for (const v of [0, 0.2, 0.5, 1]) expect(out(v, {})).toBeCloseTo(v, 5);
  });

  it('stretches the input range to the full range', () => {
    const p = { inBlack: 0.2, inWhite: 0.8 };
    expect(out(0.2, p)).toBeCloseTo(0, 5);
    expect(out(0.1, p)).toBeCloseTo(0, 5); // below black clips
    expect(out(0.5, p)).toBeCloseTo(0.5, 5);
    expect(out(0.8, p)).toBeCloseTo(1, 5);
  });

  it('bends midtones with gamma', () => {
    expect(out(0.25, { gamma: 2 })).toBeCloseTo(0.5, 5);
    expect(out(0.25, { gamma: 0.5 })).toBeCloseTo(0.0625, 5);
  });

  it('maps into the output range', () => {
    expect(out(0, { outBlack: 0.1, outWhite: 0.9 })).toBeCloseTo(0.1, 5);
    expect(out(1, { outBlack: 0.1, outWhite: 0.9 })).toBeCloseTo(0.9, 5);
  });

  it('clips HDR input to the output white, like any levels tool', () => {
    expect(out(1.5, {})).toBeCloseTo(1, 5);
    expect(out(1.5, { outWhite: 0.8 })).toBeCloseTo(0.8, 5);
  });

  it('survives a collapsed input range', () => {
    expect(Number.isFinite(out(0.5, { inBlack: 0.5, inWhite: 0.5 }))).toBe(true);
  });
});
