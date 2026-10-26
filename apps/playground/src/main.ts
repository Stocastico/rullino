import {
  activeSteps,
  createGpuContext,
  decodeSrgb8,
  applyGeometry,
  applyGeometryCpu,
  downscale,
  downscaleCpu,
  encodeImage,
  encodeSrgb8,
  exportImage,
  fitWithin,
  geometryFrame,
  histogramSrgb8,
  IDENTITY_GEOMETRY,
  defaultParams,
  parseChain,
  serializeChain,
  isIdentityGeometry,
  importImage,
  readImage,
  releaseTexture,
  Pipeline,
  readSrgb8,
  runChainCpu,
  sampleImage,
  type ExportOptions,
  type Geometry,
  type Vec2,
  type GpuContext,
  type LinearImage,
  type Mask,
  type RasterMask,
  type Step,
} from '@rullino/core';
import { autoAdjust, filters } from '@rullino/filters';
import { growMask, type OrtModule, type SamPoint } from '@rullino/ml';
import { lookLut, looks, lookSteps } from '@rullino/presets';
import { createEffectBrowser } from './effect-browser';
import { createFilmStrip } from './film-strip';
import { effectiveMask, newStep, renderChain, SELECTION, withMask, withSelection, type ChainState } from './chain-ui';
import { createCropOverlay, fitAspect } from './crop-overlay';
import { renderGeometryControls, type Aspect, type EditMode } from './geometry-ui';
import { createPerspectiveOverlay, UNIT_QUAD } from './perspective-overlay';
import { drawHistogram } from './histogram-view';
import { createMaskOverlay } from './mask-overlay';
import { brushOptions, brushSize, fitRaster, setImageSize, setMaskSource, tools, wandAt } from './mask-ui';
import { samples } from './samples';
import { History } from './history';
import { decodeState, encodeState } from './share';
import { attachZoom, FIT, updateHandleScale } from './zoom';
import { createDepthMapper } from './depth-estimate';
import { createObjectRemover, REMOVE_GROW } from './object-remove';
import { createObjectSelector, isSoftwareAdapter } from './object-select';

/** Display resolution: the after/before canvases. Export re-runs the chain at full resolution. */
const DISPLAY_SIDE = 2048;
/** Resolution used while a slider is being dragged. */
const PREVIEW_SIDE = 768;
/** The CPU fallback works at a smaller size to stay usable. */
const CPU_SIDE = 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>('status'),
  announce: $<HTMLParagraphElement>('announce'),
  sample: $<HTMLSelectElement>('sample'),
  file: $<HTMLInputElement>('file'),
  chain: $<HTMLDivElement>('chain'),
  compare: $<HTMLInputElement>('compare'),
  split: $<HTMLInputElement>('split'),
  stage: $<HTMLElement>('stage'),
  before: $<HTMLCanvasElement>('before'),
  after: $<HTMLCanvasElement>('after'),
  overlay: document.getElementById('overlay') as unknown as SVGSVGElement,
  histogram: $<HTMLCanvasElement>('histogram'),
  geometry: $<HTMLDivElement>('geometry'),
  geometryOverlay: document.getElementById('geometry-overlay') as unknown as SVGSVGElement,
  exportFormat: $<HTMLSelectElement>('export-format'),
  exportQuality: $<HTMLInputElement>('export-quality'),
  exportSize: $<HTMLInputElement>('export-size'),
  exportButton: $<HTMLButtonElement>('export'),
  undo: $<HTMLButtonElement>('undo'),
  redo: $<HTMLButtonElement>('redo'),
  share: $<HTMLButtonElement>('share'),
  auto: $<HTMLButtonElement>('auto'),
  looks: $<HTMLDivElement>('looks'),
  viewport: $<HTMLElement>('viewport'),
  zoomIn: $<HTMLButtonElement>('zoom-in'),
  zoomOut: $<HTMLButtonElement>('zoom-out'),
  zoomFit: $<HTMLButtonElement>('zoom-fit'),
};
const beforeCtx = ui.before.getContext('2d')!;

/**
 * Shows a message in the status line and announces it to screen readers. Per-frame timings go to
 * the status line only: a live region updated on every frame would talk constantly.
 */
function announce(message: string): void {
  ui.status.textContent = message;
  ui.announce.textContent = message;
}

/** A spinner over the image while work takes longer than a moment (first shader compiles take seconds). */
let pending = 0;
let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
async function busyWhile<T>(work: Promise<T>): Promise<T> {
  if (pending++ === 0) spinnerTimer = setTimeout(() => ui.stage.classList.add('busy'), 300);
  try {
    return await work;
  } finally {
    if (--pending === 0) {
      clearTimeout(spinnerTimer);
      ui.stage.classList.remove('busy');
    }
  }
}
const afterCtx = ui.after.getContext('2d')!;

const byId = new Map(filters.map((f) => [f.id, f]));
const exposure = byId.get('exposure')!;
let chain: ChainState = (() => {
  const first = newStep(exposure);
  return { steps: [first], selected: first.uid };
})();

/** The steps as the pipeline runs them. With `upTo`, the steps after that one are switched off (the strip's "show up to here"). */
const toSteps = (s: ChainState, upTo?: string): Step[] => {
  const cut = upTo ? s.steps.findIndex((st) => st.uid === upTo) : -1;
  return s.steps.map((st, i) => {
    const mask = effectiveMask(s, st);
    return { filter: byId.get(st.filterId)!, params: st.params, enabled: st.enabled && (cut < 0 || i <= cut), ...(mask ? { mask } : {}) };
  });
};
/** View only: the photo is shown up to this step. Not part of the chain, history or share links. */
let soloUid: string | undefined;

/** Size of the after canvas for the current image; applied when a frame is ready, not on load. */
let displaySize: [number, number] = [0, 0];

