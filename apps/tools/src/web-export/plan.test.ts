import { describe, expect, it } from 'vitest';
import { parseEdit } from '@rullino/core';
import { filters } from '@rullino/filters';
import { webExportEdit } from './plan';

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
    expect(g.output).toEqual({ node: 'sharp', format: 'webp', quality: 0.8, metadata: 'strip' }); // the page promises no metadata, also through render()
  });

  it('leaves out the resize without a long side and the sharpening at 0', () => {
    const g = parseEdit(webExportEdit({ sharpen: 0, format: 'png' }), { filters });
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([['sharp', 'chain']]);
    expect((g.nodes[0] as unknown as { steps: unknown[] }).steps).toHaveLength(0);
    expect(g.output).toEqual({ node: 'sharp', format: 'png', metadata: 'strip' });
  });

  it('rejects a long side that is not a positive whole number', () => {
    expect(() => webExportEdit({ longSide: 0, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
    expect(() => webExportEdit({ longSide: 12.5, sharpen: 0, format: 'jpeg' })).toThrow(/long side/i);
  });
});
