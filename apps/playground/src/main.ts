import {
  activeSteps,
  createGpuContext,
  decodeSrgb8,
  downscale,
  encodeImage,
  encodeSrgb8,
  exportImage,
  fitWithin,
  importImage,
  Pipeline,
  readSrgb8,
  runChainCpu,
  type ExportOptions,
  type GpuContext,
  type LinearImage,
  type Step,
} from '@rullino/core';
import { filters } from '@rullino/filters';
import { looks, lookSteps } from '@rullino/presets';
import { newStep, renderChain, type ChainState } from './chain-ui';
import { samples } from './samples';

/** Display resolution: the after/before canvases. Export re-runs the chain at full resolution. */
const DISPLAY_SIDE = 2048;
/** Resolution used while a slider is being dragged. */
const PREVIEW_SIDE = 768;
/** The CPU fallback works at a smaller size to stay usable. */
const CPU_SIDE = 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>('status'),
  sample: $<HTMLSelectElement>('sample'),
  file: $<HTMLInputElement>('file'),
  chain: $<HTMLDivElement>('chain'),
  compare: $<HTMLInputElement>('compare'),
  split: $<HTMLInputElement>('split'),
  stage: $<HTMLElement>('stage'),
  before: $<HTMLCanvasElement>('before'),
  after: $<HTMLCanvasElement>('after'),
  exportFormat: $<HTMLSelectElement>('export-format'),
  exportQuality: $<HTMLInputElement>('export-quality'),
  exportButton: $<HTMLButtonElement>('export'),
};
const beforeCtx = ui.before.getContext('2d')!;
const afterCtx = ui.after.getContext('2d')!;

const byId = new Map(filters.map((f) => [f.id, f]));
const exposure = byId.get('exposure')!;
let chain: ChainState = (() => {
  const first = newStep(exposure);
  return { steps: [first], selected: first.uid };
})();

const toSteps = (s: ChainState): Step[] =>
  s.steps.map((st) => ({ filter: byId.get(st.filterId)!, params: st.params, enabled: st.enabled }));

/** Size of the after canvas for the current image; applied when a frame is ready, not on load. */
let displaySize: [number, number] = [0, 0];

/** Draws straight-alpha sRGB bytes onto the after canvas, scaling up if they are a preview. */
async function present(bytes: Uint8ClampedArray<ArrayBuffer>, w: number, h: number) {
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
  /** Loads an image and returns the display size. */
  load(image: ImageBitmap): Promise<[number, number]>;
  render(steps: Step[], preview: boolean): Promise<void>;
  /** Runs the chain at the largest resolution available and encodes the result. */
  export(steps: Step[], options: ExportOptions): Promise<Blob>;
}

// Output goes through readback + putImageData on a 2D canvas rather than a WebGPU canvas:
// configuring a WebGPU canvas loses the device in headless Chromium/SwiftShader (CI, cloud
// sessions), so direct presentation could not be tested.
function gpuRenderer(gpu: GpuContext): Renderer {
  const full = new Pipeline(gpu);
  const small = new Pipeline(gpu);
  let textures: GPUTexture[] = [];
  let original: GPUTexture | undefined;
  let originalScale = 1;
  return {
    name: 'WebGPU',
    async load(image) {
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
      // Pixel-unit params (blur radii...) are defined at the original resolution.
      full.setSource(display, { scale: dw / image.width });
      small.setSource(preview, { scale: pw / image.width });
      // Only now are the previous textures unreferenced (destruction waits for queued GPU work).
      for (const t of textures) t.destroy();
      textures = [...new Set([fullRes, display, preview])];
      original = fullRes;
      originalScale = fullRes.width / image.width;
      ui.before.width = dw;
      ui.before.height = dh;
      beforeCtx.putImageData(new ImageData(await readSrgb8(gpu, display), dw, dh), 0, 0);
      return [dw, dh];
    },
    async render(steps, preview) {
      const out = (preview ? small : full).run(steps);
      await present(await readSrgb8(gpu, out), out.width, out.height);
    },
    async export(steps, options) {
      if (!original) throw new Error('no image loaded');
      // A throwaway Pipeline: full-resolution intermediates are freed as soon as the file is encoded.
      const pipeline = new Pipeline(gpu);
      try {
        pipeline.setSource(original, { scale: originalScale });
        return await exportImage(gpu, pipeline.run(steps), options);
      } finally {
        pipeline.destroy();
      }
    },
  };
}