/** Draws straight-alpha sRGB bytes onto the after canvas, scaling up if they are a preview. */
async function present(bytes: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
  drawHistogram(ui.histogram, histogramSrgb8(bytes));
  const data = new ImageData(bytes, w, h);
  // Resizing clears a canvas, so it happens here, together with the new frame: the previous
  // image stays visible while a new one is loading.
  if (ui.after.width !== displaySize[0] || ui.after.height !== displaySize[1]) [ui.after.width, ui.after.height] = displaySize;
  afterCtx.clearRect(0, 0, ui.after.width, ui.after.height);
  if (w === ui.after.width && h === ui.after.height) afterCtx.putImageData(data, 0, 0);
  else {
    const bitmap = await createImageBitmap(data);
    afterCtx.drawImage(bitmap, 0, 0, ui.after.width, ui.after.height);
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Two back ends behind one interface: WebGPU, or the CPU reference implementations as fallback.

interface Renderer {
  readonly name: string;
  /** Loads an image framed by `geometry`; returns the (framed) display size. */
  load(image: ImageBitmap, geometry: Geometry): Promise<[number, number]>;
  /**
   * Reframes the loaded image; returns the new display size. `previewOnly` (while dragging)
   * reframes just the reduced preview; a later full call brings the display image up to date.
   */
  setGeometry(geometry: Geometry, previewOnly?: boolean): Promise<[number, number]>;
  render(steps: Step[], preview: boolean): Promise<void>;
  /**
   * Runs the chain at the largest resolution available and encodes the result, shrunk (in linear
   * light) so its long side is at most `longSide` if given. Never enlarges.
   */
  export(steps: Step[], options: ExportOptions, longSide: number | undefined, geometry: Geometry): Promise<Blob>;
  /** The original image at w x h on the CPU, for mask tools (wand, edge refinement). */
  maskSource(w: number, h: number): Promise<LinearImage>;
  /** Each chain applied to the framed image shrunk to `maxSide` (the look gallery). */
  thumbnails(chains: readonly (readonly Step[])[], maxSide: number): Promise<ImageData[]>;
}

// Output goes through readback + putImageData on a 2D canvas rather than a WebGPU canvas:
// configuring a WebGPU canvas loses the device in headless Chromium/SwiftShader (CI, cloud
// sessions), so direct presentation could not be tested.
function gpuRenderer(gpu: GpuContext): Renderer {
  const full = new Pipeline(gpu);
  const small = new Pipeline(gpu);
  const thumbs = new Pipeline(gpu);
  let textures: GPUTexture[] = [];
  let raw: { fullRes: GPUTexture; display: GPUTexture; preview: GPUTexture; fullScale: number; displayScale: number; previewScale: number } | undefined;
  let geometry: Geometry = IDENTITY_GEOMETRY;
  /** Geometry-applied display and preview textures (the raw ones when the geometry is the identity). */
  let framedDisplay: GPUTexture | undefined;
  let framedPreview: GPUTexture | undefined;
  // The framed textures this renderer made (geometry applied) and so must give back to the pool.
  // The raw ones are not: `load` destroys them. Judging by "is it the current raw texture" got this
  // wrong when a new image replaced `raw` first: the previous image's raw textures looked owned, went
  // into the pool, were destroyed by `load`, and the pool then handed out destroyed textures.
  const framed = new Set<GPUTexture>();
  const owned = (t: GPUTexture | undefined) => t !== undefined && framed.has(t);
  const giveBack = (t: GPUTexture) => {
    framed.delete(t);
    releaseTexture(gpu, t);
  };
  let displayTex: GPUTexture | undefined;
  const maskSources = new Map<string, Promise<LinearImage>>();
  const reframe = (t: GPUTexture) => {
    if (isIdentityGeometry(geometry)) return t;
    const out = applyGeometry(gpu, t, geometry);
    framed.add(out);
    return out;
  };

  /** Applies the geometry to the display and preview images and makes them the pipelines' sources. */
  async function frame(g: Geometry, previewOnly = false): Promise<[number, number]> {
    if (!raw) throw new Error('no image loaded');
    geometry = g;
    if (previewOnly && raw.preview !== raw.display) {
      // While dragging only the preview is shown: skip the display-size resample and readback.
      const preview = reframe(raw.preview);
      small.setSource(preview, { scale: raw.previewScale });
      if (owned(framedPreview) && framedPreview !== framedDisplay) giveBack(framedPreview!);
      framedPreview = preview;
      const f = geometryFrame(g, raw.display.width, raw.display.height);
      return [f.width, f.height];
    }
    const display = reframe(raw.display);
    const preview = raw.preview === raw.display ? display : reframe(raw.preview);
    full.setSource(display, { scale: raw.displayScale });
    small.setSource(preview, { scale: raw.previewScale });
    for (const t of new Set([framedDisplay, framedPreview])) if (owned(t)) giveBack(t!);
    framedDisplay = display;
    framedPreview = preview;
    displayTex = display;
    maskSources.clear();
    ui.before.width = display.width;
    ui.before.height = display.height;
    beforeCtx.putImageData(new ImageData(await readSrgb8(gpu, display), display.width, display.height), 0, 0);
    return [display.width, display.height];
  }

  return {
    name: 'WebGPU',
    async load(image, g) {
      // Beyond the device's texture limit the browser has to shrink it first (in sRGB, unavoidably).
      const limit = gpu.device.limits.maxTextureDimension2D;
      let fitted = image;
      if (Math.max(image.width, image.height) > limit) {
        const [w, h] = fitWithin(image.width, image.height, limit);
        fitted = await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      }
      const fullRes = importImage(gpu, fitted);
      if (fitted !== image) fitted.close();
      // Shrinking happens on the GPU in linear light, unlike a canvas or createImageBitmap resize.
      const [dw, dh] = fitWithin(fullRes.width, fullRes.height, DISPLAY_SIDE);
      const display = dw < fullRes.width ? downscale(gpu, fullRes, dw, dh) : fullRes;
      const [pw, ph] = fitWithin(fullRes.width, fullRes.height, PREVIEW_SIDE);
      const preview = pw < dw ? downscale(gpu, display, pw, ph) : display;
      const previous = textures;
      textures = [...new Set([fullRes, display, preview])];
      // Pixel-unit params (blur radii...) are defined at the original resolution.
      raw = { fullRes, display, preview, fullScale: fullRes.width / image.width, displayScale: dw / image.width, previewScale: pw / image.width };
      const size = await frame(g);
      // Only now are the previous textures unreferenced (destruction waits for queued GPU work).
      for (const t of previous) t.destroy();
      return size;
    },
    setGeometry: (g, previewOnly) => frame(g, previewOnly),
    async render(steps, preview) {
      const out = (preview ? small : full).run(steps);
      await present(await readSrgb8(gpu, out), out.width, out.height);
    },
    maskSource(w, h) {
      const key = `${w}x${h}`;
      let p = maskSources.get(key);
      if (!p) {
        const src = displayTex;
        if (!src) return Promise.reject(new Error('no image loaded'));
        // Shrunk in linear light on the GPU, then read back once per image and size.
        const small = w === src.width && h === src.height ? src : downscale(gpu, src, w, h);
        p = readImage(gpu, small).finally(() => small !== src && releaseTexture(gpu, small));
        maskSources.set(key, p);
      }
      return p;
    },
    async thumbnails(chains, maxSide) {
      const src = displayTex;
      if (!src || !raw) throw new Error('no image loaded');
      const [w, h] = fitWithin(src.width, src.height, maxSide);
      const tiny = downscale(gpu, src, w, h);
      try {
        thumbs.setSource(tiny, { scale: (raw.displayScale * w) / src.width });
        const out: ImageData[] = [];
        for (const steps of chains) {
          const t = thumbs.run(steps);
          out.push(new ImageData(await readSrgb8(gpu, t), t.width, t.height));
        }
        return out;
      } finally {
        releaseTexture(gpu, tiny);
      }
    },
    async export(steps, options, longSide, g) {
      if (!raw) throw new Error('no image loaded');
      // A throwaway Pipeline: full-resolution intermediates are freed as soon as the file is encoded.
      // The geometry is the committed one, not the one shown (which drops the crop while editing it).
      const pipeline = new Pipeline(gpu);
      const source = isIdentityGeometry(g) ? raw.fullRes : applyGeometry(gpu, raw.fullRes, g);
      try {
        pipeline.setSource(source, { scale: raw.fullScale });
        const out = pipeline.run(steps);
        const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
        if (w === out.width) return await exportImage(gpu, out, options);
        const small = downscale(gpu, out, w, h);
        try {
          return await exportImage(gpu, small, options);
        } finally {
          releaseTexture(gpu, small);
        }
      } finally {
        pipeline.destroy();
        if (source !== raw.fullRes) releaseTexture(gpu, source);
      }
    },
  };
}

function cpuRenderer(): Renderer {
  let raw: LinearImage | undefined;
  let source: LinearImage | undefined;
  let scale = 1;
  const frame = async (g: Geometry): Promise<[number, number]> => {
    if (!raw) throw new Error('no image loaded');
    source = isIdentityGeometry(g) ? raw : applyGeometryCpu(raw, g);
    ui.before.width = source.width;
    ui.before.height = source.height;
    beforeCtx.putImageData(new ImageData(encodeSrgb8(source) as Uint8ClampedArray<ArrayBuffer>, source.width, source.height), 0, 0);
    return [source.width, source.height];
  };
  return {
    name: 'CPU reference',
    async load(image, g) {
      // Canvas resize happens in sRGB; acceptable for the fallback path.
      const [w, h] = fitWithin(image.width, image.height, CPU_SIDE);
      const tmp = new OffscreenCanvas(w, h).getContext('2d')!;
      tmp.drawImage(image, 0, 0, w, h);
      raw = decodeSrgb8(tmp.getImageData(0, 0, w, h).data, w, h);
      scale = w / image.width;
      return frame(g);
    },
    setGeometry: frame,
    async render(steps) {
      if (!source) return;
      const out = runChainCpu(steps, source, { scale });
      await present(encodeSrgb8(out) as Uint8ClampedArray<ArrayBuffer>, out.width, out.height);
    },
    async maskSource(w, h) {
      if (!source) throw new Error('no image loaded');
      return w === source.width && h === source.height ? source : downscaleCpu(source, w, h);
    },
    async thumbnails(chains, maxSide) {
      if (!source) throw new Error('no image loaded');
      const [w, h] = fitWithin(source.width, source.height, maxSide);
      const tiny = downscaleCpu(source, w, h);
      return chains.map((steps) => new ImageData(encodeSrgb8(runChainCpu(steps, tiny, { scale: (scale * w) / source!.width })) as Uint8ClampedArray<ArrayBuffer>, w, h));
    },
    async export(steps, options, longSide, g) {
      if (!raw) throw new Error('no image loaded');
      // The CPU fallback only ever has the reduced image.
      const out = runChainCpu(steps, isIdentityGeometry(g) ? raw : applyGeometryCpu(raw, g), { scale });
      const [w, h] = longSide ? fitWithin(out.width, out.height, longSide) : [out.width, out.height];
      return encodeImage(w === out.width ? out : downscaleCpu(out, w, h), options);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering: at most one frame in flight; changes made meanwhile collapse into the next frame.
// While a control is being dragged, frames use the reduced-resolution pipeline.

let renderer: Renderer;
/** The GPU context in use, if any; device loss restarts it. */
let gpuContext: GpuContext | undefined;
/** The current image's source, to upload it again after a device loss. */
let lastSource: ImageBitmapSource | undefined;
let imageInfo = '';
let imageName = 'image';
/** The sample shown, or undefined for the user's own image (share links name samples only). */
let imageSample: string | undefined;
let loaded = false;
let dragging = false;
let busy = false;
let dirty = false;
let frames = 0;

async function render() {
  if (!loaded) return;
  recordHistory();
  if (busy) return void (dirty = true);
  busy = true;
  do {
    dirty = false;
    const preview = dragging;
    const t0 = performance.now();
    try {
      const steps = toSteps(chain, soloUid);
      await busyWhile(renderer.render(steps, preview));
      const n = activeSteps(steps).length;
      ui.status.textContent = `${renderer.name} · ${imageInfo} · ${n} step${n === 1 ? '' : 's'}${soloUid ? ' · up to one step' : ''}${preview ? ' · preview' : ''} · ${(performance.now() - t0).toFixed(1)} ms`;
    } catch (e) {
      announce(`Render failed: ${(e as Error).message}`);
      console.error(e);
    }
  } while (dirty);
  busy = false;
  ui.status.dataset.frame = String(++frames); // lets the e2e smoke test wait for a finished frame
  if (!dragging) refreshStrip();
}

// Loads run one at a time (overlapping loads would destroy each other's textures), and a load
// that has been superseded while it was queued is skipped.
let loads: Promise<void> = Promise.resolve();
let latestLoad = 0;

let geometry: Geometry = IDENTITY_GEOMETRY;
let geometryQueued = false;
/** The display image lags behind the geometry (it was reframed for the preview only). */
let displayStale = false;
/**
 * While the crop is edited the frame is shown uncropped; while the perspective is edited, the
 * oriented image is shown without perspective, straighten or crop. Changes apply on Done.
 */
let editMode: EditMode = 'none';
let cropAspect: Aspect = 'free';
const FULL_CROP: Geometry['crop'] = { x: 0, y: 0, width: 1, height: 1 };
const shownGeometry = (): Geometry => {
  if (editMode === 'crop') return { ...geometry, crop: FULL_CROP };
  if (editMode === 'perspective') {
    const { perspective: _, ...rest } = geometry;
    return { ...rest, straighten: 0, crop: FULL_CROP };
  }
  return geometry;
};
const aspectRatio = (): number | undefined => {
  if (cropAspect === 'free') return undefined;
  if (cropAspect === 'original') return displaySize[0] / displaySize[1];
  const [a, b] = cropAspect.split(':').map(Number);
  return a! / b!;
};
const cropOverlay = createCropOverlay(ui.geometryOverlay, (crop) => (geometry = { ...geometry, crop }));
const perspectiveOverlay = createPerspectiveOverlay(ui.geometryOverlay, (quad) => (geometry = { ...geometry, perspective: quad }));
const showCrop = () => {
  ui.stage.classList.toggle('cropping', editMode !== 'none');
  ui.geometryOverlay.style.pointerEvents = editMode !== 'none' ? 'auto' : 'none';
  if (editMode === 'crop') cropOverlay.show(geometry.crop, displaySize[0], displaySize[1], aspectRatio());
  else if (editMode === 'perspective') perspectiveOverlay.show(geometry.perspective ?? UNIT_QUAD, displaySize[0], displaySize[1]);
  else cropOverlay.hide();
};

/** Reframes the image. Changes made while one is queued collapse into it (latest geometry wins). */
function setGeometry(g: Geometry): void {
  geometry = g;
  if (geometryQueued) return;
  geometryQueued = true;
  loads = loads.then(async () => {
    geometryQueued = false;
    if (!loaded) return;
    try {
      const previewOnly = dragging;
      const [w, h] = await renderer.setGeometry(shownGeometry(), previewOnly);
      displayStale = previewOnly;
      if (!previewOnly) refreshThumbnails();
      displaySize = [w, h];
      setImageSize(w, h);
      showOverlay();
      showCrop();
    } catch (e) {
      announce(`Geometry failed: ${(e as Error).message}`);
      console.error(e);
    }
  });
  void loads.then(render);
}

const geometryControls = renderGeometryControls(
  ui.geometry,
  () => geometry,
  (g, drag) => {
    if (drag) dragging = true;
    setGeometry(g);
  },
  {
    mode: () => editMode,
    setMode(mode) {
      editMode = mode;
      setGeometry(geometry);
    },
    setAspect(aspect) {
      cropAspect = aspect;
      const ratio = aspectRatio();
      if (ratio !== undefined && editMode === 'crop') geometry = { ...geometry, crop: fitAspect(geometry.crop, displaySize[0], displaySize[1], ratio) };
      showCrop();
    },
  },
);
ui.geometry.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).matches('input[type=range]')) dragging = true;
});

function loadImage(pending: ImageBitmapSource | Promise<ImageBitmapSource>, name: string, sample?: string): Promise<void> {
  const id = ++latestLoad;
  // A superseded load never awaits its source: keep a failed fetch from being an unhandled rejection.
  Promise.resolve(pending).catch(() => undefined);
  loads = loads.then(async () => {
    if (id !== latestLoad) return;
    try {
      const source = await pending;
      const image = await createImageBitmap(source);
      // A new image starts unframed, as in photo editors.
      geometry = IDENTITY_GEOMETRY;
      editMode = 'none';
      zoom.set(FIT);
      geometryControls.refresh();
      const [w, h] = await busyWhile(renderer.load(image, geometry));
      displaySize = [w, h];
      setImageSize(w, h);
      showOverlay();
      showCrop();
      imageName = name.replace(/\.[^.]+$/, '') || 'image';
      imageSample = sample;
      imageInfo = `${name} ${image.width}×${image.height}${w < image.width ? ` → ${w}×${h}` : ''}`;
      image.close();
      lastSource = source;
      loaded = true;
      refreshThumbnails();
      ui.announce.textContent = `Loaded ${imageInfo}`;
    } catch (e) {
      announce(`Could not load ${name}: ${(e as Error).message}`);
      console.error(e);
    }
  });
  return loads.then(render);
}

const EXPORTS: Record<string, { options: ExportOptions; ext: string }> = {
  png: { options: { format: 'png' }, ext: 'png' },
  png16: { options: { format: 'png', bitDepth: 16 }, ext: 'png' },
  jpeg: { options: { format: 'jpeg' }, ext: 'jpg' },
  webp: { options: { format: 'webp' }, ext: 'webp' },
};

// Exports wait for any queued load, so the textures they read are not destroyed underneath them.
function exportFile(): Promise<void> {
  const { options, ext } = EXPORTS[ui.exportFormat.value]!;
  const steps = toSteps(chain);
  const quality = Number(ui.exportQuality.value);
  ui.exportButton.disabled = true;
  const done = loads.then(async () => {
    const t0 = performance.now();
    try {
      const longSide = Number(ui.exportSize.value) || undefined;
      const blob = await busyWhile(renderer.export(steps, { ...options, quality }, longSide, geometry));
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${imageName}-rullino.${ext}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      announce(`Exported ${a.download} (${(blob.size / 1024).toFixed(0)} KB) in ${(performance.now() - t0).toFixed(0)} ms`);
    } catch (e) {
      announce(`Export failed: ${(e as Error).message}`);
      console.error(e);
    } finally {
      ui.exportButton.disabled = false;
    }
  });
  loads = done;
  return done;
}

// ---------------------------------------------------------------------------------------------
// UI wiring.

ui.exportButton.addEventListener('click', () => void exportFile());
ui.exportFormat.addEventListener('change', () => (ui.exportQuality.disabled = !['jpeg', 'webp'].includes(ui.exportFormat.value)));
ui.exportQuality.disabled = true;

/** The mask edited under `uid`: a step's own, or the selection (uid = SELECTION). */
const maskOf = (uid: string | undefined) => (uid === SELECTION ? chain.selection : chain.steps.find((s) => s.uid === uid)?.mask);
/** The chain with the mask under `uid` replaced. */
const withMaskOf = (uid: string | undefined, mask: Mask | undefined): ChainState =>
  uid === SELECTION ? withSelection(chain, mask) : { ...chain, steps: chain.steps.map((s) => (s.uid === uid ? withMask(s, mask) : s)) };
/** What the image overlay edits: the selection, or the selected step's own mask (none while the step uses the selection). */
const selectedMask = () => (chain.selected === SELECTION ? chain.selection : chain.steps.find((s) => s.uid === chain.selected && !s.useSelection)?.mask);
const overlay = createMaskOverlay(
  ui.overlay,
  (mask) => {
    chain = withMaskOf(chain.selected, mask);
    chainUi.set(chain, false);
    void render();
  },
  () => (dragging = true),
  { tool: () => tools.tool, brush: brushOptions, wand: wandClick, object: objectClick, fit: fitRaster },
);
const showOverlay = () => overlay.show(selectedMask(), displaySize[0], displaySize[1]);

/**
 * Wand clicks run one after another, each from the step's current mask (two quick clicks used to
 * start from the same mask, the second overwriting the first), and the result goes to the step
 * that was selected when clicking, even if the selection changed meanwhile.
 */
let wandQueue: Promise<void> = Promise.resolve();
function wandClick(uv: Vec2, subtract: boolean): void {
  const uid = chain.selected;
  wandQueue = wandQueue.then(async () => {
    const mask = maskOf(uid);
    if (mask?.kind !== 'raster') return;
    const next = await wandAt(mask, uv, subtract).catch((e: Error) => {
      announce(`Wand failed: ${e.message}`);
      return undefined;
    });
    if (!next) return;
    chain = withMaskOf(uid, next);
    chainUi.set(chain, false);
    showOverlay();
    void render();
  });
}
// After any queued load, so the textures it reads are the current image's.
const maskSourceImage = (w: number, h: number) => loads.then(() => renderer.maskSource(w, h));
setMaskSource(maskSourceImage);

// ONNX Runtime is its own chunk, loaded on first use; Vite ships its WASM file next to it (same
// origin, no CDN at run time).
const loadOrt = async () => (await import('onnxruntime-web/webgpu')) as unknown as OrtModule;
const gpuKind = async () => {
  const adapter = gpuContext ? await navigator.gpu?.requestAdapter() : null;
  return adapter ? { software: isSoftwareAdapter(adapter) } : undefined;
};
const objectSelector = createObjectSelector({ loadOrt, gpu: gpuKind, image: maskSourceImage, status: announce });
const objectRemover = createObjectRemover({ loadOrt, gpu: gpuKind, status: announce });
const depthMapper = createDepthMapper({ loadOrt, status: announce });

/** "Estimate depth" on a lens blur step: the depth map of the original image becomes the step's `depth`. Shares the wand's queue. */
function estimateDepth(uid: string): Promise<void> {
  const job = wandQueue.then(async () => {
    if (chain.steps.find((s) => s.uid === uid)?.filterId !== 'lensBlur') return;
    const t0 = performance.now();
    try {
      const image = await maskSourceImage(...brushSize());
      const map = await busyWhile(depthMapper.estimate(image));
      chain = { ...chain, steps: chain.steps.map((s) => (s.uid === uid ? { ...s, params: { ...s.params, depth: map } } : s)) };
      chainUi.set(chain, true);
      void render();
      announce(`Depth estimated (${(performance.now() - t0).toFixed(0)} ms). Use "Pick focus" and click the image.`);
    } catch (e) {
      announce(`Depth estimation failed: ${(e as Error).message}`);
      console.error(e);
    }
  });
  wandQueue = job;
  return job;
}

/** The next click on the image sets the focus of this lens blur step to the depth under the pointer. */
let focusPick: string | undefined;
function pickFocus(uid: string): void {
  focusPick = uid;
  ui.stage.classList.add('picking');
  announce('Click the image where it should be in focus.');
}
ui.stage.addEventListener(
  'pointerdown',
  (e) => {
    if (!focusPick) return;
    e.stopPropagation();
    e.preventDefault();
    const uid = focusPick;
    focusPick = undefined;
    ui.stage.classList.remove('picking');
    const step = chain.steps.find((s) => s.uid === uid);
    const depth = step?.params.depth as LinearImage | undefined;
    if (!step || !depth) return;
    const r = ui.after.getBoundingClientRect();
    const focus = sampleImage(depth, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))[0];
    chain = { ...chain, steps: chain.steps.map((s) => (s.uid === uid ? { ...s, params: { ...s.params, focus: Math.round(focus * 100) / 100 } } : s)) };
    chainUi.set(chain, true);
    void render();
    announce(`Focus set to depth ${focus.toFixed(2)}`);
  },
  { capture: true },
);

