import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from './share';

describe('share links', () => {
  it('round-trips JSON through a URL-safe compressed string', async () => {
    const state = { version: 1, steps: [{ filter: 'exposure', params: { stops: 0.5 } }], note: 'ü ✓' };
    const text = await encodeState(state);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeState(text)).toEqual(state);
  });

  it('compresses repetitive state', async () => {
    const state = { data: 'A'.repeat(10_000) };
    expect((await encodeState(state)).length).toBeLessThan(200);
  });

  it('rejects garbage', async () => {
    await expect(decodeState('not*base64')).rejects.toThrow();
    await expect(decodeState('AAAA')).rejects.toThrow();
  });
});
