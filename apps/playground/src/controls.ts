import { defaultParams, resolveParams, type LinearImage, type Lut, type Param, type ParamSchema, type ParamValues } from '@rullino/core';
import { renderCurveEditor } from './curve-editor';
import { describeLut, readLutFile } from './lut-file';

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

/** The group last shown per schema, so rebuilding a filter's controls keeps the open tab. */
const openGroup = new WeakMap<ParamSchema, string>();

/** A tab bar before the first grouped row; only the selected group's rows are shown. */
function addGroupTabs(root: HTMLElement, schema: ParamSchema): void {
  const rows = [...root.querySelectorAll<HTMLElement>(':scope > [data-group]')];
  const groups = [...new Set(rows.map((r) => r.dataset.group!))];
  if (groups.length === 0) return;
  const bar = el('div', { className: 'group-tabs' });
  bar.setAttribute('role', 'tablist');
  const tabs = groups.map((g) => {
    const tab = el('button', { type: 'button' }, g);
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => show(g));
    return tab;
  });
  const show = (g: string) => {
    openGroup.set(schema, g);
    tabs.forEach((t, i) => t.setAttribute('aria-selected', String(groups[i] === g)));
    for (const r of rows) r.hidden = r.dataset.group !== g;
  };
  bar.append(...tabs);
  rows[0]!.before(bar);
  const last = openGroup.get(schema);
  show(last && groups.includes(last) ? last : groups[0]!);
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
  // Several curve params (e.g. RGB / red / green / blue) share one editor with tabs.
  const curveKeys = entries.filter(([, p]) => p.type === 'curve').map(([k]) => k);

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
      case 'kernel': {
        const grid = el('div', { className: 'kernel' });
        grid.style.gridTemplateColumns = `repeat(${p.size}, 1fr)`;
        const cells = Array.from({ length: p.size * p.size }, (_, i) => {
          const cell = el('input', { type: 'number', step: '0.1', name: `${key}-${i}` });
          cell.dataset.kernelIndex = String(i);
          cell.setAttribute('aria-label', `${label} row ${Math.floor(i / p.size) + 1} column ${(i % p.size) + 1}`);
          cell.addEventListener('input', () => {
            const v = Number(cell.value);
            if (cell.value.trim() === '' || !Number.isFinite(v)) return;
            const next = [...(values[key] as number[])];
            next[i] = v;
            values[key] = next;
            emit();
          });
          return cell;
        });
        grid.append(...cells);
        widgets.set(key, { write: (v) => (v as number[]).forEach((x, i) => (cells[i]!.value = String(x))) });
        row.append(el('span', { className: 'label' }, label), grid);
        break;
      }
      case 'curve': {
        if (key !== curveKeys[0]) continue; // rendered with the first curve param's group
        let active = key;
        const host = el('div', { className: 'curve-host' });
        const editor = renderCurveEditor(host, values[key] as [number, number][], label, (points) => {
          values[active] = points;
          emit();
        });
        const tabs = el('div', { className: 'curve-tabs' });
        const buttons = curveKeys.map((k) => {
          const b = el('button', { type: 'button', textContent: schema[k]!.label ?? k });
          b.dataset.curveTab = k;
          b.addEventListener('click', () => {
            active = k;
            for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
            editor.set(values[k] as [number, number][]);
          });
          return b;
        });
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0)));
        tabs.append(...buttons);
        for (const k of curveKeys) widgets.set(k, { write: () => k === active && editor.set(values[k] as [number, number][]) });
        row.append(curveKeys.length > 1 ? tabs : el('span', { className: 'label' }, label), host);
        break;
      }
      case 'lut': {
        const input = el('input', { type: 'file', name: key, id: `param-${key}`, accept: '.cube,image/png,image/*' });
        const info = el('span', { className: 'lut-info' });
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            values[key] = await readLutFile(file);
            info.classList.remove('error');
            info.textContent = describeLut(values[key] as Lut);
            emit();
          } catch (e) {
            info.classList.add('error');
            info.textContent = `Could not read ${file.name}: ${(e as Error).message}`;
          }
          input.value = ''; // picking the same file again reloads it
        });
        widgets.set(key, { write: (v) => (info.textContent = v === p.default ? 'None (identity)' : describeLut(v as Lut)) });
        row.append(el('label', { htmlFor: input.id }, label), input, info);
        break;
      }
      case 'image': {
        // Produced elsewhere (e.g. by object removal), so only shown, and clearable.
        const info = el('span', { className: 'image-info' });
        const clear = el('button', { type: 'button', textContent: 'Clear' });
        clear.dataset.clear = '';
        clear.addEventListener('click', () => {
          values[key] = p.default;
          widgets.get(key)!.write(p.default);
          emit();
        });
        widgets.set(key, {
          write: (v) => {
            const img = v as LinearImage;
            info.textContent = v === p.default ? 'None' : `${img.width} × ${img.height} px`;
            clear.disabled = v === p.default;
          },
        });
        row.append(el('label', {}, label), info, clear);
        break;
      }
      case 'color': {
        // <input type=color> speaks #rrggbb, i.e. 8-bit sRGB: the param's own encoding.
        const input = el('input', { type: 'color', name: key, id: `param-${key}` });
        const hex = (c: readonly number[]) => `#${c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
        input.addEventListener('input', () => {
          values[key] = [1, 3, 5].map((i) => parseInt(input.value.slice(i, i + 2), 16) / 255);
          emit();
        });
        widgets.set(key, { write: (v) => (input.value = hex(v as readonly number[])) });
        row.append(el('label', { htmlFor: input.id }, label), input);
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
    if (p.group) row.dataset.group = p.group;
    root.append(row);
  }
  addGroupTabs(root, schema);

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
