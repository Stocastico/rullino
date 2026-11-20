import { encodeImage, type LinearImage } from '@rullino/core';
import { createRenderer, type Renderer } from '@rullino/web';
import { zipStore } from '../zip';
import { outputName, webExportEdit, type WebExportOptions, type WebFormat } from './plan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const files = $<HTMLInputElement>('files');
const longSide = $<HTMLInputElement>('long-side');
const format = $<HTMLSelectElement>('format');
const quality = $<HTMLInputElement>('quality');
const sharpen = $<HTMLInputElement>('sharpen');
const exportButton = $<HTMLButtonElement>('export');
const status = $('status');
const results = $('results');
const code = $('code');

let renderer: Promise<Renderer> | undefined;
let downloadUrl: string | undefined;

function options(): WebExportOptions {
  const side = longSide.value.trim();
  return {
    ...(side !== '' && { longSide: Number(side) }),
    sharpen: Number(sharpen.value),
    format: format.value as WebFormat,
    quality: Number(quality.value),
  };
}

function showCode() {
  $('quality-value').textContent = quality.value;
  $('sharpen-value').textContent = sharpen.value;
  quality.disabled = format.value === 'png';
  try {
    const edit = webExportEdit(options());
    code.textContent = `import { encodeImage } from '@rullino/core';
import { createRenderer } from '@rullino/web';

// One edit document: resize in linear light, then sharpen at the final size.
const edit = ${JSON.stringify(edit, null, 2)};

const renderer = await createRenderer(); // WebGPU, else the CPU in a worker
export async function webReady(pixels: ImageData): Promise<Blob> {
  return encodeImage(await renderer.apply(pixels, edit), edit.output); // no metadata is written
}
// On a server or in a shell: npx rullino render --edit edit.json photos/ -o web/`;
  } catch (e) {
    code.textContent = (e as Error).message;
  }
}

async function decode(file: File): Promise<ImageData> {
  // createImageBitmap applies the EXIF orientation, so portrait photos stay upright.
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function run() {
  const list = [...(files.files ?? [])];
  if (!list.length) return;
  let edit;
  try {
    edit = webExportEdit(options());
  } catch (e) {
    status.textContent = (e as Error).message;
    return;
  }
  exportButton.disabled = true;
  results.replaceChildren();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  delete status.dataset.done;
  const r = await (renderer ??= createRenderer());
  const where = r.backend === 'gpu' ? 'on this device’s GPU' : `on this device’s CPU (${r.reason ?? 'no WebGPU'})`;
  const taken = new Set<string>();
  const out: { name: string; data: Uint8Array }[] = [];
  const table = document.createElement('table');
  table.innerHTML = '<tr><th>Photo</th><th>Size</th><th>Exported</th></tr>';
  results.append(table);
  const t0 = performance.now();
  for (const [i, file] of list.entries()) {
    status.textContent = `Exporting ${i + 1} of ${list.length} ${where}…`;
    const row = table.insertRow();
    row.insertCell().textContent = file.name;
    try {
      const pixels = await decode(file);
      const sharp: LinearImage = await r.apply(pixels, edit);
      const blob = await encodeImage(sharp, edit.output);
      const name = outputName(file.name, edit.output.format, taken);
      out.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      row.insertCell().textContent = `${pixels.width}×${pixels.height} → ${sharp.width}×${sharp.height}`;
      row.insertCell().textContent = `${name}, ${kb(blob.size)} (was ${kb(file.size)})`;
    } catch (e) {
      row.insertCell().textContent = 'failed';
      row.insertCell().textContent = (e as Error).message;
      row.classList.add('bad');
    }
  }
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  if (out.length) {
    const single = out.length === 1 ? out[0]! : undefined;
    const blob = single ? new Blob([single.data as BlobPart]) : new Blob([zipStore(out) as BlobPart], { type: 'application/zip' });
    downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = single ? single.name : 'web-ready.zip';
    a.id = 'download';
    a.className = 'download';
    a.textContent = single ? `Download ${single.name}` : `Download ${out.length} photos (zip, ${kb(blob.size)})`;
    results.append(a);
  }
  const failed = list.length - out.length;
  status.textContent = `${out.length} of ${list.length} exported ${where} in ${seconds} s${failed ? `; ${failed} failed (see the table)` : ''}. Nothing left this device.`;
  status.dataset.done = String(out.length);
  exportButton.disabled = false;
}

files.addEventListener('change', () => {
  exportButton.disabled = !files.files?.length;
});
for (const el of [longSide, format, quality, sharpen]) el.addEventListener('input', showCode);
exportButton.addEventListener('click', () => void run());
showCode();
