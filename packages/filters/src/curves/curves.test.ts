import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { curves } from './index';

const enc = (v: number) => srgbToLinear(v);

describe('curves', () => {
  it('is the identity by default, HDR included', () => {
    const c: [number, number, number, number] = [0.3, 0.05, 2.5, 1];
    px(curves, c).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 4));
  });

  it('applies the RGB curve in sRGB-encoded units', () => {
    const s = [[0, 0], [0.25, 0.1], [0.75, 0.9], [1, 1]] as [number, number][];
    const out = px(curves, grey(enc(0.25)), { rgb: s });
    expect(linearToSrgb(out[0])).toBeCloseTo(0.1, 3);
    expect(linearToSrgb(px(curves, grey(enc(0.75)), { rgb: s })[1])).toBeCloseTo(0.9, 3);
  });

  it('applies per-channel curves after the RGB curve, to their channel only', () => {
    const halve = [[0, 0], [1, 0.5]] as [number, number][];
    const [r, g, b] = px(curves, grey(enc(0.8)), { red: halve }).map((v, i) => (i < 3 ? linearToSrgb(v) : v));
    expect(r).toBeCloseTo(0.4, 3);
    expect(g).toBeCloseTo(0.8, 3);
    expect(b).toBeCloseTo(0.8, 3);
    const lift = [[0, 0.2], [1, 1]] as [number, number][];
    const both = linearToSrgb(px(curves, grey(enc(0)), { rgb: lift, red: halve })[0]);
    expect(both).toBeCloseTo(0.1, 3); // rgb: 0 -> 0.2, then red: 0.2 -> 0.1
  });

  it('works on straight colour under partial alpha', () => {
    const s = [[0, 0], [1, 0.5]] as [number, number][];
    const [r, , , a] = px(curves, grey(enc(1), 0.5), { rgb: s });
    expect(a).toBe(0.5);
    expect(linearToSrgb(r / a)).toBeCloseTo(0.5, 3);
  });
});
