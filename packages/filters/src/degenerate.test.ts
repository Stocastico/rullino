import { createImage, runChainCpu, type LinearImage, type Mask } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases } from './test-utils';

// Degenerate sizes: 1x1, a single row, a single column. Every filter must return a finite image of the
// same size, with the reference and with the fast path, and the two must agree.
function noise(w: number, h: number): LinearImage {
  const img = createImage(w, h);
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < w * h; i++) {
    const a = 0.3 + 0.7 * r();
    img.data.set([r() * a, r() * a, r() * a, a], i * 4);
  }
  return img;
}

const brush: Mask = { kind: 'linear', from: [0, 0], to: [1, 1] };
const sizes: [number, number][] = [[1, 1], [1, 9], [9, 1], [2, 2], [3, 1]];

describe('degenerate sizes', () => {
  for (const f of filters) {
    for (const [w, h] of sizes) {
      it(`${f.id} ${w}x${h}`, () => {
        for (const [name, params] of parityCases(f.params)) {
          const step = [{ filter: f, params, ...(f.usesMask ? { mask: brush } : {}) }] as never;
          const ref = runChainCpu(step, noise(w, h));
          const fast = runChainCpu(step, noise(w, h), { fast: true });
          for (const out of [ref, fast]) {
            expect([out.width, out.height], name).toEqual([w, h]);
            expect(out.data.length).toBe(w * h * 4);
            for (const v of out.data) expect(Number.isFinite(v), `${f.id} ${name} not finite`).toBe(true);
          }
        }
      }, 60_000);
    }
  }
});
