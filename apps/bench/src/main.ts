import type { Adapter } from './adapter';
import { CHAIN_LABELS } from './chains';
import { runBench, type BenchRow } from './harness';

// Each library is its own chunk, loaded only when its turn comes (and measured by size).
const ADAPTERS: Record<string, () => Promise<{ adapter: Adapter }>> = {
  'rullino-gpu': () => import('./adapters/rullino-gpu'),
  'rullino-cpu': () => import('./adapters/rullino-cpu'),
  pixi: () => import('./adapters/pixi'),
  photon: () => import('./adapters/photon'),
  vips: () => import('./adapters/vips'),
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const logEl = $('log');
const log = (m: string) => {
  logEl.textContent += `${m}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

for (const id of Object.keys(ADAPTERS)) {
  const on = !params.has('libs') || params.get('libs')!.split(',').includes(id);
  $('libs').insertAdjacentHTML('beforeend', `<label><input type="checkbox" name="lib" value="${id}" ${on ? 'checked' : ''}/> ${id}</label>`);
}
if (params.has('sizes')) $<HTMLInputElement>('sizes').value = params.get('sizes')!;
if (params.has('runs')) $<HTMLInputElement>('runs').value = params.get('runs')!;

async function environment() {
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  const info = adapter?.info;
  return {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
    crossOriginIsolated,
    gpu: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, fallback: (info as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? false } : null,
  };
}

/** Which API the memory figures came from (reported with them). */
let memorySource = 'none';

/** Bytes the page uses: all memory with cross-origin isolation (WASM included), else the JS heap. */
async function memory(): Promise<number | undefined> {
  const p = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>; memory?: { usedJSHeapSize: number } };
  if (crossOriginIsolated && p.measureUserAgentSpecificMemory) {
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 30_000));
    const m = await Promise.race([p.measureUserAgentSpecificMemory().catch(() => undefined), timeout]);
    if (m) {
      memorySource = 'measureUserAgentSpecificMemory (page + workers, WASM included; GPU memory not included)';
      return m.bytes;
    }
  }
  if (p.memory) memorySource = 'performance.memory (JS heap only, coarse: WASM and GPU memory not included)';
  return p.memory?.usedJSHeapSize;
}

/** A photo scaled (cover, centred) to a size through a canvas: 8-bit RGBA. */
function photoAt(bitmap: ImageBitmap) {
  return (w: number, h: number) => {
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d')!;
    const s = Math.max(w / bitmap.width, h / bitmap.height);
    g.drawImage(bitmap, (w - bitmap.width * s) / 2, (h - bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s);
    return g.getImageData(0, 0, w, h).data;
  };
}

const fmt = (v: number | undefined, digits = 0) => (v === undefined ? '' : v.toFixed(digits));

function render(rows: BenchRow[]) {
  const body = rows
    .map((r) =>
      r.error
        ? `<tr><td>${r.label}</td><td>${r.size}</td><td></td><td class="err" colspan="6">${r.error}</td></tr>`
        : `<tr title="${r.note ?? ''}"><td>${r.label}</td><td>${r.size}</td><td>${CHAIN_LABELS[r.chain!]}</td><td>${fmt(r.initMs)}</td><td>${fmt(r.firstMs)}</td><td>${fmt(r.change?.median)}</td><td>${fmt(r.change?.min)}–${fmt(r.change?.max)}</td><td>${fmt(r.diffVsReference, 1)}</td><td>${r.memoryBytes === undefined ? '' : (r.memoryBytes / 2 ** 20).toFixed(0)}</td></tr>`,
    )
    .join('');
  $('table').innerHTML = `<table><tr><th>library</th><th>size</th><th>chain</th><th>init ms</th><th>first ms</th><th>change ms (median)</th><th>min–max</th><th>|Δ| vs rullino</th><th>memory MB</th></tr>${body}</table><p>Hover a row for how the library runs that chain. |Δ| is the mean difference from rullino's result in 8-bit steps (0 = same picture).</p>`;
}

async function run() {
  $<HTMLButtonElement>('run').disabled = true;
  logEl.textContent = '';
  const ids = [...document.querySelectorAll<HTMLInputElement>('input[name=lib]:checked')].map((i) => i.value);
  const sizes = $<HTMLInputElement>('sizes').value.split(',').map((s) => s.trim().split('x').map(Number) as [number, number]);
  const runs = Number($<HTMLInputElement>('runs').value);
  const file = $<HTMLInputElement>('photo').files?.[0];
  const env = await environment();
  if (!crossOriginIsolated) log('warning: not cross-origin isolated: wasm-vips cannot start and memory is the JS heap only (serve with `pnpm bench:web`).');
  const adapters = await Promise.all(ids.map(async (id) => (await ADAPTERS[id]!()).adapter));
  const sizesJson: Record<string, unknown> = await fetch('./sizes.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // Imported here, not statically: rullino's code then counts towards rullino's chunks, not the harness's.
  const tables = (await import('./tables')).benchTables();
  const results = await runBench({ sizes, runs, adapters, tables, image: file ? photoAt(await createImageBitmap(file)) : undefined, memory, log });
  const report = {
    environment: env,
    settings: { sizes: sizes.map(([w, h]) => `${w}x${h}`), runs, image: file ? file.name : 'synthetic', memorySource },
    libraries: Object.fromEntries(adapters.map((a) => [a.id, { label: a.label, version: a.version, backend: a.backend, notes: a.notes, gzip: sizesJson[a.id] }])),
    rows: results.rows,
  };
  render(results.rows);
  log('done.');
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const download = $<HTMLButtonElement>('download');
  download.disabled = false;
  download.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rullino-bench-${env.date.slice(0, 10)}.json`;
    a.click();
  };
  (window as { __report?: unknown }).__report = report;
  $<HTMLButtonElement>('run').disabled = false;
}

$('run').addEventListener('click', () => void run().catch((e) => log(`error: ${(e as Error).stack ?? e}`)));
environment().then((e) => {
  $('env').textContent = `${e.gpu ? `GPU: ${e.gpu.vendor} ${e.gpu.architecture} ${e.gpu.description}${e.gpu.fallback ? ' (software fallback!)' : ''}` : 'no WebGPU adapter'} · ${e.hardwareConcurrency} threads · cross-origin isolated: ${e.crossOriginIsolated}`;
  if (e.gpu?.fallback) $('env').className = 'warn';
});
if (params.has('auto')) void run().catch((e) => {
  log(`error: ${(e as Error).stack ?? e}`);
  (window as { __report?: unknown }).__report = { error: String(e) };
});
