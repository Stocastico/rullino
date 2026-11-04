import { createGpuContext, type GpuContext, type Rgba8Image } from '@rullino/core';
import { parityMarkdown, runParity, type ParityResult } from '../../../packages/filters/report/parity';

// Parameters: ?only=exposure,gaussianBlur limits the parity check to those filters; ?auto=1 runs
// the parity check on load (the smoke test does).
const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',').filter(Boolean);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

let ctx: GpuContext | undefined;
let parity: ParityResult | undefined;
let envText = '';
let speedText = '';

async function describeEnvironment(): Promise<string> {
  const lines = [
    `Browser: ${navigator.userAgent}`,
    `Platform: ${navigator.platform}, ${navigator.hardwareConcurrency ?? '?'} logical cores, memory hint ${(navigator as { deviceMemory?: number }).deviceMemory ?? 'n/a'} GB, pixel ratio ${devicePixelRatio}`,
    `Secure context: ${isSecureContext}; cross-origin isolated: ${crossOriginIsolated}`,
  ];
  if (!navigator.gpu) {
    lines.push('WebGPU: NOT AVAILABLE in this browser (rullino would use its CPU backend here).');
    return lines.join('\n');
  }
  try {
    ctx = await createGpuContext();
    const adapter = (await navigator.gpu.requestAdapter()) as (GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo>; isFallbackAdapter?: boolean }) | null;
    const info: Partial<GPUAdapterInfo> = adapter?.info ?? (await adapter?.requestAdapterInfo?.()) ?? {};
    lines.push(
      `WebGPU: available. Adapter: ${[info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || '(the browser hides the adapter details)'}`,
      `Software adapter: ${adapter?.isFallbackAdapter ?? info.isFallbackAdapter ?? 'unknown'}; max texture ${ctx.limits.maxTextureDimension2D} px; max buffer ${Math.round(ctx.limits.maxBufferSize / 2 ** 20)} MB`,
    );
  } catch (e) {
    lines.push(`WebGPU: present but could not start: ${(e as Error).message}`);
  }
  return lines.join('\n');
}

function renderParity(result: ParityResult) {
  const failing = result.rows.filter((r) => !r.pass).length;
  const affected = result.groups.filter((g) => g.failing > 0);
  const head = `<p class="${failing ? 'bad' : 'ok'}"><strong>${result.rows.length} cases, ${failing} outside the published tolerance${affected.length ? ` (${affected.length} filters)` : ''}.</strong></p>`;
  const table = affected.length
    ? `<table><tr><th>Filter</th><th>Failing / cases</th><th>Worst abs</th><th>Published abs</th></tr>${affected.map((g) => `<tr><td>${g.id}</td><td>${g.failing} / ${g.cases}</td><td>${g.worstAbs.toPrecision(3)}</td><td>${g.tolerance.abs}</td></tr>`).join('')}</table>`
    : '<p>Every filter agrees with its CPU reference within the published tolerance on this GPU.</p>';
  $('parity').innerHTML = head + table;
}

async function runParityCheck() {
  if (!ctx) {
    $('status').textContent = 'WebGPU is not available here, so there is nothing to compare. Copy the report anyway: that is the result.';
    parity = undefined;
    updateButtons();
    return;
  }
  $<HTMLButtonElement>('run-parity').disabled = true;
  const bar = $<HTMLProgressElement>('progress');
  bar.hidden = false;
  try {
    parity = await runParity(ctx, {
      ...(only ? { only } : {}),
      onProgress: async (done, total, id) => {
        bar.value = done / total;
        $('status').textContent = `${done + 1} / ${total}: ${id}`;
        await nextFrame(); // let the page repaint between filters (the CPU references are slow on old machines)
      },
    });
    bar.value = 1;
    $('status').textContent = 'Done.';
    $('status').dataset.done = 'parity';
    renderParity(parity);
  } catch (e) {
    $('status').textContent = `The check stopped: ${(e as Error).message}`;
    $('status').dataset.done = 'error';
  }
  $<HTMLButtonElement>('run-parity').disabled = false;
  updateButtons();
}

/** A picture with smooth areas and noise, as 8-bit pixels. */
function picture(megapixels: number): Rgba8Image {
  const w = Math.round(Math.sqrt(megapixels * 1e6 * (4 / 3)));
  const h = Math.round(w * 0.75);
  const data = new Uint8Array(w * h * 4);
  let seed = 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      seed = (seed * 16807) % 2147483647;
      const i = (y * w + x) * 4;
      data[i] = (x * 255) / w;
      data[i + 1] = (y * 255) / h;
      data[i + 2] = 96 + (seed & 63);
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

const chain = {
  version: 2,
  steps: [
    { filter: 'exposure', params: { ev: 0.3 } },
    { filter: 'contrast', params: { amount: 0.15 } },
    { filter: 'gaussianBlur', params: { sigma: 3 } },
    { filter: 'unsharpMask', params: {} },
  ],
};

async function runSpeedCheck() {
  $<HTMLButtonElement>('run-speed').disabled = true;
  const out = $('speed');
  const lines: string[] = [];
  const show = (extra = '') => {
    speedText = lines.join('\n');
    out.innerHTML = `<pre>${speedText}${extra}</pre>`;
    updateButtons();
  };
  try {
    const { createRenderer } = await import('@rullino/web');
    for (const backend of ['gpu', 'cpu'] as const) {
      let renderer;
      try {
        renderer = await createRenderer({ backend });
      } catch (e) {
        lines.push(`${backend.toUpperCase()}: not available (${(e as Error).message})`);
        show();
        continue;
      }
      for (const mp of [1, 12]) {
        show(`\n${backend.toUpperCase()} ${mp} MP: running…`);
        await nextFrame();
        const image = picture(mp);
        const runs: number[] = [];
        for (let i = 0; i < (backend === 'gpu' ? 3 : 1); i++) {
          const t = performance.now();
          await renderer.pixels(image, chain);
          runs.push(Math.round(performance.now() - t));
        }
        lines.push(`${backend.toUpperCase()} ${mp} MP (${image.width}x${image.height}): ${runs.map((ms, i) => `${i === 0 ? 'first' : 'next'} ${ms} ms`).join(', ')}`);
        show();
      }
      renderer.destroy();
    }
    out.dataset.done = 'speed';
  } catch (e) {
    lines.push(`Stopped: ${(e as Error).message}`);
    show();
  }
  $<HTMLButtonElement>('run-speed').disabled = false;
}

function report(): string {
  return [
    '# rullino hardware check',
    `Page: ${location.href}`,
    '',
    '## Device',
    envText,
    '',
    ...(speedText ? ['## Speed', speedText, ''] : []),
    ...(parity ? [parityMarkdown(parity)] : ['(parity check not run or WebGPU not available)']),
  ].join('\n');
}

function updateButtons() {
  for (const id of ['copy', 'download']) $<HTMLButtonElement>(id).disabled = !envText;
}

$('run-parity').addEventListener('click', runParityCheck);
$('run-speed').addEventListener('click', runSpeedCheck);
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report());
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Copy failed: use "Download as a file"';
  }
});
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([report()], { type: 'text/markdown' }));
  a.download = `rullino-hardware-check-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

envText = await describeEnvironment();
$('env').textContent = envText;
updateButtons();
$('env').dataset.ready = '1';
if (params.get('auto') === '1') await runParityCheck();
