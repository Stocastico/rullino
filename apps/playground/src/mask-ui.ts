import type { Mask } from '@rullino/core';

// Mask controls of a chain step: kind, invert, opacity, and the shape's own settings. Positions
// are edited on the image (overlay); here only what has no natural on-image handle.

export const DEFAULT_MASKS = {
  linear: { kind: 'linear', from: [0.5, 0.25], to: [0.5, 0.75] },
  radial: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.3], feather: 0.5 },
} as const satisfies Record<string, Mask>;

const KINDS = { none: 'No mask', linear: 'Linear gradient', radial: 'Radial gradient' } as const;

function slider(label: string, action: string, value: number, onInput: (v: number) => void) {
  const row = document.createElement('label');
  row.className = 'mask-slider';
  const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
  input.dataset.action = action;
  const out = document.createElement('output');
  out.textContent = value.toFixed(2);
  input.addEventListener('input', () => {
    out.textContent = Number(input.value).toFixed(2);
    onInput(Number(input.value));
  });
  row.append(label, input, out);
  return row;
}

/** `get` returns the current mask (it may also change elsewhere, e.g. by dragging on the image). */
export function renderMaskControls(root: HTMLElement, get: () => Mask | undefined, onChange: (mask: Mask | undefined) => void): void {
  const draw = () => {
    const mask = get();
    root.replaceChildren();
    const kind = Object.assign(document.createElement('select'), { title: 'Mask' });
    kind.dataset.action = 'mask-kind';
    for (const [value, text] of Object.entries(KINDS)) kind.append(new Option(text, value));
    kind.value = mask?.kind ?? 'none';
    kind.addEventListener('change', () => {
      const k = kind.value as keyof typeof KINDS;
      const m = get();
      // Keep invert / opacity when switching between shapes.
      onChange(k === 'none' ? undefined : { ...DEFAULT_MASKS[k], ...(m?.invert ? { invert: true } : {}), ...(m?.opacity !== undefined ? { opacity: m.opacity } : {}) });
      draw();
    });
    const label = Object.assign(document.createElement('label'), { className: 'mask-kind' });
    label.append('Mask ', kind);
    root.append(label);
    if (!mask) return;

    const invert = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!mask.invert });
    invert.dataset.action = 'mask-invert';
    invert.addEventListener('change', () => onChange({ ...get()!, invert: invert.checked }));
    const invertLabel = document.createElement('label');
    invertLabel.append(invert, ' Invert');
    root.append(invertLabel, slider('Opacity', 'mask-opacity', mask.opacity ?? 1, (v) => onChange({ ...get()!, opacity: v })));
    if (mask.kind === 'radial') root.append(slider('Feather', 'mask-feather', mask.feather, (v) => onChange({ ...(get() as typeof DEFAULT_MASKS.radial), feather: v })));
  };
  draw();
}
