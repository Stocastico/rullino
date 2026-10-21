import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { exposure } from './index';

const src = () => createImage(2, 1, new Float32Array([0.1, 0.2, 0.4, 1, 0.05, 0.1, 0.2, 0.5]));

describe('exposure (CPU reference)', () => {
  it('is the identity at 0 EV', () => {
    expect(exposure.cpu(src(), { ev: 0 }).data).toEqual(src().data);
  });

  it('doubles linear light per stop and leaves alpha alone', () => {
    const out = exposure.cpu(src(), { ev: 1 }).data;
    expect(Array.from(out)).toEqual(Array.from(new Float32Array([0.2, 0.4, 0.8, 1, 0.1, 0.2, 0.4, 0.5])));
  });

  it('halves per negative stop', () => {
    expect(exposure.cpu(src(), { ev: -2 }).data[2]).toBeCloseTo(0.1, 7);
  });

  it('does not mutate its input', () => {
    const input = src();
    exposure.cpu(input, { ev: 3 });
    expect(input.data).toEqual(src().data);
  });

  it('has a default inside its range', () => {
    const { min, max, default: d } = exposure.params.ev;
    expect(d).toBeGreaterThanOrEqual(min);
    expect(d).toBeLessThanOrEqual(max);
  });
});
