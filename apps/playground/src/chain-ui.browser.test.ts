import { createImage, defineFilter } from '@rullino/core';
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

  it('removing the selected step selects its neighbour (previous first)', () => {
    const { last, add, click } = setup();
    add('alpha');
    add('beta');
    add('gamma');
    click(1, 'select');
    click(1, 'remove');
    expect(last().selected).toBe(last().steps[0]!.uid);
    click(0, 'select');
    click(0, 'remove');
    expect(last().selected).toBe(last().steps[0]!.uid); // no previous: the next one
    click(0, 'remove');
    expect(last()).toEqual({ steps: [], selected: undefined });
  });

  it('moving past the ends does nothing (buttons disabled)', () => {
    const { root, states, add } = setup();
    add('alpha');
    add('beta');
    const [first, second] = [...root.querySelectorAll('[data-step]')];
    expect(first!.querySelector<HTMLButtonElement>('[data-action=up]')!.disabled).toBe(true);
    expect(second!.querySelector<HTMLButtonElement>('[data-action=down]')!.disabled).toBe(true);
    const n = states.length;
    first!.querySelector<HTMLButtonElement>('[data-action=up]')!.click();
    expect(states.length).toBe(n);
  });

  it('adds a look as a group of steps, selecting its first step', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const states: ChainState[] = [];
    renderChain(root, filters, { steps: [], selected: undefined }, (s) => states.push(s), [
      { id: 'pair', label: 'Pair', steps: () => [{ filter: filters[0]! }, { filter: filters[1]!, params: { k: 2 } }] },
    ]);
    const sel = root.querySelector<HTMLSelectElement>('select[data-action=add-look]')!;
    sel.value = 'unknown';
    sel.dispatchEvent(new Event('change'));
    expect(states).toHaveLength(0);
    sel.value = 'pair';
    sel.dispatchEvent(new Event('change'));
    const last = states.at(-1)!;
    expect(last.steps.map((s) => [s.filterId, s.params.k])).toEqual([['alpha', 1], ['beta', 2]]);
    expect(last.selected).toBe(last.steps[0]!.uid);
  });

  it('mask-aware filters start with a brush mask that cannot be removed; descriptions show as hints', () => {
    const needsMask = { ...filters[0]!, id: 'needs', kind: 'multipass', usesMask: true, description: 'Paints over things.', passes: [] } as never;
    const root = document.createElement('div');
    document.body.append(root);
    const states: ChainState[] = [];
    const chain = renderChain(root, [needsMask], { steps: [], selected: undefined }, (s) => states.push(s));
    const sel = root.querySelector<HTMLSelectElement>('select[data-action=add]')!;
    sel.value = 'needs';
    sel.dispatchEvent(new Event('change'));
    expect(states.at(-1)!.steps[0]!.mask?.kind).toBe('raster');
    expect(root.querySelector('.hint')!.textContent).toBe('Paints over things.');
    expect([...root.querySelector<HTMLSelectElement>('[data-action=mask-kind]')!.options].map((o) => o.value)).not.toContain('none');
    // The mask panel reads the current state: a change made elsewhere shows after set().
    chain.set({ ...states.at(-1)!, steps: states.at(-1)!.steps.map((s) => ({ ...s, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } })) }, true);
    expect(root.querySelector<HTMLSelectElement>('[data-action=mask-kind]')!.value).toBe('linear');
    const opacity = root.querySelector<HTMLInputElement>('[data-action=mask-opacity]')!;
    opacity.value = '0.3';
    opacity.dispatchEvent(new Event('input'));
    expect(states.at(-1)!.steps[0]!.mask).toMatchObject({ kind: 'linear', opacity: 0.3 });
  });

  it('the patch filter starts first in the chain with a mask that cannot be removed, and offers "Fill with AI"', async () => {
    const patch = { ...filters[0]!, id: 'patch', kind: 'multipass', params: { patch: { type: 'image', default: createImage(1, 1), label: 'Image' } }, passes: [] } as never;
    const root = document.createElement('div');
    document.body.append(root);
    const states: ChainState[] = [];
    const filled: string[] = [];
    renderChain(root, [filters[0]!, patch], { steps: [], selected: undefined }, (s) => states.push(s), [], {
      fill: async (uid) => void filled.push(uid),
    });
    const add = (id: string) => {
      const sel = root.querySelector<HTMLSelectElement>('select[data-action=add]')!;
      sel.value = id;
      sel.dispatchEvent(new Event('change'));
    };
    add('alpha');
    expect(root.querySelector('[data-action=fill]')).toBeNull();
    add('patch');
    expect(states.at(-1)!.steps.map((s) => s.filterId)).toEqual(['patch', 'alpha']);
    expect(states.at(-1)!.steps[0]!.mask?.kind).toBe('raster');
    expect([...root.querySelector<HTMLSelectElement>('[data-action=mask-kind]')!.options].map((o) => o.value)).not.toContain('none');
    root.querySelector<HTMLButtonElement>('[data-action=fill]')!.click();
    expect(filled).toEqual([states.at(-1)!.steps[0]!.uid]);
  });

  it('the lens blur filter offers "Estimate depth", and "Pick focus" once there is a depth map', async () => {
    const empty = createImage(1, 1);
    const lens = { ...filters[0]!, id: 'lensBlur', kind: 'multipass', params: { depth: { type: 'image', default: empty, label: 'Depth map' } }, passes: [] } as never;
    const root = document.createElement('div');
    document.body.append(root);
    const states: ChainState[] = [];
    const calls: string[] = [];
    const chain = renderChain(root, [lens], { steps: [], selected: undefined }, (s) => states.push(s), [], {
      estimateDepth: async (uid) => void calls.push(`depth:${uid}`),
      pickFocus: (uid) => void calls.push(`focus:${uid}`),
    });
    const sel = root.querySelector<HTMLSelectElement>('select[data-action=add]')!;
    sel.value = 'lensBlur';
    sel.dispatchEvent(new Event('change'));
    const uid = states.at(-1)!.steps[0]!.uid;
    expect(states.at(-1)!.steps[0]!.mask).toBeUndefined();
    const pick = () => root.querySelector<HTMLButtonElement>('[data-action=pick-focus]')!;
    expect(pick().disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-action=depth]')!.click();
    expect(calls).toEqual([`depth:${uid}`]);
    chain.set({ ...states.at(-1)!, steps: states.at(-1)!.steps.map((s) => ({ ...s, params: { depth: createImage(4, 4) } })) }, true);
    expect(pick().disabled).toBe(false);
    pick().click();
    expect(calls).toEqual([`depth:${uid}`, `focus:${uid}`]);
  });
});
