import { describe, expect, it } from 'vitest';
import { createImage } from './image';
import { createRasterMask } from './mask';
import { refineMask } from './refine';

const W = 40;
const H = 12;
/** Dark left half, bright right half: the real edge is between x = 19 and x = 20. */
const guide = () => {
  const im = createImage(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) im.data.set(x < 20 ? [0.02, 0.02, 0.02, 1] : [0.6, 0.6, 0.6, 1], (y * W + x) * 4);
  return im;
};
const maskFrom = (f: (x: number) => number) => createRasterMask(W, H, Float32Array.from({ length: W * H }, (_, i) => f(i % W)));
const row = (m: { data: Float32Array }, y = 6) => [...m.data.subarray(y * W, (y + 1) * W)];

describe('refineMask', () => {
  it('moves a rough mask edge onto the edge in the guide image', () => {
    const rough = maskFrom((x) => (x >= 17 ? 1 : 0)); // 3 px too far left
    const r = row(refineMask(rough, guide(), { radius: 6 / W, epsilon: 1e-3 }));
    const jumps = r.slice(1).map((v, i) => v - r[i]!);
    expect(jumps.indexOf(Math.max(...jumps))).toBe(19); // the sharp step is now between x = 19 and 20
    expect(Math.abs(r[17]! - r[16]!)).toBeLessThan(0.1); // the rough mask's false edge is gone
    for (const x of [20, 21, 30]) expect(r[x]).toBeGreaterThan(0.99);
    // What a guided filter cannot do: in the flat dark region it acts like a local mean, so the
    // wrongly selected pixels leave a soft halo there rather than disappearing.
    for (const x of [17, 18, 19]) expect(r[x]).toBeLessThan(0.6);
  });

  it('keeps constant masks constant and stays in [0, 1]', () => {
    for (const v of [0, 0.5, 1]) for (const q of refineMask(maskFrom(() => v), guide(), { radius: 0.1, epsilon: 1e-3 }).data) expect(q).toBeCloseTo(v, 5);
    const noisy = maskFrom((x) => ((x * 7) % 5) / 4);
    for (const q of refineMask(noisy, guide(), { radius: 0.05, epsilon: 1e-4 }).data) {
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });

  it('smooths more where the guide is flat (larger epsilon -> closer to a blur)', () => {
    const rough = maskFrom((x) => (x >= 17 ? 1 : 0));
    const sharp = row(refineMask(rough, guide(), { radius: 6 / W, epsilon: 1e-4 }));
    const soft = row(refineMask(rough, guide(), { radius: 6 / W, epsilon: 10 }));
    expect(soft[18]!).toBeGreaterThan(sharp[18]!);
  });

  it('needs a guide of the same size and leaves its inputs alone', () => {
    const rough = maskFrom((x) => (x >= 17 ? 1 : 0));
    const copy = rough.data.slice();
    refineMask(rough, guide(), { radius: 0.1, epsilon: 1e-3 });
    expect(rough.data).toEqual(copy);
    expect(() => refineMask(createRasterMask(3, 3), guide(), { radius: 0.1, epsilon: 1e-3 })).toThrow(/40x12/);
  });
});
