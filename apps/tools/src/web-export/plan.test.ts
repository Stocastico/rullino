import { describe, expect, it } from 'vitest';
import { parseEdit } from '@rullino/core';
import { filters } from '@rullino/filters';
import { outputName, webExportEdit } from './plan';

describe('webExportEdit', () => {
  it('is one document: a linear-light resize, then sharpening at the final size, then the encoding', () => {
    const doc = webExportEdit({ longSide: 2048, sharpen: 0.5, format: 'webp', quality: 0.8 });
    const g = parseEdit(doc, { filters });
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([['small', 'resize'], ['sharp', 'chain']]);
    expect(g.nodes[0]).toMatchObject({ kind: 'resize', from: ['photo'], longSide: 2048 });
    const sharp = g.nodes[1]!;
    if (sharp.kind !== 'chain') throw new Error('not a chain');
    expect(sharp.steps.map((s) => s.filter.id)).toEqual(['unsharpMask']);
    expect(sharp.steps[0]!.params).toMatchObject({ amount: 0.5, sigma: 0.6 });
    expect(g.output).toEqual({ node: 'sharp', format: 'webp', quality: 0.8 });
  });

  it('leaves out the resize without a long side and the sharpening at 0', () => {
    const g = parseEdit(webExportEdit({ sharpen: 0, format: 'png' }), { filters });
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([['sharp', 'chain']]);
    expect((g.nodes[0] as unknown as { steps: unknown[] }).steps).toHaveLength(0);
    expect(g.output).toEqual({ node: 'sharp', format: 'png' });
  });

  it('rejects a long side that is not a positive whole number', () => {
    expect(() => webExportEdit({ longSide: 0, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
    expect(() => webExportEdit({ longSide: 12.5, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
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
