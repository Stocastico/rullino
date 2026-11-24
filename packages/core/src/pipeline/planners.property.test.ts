import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defineFilter } from '../define';
import { planMapped } from '../gpu/tiled';
import { planBands, planSegments, stepReach } from './bands';
import type { Step } from './chain';
import { planTiles, tileSideFor } from './tiles';

// Properties of the band and tile planners (#177): every pixel owned exactly once, reads clamped to
// the image and covering the halo, textures within their side. The executors' bit-for-bit tests rest
// on these. RULLINO_FUZZ_RUNS raises the runs.

const RUN = 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }';
const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
// Hundreds of cases each: slower than a unit test by nature (and much slower under coverage). The
// timeout grows with the runs: a describe's timeout overrides --testTimeout, so the fuzz job's
// 20 000 runs must not be held to the 300 of `pnpm test`.
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
// A failure prints its seed: RULLINO_FUZZ_SEED=<seed> replays it.
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

/** How many times each pixel of a w × h image is owned by `rects`. */
function ownership(w: number, h: number, rects: readonly { x0: number; y0: number; x1: number; y1: number }[]): Uint16Array {
  const n = new Uint16Array(w * h);
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) n[y * w + x]!++;
  return n;
}

describe('planBands', SLOW, () => {
  it('owns every row once, reads the halo around it clamped to the image, and keeps bands ≥ 4 × halo unless forced', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 64 }), fc.integer({ min: 0, max: 50 }), fc.boolean(), (h, count, halo, force) => {
        const bands = planBands(h, count, halo, { force });
        expect(bands.length).toBeGreaterThanOrEqual(1);
        expect(bands.length).toBeLessThanOrEqual(Math.min(count, h));
        let next = 0;
        for (const b of bands) {
          expect(b.y0).toBe(next);
          expect(b.y1).toBeGreaterThan(b.y0);
          expect(b.from).toBe(Math.max(0, b.y0 - halo));
          expect(b.to).toBe(Math.min(h, b.y1 + halo));
          next = b.y1;
        }
        expect(next).toBe(h);
        if (!force && halo > 0 && bands.length > 1) expect(Math.min(...bands.map((b) => b.y1 - b.y0))).toBeGreaterThanOrEqual(Math.floor(4 * halo) - 1);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('planTiles', SLOW, () => {
  it('owns every pixel once, reads the halo clamped to the image, and no texture exceeds the side', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 160 }), fc.integer({ min: 1, max: 160 }), fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 120 }), (w, h, halo, extra) => {
        const side = 2 * halo + extra;
        const tiles = planTiles(w, h, side, halo);
        expect(ownership(w, h, tiles).every((n) => n === 1)).toBe(true);
        for (const t of tiles) {
          expect([t.fromX, t.fromY, t.toX, t.toY]).toEqual([Math.max(0, t.x0 - halo), Math.max(0, t.y0 - halo), Math.min(w, t.x1 + halo), Math.min(h, t.y1 + halo)]);
          expect(t.toX - t.fromX).toBeLessThanOrEqual(side);
          expect(t.toY - t.fromY).toBeLessThanOrEqual(side);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('refuses only a halo that leaves no interior in an image that does not fit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 40 }), (w, h, side, halo) => {
        const refuses = (w > side || h > side) && side - 2 * halo < 1;
        if (refuses) expect(() => planTiles(w, h, side, halo)).toThrow(RangeError);
        else expect(() => planTiles(w, h, side, halo)).not.toThrow();
      }),
      { numRuns: RUNS },
    );
  });
});

