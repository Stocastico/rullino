import { describe, expect, it } from 'vitest';
import { testImage } from './image';

describe('testImage', () => {
  it('is deterministic, opaque, of the requested size and not flat', () => {
    const a = testImage(64, 40);
    expect(a.length).toBe(64 * 40 * 4);
    expect(Array.from(a)).toEqual(Array.from(testImage(64, 40)));
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    const reds = new Set<number>();
    for (let i = 0; i < a.length; i += 4) reds.add(a[i]!);
    expect(reds.size).toBeGreaterThan(50); // gradients and texture, like a photo
  });
});
