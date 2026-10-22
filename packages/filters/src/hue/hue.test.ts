import { linearToOklab } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { hue } from './index';

const orange = [0.8, 0.3, 0.05, 1] as [number, number, number, number];
const hueOf = ([r, g, b]: number[]) => {
  const [, A, B] = linearToOklab(r!, g!, b!);
  return (Math.atan2(B, A) * 180) / Math.PI;
};

describe('hue', () => {
  it('is the identity at 0', () => {
    px(hue, orange).forEach((v, i) => expect(v).toBeCloseTo(orange[i]!, 6));
  });

  it('rotates the OKLab hue by the given angle, keeping lightness and chroma', () => {
    const out = px(hue, orange, { degrees: 40 });
    expect(hueOf(out) - hueOf(orange)).toBeCloseTo(40, 3);
    expect(lightness(out)).toBeCloseTo(lightness(orange), 5);
    expect(chroma(out)).toBeCloseTo(chroma(orange), 5);
  });

  it('leaves greys and alpha alone', () => {
    px(hue, grey(0.4, 0.5), { degrees: 120 }).forEach((v, i) => expect(v).toBeCloseTo(grey(0.4, 0.5)[i]!, 5));
  });

  it('±180 degrees give the complementary hue', () => {
    expect(px(hue, orange, { degrees: 180 })).toEqual(px(hue, orange, { degrees: -180 }).map((v) => expect.closeTo(v, 6)));
  });
});
