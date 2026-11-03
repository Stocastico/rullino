// The CPU backend of @rullino/web with 1, 2, 4... band workers on the
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

// Sweeps are interleaved: every round runs every configuration on every chain, one after the other, and
// the table shows the median over the rounds. A run of one configuration after another let drift (other
// load, memory, thermal) pose as a difference between configurations.
interface Config { readonly label: string; readonly threads: number }
const configs: Config[] = [
  ...COUNTS.map((n) => ({ label: `${n} thread${n > 1 ? 's' : ''}`, threads: n })),
];
const out: string[] = [];
afterAll(() =>
  commands.writeFile(
    'packages/web/bench/results.txt',
    `${W}x${H} on the CPU in Chromium (crossOriginIsolated ${String(crossOriginIsolated)}, ${navigator.hardwareConcurrency} cores), median of ${RUNS} interleaved rounds (a fresh renderer per round and configuration, warmed up first)\nms = median; speed-up over 1 thread; banded / inline = milliseconds in segments cut into bands (copies and waiting included) and in segments run on the calling thread\n${out.join('\n')}\n`,
  ),
);

it('renders the PLAN chains with 1, 2, 4... band workers', { timeout: 7_200_000 }, async () => {
  const src = image();
  const names = Object.keys(chains).filter((n) => n.includes(ONLY));
  type Sample = { ms: number; banded: number; inline: number };
  const samples = new Map<string, Sample[]>();
  const key = (c: Config, chain: string) => `${c.label}|${chain}`;
  for (let round = 0; round < RUNS; round++) {
    for (const c of configs) {
      let last = { bandedMs: 0, inlineMs: 0 };
      const r = await createRenderer({ backend: 'cpu', threads: c.threads, pool: { onRender: (i) => (last = i) } });
      await r.apply(src, chains[names[0]!]!); // starts the pool and warms the code up; not measured
      for (const name of names) {
        const t = performance.now();
        await r.apply(src, chains[name]);
        const ms = performance.now() - t;
        (samples.get(key(c, name)) ?? samples.set(key(c, name), []).get(key(c, name))!).push({ ms, banded: last.bandedMs, inline: last.inlineMs });
      }
      r.destroy();
    }
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
  for (const name of names) {
    const base = median(samples.get(key(configs[0]!, name))!.map((s) => s.ms));
    out.push(`${name}`);
    for (const c of configs) {
      const all = samples.get(key(c, name))!;
      const ms = median(all.map((s) => s.ms));
      const spread = `${Math.min(...all.map((s) => s.ms)).toFixed(0)}-${Math.max(...all.map((s) => s.ms)).toFixed(0)}`;
      out.push(`  ${c.label.padEnd(18)} ${ms.toFixed(0).padStart(7)} ms (${(base / ms).toFixed(2)}x)  range ${spread.padEnd(11)} banded ${median(all.map((s) => s.banded)).toFixed(0).padStart(6)}  inline ${median(all.map((s) => s.inline)).toFixed(0).padStart(6)}`);
    }
  }
});
