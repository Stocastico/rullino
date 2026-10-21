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

  it('renders kernels as an editable grid', () => {
    const k = { kernel: { type: 'kernel', size: 3, default: [0, 0, 0, 0, 1, 0, 0, 0, 0], label: 'Kernel' } } as const;
    const root = document.createElement('div');
    const changes: unknown[] = [];
    renderControls(root, k, defaultParams(k), (v) => changes.push(v));
    const cells = root.querySelectorAll<HTMLInputElement>('input[data-kernel-index]');
    expect(cells).toHaveLength(9);
    expect(cells[4]!.value).toBe('1');
    fire(cells[0]!, '-1');
    expect(changes.at(-1)).toEqual({ kernel: [-1, 0, 0, 0, 1, 0, 0, 0, 0] });
    fire(cells[1]!, 'abc'); // not a number: ignored
    expect(changes).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('button[data-action=reset]')!.click();
    expect(cells[0]!.value).toBe('0');
  });

  it('groups several curve params into one editor with tabs', () => {
    const id = [[0, 0], [1, 1]] as const;
    const c = {
      rgb: { type: 'curve', default: id, label: 'RGB' },
      red: { type: 'curve', default: [[0, 0.5], [1, 1]], label: 'Red' },
      k: { type: 'float', min: 0, max: 1, step: 0.1, default: 0, label: 'K' },
    } as const;
    const root = document.createElement('div');
    document.body.append(root);
    renderControls(root, c, defaultParams(c), () => {});
    expect(root.querySelectorAll('svg.curve-editor')).toHaveLength(1);
    const tabs = root.querySelectorAll<HTMLButtonElement>('button[data-curve-tab]');
    expect([...tabs].map((t) => t.textContent)).toEqual(['RGB', 'Red']);
    expect(tabs[0]!.getAttribute('aria-pressed')).toBe('true');
    tabs[1]!.click();
    expect(tabs[1]!.getAttribute('aria-pressed')).toBe('true');
    // The editor now shows the red curve: first point at y = 0.5.
    expect(root.querySelector('circle[data-point]')!.getAttribute('cy')).toBe('0.5');
    expect(root.querySelectorAll('input[name=k]')).toHaveLength(1);
  });
});

