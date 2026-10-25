import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { gradientMap } from './index';

const lin = (c: readonly number[]) => c.map(srgbToLinear);
const enc = (v: number) => grey(srgbToLinear(v)); // a grey at encoded level v

describe('gradientMap', () => {
  const shadows = [0.1, 0.0, 0.3] as [number, number, number];
  const highlights = [1, 0.8, 0.4] as [number, number, number];
  const params = { shadows, highlights };

  it('maps black to the shadow colour and white to the highlight colour', () => {
    const black = px(gradientMap, [0, 0, 0, 1], params);
    const white = px(gradientMap, [1, 1, 1, 1], params);
    lin(shadows).forEach((v, i) => expect(black[i]).toBeCloseTo(v, 6));
    lin(highlights).forEach((v, i) => expect(white[i]).toBeCloseTo(v, 6));
  });

  it('interpolates in sRGB-encoded units by encoded luminance', () => {
    const out = px(gradientMap, enc(0.5), params);
    // encoded luminance 0.5: halfway between the two colours, per encoded channel
    [0, 1, 2].forEach((i) => expect(linearToSrgb(out[i]!)).toBeCloseTo((shadows[i]! + highlights[i]!) / 2, 4));
  });

  it('values above 1 and below 0 clamp to the end colours', () => {
    lin(highlights).forEach((v, i) => expect(px(gradientMap, [4, 4, 4, 1], params)[i]).toBeCloseTo(v, 6));
    lin(shadows).forEach((v, i) => expect(px(gradientMap, [-1, -1, -1, 1], params)[i]).toBeCloseTo(v, 6));
  });

  it('tritone puts the midtone colour at the midpoint and blends towards it', () => {
    const midtones = [0.2, 0.9, 0.5] as [number, number, number];
    const t = { ...params, tritone: true, midtones, midpoint: 0.3 };
    lin(midtones).forEach((v, i) => expect(px(gradientMap, enc(0.3), t)[i]).toBeCloseTo(v, 5));
    // halfway between shadows and the midpoint
    [0, 1, 2].forEach((i) => expect(linearToSrgb(px(gradientMap, enc(0.15), t)[i]!)).toBeCloseTo((shadows[i]! + midtones[i]!) / 2, 4));
    // and between the midpoint and highlights
    [0, 1, 2].forEach((i) => expect(linearToSrgb(px(gradientMap, enc(0.65), t)[i]!)).toBeCloseTo((midtones[i]! + highlights[i]!) / 2, 4));
  });

  it('without tritone the midtone colour is ignored', () => {
    const a = px(gradientMap, enc(0.4), { ...params, midtones: [1, 0, 0] });
    expect(a).toEqual(px(gradientMap, enc(0.4), params));
  });

  it('amount blends with the original in linear light; 0 is the identity', () => {
    const src: [number, number, number, number] = [0.2, 0.5, 0.1, 1];
    px(gradientMap, src, { ...params, amount: 0 }).forEach((v, i) => expect(v).toBeCloseTo(src[i]!, 6)); // float32 storage
    const full = px(gradientMap, src, params);
    const half = px(gradientMap, src, { ...params, amount: 0.5 });
    [0, 1, 2].forEach((i) => expect(half[i]).toBeCloseTo((src[i]! + full[i]!) / 2, 6));
  });

  it('works on the straight colour: premultiplied in, premultiplied out, alpha kept', () => {
    const solid = px(gradientMap, [0.2, 0.2, 0.2, 1], params);
    const half = px(gradientMap, [0.1, 0.1, 0.1, 0.5], params); // the same colour at 50% alpha
    [0, 1, 2].forEach((i) => expect(half[i]).toBeCloseTo(solid[i]! * 0.5, 6));
    expect(half[3]).toBe(0.5);
    expect(px(gradientMap, [0, 0, 0, 0], params)).toEqual([0, 0, 0, 0]);
  });
});
