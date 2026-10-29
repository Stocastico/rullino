// WebGPU where the browser has it, otherwise the same edit on the CPU in a Web Worker. Pick the
// backend (or open the page with ?backend=cpu) and drag a slider: the picture is the same within
// the filters' published tolerance, and the page keeps animating either way.
import { createRenderer } from '@rullino/web';

const photo = new Image();
photo.src = new URL('./photo.jpg', import.meta.url).href;
await photo.decode();

// The preview is a 640 px copy of the photo as 8-bit pixels; `scale` tells pixel-sized parameters
// (the blur radius) that it is smaller than the original, so they look the same as at full size.
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
const scale = canvas.width / photo.naturalWidth;

const form = document.querySelector('#controls');
const status = document.querySelector('#status');
form.backend.value = new URLSearchParams(location.search).get('backend') ?? 'auto';

let renderer;
async function pickRenderer() {
  try {
    renderer = await createRenderer({ backend: form.backend.value });
    status.value = renderer.backend === 'gpu' ? 'Rendering on the GPU (WebGPU)' : `Rendering on the CPU in a worker${renderer.reason ? ` (${renderer.reason})` : ''}`;
  } catch (e) {
    renderer = undefined; // backend 'gpu' without WebGPU throws WebGpuUnavailableError
    status.value = `Could not start: ${e.message}`;
  }
}

// The edit document: plain JSON, the same for every backend.
const edit = () => ({
  version: 2,
  steps: [
    { filter: 'exposure', params: { ev: Number(form.ev.value) } },
    ...(Number(form.blur.value) > 0 ? [{ filter: 'gaussianBlur', params: { sigma: Number(form.blur.value) } }] : []),
  ],
});

// One render at a time; moves that arrive meanwhile collapse into the next render.
let running = false;
let again = false;
let renders = 0;
async function render() {
  if (running) return void (again = true);
  running = true;
  do {
    again = false;
    if (!renderer) break;
    const t0 = performance.now();
    ctx.putImageData(await renderer.pixels(source, edit(), { scale }), 0, 0);
    renders++;
    status.value = `${status.value.split(' · ')[0]} · ${Math.round(performance.now() - t0)} ms`;
  } while (again);
  running = false;
}

form.addEventListener('input', render);
form.backend.addEventListener('change', async () => {
  await pickRenderer();
  await render();
});

// Proof that the page stays responsive: the longest gap between animation frames.
let last = performance.now();
let longest = 0;
(function tick(now) {
  longest = Math.max(longest, now - last);
  last = now;
  document.querySelector('#stall').value = `Longest pause of the page: ${Math.round(longest)} ms`;
  requestAnimationFrame(tick);
})(last);

await pickRenderer();
await render();
window.example = { get renderer() { return renderer; }, get renders() { return renders; }, edit }; // for the smoke test
