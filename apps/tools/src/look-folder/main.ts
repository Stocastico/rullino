import { registerOffline } from '../offline';
import { encodeImage, type EditDocument } from '@rullino/core';
import { looks } from '@rullino/presets';
import { createRenderer, type Renderer } from '@rullino/web';
import { outputName, type WebFormat } from '../names';
import { decodeFile, downloadLink, kb, previewCanvas, recipeOf, whereItRan, type OutputFile } from '../page';
import { isPhoto, lookFolderEdit, type LookFolderOptions } from './plan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const folder = $<HTMLInputElement>('folder');
const filesInput = $<HTMLInputElement>('files');
const lookSelect = $<HTMLSelectElement>('look');
const intensity = $<HTMLInputElement>('intensity');
const pasted = $<HTMLTextAreaElement>('document');
const longSide = $<HTMLInputElement>('long-side');
const format = $<HTMLSelectElement>('format');
const quality = $<HTMLInputElement>('quality');
const exportButton = $<HTMLButtonElement>('export');
const cancelButton = $<HTMLButtonElement>('cancel');
const toFolder = $<HTMLInputElement>('to-folder');
const progress = $<HTMLProgressElement>('progress');
const status = $('status');
const problem = $('problem');
const results = $('results');
const previews = $('previews');

const PASTE = 'paste';
const PREVIEWS = 3;
let photos: File[] = [];
let renderer: Promise<Renderer> | undefined;
let cancelled = false;
let previewRun = 0;

for (const l of looks) lookSelect.add(new Option(l.label, l.id));
lookSelect.add(new Option('Paste an edit document…', PASTE));

// Writing straight into a folder needs the File System Access API (Chrome, Edge); elsewhere a zip.
const pickDirectory = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
$('to-folder-box').hidden = !pickDirectory;

function options(): LookFolderOptions {
  const side = longSide.value.trim();
  return {
    source: lookSelect.value === PASTE ? { document: pasted.value } : { look: lookSelect.value, intensity: Number(intensity.value) },
    format: format.value as WebFormat,
    quality: Number(quality.value),
    ...(side !== '' && { longSide: Number(side) }),
  };
}

/** The document, or undefined with the problem shown. */
function currentEdit(): EditDocument | undefined {
  try {
    const doc = lookFolderEdit(options());
    problem.textContent = '';
    return doc;
  } catch (e) {
    problem.textContent = (e as Error).message;
    return undefined;
  }
}

function showCode(doc: EditDocument | undefined) {
  if (!doc) return void ($('code').textContent = 'Fix the document above to see the code.');
  const json = JSON.stringify(doc, null, 2);
  $('code').textContent = `// edit.json
${json}

// Browser (@rullino/web): WebGPU, else the CPU in a worker
import { encodeImage } from '@rullino/core';
import { createRenderer } from '@rullino/web';
const renderer = await createRenderer();
const blob = await encodeImage(await renderer.apply(imageData, edit), edit.output);

// Shell (@rullino/node): every photo of a folder
npx rullino render --edit edit.json photos/ -o out/`;
}

function refresh() {
  $('intensity-value').textContent = intensity.value;
  $('quality-value').textContent = quality.value;
  quality.disabled = format.value === 'png';
  const paste = lookSelect.value === PASTE;
  $('paste-box').hidden = !paste;
  $('intensity-box').hidden = paste;
  const doc = currentEdit();
  showCode(doc);
  exportButton.disabled = !doc || photos.length === 0;
  void drawPreviews(doc);
}

