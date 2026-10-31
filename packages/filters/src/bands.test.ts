import { defaultParams, runChainCpu, type Filter, type LinearImage, type Mask, type Step } from '@rullino/core';
import { runChainBands, stepReach } from '@rullino/core/internal';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityImages, parityMask, specialImage } from './test-utils';

// Banded rendering must give the whole image's result bit for bit: every band computes, for the
// pixels it owns, exactly the operations the whole image computes, as long as its halo covers the
// reach of the filters. A tolerance here would hide the bugs this file is for, so everything is
// compared with strict equality. The planner and the executor are tested in core with synthetic
// filters; this checks the real ones, their declared reach and the position-dependent ones.

const images: Record<string, LinearImage> = { ...parityImages, special: specialImage() };

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be repeated. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function firstDifference(a: LinearImage, b: LinearImage): string | undefined {
  if (a.width !== b.width || a.height !== b.height) return `size ${a.width}x${a.height} against ${b.width}x${b.height}`;
  for (let i = 0; i < a.data.length; i++) {
    if (!Object.is(a.data[i], b.data[i])) {
      const px = i >> 2;
      return `pixel (${px % a.width}, ${Math.floor(px / a.width)}) channel ${i & 3}: ${a.data[i]} against ${b.data[i]}`;
    }
  }
  return undefined;
}

const stepOf = (f: Filter, params: Record<string, unknown>, mask?: Mask): Step => ({ filter: f, params: { ...defaultParams(f.params), ...params }, ...(mask && { mask }) });
const needsMask = (f: Filter) => f.kind === 'multipass' && f.usesMask === true;

/**
 * Band counts worth trying on an image `h` rows tall whose banded steps read `halo` rows: few, many,
 * a band per row, more bands than rows. With a large halo a band per row costs (2 × halo + 1) times
 * the whole image, so the counts are capped to keep the work within a few whole-image runs.
 */
function bandCounts(h: number, halo: number): number[] {
  const all = [2, 3, 7, h, h + 2];
  const cap = halo === 0 ? Infinity : Math.max(2, Math.floor((3.5 * h) / halo));
  return [...new Set(all.map((n) => Math.min(n, cap)))];
}
const haloOf = (steps: Step[]) => steps.reduce((sum, s) => sum + (stepReach(s) === 'global' ? 0 : (stepReach(s) as number)), 0);
const SLOW = 180_000;

describe('every filter, banded, equals the whole image', () => {
  describe.each(filters.map((f) => [f.id, f as Filter] as const))('%s', (_, f) => {
    it.each(Object.entries(images))('on the %s image, in every parameter case', (_, src) => {
      for (const [name, params] of parityCases(f.params)) {
        const steps = [stepOf(f, params, needsMask(f) ? parityMask : undefined)];
        const whole = runChainCpu(steps, src, { fast: true });
        for (const bands of bandCounts(src.height, haloOf(steps))) {
          const banded = runChainBands(steps, src, { fast: true, bands, force: true });
          const diff = firstDifference(banded, whole);
          expect(diff, `${f.id} ${name}, ${bands} bands: ${diff}`).toBeUndefined();
        }
      }
    }, SLOW);

    it('also through the reference implementation (defaults, a few band counts)', () => {
      const src = parityImages.rings;
      const steps = [stepOf(f, {}, needsMask(f) ? parityMask : undefined)];
      const whole = runChainCpu(steps, src);
      for (const bands of bandCounts(src.height, haloOf(steps)).filter((n) => n === 3 || n >= src.height / 2)) {
        const diff = firstDifference(runChainBands(steps, src, { bands, force: true }), whole);
        expect(diff, `${f.id}, ${bands} bands: ${diff}`).toBeUndefined();
      }
    }, SLOW);
  });
});

// A reach that is one row short must show: otherwise either the test cannot see the halo, or the
// declared reach is larger than the filter ever reads (wasted work in every banded render). A
// filter may be exempt only for a reason written here.
const EXEMPT_FROM_TIGHTNESS: Record<string, string> = {
  halftone: 'declared from the geometry of a full-ink dot; the test images hardly ever have a full-ink dot sampled at the extreme row, so one row less goes unseen',
  canny: 'the last row only reaches the Gaussian\'s smallest tap (0.4% at sigma 1): too small to flip a non-maximum-suppression decision on the test images',
};

describe('declared reach is tight', () => {
  const withReach = filters.filter((f): f is Filter & { kind: 'multipass'; reach: (p: never) => number } => f.kind === 'multipass' && typeof f.reach === 'function');

  it.each(withReach.map((f) => [f.id, f] as const))('%s: one row less changes the output somewhere', (id, f) => {
    if (EXEMPT_FROM_TIGHTNESS[id]) return;
    const shorter = { ...f, reach: (p: never) => Math.max(0, f.reach(p) - 1) } as Filter;
    let seen = false;
    let observable = false;
    for (const src of Object.values(images)) {
      // The one-at-a-time cases, and one with every number at its minimum: small reaches that fit the image.
      const mins = Object.fromEntries(Object.entries(f.params).flatMap(([k, p]) => (p.type === 'float' || p.type === 'int' ? [[k, p.min]] : [])));
      for (const [, params] of [...parityCases(f.params), ['mins', mins] as const]) {
        const mask = needsMask(f) ? parityMask : undefined;
        const steps = [stepOf(f, params, mask)];
        const reach = stepReach(steps[0]!);
        if (reach === 'global' || reach === 0) continue;
        observable = true;
        if (reach > src.height / 2) continue; // the halo would cover the image: nothing to see
        const short = [{ ...steps[0]!, filter: shorter }];
        const whole = runChainCpu(steps, src, { fast: true });
        for (const bands of [src.height, 4].map((n) => bandCounts(src.height, reach).includes(n) ? n : Math.min(n, Math.max(2, Math.floor((3.5 * src.height) / reach))))) if (firstDifference(runChainBands(short, src, { fast: true, bands, force: true }), whole)) seen = true;
        if (seen) return;
      }
    }
    if (!observable) return; // reach 0 in every case (applyLut): there is no row to take away
    expect(seen, `${id}: a reach one row shorter gave the same result in every case`).toBe(true);
  }, SLOW);
});

