import { IDENTITY_GEOMETRY, type Geometry } from '@rullino/core';

// The Geometry panel: quarter turns, flips, straighten and reset. Crop and perspective are
// edited on the image (overlay). `get` returns the current geometry, which other editors change too.

const turn = (g: Geometry, by: 90 | 270): Geometry['rotate'] => (((g.rotate + by) % 360) as Geometry['rotate']);

export const ASPECTS = { free: 'Free', original: 'Original', '1:1': '1:1', '4:3': '4:3', '3:2': '3:2', '16:9': '16:9' } as const;
export type Aspect = keyof typeof ASPECTS;

export interface CropControls {
  /** Whether crop editing is active. */
  readonly editing: () => boolean;
  readonly setEditing: (on: boolean) => void;
  readonly setAspect: (aspect: Aspect) => void;
}

export function renderGeometryControls(
  root: HTMLElement,
  get: () => Geometry,
  onChange: (g: Geometry, dragging?: boolean) => void,
  crop: CropControls,
): { refresh(): void } {
  const button = (text: string, action: string, title: string, next: () => Geometry) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, title });
    b.dataset.action = action;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => onChange(next()));
    return b;
  };
  const row = document.createElement('div');
  row.className = 'geometry-buttons';
  row.append(
    button('⟲', 'rotate-left', 'Rotate left', () => ({ ...get(), rotate: turn(get(), 270) })),
    button('⟳', 'rotate-right', 'Rotate right', () => ({ ...get(), rotate: turn(get(), 90) })),
    button('⇋', 'flip-h', 'Flip horizontally', () => ({ ...get(), flipH: !get().flipH })),
    button('⇵', 'flip-v', 'Flip vertically', () => ({ ...get(), flipV: !get().flipV })),
    button('Reset', 'geometry-reset', 'Reset geometry', () => IDENTITY_GEOMETRY),
  );
  const label = Object.assign(document.createElement('label'), { className: 'mask-slider' });
  const straighten = Object.assign(document.createElement('input'), { type: 'range', min: '-45', max: '45', step: '0.1', value: '0' });
  straighten.dataset.action = 'straighten';
  const out = document.createElement('output');
  straighten.addEventListener('input', () => {
    out.textContent = `${Number(straighten.value).toFixed(1)}°`;
    onChange({ ...get(), straighten: Number(straighten.value) }, true);
  });
  straighten.addEventListener('dblclick', () => onChange({ ...get(), straighten: 0 }));
  label.append('Straighten', straighten, out);

  const cropRow = document.createElement('div');
  cropRow.className = 'geometry-buttons';
  const aspect = Object.assign(document.createElement('select'), { title: 'Crop aspect ratio' });
  aspect.dataset.action = 'crop-aspect';
  for (const [value, text] of Object.entries(ASPECTS)) aspect.append(new Option(text, value));
  aspect.addEventListener('change', () => crop.setAspect(aspect.value as Aspect));
  const cropButton = Object.assign(document.createElement('button'), { type: 'button' });
  cropButton.addEventListener('click', () => {
    crop.setEditing(!crop.editing());
    refresh();
  });
  cropRow.append(cropButton, aspect);
  root.replaceChildren(row, label, cropRow);

  const refresh = () => {
    straighten.value = String(get().straighten);
    out.textContent = `${get().straighten.toFixed(1)}°`;
    const editing = crop.editing();
    cropButton.textContent = editing ? 'Done' : 'Crop…';
    cropButton.dataset.action = editing ? 'crop-done' : 'crop-mode';
    cropButton.classList.toggle('primary', editing);
  };
  refresh();
  return { refresh };
}