describe('planMapped', SLOW, () => {
  it('owns every output pixel once, and each tile reads a rectangle that contains what it needs and fits the side (unless one pixel needs more)', () => {
    // A mapping that scales and shifts: the need of a rectangle is its image with a margin, clamped.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), fc.integer({ min: 1, max: 120 }), fc.double({ min: 0.3, max: 4, noNaN: true }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 4, max: 64 }), (w, h, k, margin, side) => {
        const [sw, sh] = [Math.ceil(w * k), Math.ceil(h * k)];
        const need = (r: { x0: number; y0: number; x1: number; y1: number }) => {
          const x0 = Math.max(0, Math.floor(r.x0 * k) - margin);
          const y0 = Math.max(0, Math.floor(r.y0 * k) - margin);
          return { x0, y0, x1: Math.max(x0 + 1, Math.min(sw, Math.ceil(r.x1 * k) + margin)), y1: Math.max(y0 + 1, Math.min(sh, Math.ceil(r.y1 * k) + margin)) };
        };
        const plans = planMapped(w, h, side, need);
        expect(ownership(w, h, plans.map((p) => p.out)).every((n) => n === 1)).toBe(true);
        for (const { out, src } of plans) {
          const n = need(out);
          expect(src).toEqual(n);
          const single = out.x1 - out.x0 === 1 && out.y1 - out.y0 === 1;
          if (!single) {
            expect(src.x1 - src.x0).toBeLessThanOrEqual(side);
            expect(src.y1 - src.y0).toBeLessThanOrEqual(side);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe('tileSideFor', SLOW, () => {
  it('renders whole exactly when everything fits; otherwise a side within the texture limit that leaves room for the halo', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 40_000 }), fc.integer({ min: 1, max: 40_000 })), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 2048, max: 16384 }),
        fc.option(fc.integer({ min: 1, max: 2 ** 33 }), { nil: undefined }),
        (sizes, textures, halo, maxTexture, budget) => {
          const side = tileSideFor({ sizes, textures, halo, maxTexture, budget });
          const fits = sizes.every(([w, h]) => w <= maxTexture && h <= maxTexture) && (budget === undefined || Math.max(...sizes.map(([w, h]) => w * h)) * 8 * textures <= budget);
          if (fits) expect(side).toBeUndefined();
          else {
            expect(side).toBeDefined();
            expect(side!).toBeLessThanOrEqual(maxTexture);
            expect(side!).toBeGreaterThanOrEqual(Math.min(maxTexture, 2 * halo + 64));
            if (budget !== undefined && side! > 2 * halo + 64 && side! < maxTexture) expect(side! * side! * 8 * textures).toBeLessThanOrEqual(budget);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('planSegments', SLOW, () => {
  const local = (reach: number) =>
    defineFilter({ id: `r${reach}`, label: 'r', category: 'classic', kind: 'multipass', params: {}, passes: [{ name: 'out', inputs: ['input'], wgsl: RUN }], reach: () => reach, cpu: (s) => s, tolerance: { abs: 0, rel: 0 } });
  const global = defineFilter({ id: 'g', label: 'g', category: 'classic', kind: 'multipass', params: {}, passes: [{ name: 'out', inputs: ['input'], wgsl: RUN }], reach: 'global', cpu: (s) => s, tolerance: { abs: 0, rel: 0 } });
  const point = defineFilter({ id: 'p', label: 'p', category: 'adjust', kind: 'pointwise', alpha: 'premultiplied', params: {}, wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }', pixel: (c) => c, tolerance: { abs: 0, rel: 0 } });
  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.integer({ min: 0, max: 9 }).map((r) => ({ filter: local(r), params: {} })),
    fc.constant({ filter: global, params: {} }),
    fc.constant({ filter: point, params: {} }),
    fc.constant({ filter: point, params: {}, enabled: false }),
  );

  it('keeps the enabled steps in order, puts each global step alone, and gives every other segment the sum of its reaches as halo', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 12 }), (steps) => {
        const segments = planSegments(steps);
        expect(segments.flatMap((s) => s.steps)).toEqual(steps.filter((s) => s.enabled !== false));
        for (const seg of segments) {
          if (seg.halo === 'global') expect(seg.steps).toHaveLength(1);
          else {
            expect(seg.steps.every((s) => stepReach(s) !== 'global')).toBe(true);
            expect(seg.halo).toBe(seg.steps.reduce((sum, s) => sum + (stepReach(s) as number), 0));
          }
        }
        // Neighbouring local segments would have been merged.
        for (let i = 1; i < segments.length; i++) expect(segments[i - 1]!.halo === 'global' || segments[i]!.halo === 'global').toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});
