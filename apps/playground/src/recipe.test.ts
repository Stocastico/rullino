import { editXmp, encodeJpeg, writeMetadata } from '@rullino/codecs';
import { describe, expect, it } from 'vitest';
import { recipeOf } from './recipe';

describe('recipeOf', () => {
  it('the edit document a photo exported by rullino carries, parsed; undefined otherwise', async () => {
    const doc = { version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: 1.5 } }] }] };
    const plain = encodeJpeg({ width: 2, height: 2, data: new Uint8Array(16) });
    const carrying = (await writeMetadata(plain, { xmp: editXmp(undefined, { edit: JSON.stringify(doc) }) })).bytes;
    expect(await recipeOf(new Blob([carrying as BlobPart]))).toEqual(doc);
    expect(await recipeOf(new Blob([plain as BlobPart]))).toBeUndefined();
    expect(await recipeOf(new Blob(['not an image']))).toBeUndefined();
    const broken = (await writeMetadata(plain, { xmp: editXmp(undefined, { edit: '{ not json' }) })).bytes;
    expect(await recipeOf(new Blob([broken as BlobPart]))).toBeUndefined();
  });
});
