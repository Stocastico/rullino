import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { transparency } from './index';

describe('transparency', () => {
  it('makes pixels fully transparent by default', () => {
    expect(px(transparency, [0.2, 0.4, 0.6, 1])).toEqual([0, 0, 0, 0]);
  });

  it('fades premultiplied colour and alpha together, keeping the straight colour', () => {
    const [r, g, b, a] = px(transparency, [0.2, 0.4, 0.6, 0.8], { amount: 0.25 });
    expect(a).toBeCloseTo(0.6, 6);
    expect([r / a, g / a, b / a]).toEqual([0.25, 0.5, 0.75].map((v) => expect.closeTo(v, 6)));
  });

  it('is the identity at amount 0', () => {
    expect(px(transparency, [0.2, 0.4, 0.6, 0.8], { amount: 0 })).toEqual([0.2, 0.4, 0.6, 0.8].map((v) => expect.closeTo(v, 7)));
  });
});
