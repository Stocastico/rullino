import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { chromaticAberration } from './index';

const W = 41;
const H = 21;
// Red and blue both ramp from left to right; green is flat.
const ramp = imageOf(W, H, (x) => [x / W, 0.5, x / W]);

describe('chromatic aberration', () => {
  it('leaves the centre and flat images alone', () => {
    const out = chromaticAberration.cpu(ramp, { amount: 6 });
    for (let c = 0; c < 4; c++) expect(at(out, 20, 10, c)).toBeCloseTo(at(ramp, 20, 10, c), 6);
    const flat = imageOf(W, H, () => [0.3, 0.6, 0.9]);
    chromaticAberration.cpu(flat, { amount: 6 }).data.forEach((v, i) => expect(v).toBeCloseTo(flat.data[i]!, 6));
  });

  it('shifts red outwards and blue inwards, by `amount` px at the corners', () => {
    const out = chromaticAberration.cpu(ramp, { amount: 6 });
    // Right of the centre on the middle row: red is sampled further right, blue further left.
    expect(at(out, 30, 10, 0)).toBeGreaterThan(at(ramp, 30, 10, 0));
    expect(at(out, 30, 10, 2)).toBeLessThan(at(ramp, 30, 10, 2));
    expect(at(out, 30, 10, 1)).toBe(at(ramp, 30, 10, 1));
    // At distance d from the centre the shift is amount · d / half-diagonal.
    const halfDiag = Math.hypot(W, H) / 2;
    const d = 30.5 - W / 2;
    expect(at(out, 30, 10, 0) - at(ramp, 30, 10, 0)).toBeCloseTo((6 * d) / halfDiag / W, 4);
  });

  it('negative amounts swap the directions; amount is in px', () => {
    const out = chromaticAberration.cpu(ramp, { amount: -6 });
    expect(at(out, 30, 10, 0)).toBeLessThan(at(ramp, 30, 10, 0));
    expect(chromaticAberration.params.amount.unit).toBe('px');
  });
});
