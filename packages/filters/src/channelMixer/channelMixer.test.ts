import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { channelMixer } from './index';

const c = [0.6, 0.3, 0.1, 0.5] as [number, number, number, number];

describe('channel mixer', () => {
  it('is the identity at the defaults', () => {
    expect(px(channelMixer, c)).toEqual(c.map((v) => expect.closeTo(v, 7)));
  });

  it('each output channel is a weighted sum of the input channels; alpha is kept', () => {
    // Swap red and blue, green = average of all three.
    const out = px(channelMixer, c, { rr: 0, rb: 1, br: 1, bb: 0, gr: 1 / 3, gg: 1 / 3, gb: 1 / 3 });
    expect(out).toEqual([0.1, (0.6 + 0.3 + 0.1) / 3, 0.6, 0.5].map((v) => expect.closeTo(v, 6)));
  });

  it('works on premultiplied values: the same as mixing the straight colour and premultiplying', () => {
    const straight = px(channelMixer, [1.2, 0.6, 0.2, 1], { rg: 0.5, bb: 2 });
    expect(px(channelMixer, c, { rg: 0.5, bb: 2 })).toEqual([...straight.slice(0, 3).map((v) => v * 0.5), 0.5].map((v) => expect.closeTo(v, 6)));
  });
});
