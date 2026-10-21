import { createRasterMask, fitWithin, type Mask } from '@rullino/core';

// Mask controls of a chain step: kind, invert, opacity, and the shape's own settings. Positions
// are edited on the image (overlay); here only what has no natural on-image handle.

export const DEFAULT_MASKS = {
  linear: { kind: 'linear', from: [0.5, 0.25], to: [0.5, 0.75] },
  radial: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.3], feather: 0.5 },
} as const satisfies Record<string, Mask>;

const KINDS = { none: 'No mask', linear: 'Linear gradient', radial: 'Radial gradient', brush: 'Brush' } as const;

/** Brush masks get the image's proportions (so dabs stay round) at up to this many pixels. */
const BRUSH_RASTER_SIDE = 1024;
let imageSize: [number, number] = [1, 1];
/** Tells new brush masks the current image's size. */
export function setImageSize(w: number, h: number): void {
  imageSize = [w, h];
}
const emptyBrush = (): Mask => ({ kind: 'raster', raster: createRasterMask(...fitWithin(imageSize[0], imageSize[1], BRUSH_RASTER_SIDE)) });

/** Brush tool settings, shared by every brush mask (a tool, not part of the mask). */
export const brush = { radius: 0.04, hardness: 0.5, erase: false };

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
    kind.value = mask ? (mask.kind === 'raster' ? 'brush' : mask.kind) : 'none';
    kind.addEventListener('change', () => {
      const k = kind.value as keyof typeof KINDS;
      const m = get();
      // Keep invert / opacity when switching between shapes.
      const shape = k === 'none' ? undefined : k === 'brush' ? emptyBrush() : DEFAULT_MASKS[k];
      onChange(shape && { ...shape, ...(m?.invert ? { invert: true } : {}), ...(m?.opacity !== undefined ? { opacity: m.opacity } : {}) });
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
    if (mask.kind === 'raster') {
      const mode = document.createElement('div');
      mode.className = 'brush-mode';
      for (const [erase, text] of [[false, 'Paint'], [true, 'Erase']] as const) {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
        b.dataset.action = erase ? 'brush-erase' : 'brush-paint';
        b.setAttribute('aria-pressed', String(brush.erase === erase));
        b.addEventListener('click', () => {
          brush.erase = erase;
          draw();
        });
        mode.append(b);
      }
      const clear = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Clear' });
      clear.dataset.action = 'mask-clear';
      clear.addEventListener('click', () => onChange({ ...get()!, ...emptyBrush() }));
      mode.append(clear);
      root.append(
        mode,
        slider('Size', 'brush-size', brush.radius / 0.25, (v) => (brush.radius = Math.max(0.002, v * 0.25))),
        slider('Hardness', 'brush-hardness', brush.hardness, (v) => (brush.hardness = v)),
        Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Paint on the image to choose where this step applies.' }),
      );
    }
  };
  draw();
}
