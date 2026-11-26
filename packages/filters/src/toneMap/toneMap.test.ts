import { srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { toneMap } from './index';

const METHODS = ['filmic', 'reinhard', 'log'] as const;
const grey = (v: number, a = 1): [number, number, number, number] => [v * a, v * a, v * a, a];

// The curves, written out again (the specification of this filter):
const filmic = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const logCurve = (x: number, { blackEv = -10, whiteEv = 6.5, contrast = 1 } = {}) => {
  const y = Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10) / 0.18) - blackEv) / (whiteEv - blackEv)));
  const y0 = -blackEv / (whiteEv - blackEv);
  const L = (t: number) => 1 / (1 + Math.exp(-10 * contrast * (t - y0)));
  const s = (L(y) - L(0)) / (L(1) - L(0));
  return srgbToLinear(s);
};

describe('toneMap', () => {
  it.each(METHODS)('%s: black stays black, output is display-referred in [0, 1] whatever the input, and rises with it', (method) => {
    expect(px(toneMap, [0, 0, 0, 1], { method })).toEqual([0, 0, 0, 1]);
    let last = -1;
    for (const v of [0.001, 0.01, 0.05, 0.18, 0.5, 1, 2, 5, 20, 100, 1e4]) {
      const [r, g, b] = px(toneMap, grey(v), { method, white: 100 });
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    expect(last).toBeGreaterThan(0.9); // 10 000 times mid grey is (nearly) white
  });

  it('filmic is the ACES fit per channel', () => {
    const [r, g, b] = px(toneMap, [0.18, 2, 0.01, 1], { method: 'filmic' });
    expect([r, g, b]).toEqual([filmic(0.18), filmic(2), filmic(0.01)].map((v) => expect.closeTo(v, 6)));
    expect(filmic(0.18)).toBeCloseTo(0.2669, 3); // mid grey lands above 0.18: the curve lifts the middle
  });

  it('ev exposes before the curve, in stops', () => {
    for (const method of METHODS) {
      const a = px(toneMap, grey(0.3), { method, ev: 1 });
      const b = px(toneMap, grey(0.6), { method, ev: 0 });
      for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 6);
    }
  });

  it('reinhard maps the white point to 1, keeps the colour ratios and the luminance order', () => {
    const [r] = px(toneMap, grey(6), { method: 'reinhard', white: 6 });
    expect(r).toBeCloseTo(1, 6);
    const [r1, g1, b1] = px(toneMap, [0.2, 0.1, 0.05, 1], { method: 'reinhard', white: 4 });
    expect(r1 / g1).toBeCloseTo(2, 5);
    expect(g1 / b1).toBeCloseTo(2, 5);
    // A larger white point leaves the same grey darker.
    expect(px(toneMap, grey(1), { method: 'reinhard', white: 2 })[0]).toBeGreaterThan(px(toneMap, grey(1), { method: 'reinhard', white: 16 })[0]!);
    // The mean is the luminance: a saturated bright colour does not overflow, it clips at 1.
    for (const c of px(toneMap, [50, 0, 0, 1], { method: 'reinhard', white: 100 })) expect(c).toBeLessThanOrEqual(1);
  });

  it('log is the logarithmic sigmoid: black below the black EV, white above the white EV, mid grey in the middle', () => {
    expect(px(toneMap, grey(0.18 * 2 ** -11), { method: 'log' })[0]).toBe(0);
    expect(px(toneMap, grey(0.18 * 2 ** 7), { method: 'log' })[0]).toBe(1);
    for (const v of [0.01, 0.18, 0.7, 3]) expect(px(toneMap, grey(v), { method: 'log' })[0]).toBeCloseTo(logCurve(v), 6);
    const mid = px(toneMap, grey(0.18), { method: 'log' })[0]!;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.35); // about 18% grey light: sRGB 0.5
    // The range and the contrast are parameters.
    expect(px(toneMap, grey(0.18 * 2 ** -8), { method: 'log', blackEv: -8 })[0]).toBeCloseTo(logCurve(0.18 * 2 ** -8, { blackEv: -8 }), 6);
    expect(px(toneMap, grey(0.18 * 2 ** 4), { method: 'log', whiteEv: 4 })[0]).toBeCloseTo(1, 6);
    const steep = px(toneMap, grey(0.5), { method: 'log', contrast: 2 })[0]! - px(toneMap, grey(0.1), { method: 'log', contrast: 2 })[0]!;
    const flat = px(toneMap, grey(0.5), { method: 'log', contrast: 0.5 })[0]! - px(toneMap, grey(0.1), { method: 'log', contrast: 0.5 })[0]!;
    expect(steep).toBeGreaterThan(flat);
  });

  it('works on straight colour under partial alpha and keeps alpha', () => {
    for (const method of METHODS) {
      const full = px(toneMap, [0.4, 0.2, 0.1, 1], { method });
      const half = px(toneMap, [0.2, 0.1, 0.05, 0.5], { method });
      expect(half[3]).toBe(0.5);
      for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo(full[k]! * 0.5, 6);
    }
  });

  it('colours outside sRGB (negative channels) come out finite, as black in that channel', () => {
    for (const method of METHODS) {
      const out = px(toneMap, [-0.3, 0.5, 2, 1], { method });
      for (const c of out) expect(Number.isFinite(c)).toBe(true);
      expect(out[0]).toBeLessThanOrEqual(0.0001);
    }
  });
});
