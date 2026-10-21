import {
  createGpuContext,
  decodeSrgb8,
  defaultParams,
  encodeSrgb8,
  importImage,
  readSrgb8,
  runPointwise,
  type GpuContext,
  type LinearImage,
  type PointwiseFilter,
} from '@rullino/core';
import { filters } from '@rullino/filters';
import { renderControls } from './controls';
import { samples } from './samples';

/** Longest side images are scaled down to on load. Full-resolution processing comes with M2's preview/export split. */
const MAX_SIDE = 2048;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $<HTMLParagraphElement>('status'),
  sample: $<HTMLSelectElement>('sample'),
  file: $<HTMLInputElement>('file'),
  filter: $<HTMLSelectElement>('filter'),
  description: $<HTMLParagraphElement>('filter-description'),
  controls: $<HTMLDivElement>('controls'),
  compare: $<HTMLInputElement>('compare'),
  split: $<HTMLInputElement>('split'),
  stage: $<HTMLElement>('stage'),
  before: $<HTMLCanvasElement>('before'),
  after: $<HTMLCanvasElement>('after'),
};

type AnyFilter = PointwiseFilter<any>;

let filter: AnyFilter = filters[0]!;
let params: Record<string, unknown> = defaultParams(filter.params);

// ---------------------------------------------------------------------------------------------
// Two back ends behind one interface: WebGPU, or the CPU reference implementations as fallback.

interface Renderer {
  readonly name: string;
  load(image: ImageBitmap): void;
  render(): Promise<void>;
}

// Output goes through readback + putImageData on a 2D canvas rather than a WebGPU canvas:
// configuring a WebGPU canvas loses the device in headless Chromium/SwiftShader (CI, cloud
// sessions), so direct presentation could not be tested. Revisit with M2's reduced-size preview.
function gpuRenderer(gpu: GpuContext): Renderer {
  const beforeCtx = ui.before.getContext('2d')!;
  const afterCtx = ui.after.getContext('2d')!;
  let source: GPUTexture | undefined;
  return {
    name: 'WebGPU',
    load(image) {
      source?.destroy();
      source = importImage(gpu, image);
      beforeCtx.clearRect(0, 0, image.width, image.height);
      beforeCtx.drawImage(image, 0, 0);
    },
    async render() {
      if (!source) return;
      const out = runPointwise(gpu, filter, source, params as never);
      const bytes = await readSrgb8(gpu, out);
      out.destroy();
      afterCtx.putImageData(new ImageData(bytes, out.width, out.height), 0, 0);
    },
  };
}

function cpuRenderer(): Renderer {
  const beforeCtx = ui.before.getContext('2d')!;
  const afterCtx = ui.after.getContext('2d')!;
  let source: LinearImage | undefined;
  const put = (ctx: CanvasRenderingContext2D, img: LinearImage) =>
    ctx.putImageData(new ImageData(encodeSrgb8(img) as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return {
    name: 'CPU reference',
    load(image) {
      const tmp = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
      tmp.drawImage(image, 0, 0);
      const data = tmp.getImageData(0, 0, image.width, image.height);
      source = decodeSrgb8(data.data, data.width, data.height);
      beforeCtx.putImageData(data, 0, 0);
    },
    async render() {
      if (source) put(afterCtx, filter.cpu(source, params as never));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering: at most one frame in flight; changes made meanwhile collapse into the next frame.

let renderer: Renderer;
let imageInfo = '';
let busy = false;
let dirty = false;

async function render() {
  if (busy) return void (dirty = true);
  busy = true;
  do {
    dirty = false;
    const t0 = performance.now();
    try {
      await renderer.render();
      ui.status.textContent = `${renderer.name} · ${imageInfo} · ${filter.label} · ${(performance.now() - t0).toFixed(1)} ms`;
    } catch (e) {
      ui.status.textContent = `Render failed: ${(e as Error).message}`;
      console.error(e);
    }
  } while (dirty);
  busy = false;
}

async function loadImage(source: ImageBitmapSource, name: string) {
  const probe = await createImageBitmap(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(probe.width, probe.height));
  const image =
    scale < 1
      ? await createImageBitmap(source, {
          resizeWidth: Math.round(probe.width * scale),
          resizeHeight: Math.round(probe.height * scale),
          resizeQuality: 'high',
        })
      : probe;
  if (image !== probe) probe.close();

  for (const c of [ui.before, ui.after]) {
    c.width = image.width;
    c.height = image.height;
  }
  imageInfo = `${name} ${image.width}×${image.height}${scale < 1 ? ' (scaled)' : ''}`;
  renderer.load(image);
  image.close();
  void render();
}

// ---------------------------------------------------------------------------------------------
// UI wiring.

function selectFilter(id: string) {
  filter = filters.find((f) => f.id === id) ?? filters[0]!;
  params = defaultParams(filter.params);
  ui.description.textContent = filter.description ?? '';
  renderControls(ui.controls, filter.params, params as never, (v) => {
    params = v;
    void render();
  });
  void render();
}

const CATEGORY_LABELS: Record<string, string> = { adjust: 'Adjust', look: 'Look', classic: 'Classic', stylize: 'Stylize' };
for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
  const group = Object.assign(document.createElement('optgroup'), { label });
  for (const f of filters.filter((f) => f.category === category)) group.append(new Option(f.label, f.id));
  if (group.children.length) ui.filter.append(group);
}
ui.filter.addEventListener('change', () => selectFilter(ui.filter.value));

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
  ui.after.addEventListener('pointerup', () => ui.after.removeEventListener('pointermove', move), { once: true });
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
selectFilter(filter.id);
const first = samples[0]!;
await loadImage(first.make(), first.label);
