import { describe, expect, it } from 'vitest';
import { bundle, whereItRan } from './page';
import { zipStore } from './zip';

describe('whereItRan', () => {
  it('names the GPU or the CPU and why', () => {
    expect(whereItRan({ backend: 'gpu' })).toBe('on this device’s GPU');
    expect(whereItRan({ backend: 'cpu', reason: 'no adapter' })).toBe('on this device’s CPU (no adapter)');
    expect(whereItRan({ backend: 'cpu' })).toBe('on this device’s CPU (no WebGPU)');
  });
});

describe('bundle', () => {
  const a = { name: 'a.jpg', data: new Uint8Array([1, 2, 3]) };
  const b = { name: 'b.jpg', data: new Uint8Array([4]) };
  it('gives one file as itself and several as a zip', async () => {
    const one = bundle([a], 'photos.zip');
    expect(one.name).toBe('a.jpg');
    expect(new Uint8Array(await one.blob.arrayBuffer())).toEqual(a.data);
    const two = bundle([a, b], 'photos.zip');
    expect(two.name).toBe('photos.zip');
    expect(two.blob.type).toBe('application/zip');
    expect(new Uint8Array(await two.blob.arrayBuffer())).toEqual(zipStore([a, b]));
  });

  it('refuses an empty set', () => {
    expect(() => bundle([], 'x.zip')).toThrow(/nothing to download/);
  });
});
