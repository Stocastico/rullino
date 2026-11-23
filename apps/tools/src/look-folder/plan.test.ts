import { parseEdit, ParseError } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks, resolveLookLut } from '@rullino/presets';
import { describe, expect, it } from 'vitest';
import { isPhoto, lookFolderEdit } from './plan';

const parse = (doc: unknown) => parseEdit(doc, { filters, resolveLut: resolveLookLut });

describe('lookFolderEdit', () => {
  it('a built-in look at an intensity, with the output settings', () => {
    const doc = lookFolderEdit({ source: { look: 'noir', intensity: 0.6 }, format: 'jpeg', quality: 0.9, longSide: 1600 });
    const expected = lookEdit(looks.find((l) => l.id === 'noir')!, { intensity: 0.6 });
    expect(doc.nodes).toEqual(expected.nodes);
    expect(doc.output).toEqual({ format: 'jpeg', quality: 0.9, longSide: 1600 });
    expect(parse(doc).nodes).toHaveLength(1);
  });

  it('a pasted document, its output settings overridden by the page’s', () => {
    const pasted = JSON.stringify({ version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }], output: { format: 'webp', longSide: 100, quality: 0.2 } });
    const doc = lookFolderEdit({ source: { document: pasted }, format: 'png', quality: 0.9 });
    expect(parse(doc).nodes[0]).toMatchObject({ kind: 'chain', id: 'edit' });
    expect(doc.output).toEqual({ longSide: 100, format: 'png' }); // quality is dropped for PNG
    const v3 = JSON.stringify({ version: 3, inputs: { p: {} }, nodes: [{ id: 'a', from: 'p', steps: [] }, { id: 'b', kind: 'resize', from: 'a', scale: 0.5 }] });
    expect(lookFolderEdit({ source: { document: v3 }, format: 'jpeg', quality: 0.7 }).output).toEqual({ format: 'jpeg', quality: 0.7 });
  });

  it('says what is wrong with a pasted document', () => {
    expect(() => lookFolderEdit({ source: { document: '{ "version": 2, ' }, format: 'png' })).toThrow(/not JSON/);
    expect(() => lookFolderEdit({ source: { document: '{"version": 2, "steps": [{"filter": "nope"}]}' }, format: 'png' })).toThrow(ParseError);
    const two = JSON.stringify({ version: 3, inputs: { a: {}, b: {} }, nodes: [{ id: 'm', kind: 'mix', from: ['a', 'b'] }] });
    expect(() => lookFolderEdit({ source: { document: two }, format: 'png' })).toThrow(/reads 2 photos \(a, b\); this page gives it one/);
  });

  it('refuses an unknown look and a long side that is not a positive whole number', () => {
    expect(() => lookFolderEdit({ source: { look: 'nope', intensity: 1 }, format: 'png' })).toThrow(/unknown look "nope"/);
    expect(() => lookFolderEdit({ source: { look: 'noir', intensity: 1 }, format: 'png', longSide: 0 })).toThrow(/long side/);
  });
});

describe('isPhoto', () => {
  it('takes the image files a browser can decode, by type or extension, and skips the rest', () => {
    expect(isPhoto({ name: 'a.JPG', type: '' })).toBe(true);
    expect(isPhoto({ name: 'b.webp', type: '' })).toBe(true);
    expect(isPhoto({ name: 'c', type: 'image/png' })).toBe(true);
    expect(isPhoto({ name: '.DS_Store', type: '' })).toBe(false);
    expect(isPhoto({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(isPhoto({ name: 'raw.CR3', type: '' })).toBe(false);
  });
});
