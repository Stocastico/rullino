// `pnpm bench:threads:web [--size WxH] [--threads 1,2,4] [--runs n] [--only text]`: the CPU backend of
// @rullino/web with 1, 2, 4 band workers (copied bands and shared memory) on the PLAN chains, in
// headless Chromium, through the `bench` Vitest project. Prints and writes packages/web/bench/results.txt.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const env = {
  ...process.env,
  VITE_BENCH_SIZE: flag('--size', '4000x3000'),
  VITE_BENCH_THREADS: flag('--threads', '1,2,4'),
  VITE_BENCH_RUNS: flag('--runs', '3'),
  VITE_BENCH_ONLY: flag('--only', ''),
};
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project', 'bench', 'packages/web'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (r.status === 0) console.log(readFileSync(fileURLToPath(new URL('../packages/web/bench/results.txt', import.meta.url)), 'utf8'));
process.exitCode = r.status ?? 1;