function pick(list: FileList | null) {
  const all = [...(list ?? [])];
  photos = all.filter(isPhoto).sort((a, b) => a.name.localeCompare(b.name));
  const skipped = all.length - photos.length;
  $('picked').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}${skipped ? ` (${skipped} other file${skipped === 1 ? '' : 's'} skipped)` : ''}.`;
  refresh();
}

/** Before / after of the first photos, rendered small (scale passed, so pixel sizes match the export). */
async function drawPreviews(doc: EditDocument | undefined) {
  const run = ++previewRun;
  if (!doc || photos.length === 0) return void previews.replaceChildren();
  const r = await (renderer ??= createRenderer());
  const items: HTMLElement[] = [];
  for (const file of photos.slice(0, PREVIEWS)) {
    try {
      const full = await decodeFile(file);
      const before = previewCanvas(full);
      const small = before.getContext('2d')!.getImageData(0, 0, before.width, before.height);
      const after = await r.pixels(small, { ...doc, output: { ...doc.output, longSide: undefined } }, { scale: before.width / full.width });
      if (run !== previewRun) return;
      const fig = document.createElement('figure');
      fig.append(before, previewCanvas(after), Object.assign(document.createElement('figcaption'), { textContent: file.name }));
      items.push(fig);
    } catch (e) {
      items.push(Object.assign(document.createElement('p'), { className: 'bad', textContent: `${file.name}: ${(e as Error).message}` }));
    }
  }
  if (run === previewRun) {
    previews.replaceChildren(...items);
    previews.dataset.ready = String(++previewRenders);
  }
}
let previewRenders = 0;

async function run() {
  const doc = currentEdit();
  if (!doc || photos.length === 0) return;
  let dir: FileSystemDirectoryHandle | undefined;
  if (toFolder.checked && pickDirectory) {
    try {
      dir = await pickDirectory({ mode: 'readwrite' });
    } catch {
      return; // the picker was dismissed
    }
  }
  cancelled = false;
  exportButton.disabled = true;
  cancelButton.hidden = false;
  progress.hidden = false;
  progress.max = photos.length;
  progress.value = 0;
  delete status.dataset.done;
  for (const old of results.querySelectorAll<HTMLAnchorElement>('#download')) URL.revokeObjectURL(old.href);
  results.replaceChildren();
  const r = await (renderer ??= createRenderer());
  const where = whereItRan(r);
  const taken = new Set<string>();
  const out: OutputFile[] = [];
  const failed: string[] = [];
  const t0 = performance.now();
  for (const [i, file] of photos.entries()) {
    if (cancelled) break;
    status.textContent = `Photo ${i + 1} of ${photos.length} ${where}…`;
    try {
      const blob = await encodeImage(await r.apply(await decodeFile(file), doc), doc.output);
      const name = outputName(file.name, doc.output!.format as WebFormat, taken);
      const data = new Uint8Array(await blob.arrayBuffer());
      if (dir) {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(data as BlobPart);
        await w.close();
      }
      out.push({ name, data });
    } catch (e) {
      failed.push(`${file.name}: ${(e as Error).message}`);
    }
    progress.value = i + 1;
  }
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  const total = out.reduce((n, f) => n + f.data.length, 0);
  if (out.length && !dir) downloadLink(results, out, 'with-look.zip');
  if (failed.length) results.append(...failed.map((f) => Object.assign(document.createElement('p'), { className: 'bad', textContent: f })));
  status.textContent = `${cancelled ? 'Cancelled: ' : ''}${out.length} of ${photos.length} exported ${where} in ${seconds} s (${kb(total)})${dir ? `, written into “${dir.name}”` : ''}. Nothing left this device.`;
  status.dataset.done = String(out.length);
  if (cancelled) status.dataset.cancelled = '';
  else delete status.dataset.cancelled;
  exportButton.disabled = false;
  cancelButton.hidden = true;
}

// A photo exported with rullino carries its edit document (#180): it can be the recipe for the folder.
$<HTMLInputElement>('from-photo').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const recipe = await recipeOf(file);
  if (recipe === undefined) {
    problem.textContent = `${file.name} carries no rullino edit document.`;
    return;
  }
  pasted.value = recipe;
  refresh();
});
folder.addEventListener('change', () => pick(folder.files));
filesInput.addEventListener('change', () => pick(filesInput.files));
for (const el of [lookSelect, intensity, pasted, longSide, format, quality]) el.addEventListener('input', refresh);
lookSelect.addEventListener('change', refresh);
exportButton.addEventListener('click', () => void run());
cancelButton.addEventListener('click', () => {
  cancelled = true;
  status.textContent = 'Cancelling after this photo…';
});
lookSelect.value = 'warm';
refresh();
registerOffline();
