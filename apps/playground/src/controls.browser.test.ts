import { defaultParams } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { renderControls } from './controls';

const schema = {
  amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Amount' },
  levels: { type: 'int', min: 2, max: 32, default: 4, label: 'Levels' },
  invert: { type: 'bool', default: false, label: 'Invert' },
  method: { type: 'enum', options: { luminance: 'Luminance', average: 'Average' }, default: 'luminance', label: 'Method' },
} as const;

function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  const changes: unknown[] = [];
  const controls = renderControls(root, schema, defaultParams(schema), (v) => changes.push(v));
  return { root, changes, controls };
}

const fire = (el: HTMLInputElement | HTMLSelectElement, value: string | boolean, type = 'input') => {
  if (typeof value === 'boolean') (el as HTMLInputElement).checked = value;
  else el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
};

describe('renderControls', () => {
  it('renders one labelled control per parameter, of the right kind, at its default', () => {
    const { root } = setup();
    const amount = root.querySelector<HTMLInputElement>('[name=amount]')!;
    expect(amount.type).toBe('range');
    expect([amount.min, amount.max, amount.step, amount.value]).toEqual(['-1', '1', '0.01', '0']);
    expect(root.querySelector<HTMLInputElement>('[name=levels]')!.step).toBe('1');
    expect(root.querySelector<HTMLInputElement>('[name=invert]')!.type).toBe('checkbox');
    const method = root.querySelector<HTMLSelectElement>('[name=method]')!;
    expect([...method.options].map((o) => [o.value, o.text])).toEqual([
      ['luminance', 'Luminance'],
      ['average', 'Average'],
    ]);
    expect(root.textContent).toContain('Amount');
    expect(root.textContent).toContain('Levels');
  });

  it('emits resolved values on change', () => {
    const { root, changes } = setup();
    fire(root.querySelector<HTMLInputElement>('[name=amount]')!, '0.25');
    fire(root.querySelector<HTMLInputElement>('[name=invert]')!, true, 'change');
    fire(root.querySelector<HTMLSelectElement>('[name=method]')!, 'average', 'change');
    expect(changes.at(-1)).toEqual({ amount: 0.25, levels: 4, invert: true, method: 'average' });
  });

  it('shows the current value next to sliders', () => {
    const { root } = setup();
    fire(root.querySelector<HTMLInputElement>('[name=levels]')!, '7');
    expect(root.querySelector('output[for=param-levels]')?.textContent).toBe('7');
  });

  it('resets to defaults', () => {
    const { root, changes } = setup();
    fire(root.querySelector<HTMLInputElement>('[name=amount]')!, '0.5');
    root.querySelector<HTMLButtonElement>('button[data-action=reset]')!.click();
    expect(changes.at(-1)).toEqual(defaultParams(schema));
    expect(root.querySelector<HTMLInputElement>('[name=amount]')!.value).toBe('0');
  });

  it('says so when a filter has no parameters', () => {
    const root = document.createElement('div');
    renderControls(root, {}, {}, () => {});
    expect(root.textContent).toMatch(/no parameters/i);
  });
});