/**
 * "Fill with AI" on a patch step: the masked area (grown a little) of the original image is
 * filled by the model and kept as the step's image; the step's mask becomes the grown one so the
 * fill covers the object's edge. Shares the wand's queue.
 */
function fillPatch(uid: string): Promise<void> {
  const job = wandQueue.then(async () => {
    const step = chain.steps.find((s) => s.uid === uid);
    if (step?.mask?.kind !== 'raster') return;
    const mask = fitRaster(step.mask);
    if (!mask.raster.data.some((v) => v > 0.5)) {
      announce('Select what to remove first (brush, wand or Object).');
      return;
    }
    const t0 = performance.now();
    try {
      const grown = { ...mask, raster: growMask(mask.raster, REMOVE_GROW) };
      const image = await maskSourceImage(grown.raster.width, grown.raster.height);
      const patched = await busyWhile(objectRemover.fill(image, grown.raster));
      chain = { ...chain, steps: chain.steps.map((s) => (s.uid === uid ? { ...withMask(s, grown), params: { ...s.params, patch: patched } } : s)) };
      chainUi.set(chain, true);
      showOverlay();
      void render();
      announce(`Area filled (${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (e) {
      announce(`Fill failed: ${(e as Error).message}`);
      console.error(e);
    }
  });
  wandQueue = job;
  return job;
}

/**
 * Object-selection clicks share the wand's queue. The points of one object accumulate (a click
 * refines it, Alt+click excludes); "New object" (or choosing the tool again) starts the next one,
 * on top of the mask as it is then.
 */
let objectSession: { uid: string; id: number; base: RasterMask; points: SamPoint[] } | undefined;
function objectClick(uv: Vec2, subtract: boolean): void {
  const uid = chain.selected;
  wandQueue = wandQueue.then(async () => {
    const mask = maskOf(uid);
    if (mask?.kind !== 'raster' || !uid) return;
    if (!objectSession || objectSession.uid !== uid || objectSession.id !== tools.objectSession) {
      objectSession = { uid, id: tools.objectSession, base: fitRaster(mask), points: [] };
    }
    const session = objectSession;
    session.points.push({ x: uv[0], y: uv[1], positive: !subtract });
    const t0 = performance.now();
    try {
      const raster = await busyWhile(objectSelector.select(session.base.raster, session.points));
      const next = { ...session.base, raster };
      chain = withMaskOf(uid, next);
      chainUi.set(chain, false);
      showOverlay();
      void render();
      announce(`Object selected (${session.points.length} point${session.points.length === 1 ? '' : 's'}, ${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (e) {
      session.points.pop();
      announce(`Object selection failed: ${(e as Error).message}`);
      console.error(e);
    }
  });
}

const chainUi = renderChain(
  ui.chain,
  filters,
  chain,
  (next) => {
    chain = next;
    showOverlay();
    void render();
  },
  { fill: fillPatch, estimateDepth, pickFocus },
);

// The chain as a film strip under the photo; every edit goes through chainUi, which tells the strip.
const strip = createFilmStrip($<HTMLDivElement>('strip'), filters, {
  select: (uid) => chainUi.select(uid),
  toggle: (uid, enabled) => chainUi.toggle(uid, enabled),
  remove: (uid) => {
    if (uid === soloUid) setSolo(undefined);
    chainUi.remove(uid);
  },
  move: (from, to) => chainUi.move(from, to),
  add: () => effectBrowser.open(),
  solo: (uid) => setSolo(uid),
});
chainUi.subscribe((state) => strip.set(state));
function setSolo(uid: string | undefined): void {
  soloUid = uid;
  strip.setSolo(uid);
  void render();
}

const STRIP_SIDE = 160;
let stripQueued = false;
/** Redraws the strip's frames: the picture after each step, through the same thumbnail pipeline as the looks. */
function refreshStrip(): void {
  if (stripQueued) return;
  stripQueued = true;
  loads = loads.then(async () => {
    stripQueued = false;
    if (!loaded) return;
    try {
      const steps = toSteps(chain);
      const images = await renderer.thumbnails([[], ...steps.map((_, i) => steps.slice(0, i + 1))], STRIP_SIDE);
      strip.setThumbnails(images[0], new Map(chain.steps.map((st, i) => [st.uid, images[i + 1]!])));
    } catch (e) {
      console.error(e);
    }
  });
}
ui.chain.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).matches('input[type=range]')) dragging = true;
});
window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  // Full resolution on release; a geometry dragged in preview reframes the display image first.
  if (displayStale) setGeometry(geometry);
  else void render();
});

