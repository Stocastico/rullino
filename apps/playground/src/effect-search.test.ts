import type { Filter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { searchEffects } from './effect-search';

const f = (id: string, label: string, category: string, description = '', tryThis = '') => ({ id, label, category, description, tryThis }) as unknown as Filter<any>;
const list = [
  f('gaussianBlur', 'Gaussian blur', 'classic', 'Blurs with a bell-shaped weighting.'),
  f('boxBlur', 'Box blur', 'classic', 'Blurs by averaging a square.'),
  f('halftone', 'Halftone', 'stylize', 'Prints the picture as dots, like a newspaper.'),
  f('exposure', 'Exposure', 'adjust', 'Makes the picture lighter or darker.'),
] as const;

describe('searchEffects', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(searchEffects(list, '  ').map((x) => x.id)).toEqual(['gaussianBlur', 'boxBlur', 'halftone', 'exposure']);
  });

  it('matches names, ids, descriptions and categories, all words required', () => {
    expect(searchEffects(list, 'blur').map((x) => x.id)).toEqual(['gaussianBlur', 'boxBlur']);
    expect(searchEffects(list, 'newspaper').map((x) => x.id)).toEqual(['halftone']);
    expect(searchEffects(list, 'stylize').map((x) => x.id)).toEqual(['halftone']);
    expect(searchEffects(list, 'gaussianblur').map((x) => x.id)).toEqual(['gaussianBlur']);
    expect(searchEffects(list, 'blur square').map((x) => x.id)).toEqual(['boxBlur']);
    expect(searchEffects(list, 'blur newspaper')).toEqual([]);
  });

  it('ranks a name that starts with the word above one that only contains it, then a description match', () => {
    const ranked = searchEffects(
      [f('a', 'Soft glow', 'look', 'Adds bloom.'), f('b', 'Bloom', 'stylize', 'A glow.'), f('c', 'Light bloom', 'adjust', '')],
      'bloom',
    ).map((x) => x.id);
    expect(ranked).toEqual(['b', 'c', 'a']);
  });

  it('ignores case', () => {
    expect(searchEffects(list, 'HALF').map((x) => x.id)).toEqual(['halftone']);
  });
});