function cpuRenderer(): Renderer {
  let source: LinearImage | undefined;
  let scale = 1;
  return {
    name: 'CPU reference',
    async load(image) {
      // Canvas resize happens in sRGB; acceptable for the fallback path.
      const [w, h] = fitWithin(image.width, image.height, CPU_SIDE);
      const tmp = new OffscreenCanvas(w, h).getContext('2d')!;
      tmp.drawImage(image, 0, 0, w, h);
      const data = tmp.getImageData(0, 0, w, h);
      source = decodeSrgb8(data.data, w, h);
      scale = w / image.width;
      ui.before.width = w;
      ui.before.height = h;
      beforeCtx.putImageData(data, 0, 0);
      return [w, h];
    },
    async render(steps) {
      if (!source) return;
      const out = runChainCpu(steps, source, { scale });
      await present(encodeSrgb8(out) as Uint8ClampedArray<ArrayBuffer>, out.width, out.height);
    },
    async export(steps, options) {
      if (!source) throw new Error('no image loaded');
      // The CPU fallback only ever has the reduced image.
      return encodeImage(runChainCpu(steps, source, { scale }), options);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering: at most one frame in flight; changes made meanwhile collapse into the next frame.
// While a control is being dragged, frames use the reduced-resolution pipeline.

let renderer: Renderer;
let imageInfo = '';
let imageName = 'image';
let loaded = false;
let dragging = false;
let busy = false;
let dirty = false;
let frames = 0;

async function render() {
  if (!loaded) return;
  if (busy) return void (dirty = true);
  busy = true;
  do {
    dirty = false;
    const preview = dragging;
    const t0 = performance.now();
    try {
      const steps = toSteps(chain);
      await renderer.render(steps, preview);
      const n = activeSteps(steps).length;
      ui.status.textContent = `${renderer.name} · ${imageInfo} · ${n} step${n === 1 ? '' : 's'}${preview ? ' · preview' : ''} · ${(performance.now() - t0).toFixed(1)} ms`;
    } catch (e) {
      ui.status.textContent = `Render failed: ${(e as Error).message}`;
      console.error(e);
    }
  } while (dirty);
  busy = false;
  ui.status.dataset.frame = String(++frames); // lets the e2e smoke test wait for a finished frame
}

// Loads run one at a time (overlapping loads would destroy each other's textures), and a load
// that has been superseded while it was queued is skipped.
let loads: Promise<void> = Promise.resolve();
let latestLoad = 0;

function loadImage(source: ImageBitmapSource, name: string): Promise<void> {
  const id = ++latestLoad;
  loads = loads.then(async () => {
    if (id !== latestLoad) return;
    try {
      const image = await createImageBitmap(source);
      const [w, h] = await renderer.load(image);
      displaySize = [w, h];
      imageName = name.replace(/\.[^.]+$/, '') || 'image';
      imageInfo = `${name} ${image.width}×${image.height}${w < image.width ? ` → ${w}×${h}` : ''}`;
      image.close();
      loaded = true;
    } catch (e) {
      ui.status.textContent = `Could not load ${name}: ${(e as Error).message}`;
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
      const blob = await renderer.export(steps, { ...options, quality });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${imageName}-rullino.${ext}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      ui.status.textContent = `Exported ${a.download} (${(blob.size / 1024).toFixed(0)} KB) in ${(performance.now() - t0).toFixed(0)} ms`;
    } catch (e) {
      ui.status.textContent = `Export failed: ${(e as Error).message}`;
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

renderChain(
  ui.chain,
  filters,
  chain,
  (next) => {
    chain = next;
    void render();
  },
  looks.map((l) => ({ id: l.id, label: l.label, steps: () => lookSteps(l) })),
);
ui.chain.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).matches('input[type=range]')) dragging = true;
});
window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  void render(); // full resolution on release
});

for (const s of samples) ui.sample.append(new Option(s.label, s.id));
ui.sample.addEventListener('change', () => {
  const s = samples.find((s) => s.id === ui.sample.value)!;
  void loadImage(s.make(), s.label);
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

try {
  renderer = gpuRenderer(await createGpuContext());
} catch (e) {
  console.warn(e);
  renderer = cpuRenderer();
  ui.status.textContent = `WebGPU unavailable (${(e as Error).message}); using the CPU reference.`;
}
const first = samples[0]!;
await loadImage(first.make(), first.label);