for (const group of new Set(samples.map((s) => s.group))) {
  const optgroup = Object.assign(document.createElement('optgroup'), { label: group });
  for (const s of samples.filter((s) => s.group === group)) optgroup.append(new Option(s.label, s.id));
  ui.sample.append(optgroup);
}
ui.sample.addEventListener('change', () => {
  const s = samples.find((s) => s.id === ui.sample.value)!;
  void loadImage(s.make(), s.label, s.id);
});

ui.file.addEventListener('change', () => {
  const file = ui.file.files?.[0];
  if (file) void loadImage(file, file.name);
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file?.type.startsWith('image/')) void loadImage(file, file.name);
});

// Before / after split: drag on the image, or use the slider.
const setSplit = (v: number) => {
  const t = Math.min(1, Math.max(0, v));
  ui.stage.style.setProperty('--split', `${t * 100}%`);
  ui.split.value = String(t);
};
ui.split.addEventListener('input', () => setSplit(Number(ui.split.value)));
ui.compare.addEventListener('change', () => ui.stage.classList.toggle('single', !ui.compare.checked));
ui.after.addEventListener('pointerdown', (e) => {
  if (!ui.compare.checked) return;
  const move = (ev: PointerEvent) => {
    const r = ui.after.getBoundingClientRect();
    setSplit((ev.clientX - r.left) / r.width);
  };
  move(e);
  ui.after.setPointerCapture(e.pointerId);
  ui.after.addEventListener('pointermove', move);
  const stop = () => {
    ui.after.removeEventListener('pointermove', move);
    ui.after.removeEventListener('pointerup', stop);
    ui.after.removeEventListener('pointercancel', stop);
  };
  ui.after.addEventListener('pointerup', stop);
  ui.after.addEventListener('pointercancel', stop);
});
// The before canvas sits on top; let pointer events fall through to the after canvas.
ui.before.style.pointerEvents = 'none';
setSplit(0.5);

