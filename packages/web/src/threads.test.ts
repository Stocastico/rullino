import { describe, expect, it } from 'vitest';
import { resolveThreads } from './threads';

describe('resolveThreads', () => {
  it('takes whole numbers, caps them, and rejects the rest', () => {
    expect(resolveThreads(3)).toBe(3);
    expect(resolveThreads(1)).toBe(1);
    expect(resolveThreads(1000)).toBe(64);
    for (const bad of [0, -2, 1.5, Number.NaN]) expect(() => resolveThreads(bad)).toThrow(/threads/);
  });

  it('by default uses 4 workers on a machine with 4 cores or more, and none below (two cores gain too little to pay for the pool)', () => {
    expect(resolveThreads(undefined, 4)).toBe(4);
    expect(resolveThreads(undefined, 6)).toBe(4);
    expect(resolveThreads(undefined, 24)).toBe(4);
    for (const cores of [0, 1, 2, 3]) expect(resolveThreads(undefined, cores)).toBe(1);
    expect(resolveThreads(undefined)).toBeGreaterThanOrEqual(1);
    expect(resolveThreads(undefined)).toBeLessThanOrEqual(4);
    expect(resolveThreads(1, 24), 'threads: 1 stays possible').toBe(1);
  });

  it("'auto' is the cores, between 1 and 8", () => {
    expect(resolveThreads('auto', 4)).toBe(4);
    expect(resolveThreads('auto', 32)).toBe(8);
    expect(resolveThreads('auto', 0)).toBe(1);
    expect(resolveThreads('auto')).toBeGreaterThanOrEqual(1);
  });
});