// The registry cases vary one parameter at a time (angles 0, 45 and 90 only): the geometry of the
// halftone reach needs every size, angle, shape, grid and ink together.
describe('halftone reach holds across sizes and angles', () => {
  const halftone = filters.find((f) => f.id === 'halftone')! as Filter;
  it('banded equals whole for 4 sizes × 5 angles × 3 shapes × 2 grids × 2 inks on every image', () => {
    for (const src of Object.values(images)) {
      for (const size of [2, 5, 13, 21])
        for (const angle of [0, 15, 45, 75, 90])
          for (const shape of ['circle', 'square', 'ring'])
            for (const grid of ['square', 'hex'])
              for (const mode of ['mono', 'cmy']) {
                const steps = [stepOf(halftone, { size, angle, shape, grid, mode })];
                const reach = stepReach(steps[0]!) as number;
                const bands = Math.max(2, Math.min(src.height, Math.floor((3.5 * src.height) / Math.max(1, reach))));
                const diff = firstDifference(runChainBands(steps, src, { fast: true, bands, force: true }), runChainCpu(steps, src, { fast: true }));
                expect(diff, `${src.width}x${src.height} size ${size} angle ${angle} ${shape} ${grid} ${mode} (reach ${reach}, ${bands} bands): ${diff}`).toBeUndefined();
              }
    }
  }, SLOW);
});

describe('random chains', () => {
  const pool = filters as readonly Filter[];
  const mask = (rand: () => number): Mask => {
    const k = Math.floor(rand() * 3);
    if (k === 0) return { kind: 'linear', from: [rand(), rand()], to: [0.2 + 0.6 * rand(), 0.2 + 0.6 * rand() + 0.1] };
    if (k === 1) return { kind: 'radial', center: [rand(), rand()], radius: [0.1 + 0.4 * rand(), 0.1 + 0.4 * rand()], feather: rand() };
    const w = 5 + Math.floor(rand() * 9);
    const h = 4 + Math.floor(rand() * 9);
    return { kind: 'raster', raster: { width: w, height: h, data: Float32Array.from({ length: w * h }, () => rand()) } };
  };

  it('120 seeded chains of 1 to 6 steps (neighbourhood, global, masked, disabled) equal the whole image', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rand = rng(seed);
      const names = Object.keys(images);
      const src = images[names[Math.floor(rand() * names.length)]!]!;
      const chain: Step[] = [];
      const length = 1 + Math.floor(rand() * 6);
      for (let i = 0; i < length; i++) {
        const f = pool[Math.floor(rand() * pool.length)]!;
        const cases = parityCases(f.params);
        const [, params] = cases[Math.floor(rand() * cases.length)]!;
        const m = needsMask(f) ? (rand() < 0.5 ? parityMask : mask(rand)) : rand() < 0.3 ? mask(rand) : undefined;
        chain.push({ ...stepOf(f, params, m), ...(rand() < 0.1 && { enabled: false }) });
      }
      const halo = haloOf(chain.filter((c) => c.enabled !== false));
      const bands = Math.min(1 + Math.floor(rand() * (src.height + 2)), halo === 0 ? Infinity : Math.max(2, Math.floor((3.5 * src.height) / halo)));
      const scale = rand() < 0.3 ? 0.5 : 1;
      const label = `seed ${seed}: ${chain.map((s) => s.filter.id).join(' > ')}, ${bands} bands, scale ${scale}, ${src.width}x${src.height}`;
      const whole = runChainCpu(chain, src, { fast: true, scale });
      const diff = firstDifference(runChainBands(chain, src, { fast: true, scale, bands, force: true }), whole);
      expect(diff, `${label}: ${diff}`).toBeUndefined();
    }
  }, SLOW);
});

describe('reach declarations', () => {
  it('every multipass filter declares a reach, as a number of rows or global', () => {
    const missing = filters.filter((f) => f.kind === 'multipass' && f.reach === undefined).map((f) => f.id);
    expect(missing, 'multipass filters without a reach').toEqual([]);
  });

  it('lists the filters that are still global, so that making one banded changes this test', () => {
    // Position-dependent ones wait for the frame argument; the others need the whole image.
    const global = filters.filter((f) => f.kind === 'multipass' && f.reach === 'global').map((f) => f.id).sort();
    expect(global).toEqual(['chromaticAberration', 'clahe', 'equalize', 'lensBlur', 'otsu', 'patch']);
  });
});
