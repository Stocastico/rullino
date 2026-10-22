import { flipGeometry, IDENTITY_GEOMETRY, turnGeometry, type Geometry } from '@rullino/core';

// The Geometry panel: quarter turns, flips, straighten and reset. Crop and perspective are
// edited on the image (overlay). `get` returns the current geometry, which other editors change too.

export const ASPECTS = { free: 'Free', original: 'Original', '1:1': '1:1', '4:3': '4:3', '3:2': '3:2', '16:9': '16:9' } as const;
export type Aspect = keyof typeof ASPECTS;

/** What is being edited on the image. */
export type EditMode = 'none' | 'crop' | 'perspective';

export interface EditControls {
  readonly mode: () => EditMode;
  readonly setMode: (mode: EditMode) => void;
  readonly setAspect: (aspect: Aspect) => void;
}

export function renderGeometryControls(
  root: HTMLElement,
  get: () => Geometry,
  onChange: (g: Geometry, dragging?: boolean) => void,
  edit: EditControls,
): { refresh(): void } {
  const button = (text: string, action: string, title: string, next: () => Geometry) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, title });
    b.dataset.action = action;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => {
      onChange(next());
      refresh();
    });
    return b;
  };
  const row = document.createElement('div');
  row.className = 'geometry-buttons';
  row.append(
    // Turns and flips act on what is shown: crop, perspective and straighten follow the content.
    button('⟲', 'rotate-left', 'Rotate left', () => turnGeometry(get(), 'ccw')),
    button('⟳', 'rotate-right', 'Rotate right', () => turnGeometry(get(), 'cw')),
    button('⇋', 'flip-h', 'Flip horizontally', () => flipGeometry(get(), 'h')),
    button('⇵', 'flip-v', 'Flip vertically', () => flipGeometry(get(), 'v')),
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
  aspect.addEventListener('change', () => edit.setAspect(aspect.value as Aspect));
  const modeButton = (mode: Exclude<EditMode, 'none'>) => {
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    b.addEventListener('click', () => {
      edit.setMode(edit.mode() === mode ? 'none' : mode);
      refresh();
    });
    return b;
  };
  const cropButton = modeButton('crop');
  const perspectiveButton = modeButton('perspective');
  cropRow.append(cropButton, aspect, perspectiveButton);
  root.replaceChildren(row, label, cropRow);

  function refresh() {
    straighten.value = String(get().straighten);
    out.textContent = `${get().straighten.toFixed(1)}°`;
    const mode = edit.mode();
    for (const [b, m, text] of [[cropButton, 'crop', 'Crop…'], [perspectiveButton, 'perspective', 'Perspective…']] as const) {
      b.textContent = mode === m ? 'Done' : text;
      b.dataset.action = mode === m ? `${m}-done` : `${m}-mode`;
      b.classList.toggle('primary', mode === m);
      b.disabled = mode !== 'none' && mode !== m;
    }
  }
  refresh();
  return { refresh };
}
