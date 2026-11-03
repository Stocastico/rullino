// The CPU backend of @rullino/web with 1, 2, 4 band workers, copied bands and shared memory, on the
// PLAN chains, in Chromium. Not a test: `pnpm bench:threads:web` runs it (VITE_BENCH_SIZE=4000x3000 by
// default there; `pnpm bench` runs a small size so that CI only checks that it still runs). Browser
// console output is not forwarded, so results go to a file.
import { createImage, serializeChain, type LinearImage, type Step } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks } from '@rullino/presets';
import { commands } from 'vitest/browser';
import { afterAll, it } from 'vitest';
import { createRenderer } from '../src/renderer';

const env = import.meta.env as Record<string, string | undefined>;
const [W, H] = (env.VITE_BENCH_SIZE ?? '640x480').split('x').map(Number) as [number, number];
const RUNS = Number(env.VITE_BENCH_RUNS ?? 3);
const ONLY = env.VITE_BENCH_ONLY ?? '';
const COUNTS = (env.VITE_BENCH_THREADS ?? '1,2,4').split(',').map(Number);

const byId = new Map(filters.map((f) => [f.id, f]));
const step = (id: string, params: Record<string, unknown> = {}): Step => ({ filter: byId.get(id)!, params });
const doc = (steps: Step[]) => JSON.parse(JSON.stringify(serializeChain(steps)));
const chains: Record<string, unknown> = {
  'exposure + curves': doc([step('exposure', { ev: 0.3 }), step('curves', { rgb: [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]] })]),
  'blur + unsharp': doc([step('gaussianBlur', { sigma: 3 }), step('unsharpMask', { amount: 0.8 })]),
  'levels + vignette + grain': doc([step('levels', { inBlack: 0.05 }), step('vignette'), step('grain')]),
  'look (LUT, vignette, grain)': JSON.parse(JSON.stringify(lookEdit(looks[2]!))),
  'blur + equalize + sharpen': doc([step('gaussianBlur', { sigma: 2 }), step('equalize'), step('sharpen')]),
  'kuwahara r4 + sharpen': doc([step('kuwahara', { radius: 4 }), step('sharpen')]),
};

function image(): LinearImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - W / 2, y - H / 2) * 0.08) * (x / W);
      data.set([v * v, v, v * 0.8, 1], (y * W + x) * 4);
    }
  return createImage(W, H, data);
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;

const rows: string[] = [];
afterAll(() =>
  commands.writeFile(
    'packages/web/bench/results.txt',
    `${W}x${H} on the CPU in Chromium (crossOriginIsolated ${String(crossOriginIsolated)}, ${navigator.hardwareConcurrency} cores), median of ${RUNS}; first render, which starts the pool, in brackets\n${rows.join('\n')}\n`,
  ),
);

it('renders the PLAN chains with 1, 2, 4 band workers, by copy and in shared memory', { timeout: 3_600_000 }, async () => {
  const src = image();
  const base: Record<string, number> = {};
  for (const [label, threads, shared] of [...COUNTS.map((n) => [`${n} thread${n > 1 ? 's' : ''}`, n, false] as const), ...COUNTS.filter((n) => n > 1).map((n) => [`${n} threads, shared`, n, true] as const)]) {
    const r = await createRenderer({ backend: 'cpu', threads, pool: { shared } });
    for (const [name, edit] of Object.entries(chains)) {
      if (!name.includes(ONLY)) continue;
      const times: number[] = [];
      for (let i = 0; i <= RUNS; i++) {
        const t = performance.now();
        await r.apply(src, edit);
        times.push(performance.now() - t);
      }
      const med = median(times.slice(1));
      if (threads === 1) base[name] = med;
      rows.push(`${label.padEnd(18)} ${name.padEnd(28)} ${med.toFixed(0).padStart(7)} ms ${base[name] ? `(${(base[name]! / med).toFixed(2)}x)` : ''} [${times[0]!.toFixed(0)}]`);
    }
    r.destroy();
  }
});
