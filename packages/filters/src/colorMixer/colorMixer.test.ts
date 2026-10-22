import { linearToOklab, oklabToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { BANDS, colorMixer } from './index';

type Rgba = [number, number, number, number];
/** An opaque colour of OKLab lightness 0.65, chroma 0.1 and the given hue (degrees). */
const atHue = (deg: number): Rgba => {
  const t = (deg * Math.PI) / 180;
  return [...oklabToLinear(0.65, 0.1 * Math.cos(t), 0.1 * Math.sin(t)), 1];
};
const hueOf = ([r, g, b]: number[]) => {
  const [, A, B] = linearToOklab(r!, g!, b!);
  return (Math.atan2(B, A) * 180) / Math.PI;
};
const close = (a: number[], b: number[], d = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

describe('colour mixer', () => {
  it('is the identity at the defaults', () => {
    for (let h = 0; h < 360; h += 15) close(px(colorMixer, atHue(h)), atHue(h));
  });

  it('a band at its centre gets exactly that band, and its neighbours nothing', () => {
    const blue = atHue(BANDS.find((b) => b.id === 'blue')!.centre);
    expect(chroma(px(colorMixer, blue, { blueSat: -1 }))).toBeLessThan(1e-6);
    close(px(colorMixer, blue, { purpleSat: -1, aquaSat: -1, redLum: 1 }), blue);
    expect(lightness(px(colorMixer, blue, { blueLum: -1 }))).toBeCloseTo(0.65 * 0.6, 4);
    expect(hueOf(px(colorMixer, blue, { blueHue: 20 })) - hueOf(blue)).toBeCloseTo(20, 3);
  });

  it('band weights sum to one: the same change on every band acts uniformly on every hue', () => {
    const all = Object.fromEntries(BANDS.map((b) => [`${b.id}Sat`, 0.5]));
    for (let h = 0; h < 360; h += 7) expect(chroma(px(colorMixer, atHue(h), all))).toBeCloseTo(0.15, 4);
  });

  it('between two bands both contribute, in proportion to the distance', () => {
    // Halfway between yellow (105°) and green (140°).
    const c = px(colorMixer, atHue(122.5), { yellowSat: -1 });
    expect(chroma(c)).toBeCloseTo(0.05, 4);
  });

  it('leaves greys and alpha alone whatever the settings', () => {
    const all = Object.fromEntries(BANDS.flatMap((b) => [[`${b.id}Sat`, 1], [`${b.id}Lum`, -1], [`${b.id}Hue`, 30]]));
    close(px(colorMixer, grey(0.4, 0.5), all), grey(0.4, 0.5));
  });
});
