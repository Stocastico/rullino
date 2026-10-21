import { defineFilter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { renderChain, type ChainState } from './chain-ui';

const mk = (id: string) =>
  defineFilter({
    id,
    label: id.toUpperCase(),
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'premultiplied',
    params: { k: { type: 'float', min: 0, max: 2, step: 0.1, default: 1, label: 'K' } },
    wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }',
    pixel: (c) => c,
    tolerance: { abs: 0, rel: 0 },
  });
const filters = [mk('alpha'), mk('beta'), mk('gamma')];

function setup(initial: ChainState = { steps: [], selected: undefined }) {
  const root = document.createElement('div');
  document.body.append(root);
  const states: ChainState[] = [];
  renderChain(root, filters, initial, (s) => states.push(s));
  const last = () => states.at(-1)!;
  const add = (id: string) => {
    const sel = root.querySelector<HTMLSelectElement>('select[data-action=add]')!;
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  };
  const click = (uidIndex: number, action: string) =>
    root.querySelectorAll<HTMLElement>('[data-step]')[uidIndex]!.querySelector<HTMLElement>(`[data-action=${action}]`)!.click();
  return { root, states, last, add, click };
}

describe('renderChain', () => {
  it('adds steps with default params and selects the new one', () => {
    const { root, last, add } = setup();
    add('beta');
    add('alpha');
    expect(last().steps.map((s) => s.filterId)).toEqual(['beta', 'alpha']);
    expect(last().steps[1]!.params).toEqual({ k: 1 });
    expect(last().selected).toBe(last().steps[1]!.uid);
    expect(root.querySelectorAll('[data-step]')).toHaveLength(2);
    // Only the selected step shows its controls.
    expect(root.querySelectorAll('input[name=k]')).toHaveLength(1);
  });

  it('removes, reorders and toggles steps', () => {
    const { last, add, click, root } = setup();
    add('alpha');
    add('beta');
    add('gamma');
    click(2, 'up');
    expect(last().steps.map((s) => s.filterId)).toEqual(['alpha', 'gamma', 'beta']);
    click(0, 'down');
    expect(last().steps.map((s) => s.filterId)).toEqual(['gamma', 'alpha', 'beta']);
    const toggle = root.querySelectorAll<HTMLInputElement>('[data-step] input[data-action=toggle]')[1]!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(last().steps[1]!.enabled).toBe(false);
    click(0, 'remove');
    expect(last().steps.map((s) => s.filterId)).toEqual(['alpha', 'beta']);
  });

  it('edits the params of the selected step without rebuilding the list', () => {
    const { root, last, add } = setup();
    add('alpha');
    const card = root.querySelector('[data-step]');
    const k = root.querySelector<HTMLInputElement>('input[name=k]')!;
    k.value = '0.5';
    k.dispatchEvent(new Event('input', { bubbles: true }));
    expect(last().steps[0]!.params).toEqual({ k: 0.5 });
    expect(root.querySelector('[data-step]')).toBe(card); // same DOM node: a drag in progress survives
  });

  it('selects a step by clicking its title', () => {
    const { root, last, add, click } = setup();
    add('alpha');
    add('beta');
    click(0, 'select');
    expect(last().selected).toBe(last().steps[0]!.uid);
    expect(root.querySelectorAll('input[name=k]')).toHaveLength(1);
  });

  it('shows a hint for an empty chain', () => {
    expect(setup().root.textContent).toMatch(/add a filter/i);
  });
});
