import { describe, expect, it } from 'vitest';
import { parseChain } from '@rullino/core';
import { filters } from '@rullino/filters';
import { outputName, webExportEdits } from './plan';

describe('webExportEdits', () => {
  it('shrinks first, then sharpens for the screen, then encodes as asked', () => {
    const { shrink, finish } = webExportEdits({ longSide: 2048, sharpen: 0.5, format: 'webp', quality: 0.8 });
    expect(parseChain(shrink, { filters }).output).toEqual({ longSide: 2048 });
    expect(parseChain(shrink, { filters }).steps).toHaveLength(0);
    const f = parseChain(finish, { filters });
    expect(f.steps.map((s) => s.filter.id)).toEqual(['unsharpMask']);
    expect(f.steps[0]!.params).toMatchObject({ amount: 0.5, sigma: 0.6 });
    expect(f.output).toEqual({ format: 'webp', quality: 0.8 });
  });

  it('leaves sharpening out at 0, and the size alone when no long side is asked', () => {
    const { shrink, finish } = webExportEdits({ sharpen: 0, format: 'png' });
    expect(parseChain(shrink, { filters }).output).toBeUndefined();
    expect(parseChain(finish, { filters }).steps).toHaveLength(0);
    expect(parseChain(finish, { filters }).output).toEqual({ format: 'png' });
  });

  it('rejects a long side that is not a positive whole number', () => {
    expect(() => webExportEdits({ longSide: 0, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
    expect(() => webExportEdits({ longSide: 12.5, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
  });
});

describe('outputName', () => {
  it('keeps the name and gives it the extension of the format', () => {
    const taken = new Set<string>();
    expect(outputName('IMG_0001.HEIC', 'jpeg', taken)).toBe('IMG_0001.jpg');
    expect(outputName('beach.png', 'webp', taken)).toBe('beach.webp');
    expect(outputName('no-extension', 'png', taken)).toBe('no-extension.png');
  });

  it('never gives two photos the same name', () => {
    const taken = new Set<string>();
    expect(outputName('a.jpg', 'jpeg', taken)).toBe('a.jpg');
    expect(outputName('a.png', 'jpeg', taken)).toBe('a-2.jpg');
    expect(outputName('a.jpeg', 'jpeg', taken)).toBe('a-3.jpg');
    expect(outputName('A.jpg', 'jpeg', taken)).toBe('A-4.jpg'); // a.jpg, a-2.jpg and a-3.jpg are taken without case (macOS, Windows)
  });
});
