import { describe, expect, it } from 'vitest';
import { resolveThreads } from './threads';

describe('resolveThreads', () => {
  it('is 1 by default, takes whole numbers, caps them, and rejects the rest', () => {
    expect(resolveThreads(undefined)).toBe(1);
    expect(resolveThreads(3)).toBe(3);
    expect(resolveThreads(1000)).toBe(64);
    for (const bad of [0, -2, 1.5, Number.NaN]) expect(() => resolveThreads(bad)).toThrow(/threads/);
  });

  it("'auto' is the cores, between 1 and 8", () => {
    expect(resolveThreads('auto', 4)).toBe(4);
    expect(resolveThreads('auto', 32)).toBe(8);
    expect(resolveThreads('auto', 0)).toBe(1);
    expect(resolveThreads('auto')).toBeGreaterThanOrEqual(1);
  });
});
