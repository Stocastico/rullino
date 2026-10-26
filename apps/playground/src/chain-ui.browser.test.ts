import { createImage, defineFilter } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { effectiveMask, renderChain, SELECTION, type ChainState, type StepState } from './chain-ui';

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
  const chain = renderChain(root, filters, initial, (s) => states.push(s));
  const last = () => states.at(-1)!;
  const add = (id: string) => chain.add(filters.find((f) => f.id === id)!);
  const uidAt = (i: number) => last().steps[i]!.uid;
  const click = (i: number, action: 'up' | 'down' | 'remove' | 'select') => {
    if (action === 'up') chain.move(i, i - 1);
    else if (action === 'down') chain.move(i, i + 1);
    else if (action === 'remove') chain.remove(uidAt(i));
    else chain.select(uidAt(i));
  };
  return { root, states, last, add, click, chain, uidAt };
}

describe('renderChain (the chain state and the inspector of the selected step)', () => {
  it('adds steps with default params and selects the new one', () => {
    const { root, last, add } = setup();
    add('beta');
    add('alpha');
    expect(last().steps.map((s) => s.filterId)).toEqual(['beta', 'alpha']);
    expect(last().steps[1]!.params).toEqual({ k: 1 });
    expect(last().selected).toBe(last().steps[1]!.uid);
    // Only the selected step has an inspector, with its controls.
    expect(root.querySelectorAll('[data-step]')).toHaveLength(1);
    expect(root.querySelectorAll('input[name=k]')).toHaveLength(1);
  });

  it('removes, reorders and toggles steps', () => {
    const { last, add, click, chain } = setup();
    add('alpha');
    add('beta');
    add('gamma');
    click(2, 'up');
    expect(last().steps.map((s) => s.filterId)).toEqual(['alpha', 'gamma', 'beta']);
    click(0, 'down');
    expect(last().steps.map((s) => s.filterId)).toEqual(['gamma', 'alpha', 'beta']);
    chain.toggle(last().steps[1]!.uid, false);
    expect(last().steps[1]!.enabled).toBe(false);
    chain.toggle(last().steps[1]!.uid, true);
    expect(last().steps[1]!.enabled).toBe(true);
    chain.move(0, 2);
    expect(last().steps.map((s) => s.filterId)).toEqual(['alpha', 'beta', 'gamma']);
    chain.move(0, 0);
    chain.move(0, 7);
    chain.move(-1, 1);
    expect(last().steps.map((s) => s.filterId)).toEqual(['alpha', 'beta', 'gamma']);
    click(0, 'remove');
    expect(last().steps.map((s) => s.filterId)).toEqual(['beta', 'gamma']);
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

  it('tells subscribers about every change, from here or from set(), and once on subscribing', () => {
    const { chain, add, last } = setup();
    const seen: number[] = [];
    chain.subscribe((st) => seen.push(st.steps.length));
    add('alpha');
    add('beta');
    chain.set({ ...last(), steps: [] }, false);
    expect(seen).toEqual([0, 1, 2, 0]);
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
    expect(setup().root.textContent).toMatch(/browse effects/i);
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

  it('mask-aware filters start with a brush mask that cannot be removed; descriptions show as hints', () => {
    const needsMask = { ...filters[0]!, id: 'needs', kind: 'multipass', usesMask: true, description: 'Paints over things.', tryThis: 'Paint a small area first.', passes: [] } as never;
    const root = document.createElement('div');
    document.body.append(root);
    const states: ChainState[] = [];
    const chain = renderChain(root, [needsMask], { steps: [], selected: undefined }, (s) => states.push(s));
    chain.add(needsMask);
    expect(states.at(-1)!.steps[0]!.mask?.kind).toBe('raster');
    expect(root.querySelector('.hint')!.textContent).toBe('Paints over things.');
    expect(root.querySelector('.try-this')!.textContent).toBe('Try this: Paint a small area first.');
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
    const ui = renderChain(root, [filters[0]!, patch], { steps: [], selected: undefined }, (s) => states.push(s), {
      fill: async (uid) => void filled.push(uid),
    });
    const add = (id: string) => ui.add(id === 'patch' ? patch : filters[0]!);
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
    const chain = renderChain(root, [lens], { steps: [], selected: undefined }, (s) => states.push(s), {
      estimateDepth: async (uid) => void calls.push(`depth:${uid}`),
      pickFocus: (uid) => void calls.push(`focus:${uid}`),
    });
    chain.add(lens);
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

  describe('selection', () => {
    const linear = { kind: 'linear', from: [0, 0], to: [0, 1] } as const;
    const radial = { kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.2], feather: 0.5 } as const;
    const step = (extra: Partial<StepState> = {}): StepState => ({ uid: 's1', filterId: 'alpha', params: {}, enabled: true, ...extra });

    it('a step uses the selection only when asked, instead of its own mask', () => {
      expect(effectiveMask({ steps: [], selected: undefined }, step())).toBeUndefined();
      expect(effectiveMask({ steps: [], selected: undefined, selection: linear }, step())).toBeUndefined();
      expect(effectiveMask({ steps: [], selected: undefined, selection: linear }, step({ mask: radial }))).toBe(radial);
      expect(effectiveMask({ steps: [], selected: undefined, selection: linear }, step({ useSelection: true, mask: radial }))).toBe(linear);
      // nothing selected: the whole image, like an editor without a selection
      expect(effectiveMask({ steps: [], selected: undefined }, step({ useSelection: true, mask: radial }))).toBeUndefined();
    });

    it('selecting the Selection shows the mask controls of the selection, not a step\'s', () => {
      const { root, last, add, chain } = setup();
      add('alpha');
      expect(root.querySelector('[data-selection]')).toBeNull();
      // the step's own mask controls are open, not the selection's
      expect(root.querySelectorAll('[data-action=mask-kind]')).toHaveLength(1);
      chain.select(SELECTION);
      expect(last().selected).toBe(SELECTION);
      const kind = root.querySelector<HTMLSelectElement>('[data-selection] [data-action=mask-kind]')!;
      expect(kind.value).toBe('none');
      expect(root.querySelectorAll('[data-action=mask-kind]')).toHaveLength(1);
      kind.value = 'linear';
      kind.dispatchEvent(new Event('change'));
      expect(last().selection?.kind).toBe('linear');
      expect(last().steps).toHaveLength(1);
    });

    it('"Only in selection" switches a step to the shared selection and hides its own mask controls', () => {
      const { root, last, add } = setup();
      add('alpha');
      const uid = last().steps[0]!.uid;
      const check = () => root.querySelector<HTMLInputElement>('[data-step] [data-action=use-selection]')!;
      expect(check().checked).toBe(false);
      check().checked = true;
      check().dispatchEvent(new Event('change'));
      expect(last().steps.find((s) => s.uid === uid)!.useSelection).toBe(true);
      expect(root.querySelector('[data-step] [data-action=mask-kind]')).toBeNull();
      check().checked = false;
      check().dispatchEvent(new Event('change'));
      expect(last().steps[0]!.useSelection).toBeFalsy();
      expect(root.querySelector('[data-step] [data-action=mask-kind]')).not.toBeNull();
    });

    it('filters that need their own mask (inpainting) do not offer it', () => {
      const needsMask = { ...filters[0]!, id: 'needs', kind: 'multipass', usesMask: true, passes: [] } as never;
      const root = document.createElement('div');
      document.body.append(root);
      renderChain(root, [needsMask], { steps: [], selected: undefined }, () => {}).add(needsMask);
      expect(root.querySelector('[data-action=use-selection]')).toBeNull();
    });

    it('editing the chain keeps the selection (removing, adding)', () => {
      const { last, add, click } = setup({ steps: [], selected: undefined, selection: linear });
      add('alpha');
      add('beta');
      expect(last().selection).toBe(linear);
      click(1, 'remove');
      expect(last().selection).toBe(linear);
    });
  });
});