// ---------------------------------------------------------------------------------------------
// Zoom and pan.

const zoom = attachZoom(ui.viewport, ui.stage, (v) => {
  updateHandleScale([ui.overlay, ui.geometryOverlay]);
  ui.zoomFit.textContent = v.zoom === 1 ? 'Fit' : `${Math.round(v.zoom * 100)}%`;
  ui.stage.classList.toggle('pixelated', (v.zoom * ui.after.clientWidth) / Math.max(1, ui.after.width) > 2);
});
const ZOOM_STEP = Math.SQRT2;
ui.zoomIn.addEventListener('click', () => zoom.zoomBy(ZOOM_STEP));
ui.zoomOut.addEventListener('click', () => zoom.zoomBy(1 / ZOOM_STEP));
ui.zoomFit.addEventListener('click', () => zoom.set(FIT));
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
  if (e.key === '+' || e.key === '=') zoom.zoomBy(ZOOM_STEP);
  else if (e.key === '-') zoom.zoomBy(1 / ZOOM_STEP);
  else if (e.key === '0') zoom.set(FIT);
});

// ---------------------------------------------------------------------------------------------
// Look gallery: every look applied to a thumbnail of the (framed) original; a click adds its steps.

const THUMB_SIDE = 160;
const lookCards = looks.map((look) => {
  const card = Object.assign(document.createElement('button'), { type: 'button', className: 'look-card', title: `Add the ${look.label} look` });
  card.dataset.look = look.id;
  card.setAttribute('role', 'listitem');
  const canvas = document.createElement('canvas');
  card.append(canvas, Object.assign(document.createElement('span'), { textContent: look.label }));
  card.addEventListener('click', () => {
    const added = lookSteps(look).map((s) => ({ ...newStep(s.filter), params: { ...defaultParams(s.filter.params), ...s.params } }));
    chain = { ...chain, steps: [...chain.steps, ...added], selected: added[0]?.uid ?? chain.selected };
    chainUi.set(chain, true);
    showOverlay();
    void render();
  });
  ui.looks.append(card);
  return { look, canvas };
});

