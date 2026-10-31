// Renders on the CPU with 1, 2, 4... worker threads: the PLAN chains at 12 MP by default, through the
// whole renderer (decode, geometry, chain, pool). Not a test: `pnpm bench:threads` bundles this file
// and the worker, then runs it in plain Node. Arguments: `--size <w>x<h>`, `--threads 1,2,4`, `--runs <n>`,
// `--only <text>` (chains whose name contains it).
import { createImage, serializeChain, type LinearImage, type Step } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks } from '@rullino/presets';
import { createRenderer } from '../src/renderer';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1]! : fallback);
const [w, h] = flag('--size', '4000x3000').split('x').map(Number) as [number, number];
const counts = flag('--threads', '1,2,4').split(',').map(Number);
const runs = Number(flag('--runs', '3'));
const only = flag('--only', '');
const workerUrl = new URL(process.env.RULLINO_BENCH_WORKER!);

const byId = new Map(filters.map((f) => [f.id, f]));
const step = (id: string, params: Record<string, unknown> = {}): Step => ({ filter: byId.get(id)!, params });
const doc = (steps: Step[]) => JSON.parse(JSON.stringify(serializeChain(steps)));
const chains: Record<string, unknown> = {
  'exposure + curves': doc([step('exposure', { ev: 0.3 }), step('curves', { rgb: [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]] })]),
  'blur + unsharp': doc([step('gaussianBlur', { sigma: 3 }), step('unsharpMask', { amount: 0.8 })]),
  'levels + vignette + grain': doc([step('levels', { inBlack: 0.05 }), step('vignette'), step('grain')]),
  'look (LUT, vignette, grain)': JSON.parse(JSON.stringify(lookEdit(looks[2]!))),
  'blur + equalize + sharpen (a global step in the middle)': doc([step('gaussianBlur', { sigma: 2 }), step('equalize'), step('sharpen')]),
  'kuwahara r4 + sharpen': doc([step('kuwahara', { radius: 4 }), step('sharpen')]),
};

function image(): LinearImage {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w / 2, y - h / 2) * 0.08) * (x / w);
      data.set([v * v, v, v * 0.8, 1], (y * w + x) * 4);
    }
  return createImage(w, h, data);
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
const src = image();
console.log(`${w}x${h} on the CPU, median of ${runs} (first render of each, which starts the pool, in brackets):`);
const base: Record<string, number> = {};
for (const threads of counts) {
  const r = await createRenderer({ backend: 'cpu', threads, pool: { workerUrl } });
  console.log(`threads ${threads}:`);
  for (const [name, edit] of Object.entries(chains)) {
    if (!name.includes(only)) continue;
    const times: number[] = [];
    for (let i = 0; i <= runs; i++) {
      const t = performance.now();
      await r.apply(src, edit);
      times.push(performance.now() - t);
    }
    const [first, ...rest] = times;
    const m = median(rest);
    base[name] ??= m;
    console.log(`  ${name.padEnd(56)} ${m.toFixed(0).padStart(7)} ms  x${(base[name]! / m).toFixed(2)}  (${first!.toFixed(0)})`);
  }
  r.destroy();
}
