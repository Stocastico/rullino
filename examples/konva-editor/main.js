// A Konva photo editor in one file: sliders build an edit document, attachEdit() renders it on the
// Konva.Image at the size it has on screen (WebGPU, or the CPU in a Web Worker), Export renders the
// same document on the full-resolution photo.
import { attachEdit } from '@rullino/konva';
import { lookEdit, looks } from '@rullino/presets';
import { createRenderer } from '@rullino/web';
import Konva from 'konva';

const photo = new Image();
photo.src = new URL('./photo.jpg', import.meta.url).href;
await photo.decode();

// The stage: the photo at 640 px wide, draggable, with a transformer to resize it.
const width = 640;
const height = Math.round((width * photo.naturalHeight) / photo.naturalWidth);
const stage = new Konva.Stage({ container: 'stage', width, height });
const layer = new Konva.Layer();
stage.add(layer);
const node = new Konva.Image({ image: photo, width, height, draggable: true });
layer.add(node, new Konva.Transformer({ nodes: [node], keepRatio: true }));

const renderer = await createRenderer(); // WebGPU if the browser has it, else the CPU in a worker
const editor = await attachEdit(node, { renderer });
const status = document.querySelector('#status');
status.value = `Rendering on ${renderer.backend === 'gpu' ? 'WebGPU' : `the CPU (${renderer.reason})`}`;

// The edit document: plain JSON, the same the browser, a worker and @rullino/node render.
const form = document.querySelector('#controls');
for (const look of looks) form.look.add(new Option(look.label, look.id));
function edit() {
  const look = looks.find((l) => l.id === form.look.value);
  return {
    version: 2,
    steps: [
      { filter: 'exposure', params: { ev: Number(form.ev.value) } },
      { filter: 'contrast', params: { amount: Number(form.contrast.value) } },
      { filter: 'saturation', params: { amount: Number(form.saturation.value) } },
      ...(look ? lookEdit(look).steps : []),
    ],
  };
}

// Every slider move: set() renders the latest document and drops the ones it had no time for.
form.addEventListener('input', () => editor.set(edit()));
// Resizing the node changes its size on screen: render again at the new size.
node.on('transformend', () => editor.set(edit()));

document.querySelector('#export').addEventListener('click', async () => {
  const blob = await editor.export({ ...edit(), output: { format: 'jpeg', quality: 0.9 } });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'edited.jpg' });
  a.click();
  URL.revokeObjectURL(a.href);
});

await editor.set(edit());
window.example = { node, editor, edit }; // for the smoke test