// Effect browser (Ctrl+K): every effect on a thumbnail of the framed original, at its preview values.
const effectBrowser = createEffectBrowser({
  filters,
  thumbnails: (batch) => {
    const result = loads.then(async () =>
      loaded ? renderer.thumbnails(batch.map((f) => [{ filter: f, params: { ...defaultParams(f.params), ...f.preview }, enabled: true }]), THUMB_SIDE) : batch.map(() => undefined),
    );
    loads = result.then(() => undefined, () => undefined);
    return result;
  },
  onPick: (f) => chainUi.add(f),
});
document.getElementById('browse')!.addEventListener('click', () => effectBrowser.open());

let thumbnailsQueued = false;
/** Redraws the gallery after the current load / reframe (queued like them, so textures are valid). */
function refreshThumbnails(): void {
  if (thumbnailsQueued) return;
  thumbnailsQueued = true;
  effectBrowser.invalidate();
  refreshStrip();
  loads = loads.then(async () => {
    thumbnailsQueued = false;
    if (!loaded) return;
    try {
      const images = await renderer.thumbnails(lookCards.map((c) => lookSteps(c.look)), THUMB_SIDE);
      images.forEach((img, i) => {
        const { canvas } = lookCards[i]!;
        [canvas.width, canvas.height] = [img.width, img.height];
        canvas.getContext('2d')!.putImageData(img, 0, 0);
        canvas.dataset.ready = '';
      });
    } catch (e) {
      console.error(e);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Auto: suggested white balance and levels for the (framed) original, as ordinary editable steps.

/** Long side of the image Auto analyses: statistics need few pixels. */
const AUTO_SIDE = 256;
ui.auto.addEventListener('click', async () => {
  if (!loaded) return;
  ui.auto.disabled = true;
  try {
    const [w, h] = fitWithin(displaySize[0], displaySize[1], AUTO_SIDE);
    // After any queued load, so it reads the current image.
    const a = autoAdjust(await loads.then(() => renderer.maskSource(w, h)));
    const patch = { whiteBalance: a.whiteBalance, levels: a.levels } as Record<string, Record<string, number>>;
    let steps = [...chain.steps];
    // Update the first existing step of each kind; insert missing ones at the start of the chain
    // (Auto looks at the original, before any other step).
    const missing: typeof steps = [];
    for (const id of ['whiteBalance', 'levels']) {
      const i = steps.findIndex((st) => st.filterId === id);
      if (i >= 0) steps[i] = { ...steps[i]!, params: { ...steps[i]!.params, ...patch[id] }, enabled: true };
      else missing.push({ ...newStep(byId.get(id)!), params: { ...defaultParams(byId.get(id)!.params), ...patch[id] } });
    }
    steps = [...missing, ...steps];
    chain = { ...chain, steps, selected: steps.find((st) => st.filterId === 'levels')!.uid };
    chainUi.set(chain, true);
    showOverlay();
    void render();
    announce(`Auto: temperature ${a.whiteBalance.temperature}, tint ${a.whiteBalance.tint}, levels ${a.levels.inBlack}–${a.levels.inWhite}, gamma ${a.levels.gamma}`);
  } catch (e) {
    announce(`Auto failed: ${(e as Error).message}`);
    console.error(e);
  } finally {
    ui.auto.disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------
// Undo / redo and share links.

interface Snapshot {
  readonly chain: ChainState;
  readonly geometry: Geometry;
}
// States are immutable, so a snapshot is two references. The selection is not an edit.
const history = new History<Snapshot>(
  { chain, geometry },
  { same: (a, b) => a.chain.steps === b.chain.steps && a.chain.selection === b.chain.selection && a.geometry === b.geometry },
);
const updateHistoryButtons = () => {
  ui.undo.disabled = !history.canUndo;
  ui.redo.disabled = !history.canRedo;
};
/** Records the current state once a gesture is over (not while dragging or editing the crop). */
function recordHistory(): void {
  if (dragging || editMode !== 'none') return;
  history.record({ chain, geometry });
  updateHistoryButtons();
}
function applySnapshot(s: Snapshot): void {
  // Keep the selected step if it still exists.
  const selected = chain.selected === SELECTION || s.chain.steps.some((st) => st.uid === chain.selected) ? chain.selected : s.chain.selected;
  chain = { ...s.chain, selected };
  chainUi.set(chain, true);
  if (s.geometry !== geometry) {
    setGeometry(s.geometry);
    geometryControls.refresh();
  }
  showOverlay();
  updateHistoryButtons();
  void render();
}
const undo = () => {
  const s = history.undo();
  if (s) applySnapshot(s);
};
const redo = () => {
  const s = history.redo();
  if (s) applySnapshot(s);
};
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  // Text fields keep their own undo.
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && ['text', 'number'].includes(t.type)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) undo();
  else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
  else return;
  e.preventDefault();
});

// LUTs travel by name: only the looks' baked LUTs can be referenced.
const lutRef = (lut: unknown) => {
  const look = looks.find((l) => lookLut(l) === lut);
  return look && `look:${look.id}`;
};
const resolveLut = (ref: string) => {
  const look = looks.find((l) => `look:${l.id}` === ref);
  return look && lookLut(look);
};

ui.share.addEventListener('click', async () => {
  try {
    const doc = serializeChain(toSteps(chain), { geometry, lutRef });
    const sample = imageSample;
    const text = await encodeState({ chain: doc, ...(sample ? { sample } : {}) });
    const url = `${location.origin}${location.pathname}#s=${text}`;
    window.history.replaceState(null, '', url);
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    announce(`Link copied (${(url.length / 1024).toFixed(1)} KB)${sample ? '' : ' · it applies the edits to a sample image: your own image is not included'}`);
  } catch (e) {
    announce(`Cannot share: ${(e as Error).message}`);
  }
});

/** The edits and sample image in the URL fragment, if any. */
async function readShareLink(): Promise<{ snapshot: Snapshot; sample?: string } | undefined> {
  const text = new URLSearchParams(location.hash.slice(1)).get('s');
  if (!text) return undefined;
  try {
    const state = (await decodeState(text)) as { chain?: unknown; sample?: unknown };
    const { steps, geometry: g } = parseChain(state.chain, { filters, resolveLut });
    const states = steps.map((st) => ({
      ...newStep(st.filter),
      params: { ...defaultParams(st.filter.params), ...st.params },
      enabled: st.enabled !== false,
      ...(st.mask ? { mask: st.mask } : {}),
    }));
    // A mask-aware step from a link without a mask keeps the empty brush newStep gave it.
    return {
      snapshot: { chain: { steps: states, selected: states[0]?.uid }, geometry: g ?? IDENTITY_GEOMETRY },
      ...(typeof state.sample === 'string' ? { sample: state.sample } : {}),
    };
  } catch (e) {
    announce(`Invalid link: ${(e as Error).message}`);
    console.error(e);
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------

async function startRenderer(): Promise<void> {
  try {
    const gpu = await createGpuContext({
      // Shader compile failures and other GPU errors: say so instead of showing a blank image.
      onError: (e) => {
        console.error(e);
        announce(`GPU error: ${e.message.split('\n')[0]}`);
      },
    });
    gpuContext = gpu;
    renderer = gpuRenderer(gpu);
    void gpu.lost.then((info) => {
      if (gpu === gpuContext) void recoverFromDeviceLoss(info);
    });
  } catch (e) {
    console.warn(e);
    gpuContext = undefined;
    renderer = cpuRenderer();
    announce(`WebGPU unavailable (${(e as Error).message}); using the CPU reference.`);
  }
}

/**
 * The GPU device can be lost (driver reset, GPU switch, tab in the background for long): start a
 * new one, upload the current image again and re-render. Chain, masks and geometry are untouched.
 */
async function recoverFromDeviceLoss(info: GPUDeviceLostInfo): Promise<void> {
  console.warn('GPU device lost', info.reason, info.message);
  await startRenderer();
  announce(`The GPU device was lost (${info.message || info.reason}); restarted with ${renderer.name}.`);
  const source = lastSource;
  if (!source) return;
  loads = loads.then(async () => {
    try {
      const image = await createImageBitmap(source);
      const [w, h] = await busyWhile(renderer.load(image, shownGeometry()));
      image.close();
      displaySize = [w, h];
      setImageSize(w, h);
      showOverlay();
      showCrop();
    } catch (e) {
      announce(`Could not restore the image after a device loss: ${(e as Error).message}`);
      console.error(e);
    }
  });
  await loads;
  void render();
}
// For the e2e smoke test: simulate a device loss.
(window as unknown as { rullino: object }).rullino = { loseDevice: () => gpuContext?.device.destroy() };

await startRenderer();
const shared = await readShareLink();
// A share link names its sample; `?sample=<id>` picks one too (the smoke test pins its test image).
const requested = shared?.sample ?? new URLSearchParams(location.search).get('sample');
const first = samples.find((s) => s.id === requested) ?? samples[0]!;
ui.sample.value = first.id;
await loadImage(first.make(), first.label, first.id);
if (shared) {
  // The linked state is where history starts, not an undoable edit of the default chain.
  history.replace(shared.snapshot);
  applySnapshot(shared.snapshot);
} else if (!requested) {
  // A first visit opens on a chain that visibly does something (an identity chain looks broken);
  // an explicit `?sample=` keeps the plain one, which the e2e checks rely on.
  const welcome = looks.find((l) => l.id === 'golden');
  if (welcome) {
    const steps = lookSteps(welcome).map((s) => ({ ...newStep(s.filter), params: { ...defaultParams(s.filter.params), ...s.params } }));
    chain = { ...chain, steps, selected: steps[0]?.uid ?? chain.selected };
    chainUi.set(chain, true);
    history.replace({ chain, geometry });
    void render();
  }
}
