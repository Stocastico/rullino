import {
  createGpuContext,
  decodeSrgb8,
  encodeSrgb8,
  readImage,
  runPointwise,
  uploadImage,
  type GpuContext,
  type LinearImage,
} from '@rullino/core';
import { exposure } from '@rullino/filters';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>('status');
const fileInput = $<HTMLInputElement>('file');
const slider = $<HTMLInputElement>('ev');
const sliderValue = $<HTMLOutputElement>('ev-value');
const canvas = $<HTMLCanvasElement>('out');
const ctx2d = canvas.getContext('2d')!;

const { min, max, step, default: def } = exposure.params.ev;
Object.assign(slider, { min, max, step, value: String(def) });

let gpu: GpuContext | undefined;
let source: LinearImage | undefined;
let sourceTexture: GPUTexture | undefined;

/** Built-in sample: a grey ramp over a hue sweep, so exposure changes are easy to see. */
function sampleImage(): ImageData {
  const w = 512;
  const h = 256;
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = x / (w - 1);
      if (y < h / 2) {
        img.data.set([t * 255, t * 255, t * 255, 255], i);
      } else {
        const hue = t * 6;
        const c = (k: number) => 255 * Math.max(0, Math.min(1, Math.abs(((hue + k) % 6) - 3) - 1));
        img.data.set([c(0), c(4), c(2), 255], i);
      }
    }
  }
  return img;
}

function setSource(img: ImageData) {
  source = decodeSrgb8(img.data, img.width, img.height);
  canvas.width = img.width;
  canvas.height = img.height;
  sourceTexture?.destroy();
  sourceTexture = gpu ? uploadImage(gpu, source) : undefined;
  void render();
}

let rendering = false;
let pending = false;
async function render() {
  if (!source) return;
  if (rendering) return void (pending = true);
  rendering = true;
  const ev = Number(slider.value);
  sliderValue.value = `${ev >= 0 ? '+' : ''}${ev.toFixed(2)} EV`;

  let result: LinearImage;
  if (gpu && sourceTexture) {
    const out = runPointwise(gpu, exposure, sourceTexture, { ev });
    result = await readImage(gpu, out);
    out.destroy();
  } else {
    result = exposure.cpu(source, { ev });
  }
  ctx2d.putImageData(new ImageData(encodeSrgb8(result) as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);

  rendering = false;
  if (pending) {
    pending = false;
    void render();
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const off = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  off.drawImage(bitmap, 0, 0);
  setSource(off.getImageData(0, 0, bitmap.width, bitmap.height));
});
slider.addEventListener('input', () => void render());

try {
  gpu = await createGpuContext();
  status.textContent = 'WebGPU ready.';
} catch (e) {
  status.textContent = `WebGPU unavailable (${(e as Error).message}); using the CPU reference.`;
}
setSource(sampleImage());
