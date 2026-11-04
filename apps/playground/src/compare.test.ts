import { describe, expect, it } from 'vitest';
import type { ChainState, StepState } from './chain-ui';
import { compareLabel, compareOptions, isCompareKey, resolveCompare } from './compare';

const step = (uid: string, filterId: string): StepState => ({ uid, filterId, params: {}, enabled: true });
const state: ChainState = { steps: [step('a', 'exposure'), step('b', 'curves'), step('c', 'exposure')], selected: 'a' };
const labels: Record<string, string> = { exposure: 'Exposure', curves: 'Curves' };
const labelOf = (id: string) => labels[id] ?? id;

describe('compare with a step', () => {
  it('offers the original, then the picture after each step, numbered (filters can repeat)', () => {
    expect(compareOptions(state, labelOf)).toEqual([
      { value: '', label: 'Original' },
      { value: 'a', label: 'After 1. Exposure' },
      { value: 'b', label: 'After 2. Curves' },
      { value: 'c', label: 'After 3. Exposure' },
    ]);
  });

  it('falls back to the original when the compared step is gone', () => {
    expect(resolveCompare(state, 'b')).toBe('b');
    expect(resolveCompare(state, 'gone')).toBeUndefined();
    expect(resolveCompare(state, undefined)).toBeUndefined();
  });

  it('labels the before side of the split', () => {
    expect(compareLabel(state, undefined, labelOf)).toBe('before');
    expect(compareLabel(state, 'b', labelOf)).toBe('after 2. Curves');
    expect(compareLabel(state, 'gone', labelOf)).toBe('before');
  });
});

describe('hold to compare', () => {
  const key = (k: string, extra: Partial<Parameters<typeof isCompareKey>[0]> = {}) => isCompareKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra });

  it('is the backslash key, without modifiers', () => {
    expect(key('\\')).toBe(true);
    expect(key('a')).toBe(false);
    expect(key('\\', { ctrlKey: true })).toBe(false);
    expect(key('\\', { metaKey: true })).toBe(false);
    expect(key('\\', { altKey: true })).toBe(false);
  });

  it('is ignored while typing in a field, not on a slider or a button', () => {
    expect(key('\\', { target: { tagName: 'INPUT', type: 'text', isContentEditable: false } })).toBe(false);
    expect(key('\\', { target: { tagName: 'INPUT', type: 'number', isContentEditable: false } })).toBe(false);
    expect(key('\\', { target: { tagName: 'INPUT', type: 'range', isContentEditable: false } })).toBe(true);
    expect(key('\\', { target: { tagName: 'INPUT', type: 'checkbox', isContentEditable: false } })).toBe(true);
    expect(key('\\', { target: { tagName: 'BUTTON', isContentEditable: false } })).toBe(true);
    expect(key('\\', { target: { tagName: 'TEXTAREA', isContentEditable: false } })).toBe(false);
    expect(key('\\', { target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
    expect(key('\\', { target: { tagName: 'CANVAS', isContentEditable: false } })).toBe(true);
  });
});
