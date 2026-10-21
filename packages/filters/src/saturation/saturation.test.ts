import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { saturation } from './index';

const orange = [0.8, 0.3, 0.05, 1] as [number, number, number, number];

describe('saturation', () => {
  it('is the identity at 0', () => {
    px(saturation, orange).forEach((v, i) => expect(v).toBeCloseTo(orange[i]!, 6));
  });

  it('scales OKLab chroma and keeps lightness', () => {
    expect(chroma(px(saturation, orange, { amount: 0.5 }))).toBeCloseTo(chroma(orange) * 1.5, 4);
    expect(lightness(px(saturation, orange, { amount: 0.5 }))).toBeCloseTo(lightness(orange), 5);
  });

  it('fully desaturates at -1', () => {
    const [r, g, b] = px(saturation, orange, { amount: -1 });
    expect(g).toBeCloseTo(r, 5);
    expect(b).toBeCloseTo(r, 5);
  });

  it('leaves greys alone', () => {
    expect(px(saturation, grey(0.4), { amount: 1 })[1]).toBeCloseTo(0.4, 5);
  });
});
