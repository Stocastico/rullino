import { defaultParams, resolveParams, type Param, type ParamSchema, type ParamValues } from '@rullino/core';

// Builds the parameter UI for a filter straight from its schema: a new filter gets
// sliders, checkboxes and menus without any playground code.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string)[]) {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step)));

function format(p: Param, v: unknown): string {
  return p.type === 'float' ? (v as number).toFixed(decimals(p.step)) : String(v);
}

export interface Controls<S extends ParamSchema> {
  /** Updates the widgets without emitting a change. */
  set(values: ParamValues<S>): void;
}

export function renderControls<S extends ParamSchema>(
  root: HTMLElement,
  schema: S,
  initial: ParamValues<S>,
  onChange: (values: ParamValues<S>) => void,
): Controls<S> {
  root.replaceChildren();
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    root.append(el('p', { className: 'hint' }, 'This filter has no parameters.'));
    return { set() {} };
  }

  let values: Record<string, unknown> = { ...initial };
  const widgets = new Map<string, { write(v: unknown): void }>();

  const emit = () => {
    const resolved = resolveParams(schema, values as Partial<ParamValues<S>>);
    values = { ...resolved };
    onChange(resolved);
  };

  for (const [key, p] of entries) {
    const label = p.label ?? key;
    const row = el('div', { className: `control control-${p.type}` });
    switch (p.type) {
      case 'float':
      case 'int': {
        const input = el('input', {
          type: 'range',
          name: key,
          id: `param-${key}`,
          min: String(p.min),
          max: String(p.max),
          step: String(p.type === 'int' ? 1 : p.step),
        });
        const output = el('output');
        output.htmlFor.add(input.id);
        const write = (v: unknown) => {
          input.value = String(v);
          output.textContent = format(p, v);
        };
        input.addEventListener('input', () => {
          values[key] = Number(input.value);
          output.textContent = format(p, values[key]);
          emit();
        });
        // Double-click a slider to reset just that parameter.
        input.addEventListener('dblclick', () => {
          values[key] = p.default;
          write(p.default);
          emit();
        });
        widgets.set(key, { write });
        row.append(el('label', { htmlFor: input.id }, label), input, output);
        break;
      }
      case 'bool': {
        const input = el('input', { type: 'checkbox', name: key, id: `param-${key}` });
        input.addEventListener('change', () => {
          values[key] = input.checked;
          emit();
        });
        widgets.set(key, { write: (v) => (input.checked = v as boolean) });
        row.append(el('label', { htmlFor: input.id }, input, ' ', label));
        break;
      }
      case 'enum': {
        const select = el('select', { name: key, id: `param-${key}` });
        for (const [value, text] of Object.entries(p.options)) select.append(el('option', { value }, text));
        select.addEventListener('change', () => {
          values[key] = select.value;
          emit();
        });
        widgets.set(key, { write: (v) => (select.value = v as string) });
        row.append(el('label', { htmlFor: select.id }, label), select);
        break;
      }
    }
    if (p.description) row.title = p.description;
    root.append(row);
  }

  const set = (v: ParamValues<S>) => {
    values = { ...v };
    for (const [key, w] of widgets) w.write(values[key]);
  };

  const reset = el('button', { type: 'button', className: 'reset' }, 'Reset');
  reset.dataset.action = 'reset';
  reset.addEventListener('click', () => {
    set(defaultParams(schema));
    emit();
  });
  root.append(reset);

  set(initial);
  return { set };
}
