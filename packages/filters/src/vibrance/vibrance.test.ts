import { describe, expect, it } from 'vitest';
import { chroma, grey, px } from '../test-utils';
import { vibrance } from './index';

const muted = [0.3, 0.25, 0.2, 1] as [number, number, number, number];
const vivid = [0.9, 0.1, 0.05, 1] as [number, number, number, number];

describe('vibrance', () => {
  it('is the identity at 0', () => {
    px(vibrance, muted).forEach((v, i) => expect(v).toBeCloseTo(muted[i]!, 6));
  });

  it('boosts muted colours relatively more than vivid ones', () => {
    const gainMuted = chroma(px(vibrance, muted, { amount: 1 })) / chroma(muted);
    const gainVivid = chroma(px(vibrance, vivid, { amount: 1 })) / chroma(vivid);
    expect(gainMuted).toBeGreaterThan(1.5);
    expect(gainVivid).toBeLessThan(gainMuted);
    expect(gainVivid).toBeGreaterThanOrEqual(1);
  });

  it('reduces chroma when negative and leaves greys alone', () => {
    expect(chroma(px(vibrance, muted, { amount: -1 }))).toBeLessThan(chroma(muted));
    expect(px(vibrance, grey(0.4), { amount: 1 })[2]).toBeCloseTo(0.4, 5);
  });
});
