import { createRasterMask, fitWithin, magicWand, refineMask, resampleRaster, type BrushOptions, type LinearImage, type Mask, type RasterMask, type Vec2 } from '@rullino/core';

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

/** Tool settings, shared by every brush mask (tools, not part of the mask). */
export const tools = {
  tool: 'paint' as 'paint' | 'erase' | 'wand',
  radius: 0.04,
  hardness: 0.5,
  tolerance: 0.1,
  contiguous: true,
};
export const brushOptions = (): BrushOptions => ({ radius: tools.radius, hardness: tools.hardness, erase: tools.tool === 'erase' });

/** The original image at a given size (linear, premultiplied), for the wand and edge refinement. */
let maskSource: ((w: number, h: number) => Promise<LinearImage>) | undefined;
export function setMaskSource(source: (w: number, h: number) => Promise<LinearImage>): void {
  maskSource = source;
}

/**
 * The mask with its raster at the current image's brush resolution. A mask outlives image changes
 * (its coordinates are normalised), so its raster may have another image's proportions.
 */
export function fitRaster(mask: RasterMask): RasterMask {
  const [w, h] = fitWithin(imageSize[0], imageSize[1], BRUSH_RASTER_SIDE);
  const raster = resampleRaster(mask.raster, w, h);
  return raster === mask.raster ? mask : { ...mask, raster };
}

/** Wand click at `uv`: adds the similar region to the mask, or removes it. */
export async function wandAt(current: RasterMask, uv: Vec2, subtract: boolean): Promise<Mask | undefined> {
  if (!maskSource) return undefined;
  const mask = fitRaster(current);
  const { width, height } = mask.raster;
  const image = await maskSource(width, height);
  const raster = magicWand(image, uv, { tolerance: tools.tolerance, contiguous: tools.contiguous, softness: 0.25, into: mask.raster, subtract });
  return { ...mask, raster };
}

async function refined(current: RasterMask): Promise<Mask | undefined> {
  if (!maskSource) return undefined;
  const mask = fitRaster(current);
  const { width, height } = mask.raster;
  return { ...mask, raster: refineMask(mask.raster, await maskSource(width, height), { radius: 0.008, epsilon: 1e-3 }) };
}

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
      const button = (text: string, action: string, onClick: () => void) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
        b.dataset.action = action;
        b.addEventListener('click', onClick);
        return b;
      };
      const mode = document.createElement('div');
      mode.className = 'brush-mode';
      for (const [tool, text] of [['paint', 'Paint'], ['erase', 'Erase'], ['wand', 'Wand']] as const) {
        const b = button(text, `tool-${tool}`, () => {
          tools.tool = tool;
          draw();
        });
        b.setAttribute('aria-pressed', String(tools.tool === tool));
        mode.append(b);
      }
      const actions = document.createElement('div');
      actions.className = 'brush-mode';
      actions.append(
        button('Refine edges', 'mask-refine', async () => {
          const next = await refined(get() as RasterMask);
          if (next) onChange(next);
        }),
        button('Clear', 'mask-clear', () => onChange({ ...get()!, ...emptyBrush() })),
      );
      const hint = (text: string) => Object.assign(document.createElement('p'), { className: 'hint', textContent: text });
      root.append(mode);
      if (tools.tool === 'wand') {
        const contiguous = Object.assign(document.createElement('input'), { type: 'checkbox', checked: tools.contiguous });
        contiguous.addEventListener('change', () => (tools.contiguous = contiguous.checked));
        const contiguousLabel = document.createElement('label');
        contiguousLabel.append(contiguous, ' Connected region only');
        root.append(
          slider('Tolerance', 'wand-tolerance', tools.tolerance / 0.5, (v) => (tools.tolerance = v * 0.5)),
          contiguousLabel,
          hint('Click to add similar colours, Alt+click to remove them.'),
        );
      } else {
        root.append(
          slider('Size', 'brush-size', tools.radius / 0.25, (v) => (tools.radius = Math.max(0.002, v * 0.25))),
          slider('Hardness', 'brush-hardness', tools.hardness, (v) => (tools.hardness = v)),
          hint('Paint on the image to choose where this step applies.'),
        );
      }
      root.append(actions);
    }
  };
  draw();
}
