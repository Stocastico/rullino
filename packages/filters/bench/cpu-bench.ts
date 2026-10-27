// CPU timings: the three PLAN §6b chains (12 MP by default) and every registered filter at
// 1024x768, the reference and the fast path (where a filter has one). Not a test: `pnpm bench:cpu` bundles this
// file and runs it in plain Node, because Vitest's module runner turns every call to an imported
// function into a getter call, which made the small functions of the fast paths look 4x slower.
// Arguments: `chains` and/or `filters` (default both), `--only <filter id>`, `--size <w>x<h>` for the
// chains (default 4000x3000).
import { createImage, defaultParams, lutFromFunction, runChainCpu, type LinearImage, type Step } from '@rullino/core';
import { filters } from '../src';

const ms = (t: number) => `${t.toFixed(0).padStart(8)} ms`;
/** Reference time, and the fast path's when the filter (or a filter of the chain) has one. */
const row = (name: string, ref: number, fast?: number) => console.log(`${name.padEnd(34)} ${ms(ref)}${fast === undefined ? '' : `   fast ${ms(fast)}`}`);

function image(w: number, h: number): LinearImage {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w / 2, y - h / 2) * 0.08) * (x / w);
      data.set([v * v, v, v * 0.8, 1], (y * w + x) * 4);
    }
  return createImage(w, h, data);
}

function time(run: () => unknown): number {
  const t0 = performance.now();
  run();
  return performance.now() - t0;
}

const byId = new Map(filters.map((f) => [f.id, f]));
const step = (id: string, params: Record<string, unknown> = {}): Step => ({ filter: byId.get(id)!, params });

/** The chains PLAN §6b measured (26 Oct, another machine: 10.0 s, 8.0 s, 14.3 s at 12 MP). */
const planChains: Record<string, Step[]> = {
  'exposure + curves + LUT': [
    step('exposure', { ev: 0.3 }),
    step('curves', { rgb: [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]] }),
    step('applyLut', { look: lutFromFunction(33, (r, g, b) => [Math.sqrt(r), g * g, (r + b) / 2]) }),
  ],
  'blur + unsharp': [step('gaussianBlur', { sigma: 3 }), step('unsharpMask', { amount: 0.8 })],
  'levels + vignette + grain': [step('levels', { inBlack: 0.05 }), step('vignette'), step('grain')],
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const [cw, ch] = (args.includes('--size') ? args[args.indexOf('--size') + 1]! : '4000x3000').split('x').map(Number) as [number, number];
const parts: string[] = args.filter((a) => a === 'chains' || a === 'filters');
const run = (part: string) => parts.length === 0 || parts.includes(part);

if (run('chains')) {
  const src = image(cw, ch);
  console.log(`${cw}x${ch}:`);
  for (const [name, steps] of Object.entries(planChains)) {
    row(`chain: ${name}`, time(() => runChainCpu(steps, src)), time(() => runChainCpu(steps, src, { fast: true })));
    for (const s of steps) if (s.filter.fast) row(`  ${s.filter.id}`, time(() => runChainCpu([s], src)), time(() => runChainCpu([s], src, { fast: true })));
  }
}

if (run('filters')) {
  console.log('1024x768:');
  const src = image(1024, 768);
  const hole = { kind: 'radial', center: [0.5, 0.5], radius: [0.15, 0.1], feather: 0.3 } as const;
  for (const f of filters) {
    if (only && f.id !== only) continue;
    const mask = f.kind === 'multipass' && f.usesMask ? hole : undefined;
    const steps: Step[] = [{ filter: f, params: defaultParams(f.params), ...(mask && { mask }) }];
    row(f.id, time(() => runChainCpu(steps, src)), f.fast && time(() => runChainCpu(steps, src, { fast: true })));
  }
}
