import { registerOffline } from '../offline';
import { parseCube, type Lut } from '@rullino/core';
import { looks, resolveLookLut } from '@rullino/presets';
import { createRenderer, type Renderer } from '@rullino/web';
import { decodeFile, whereItRan } from '../page';
import { cubeFile, cubeName, DEFAULT_GRADE, gradeSteps, previewEdit, type Grade } from './plan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const REF = 'lut-maker:current';
const PREVIEW_SIDE = 800;
const SLIDERS: { key: keyof Grade; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposure (EV)', min: -2, max: 2, step: 0.05 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01 },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
];

const lookSelect = $<HTMLSelectElement>('look');
for (const l of looks) lookSelect.add(new Option(l.label, l.id));
const inputs = new Map<keyof Grade, HTMLInputElement>([['intensity', $<HTMLInputElement>('intensity')]]);
for (const s of SLIDERS) {
  const box = document.createElement('div');
  box.innerHTML = `<label for="${s.key}">${s.label} <span data-value="${s.key}"></span></label><input id="${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="0" />`;
  $('sliders').append(box);
  inputs.set(s.key, box.querySelector('input')!);
}

let lut: Lut | undefined;
let source: { small: ImageData; scale: number } | undefined;
let renderer: Promise<Renderer> | undefined;
let pending = false;

const grade = (): Grade => ({ ...DEFAULT_GRADE, look: lookSelect.value, ...Object.fromEntries([...inputs].map(([k, el]) => [k, Number(el.value)])) });

function showCode(g: Grade) {
  const look = g.look ? `  ...lookSteps(looks.find((l) => l.id === '${g.look}')!, { intensity: ${g.intensity}, vignette: false, grain: false }),\n` : '';
  const rest = gradeSteps({ ...g, look: '' }).map((s) => `  { filter: f.${s.filter.id}, params: ${JSON.stringify(s.params)} },\n`).join('');
  $('code').textContent = `import { formatCube } from '@rullino/core';
import * as f from '@rullino/filters';
import { bakeLut, looks, lookSteps } from '@rullino/presets';

const steps = [
${look}${rest}];
const cube = formatCube(bakeLut(steps, { size: ${Number($<HTMLSelectElement>('size').value)}, title: ${JSON.stringify($<HTMLInputElement>('title').value)} }));`;
}

/** Bakes the grade (a preview LUT of 33³ while sliding) and redraws the after side through it. */
async function update() {
  if (pending) return;
  pending = true;
  await new Promise(requestAnimationFrame);
  pending = false;
  for (const [k, el] of inputs) for (const v of document.querySelectorAll(`[data-value="${k}"]`)) v.textContent = el.value;
  const g = grade();
  const t0 = performance.now();
  lut = parseCube(cubeFile(g, { size: 33 })); // the file's own numbers (six decimals), not the unrounded bake
  const bakeMs = performance.now() - t0;
  showCode(g);
  $<HTMLButtonElement>('download').disabled = false;
  if (!source) return void ($('status').textContent = `LUT ready (baked in ${bakeMs.toFixed(0)} ms). Load a photo to see it.`);
  const r = await (renderer ??= createRenderer({ resolveLut: (ref) => (ref === REF ? lut : resolveLookLut(ref)) }));
  const after = await r.pixels(source.small, previewEdit(REF));
  const c = $<HTMLCanvasElement>('after');
  [c.width, c.height] = [after.width, after.height];
  c.getContext('2d')!.putImageData(after, 0, 0);
  $('status').textContent = `Previewed ${whereItRan(r)}; LUT baked in ${bakeMs.toFixed(0)} ms. Nothing left this device.`;
  $('status').dataset.frame = String(Number($('status').dataset.frame ?? 0) + 1);
}

$<HTMLInputElement>('photo').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const full = await decodeFile(file);
  const k = Math.min(1, PREVIEW_SIDE / Math.max(full.width, full.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(full.width * k)), Math.max(1, Math.round(full.height * k)));
  const big = new OffscreenCanvas(full.width, full.height);
  big.getContext('2d')!.putImageData(full, 0, 0);
  canvas.getContext('2d')!.drawImage(big, 0, 0, canvas.width, canvas.height);
  const small = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  source = { small, scale: k };
  const before = $<HTMLCanvasElement>('before');
  [before.width, before.height] = [small.width, small.height];
  before.getContext('2d')!.putImageData(small, 0, 0);
  void update();
});

$('download').addEventListener('click', () => {
  const title = $<HTMLInputElement>('title').value;
  const text = cubeFile(grade(), { size: Number($<HTMLSelectElement>('size').value), title });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = cubeName(title);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});
$('reset').addEventListener('click', () => {
  lookSelect.value = '';
  for (const [k, el] of inputs) el.value = String(DEFAULT_GRADE[k]);
  void update();
});
for (const el of [lookSelect, ...inputs.values(), $('size'), $('title')]) el.addEventListener('input', () => void update());
void update();
registerOffline();
