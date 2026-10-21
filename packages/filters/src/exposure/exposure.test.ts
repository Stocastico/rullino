import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { exposure } from './index';

describe('exposure', () => {
  it('is the identity at 0 EV', () => {
    expect(px(exposure, [0.1, 0.2, 0.4, 1])).toEqual(px(exposure, [0.1, 0.2, 0.4, 1], { ev: 0 }));
    expect(px(exposure, [0.25, 0.5, 0.125, 0.5])).toEqual([0.25, 0.5, 0.125, 0.5]);
  });

  it('doubles linear light per stop and leaves alpha alone', () => {
    expect(px(exposure, [0.25, 0.5, 0.125, 0.5], { ev: 1 })).toEqual([0.5, 1, 0.25, 0.5]);
    expect(px(exposure, [0.25, 0.5, 0.125, 1], { ev: -2 })).toEqual([0.0625, 0.125, 0.03125, 1]);
  });
});
